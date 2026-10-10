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

function UserMenu() {
  const { me, users, switchUser, signOut } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Account" aria-expanded={open}><Avatar name={me.name} /></button>
      {open && (
        <div className="popover usermenu-pop">
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
  // `sep` starts a new group in the nav row
  const links = [
    { to: '/', label: 'Overview', on: pathname === '/' },
    { to: '/my-work', label: 'My work', on: pathname === '/my-work' },
    { to: '/projects', label: 'Projects', on: pathname.startsWith('/projects') && !onBoard, sep: true },
    { to: '/projects?view=board', label: 'Board', on: onBoard },
    { to: '/regulatory', label: 'Regulatory', on: pathname === '/regulatory', sep: true },
    { to: '/artwork', label: 'Artwork', on: pathname === '/artwork' },
    { to: '/legal', label: 'Legal', on: pathname === '/legal' },
    { to: '/workflows', label: 'Workflows', on: pathname.startsWith('/workflows'), sep: true },
    { to: '/audit', label: 'Audit trail', on: pathname === '/audit' },
    ...(can('manage_users') ? [{ to: '/admin', label: 'Admin', on: pathname === '/admin' }] : []),
  ]

  const search = (e) => {
    e.preventDefault()
    navigate(`/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-in hdr-top">
          <Link to="/" className="brand" aria-label="Neo Health home">
            <span className="brand-logo" dangerouslySetInnerHTML={{ __html: logo }} />
            <span className="brand-sep" />
            <span className="brand-name">Lifecycle &amp; regulatory</span>
          </Link>
          <div className="hdr-right">
            <form className="gsearch" onSubmit={search} role="search">
              <Icon name="search" size={14} />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
              <kbd>/</kbd>
            </form>
            <Bell />
            {can('manage_project') && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /><span>New project</span></button>}
            <UserMenu />
            <button className="icon-btn m-only" onClick={() => setMore(true)} aria-label="Menu"><Icon name="more" size={18} /></button>
          </div>
        </div>
        <nav className="hdr-in hdr-nav" aria-label="Main">
          {links.map((l) => (
            <span key={l.to} style={{ display: 'contents' }}>
              {l.sep && <span className="sep" />}
              <Link to={l.to} className={l.on ? 'on' : ''} aria-current={l.on ? 'page' : undefined}>{l.label}</Link>
            </span>
          ))}
        </nav>
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

      {more && (
        <div className="overlay sheet-wrap" onClick={() => setMore(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Menu</h3>
            {links.map((l) => <Link key={l.to} to={l.to} onClick={() => setMore(false)} className={l.on ? 'on' : ''}>{l.label}</Link>)}
            {can('manage_project') && <button onClick={() => { setMore(false); setCreating(true) }}><Icon name="plus" />New project</button>}
          </div>
        </div>
      )}

      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }} />}
    </div>
  )
}
