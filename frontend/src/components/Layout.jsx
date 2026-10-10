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
        {me.unread > 0 && <b className="badge">{me.unread > 9 ? '9+' : me.unread}</b>}
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

function UserMenu({ compact }) {
  const { me, users, switchUser, signOut } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div className={`pop-wrap ${compact ? 'm-user' : ''}`} ref={ref}>
      {compact
        ? <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Account" aria-expanded={open}><Avatar name={me.name} /></button>
        : (
          <button className="side-user" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>
            <Avatar name={me.name} />
            <span><b>{me.name}</b><small>{me.role} · {org(me.country)}</small></span>
            <Icon name="more" size={16} />
          </button>
        )}
      {open && (
        <div className={`popover usermenu-pop ${compact ? '' : 'up'}`}>
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

  const onBoard = pathname === '/projects' && qs.includes('view=board')
  const NAV = [
    { h: 'Overview' },
    { to: '/', icon: 'grid', label: 'Dashboard', on: pathname === '/' },
    { to: '/my-work', icon: 'tasks', label: 'My work', on: pathname === '/my-work' },
    { h: 'Projects' },
    { to: '/projects', icon: 'list', label: 'All projects', on: pathname.startsWith('/projects') && !onBoard },
    { to: '/projects?view=board', icon: 'board', label: 'Pipeline board', on: onBoard },
    { h: 'Workstreams' },
    { to: '/regulatory', icon: 'shield', label: 'Regulatory', on: pathname === '/regulatory' },
    { to: '/artwork', icon: 'image', label: 'Artwork', on: pathname === '/artwork' },
    { to: '/legal', icon: 'scale', label: 'Legal register', on: pathname === '/legal' },
    { h: 'Governance' },
    { to: '/workflows', icon: 'activity', label: 'Workflows', on: pathname.startsWith('/workflows') },
    { to: '/audit', icon: 'history', label: 'Audit trail', on: pathname === '/audit' },
    ...(can('manage_users') ? [{ to: '/admin', icon: 'settings', label: 'Admin', on: pathname === '/admin' }] : []),
  ]
  const links = NAV.filter((n) => n.to)
  const on = links.find((l) => l.on)
  // no crumb when it would just repeat the title ("Regulatory / Regulatory portal")
  const section = on && !title?.toLowerCase().includes(on.label.toLowerCase().split(' ')[0]) ? on : null
  const tabs = ['/', '/my-work', '/projects'].map((t) => links.find((l) => l.to === t))

  const search = (e) => {
    e.preventDefault()
    navigate(`/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="side-top">
          <Link to="/" className="brand" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
        </div>
        <p className="side-org">Product lifecycle &amp; regulatory operations</p>
        <nav className="nav" aria-label="Main">
          {NAV.map((n, i) => n.h
            ? <span key={i} className="nav-h">{n.h}</span>
            : <Link key={n.to} to={n.to} className={`nav-item ${n.on ? 'active' : ''}`} aria-current={n.on ? 'page' : undefined}><Icon name={n.icon} size={16} />{n.label}</Link>)}
        </nav>
        <div className="side-foot"><UserMenu /></div>
      </aside>

      <div className="main">
        <div className="sheet-main">
          <header className="topbar">
            <Link to="/" className="mlogo" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
            <nav className="crumbs" aria-label="Breadcrumb">
              {back
                ? <><Link to={back}>{backLabel}</Link><span className="sep">/</span><b>{title}</b></>
                : section && section.label !== title
                  ? <><Link to={section.to}>{section.label}</Link><span className="sep">/</span><b>{title}</b></>
                  : <b>{title}</b>}
            </nav>
            <div className="top-right">
              <form className="gsearch" onSubmit={search} role="search">
                <Icon name="search" size={14} />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
                <kbd>/</kbd>
              </form>
              <Bell />
              <UserMenu compact />
              {can('manage_project') && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /><span>New project</span></button>}
            </div>
          </header>

          <main className="content">
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
      </div>

      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => <Link key={t.to} to={t.to} className={t.on ? 'on' : ''}><Icon name={t.icon} size={20} /><span>{t.label.replace('All projects', 'Projects')}</span></Link>)}
        <button onClick={() => setMore(true)}><Icon name="more" size={20} /><span>More</span></button>
      </nav>
      {more && (
        <div className="overlay sheet-wrap" onClick={() => setMore(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Menu</h3>
            {links.map((l) => <Link key={l.to} to={l.to} onClick={() => setMore(false)} className={l.on ? 'on' : ''}><Icon name={l.icon} />{l.label}</Link>)}
            {can('manage_project') && <button onClick={() => { setMore(false); setCreating(true) }}><Icon name="plus" />New project</button>}
          </div>
        </div>
      )}

      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }} />}
    </div>
  )
}
