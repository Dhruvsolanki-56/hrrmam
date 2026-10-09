import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/neohealth-logo.svg?raw'
import Icon from './Icon'
import NewProjectModal from './NewProjectModal'

export default function Layout({ title, subtitle, back, actions, children }) {
  const navigate = useNavigate()
  const { pathname, search: qs } = useLocation()
  const onBoard = pathname === '/projects' && qs.includes('view=board')
  const onList = pathname.startsWith('/projects') && !onBoard
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const name = localStorage.getItem('nh-actor') || 'Guest'

  const search = (e) => {
    e.preventDefault()
    navigate(`/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
  }

  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="brand" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
        <nav className="nav" aria-label="Main">
          <span className="nav-h">Dashboard</span>
          <Link to="/" className={`nav-item ${pathname === '/' ? 'active' : ''}`}><Icon name="grid" />Overview</Link>
          <span className="nav-h">Projects</span>
          <Link to="/projects" className={`nav-item ${onList ? 'active' : ''}`}><Icon name="list" />All projects</Link>
          <Link to="/projects?view=board" className={`nav-item ${onBoard ? 'active' : ''}`}><Icon name="board" />Pipeline board</Link>
        </nav>
        <div className="side-foot">
          <i>{name.slice(0, 1).toUpperCase()}</i>
          <div><b>{name}</b><small>Acting as</small></div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Link to="/" className="mlogo" aria-label="Neo Health home" dangerouslySetInnerHTML={{ __html: logo }} />
          <form className="gsearch" onSubmit={search} role="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, codes, categories…" aria-label="Search projects" />
          </form>
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /><span>New project</span></button>
        </header>

        <main className="content">
          <div className="page-head">
            <div>
              {back && <Link to={back} className="backlink"><Icon name="back" size={15} />All projects</Link>}
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {actions && <div className="page-actions">{actions}</div>}
          </div>
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        <Link to="/" className={pathname === '/' ? 'on' : ''}><Icon name="grid" size={22} /><span>Overview</span></Link>
        <Link to="/projects" className={onList ? 'on' : ''}><Icon name="list" size={22} /><span>Projects</span></Link>
        <Link to="/projects?view=board" className={onBoard ? 'on' : ''}><Icon name="board" size={22} /><span>Board</span></Link>
        <button onClick={() => setCreating(true)}><Icon name="plus" size={22} /><span>New</span></button>
      </nav>

      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }} />}
    </div>
  )
}
