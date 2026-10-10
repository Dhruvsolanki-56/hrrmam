import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/neohealth-logo.svg?raw'
import { api } from '../api'
import { useApp, useCan } from '../context'
import { Avatar, fmtDateTime } from './bits'
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

function Bell() {
  const { me, refreshMe } = useApp()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)
  const ref = useOutside(open, () => setOpen(false))

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      const rows = await api.notifications().catch(() => [])
      setItems(rows)
      if (rows.some((n) => !n.read)) { await api.markRead({ all: true }).catch(() => {}); refreshMe() }
    }
  }
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="icon-btn" onClick={toggle} aria-label={`Notifications${me.unread ? `, ${me.unread} unread` : ''}`} aria-expanded={open}>
        <Icon name="bell" size={17} />
        {me.unread > 0 && <b className="badge" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover notifs" role="dialog" aria-label="Notifications">
          <header><h3>Notifications</h3>{items && <span className="muted">{items.length}</span>}</header>
          {!items && <p className="muted pad">Loading…</p>}
          {items && !items.length && <p className="muted pad">You're all caught up.</p>}
          <ul>
            {(items || []).map((n) => (
              <li key={n.id} className={`n-${n.kind} ${n.read ? '' : 'unread'}`}>
                <button onClick={() => { setOpen(false); n.project_id && nav(`/projects/${n.project_id}${n.task_id ? '?tab=tasks' : ''}`) }}>
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                  <small>{fmtDateTime(n.created_at)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
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
  const NAV = [
    { to: '/', icon: 'grid', label: 'Overview', on: pathname === '/' },
    { to: '/my-work', icon: 'tasks', label: 'My work', on: pathname === '/my-work' },
    { h: 'Projects' },
    { to: '/projects', icon: 'list', label: 'All projects', on: pathname.startsWith('/projects') && !onBoard },
    { to: '/projects?view=board', icon: 'board', label: 'Board', on: onBoard },
    { h: 'Workstreams' },
    { to: '/regulatory', icon: 'shield', label: 'Regulatory', on: pathname === '/regulatory' },
    { to: '/artwork', icon: 'image', label: 'Artwork', on: pathname === '/artwork' },
    { to: '/legal', icon: 'scale', label: 'Legal', on: pathname === '/legal' },
    { h: 'Governance' },
    { to: '/workflows', icon: 'activity', label: 'Workflows', on: pathname.startsWith('/workflows') },
    { to: '/audit', icon: 'history', label: 'Audit trail', on: pathname === '/audit' },
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

      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }} />}
    </div>
  )
}
