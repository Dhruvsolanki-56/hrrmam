import { useCallback, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { api, getUid, setUid } from './api'
import { AppContext } from './context'
import Admin from './pages/Admin'
import Artwork from './pages/Artwork'
import Audit from './pages/Audit'
import Dashboard from './pages/Dashboard'
import Legal from './pages/Legal'
import Login from './pages/Login'
import MyWork from './pages/MyWork'
import ProjectDetail from './pages/ProjectDetail'
import Projects from './pages/Projects'
import Regulatory from './pages/Regulatory'
import WorkflowEdit from './pages/WorkflowEdit'
import WorkflowView from './pages/WorkflowView'
import Workflows from './pages/Workflows'
import logo from './assets/neohealth-logo.svg?raw'

/** Free hosting puts the API to sleep; keep retrying and say so instead of showing a blank page. */
function Splash({ waking }) {
  return (
    <div className="splash" role="status">
      <div className="splash-logo" dangerouslySetInnerHTML={{ __html: logo }} />
      <span className="splash-bar"><i /></span>
      <p>{waking ? 'Waking up the server — the first load can take up to a minute.' : 'Loading…'}</p>
    </div>
  )
}

export default function App() {
  const [boot, setBoot] = useState(null) // { stages, config, loginUsers }
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [ready, setReady] = useState(false)
  const [waking, setWaking] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const started = Date.now()
    const t = setTimeout(() => !cancelled && setWaking(true), 2500)
    const attempt = () => {
      Promise.all([api.stages(), api.config(), api.loginUsers()])
        .then(([stages, config, loginUsers]) => { if (!cancelled) setBoot({ stages, config, loginUsers }) })
        .catch(() => {
          if (cancelled) return
          if (Date.now() - started > 120000) return setFailed(true)
          setWaking(true)
          setTimeout(attempt, 3000)
        })
    }
    attempt()
    return () => { cancelled = true; clearTimeout(t) }
  }, [])

  const loadMe = useCallback(async () => {
    if (!getUid()) { setMe(null); setReady(true); return }
    try {
      const [m, u] = await Promise.all([api.me(), api.users()])
      setMe(m); setUsers(u)
    } catch (e) {
      if (e.status === 401) { setUid(null); setMe(null) }
    }
    setReady(true)
  }, [])
  useEffect(() => { if (boot) loadMe() }, [boot, loadMe])

  const switchUser = (id) => { setUid(id); setMe(null); setReady(false); loadMe() }
  const signOut = () => { setUid(null); setMe(null) }
  const refreshMe = () => api.me().then(setMe).catch(() => {})

  if (failed) return <p className="fatal">Cannot reach the server. Please refresh in a moment.</p>
  if (!boot || !ready) return <Splash waking={waking} />
  if (!me) return <Login users={boot.loginUsers} onPick={switchUser} />

  return (
    <AppContext.Provider value={{ stages: boot.stages, config: boot.config, me, users, switchUser, signOut, refreshMe }}>
      {/* key: switching user resets every page so nothing from the previous person lingers */}
      <Routes key={me.id}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/my-work" element={<MyWork />} />
        <Route path="/regulatory" element={<Regulatory />} />
        <Route path="/artwork" element={<Artwork />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/:id" element={<WorkflowView />} />
        <Route path="/workflows/:id/edit" element={<WorkflowEdit />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </AppContext.Provider>
  )
}
