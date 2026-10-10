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
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, close])
  return ref
}

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
      <button className="icon-btn" onClick={toggle} aria-label={`Notifications${me.unread ? `, ${me.unread} unread` : ''}`}>
        <Icon name="bell" size={19} />
        {me.unread > 0 && <b className="badge">{me.unread > 9 ? '9+' : me.unread}</b>}
      </button>
      {open && (
        <div className="popover notifs" role="dialog" aria-label="Notifications">
          <header><h3>Notifications</h3></header>
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
      <button className="usermenu" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>
        <Avatar name={me.name} size={34} />
        <span><b>{me.name}</b><small>{me.role}</small></span>
      </button>
      {open && (
        <div className="popover usermenu-pop">
          <p className="muted">Signed in as <b>{me.name}</b> · {me.role} · {me.country === 'IN' ? 'Neo India' : me.country === 'AU' ? 'Neo Australia' : 'Partner'}</p>
          <label className="field">Switch user <small>(demo — there are no passwords yet)</small>
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

export default function Layout({ title, subtitle, back, backLabel = 'All projects', actions, children }) {
  const navigate = useNavigate()
  const { pathname, search: qs } = useLocation()
  const can = useCan()
  const { me } = useApp()
  const [creating, setCreating] = useState(false)
  const [more, setMore] = useState(false)
  const [q, setQ] = useState('')

  const onBoard = pathname === '/projects' && qs.includes('view=board')
  const NAV = [
    { h: 'Dashboard' },
    { to: '/', icon: 'grid', label: 'Director overview', on: pathname === '/' },
    { to: '/my-work', icon: 'tasks', label: 'My work', on: pathname === '/my-work' },
    { h: 'Projects' },
    { to: '/projects', icon: 'list', label: 'All projects', on: pathname.startsWith('/projects') && !onBoard },
    { to: '/projects?view=board', icon: 'board', label: 'Pipeline board', on: onBoard },
    { h: 'Workstreams' },
    { to: '/regulatory', icon: 'shield', label: 'Regulatory portal', on: pathname === '/regulatory' },
    { to: '/artwork', icon: 'image', label: 'Artwork portal', on: pathname === '/artwork' },
    { to: '/legal', icon: 'scale', label: 'Legal register', on: pathname === '/legal' },
    { h: 'Control' },
    { to: '/workflows', icon: 'board', label: 'Workflows', on: pathname.startsWith('/workflows') },
    { to: '/audit', icon: 'history', label: 'Audit trail', on: pathname === '/audit' },
    ...(can('manage_users') ? [{ to: '/admin', icon: 'settings', label: 'Admin', on: pathname === '/admin' }] : []),
  ]
  const links = NAV.filter((n) => n.to)
  const tabs = ['/', '/my-work', '/projects'].map((t) => links.find((l) => l.to === t))

  const search = (e) => {
    e.preventDefault()
    navigate(`/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }

  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="brand" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
        <nav className="nav" aria-label="Main">
          {NAV.map((n, i) => n.h
            ? <span key={i} className="nav-h">{n.h}</span>
            : <Link key={n.to} to={n.to} className={`nav-item ${n.on ? 'active' : ''}`}><Icon name={n.icon} />{n.label}</Link>)}
        </nav>
        <div className="side-foot">
          <i>{me.name.slice(0, 1)}</i>
          <div><b>{me.name}</b><small>{me.role}</small></div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Link to="/" className="mlogo" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
          <form className="gsearch" onSubmit={search} role="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, codes, products…" aria-label="Search projects" />
          </form>
          <div className="top-right">
            <Bell />
            <UserMenu />
            {can('manage_project') && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /><span>New project</span></button>}
          </div>
        </header>

        <main className="content">
          <div className="page-head">
            <div>
              {back && <Link to={back} className="backlink"><Icon name="back" size={15} />{backLabel}</Link>}
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {actions && <div className="page-actions">{actions}</div>}
          </div>
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => <Link key={t.to} to={t.to} className={t.on ? 'on' : ''}><Icon name={t.icon} size={22} /><span>{t.label.replace('Director overview', 'Overview').replace('All projects', 'Projects')}</span></Link>)}
        <button onClick={() => setMore(true)}><Icon name="more" size={22} /><span>More</span></button>
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
