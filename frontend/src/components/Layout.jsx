import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import logo from '../assets/neohealth-logo.svg?raw'
import NewProjectModal from './NewProjectModal'

const NAV = [
  { to: '/', label: 'Overview', end: true, d: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z' },
  { to: '/projects', label: 'Projects', d: 'M4 6h16M4 12h16M4 18h10' },
]

export default function Layout({ title, subtitle, back, children }) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const name = localStorage.getItem('nh-actor') || 'Guest'

  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="logo" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
        <span className="nav-h">Workspace</span>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={n.d} />
              </svg>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <i>{name.slice(0, 1).toUpperCase()}</i>
          <div><b>{name}</b><small>Acting as</small></div>
        </div>
      </aside>

      <div className="main">
        <header className="ph">
          <nav className="crumbs" aria-label="Breadcrumb">
            {back ? <><Link to={back}>Projects</Link><span className="sep">/</span><span className="cur">{title}</span></>
              : <span className="cur">{title}</span>}
          </nav>
          <button className="btn primary sm" onClick={() => setCreating(true)}>+ New project</button>
        </header>
        <main className="content">
          <div className="page-head">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {children}
        </main>
      </div>

      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }} />}
    </div>
  )
}
