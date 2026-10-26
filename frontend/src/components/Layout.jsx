import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/neohealth-logo.svg?raw'
import { api } from '../api'
import { useApp, useCan, useMe } from '../context'
import { Avatar, Toasts, fmtDateTime, projectUrl } from './bits'
import Icon from './Icon'
import NewProjectModal from './NewProjectModal'

/** Click outside to close. */
function useOutside(open, close) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) close() }
    const k = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open, close])
  return ref
}

const org = (c) => (c === 'IN' ? 'Neo India' : c === 'AU' ? 'Neo Health Australia' : 'Partner')

/** The same reminder sent again and again shows once, with how many times it came. */
function collapse(rows) {
  const out = []
  for (const n of rows) {
    const prev = out[out.length - 1]
    if (prev && prev.title === n.title && prev.body === n.body) { prev.times += 1; prev.read = prev.read && n.read; continue }
    out.push({ ...n, times: 1 })
  }
  return out
}

function Bell() {
  const { me, refreshMe } = useApp()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)
  const ref = useOutside(open, () => setOpen(false))
  // loaded in the background, so the list is already there when the bell is clicked
  useEffect(() => { api.notifications().then(setItems).catch(() => setItems([])) }, [me.unread])

  const readAll = async () => {
    await api.markRead({ all: true }).catch(() => {})
    setItems((x) => (x || []).map((n) => ({ ...n, read: true })))
    refreshMe()
  }
  const openOne = (n) => {
    setOpen(false)
    if (!n.read) api.markRead({ ids: [n.id] }).then(refreshMe).catch(() => {})
    if (n.project_id) nav(projectUrl(n.project_id, n.link || (n.task_id ? `tab=tasks&focus=task-${n.task_id}` : '')))
  }
  const rows = collapse(items || [])
  const fresh = rows.filter((n) => !n.read)
  const earlier = rows.filter((n) => n.read)
  const Item = ({ n }) => (
    <li className={`n-${n.kind} ${n.read ? '' : 'unread'}`}>
      <button onClick={() => openOne(n)}>
        <strong>{n.title}{n.times > 1 && <em className="n-times"> ×{n.times}</em>}</strong>
        <span>{tidy(n.body)}</span>
        <small>{fmtDateTime(n.created_at)}</small>
      </button>
    </li>
  )
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notifications${me.unread ? `, ${me.unread} unread` : ''}`} aria-expanded={open}>
        <Icon name="bell" size={17} />
        {me.unread > 0 && <b className="badge num-badge" aria-hidden="true">{me.unread > 99 ? '99+' : me.unread}</b>}
      </button>
      {open && (
        <div className="popover notifs" role="dialog" aria-label="Notifications">
          <header><h3>Notifications</h3>{me.unread > 0 ? <button className="link" onClick={readAll}>Mark all as read</button> : <span className="muted">All read</span>}</header>
          {!items && <p className="muted pad">Loading…</p>}
          {items && !items.length && <p className="muted pad">You're all caught up.</p>}
          {fresh.length > 0 && <p className="n-group">New · {me.unread}</p>}
          <ul>{fresh.map((n) => <Item key={n.id} n={n} />)}</ul>
          {earlier.length > 0 && <p className="n-group">Earlier</p>}
          <ul>{earlier.map((n) => <Item key={n.id} n={n} />)}</ul>
        </div>
      )}
    </div>
  )
}

/** "Project: A · Task: B · Owner: C · Due: D · Action: E" -> "A · B. E". Owner and due date are on the task itself. */
function tidy(body = '') {
  const parts = body.split(' · ').filter((x) => !/^(Owner|Due): /.test(x))
  const head = parts.filter((x) => /^(Project|Task|Stage): /.test(x)).map((x) => x.replace(/^\w+: /, ''))
  const rest = parts.filter((x) => !/^(Project|Task|Stage): /.test(x)).map((x) => x.replace(/^Action: /, ''))
  return [head.join(' · '), rest.join(' · ')].filter(Boolean).join(' — ') || body
}

function UserMenu({ side }) {
  const { me, users, switchUser, signOut } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div className="pop-wrap" ref={ref}>
      {side
        ? (
          <button className="side-user" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>
            <Avatar name={me.name} />
            <span><b>{me.name}</b><small>{me.role}</small></span>
          </button>
        )
        : <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Account" aria-expanded={open}><Avatar name={me.name} /></button>}
      {open && (
        <div className={`popover usermenu-pop ${side ? 'up' : ''}`}>
          <div className="who-am-i"><Avatar name={me.name} /><span><b>{me.name}</b><small>{me.role} · {org(me.country)}</small></span></div>
          <label className="field">Switch user <small>(demo, no passwords yet)</small>
            <select value={me.id} onChange={(e) => { setOpen(false); switchUser(e.target.value) }}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
            </select>
          </label>
          <button className="btn line" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}

/** Page frame. `head={false}` lets a page draw its own header (dashboard, Project 360). */
export default function Layout({ title, subtitle, back, backLabel = 'All projects', actions, head = true, children }) {
  const navigate = useNavigate()
  const { pathname, search: qs } = useLocation()
  const can = useCan()
  const [creating, setCreating] = useState(false)
  const [more, setMore] = useState(false)
  const [q, setQ] = useState('')
  const searchRef = useRef(null)

  // "/" focuses search, like most work tools
  useEffect(() => {
    const k = (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); searchRef.current?.focus() }
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])

  useEffect(() => { setMore(false) }, [pathname, qs])
  useEffect(() => {
    if (!more) return
    const k = (e) => { if (e.key === 'Escape') setMore(false) }
    document.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [more])

  const onBoard = pathname === '/projects' && qs.includes('view=board')
  const onDone = pathname === '/projects' && qs.includes('status=completed')
  const me = useMe()
  const role = me?.role_key
  const lead = ['super_admin', 'director', 'project_manager'].includes(role)
  const who = (...roles) => lead || roles.includes(role)
  const NAV = [
    { to: '/', icon: 'grid', label: 'Overview', on: pathname === '/' },
    { to: '/my-work', icon: 'tasks', label: 'My work', on: pathname === '/my-work' },
    { h: 'Projects' },
    { to: '/projects', icon: 'list', label: 'All projects', on: pathname.startsWith('/projects') && !onBoard && !onDone },
    ...(lead ? [{ to: '/projects?view=board', icon: 'board', label: 'Board', on: onBoard }] : []),
    { to: '/projects?status=completed', icon: 'check', label: 'Completed', on: onDone },
    ...(who('regulatory', 'artwork', 'quality', 'legal') ? [{ h: 'Workstreams' }] : []),
    ...(who('regulatory') ? [{ to: '/regulatory', icon: 'shield', label: 'Regulatory', on: pathname === '/regulatory' }] : []),
    ...(who('artwork', 'regulatory', 'quality') ? [{ to: '/artwork', icon: 'image', label: 'Artwork', on: pathname === '/artwork' }] : []),
    ...(who('legal') ? [{ to: '/legal', icon: 'scale', label: 'Legal', on: pathname === '/legal' }] : []),
    ...(who('regulatory', 'legal') ? [{ h: 'Governance' }, { to: '/audit', icon: 'history', label: 'Audit trail', on: pathname === '/audit' }] : []),
    { h: 'Support' }, { to: '/help', icon: 'help', label: 'How this works', on: pathname === '/help' },
    ...(can('manage_users') ? [{ to: '/admin', icon: 'settings', label: 'Admin', on: pathname === '/admin' }] : []),
  ]
  const links = NAV.filter((n) => n.to)

  const search = (e) => {
    e.preventDefault()
    navigate(`/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }

  return (
    <div className="app">
      {more && <div className="side-scrim" onClick={() => setMore(false)} aria-hidden="true" />}
      <aside className={`side ${more ? 'open' : ''}`} aria-label="Navigation">
        <div className="side-top">
          <Link to="/" className="side-brand" aria-label="Neo Health home">
            <span className="brand-logo" dangerouslySetInnerHTML={{ __html: logo }} />
            <span className="brand-name">Lifecycle &amp; regulatory</span>
          </Link>
          <button className="icon-btn side-close" onClick={() => setMore(false)} aria-label="Close menu"><Icon name="x" size={18} /></button>
        </div>
        {can('manage_project') && <button className="btn primary side-new" onClick={() => { setMore(false); setCreating(true) }}><Icon name="plus" size={15} />New project</button>}
        <nav className="side-nav" aria-label="Main">
          {NAV.map((n, i) => n.h
            ? <span key={i} className="side-h">{n.h}</span>
            : <Link key={n.to} to={n.to} className={n.on ? 'on' : ''} aria-current={n.on ? 'page' : undefined}><Icon name={n.icon} size={16} />{n.label}</Link>)}
        </nav>
        <div className="side-foot"><UserMenu side /></div>
      </aside>

      <div className="main">
      <header className="hdr">
        <div className="hdr-in hdr-top">
          <button className="icon-btn m-only menu-btn" onClick={() => setMore(true)} aria-label="Open menu" aria-expanded={more}><Icon name="menu" size={20} /></button>
          <Link to="/" className="brand m-only" aria-label="Neo Health home">
            <span className="brand-logo" dangerouslySetInnerHTML={{ __html: logo }} />
          </Link>
          <form className="gsearch" onSubmit={search} role="search">
            <Icon name="search" size={14} />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
            <kbd>/</kbd>
          </form>
          <div className="hdr-right">
            <Bell />
            {can('manage_project') && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /><span>New project</span></button>}
            <span className="m-only"><UserMenu /></span>
          </div>
        </div>
      </header>

      <main className="page">
        {back && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to={back}>{backLabel}</Link><span className="sep">/</span><span>{title}</span>
          </nav>
        )}
        {head && (
          <div className="page-head">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {actions && <div className="page-actions">{actions}</div>}
          </div>
        )}
        {children}
      </main>
      </div>

      <Toasts />
      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }} />}
    </div>
  )
}
