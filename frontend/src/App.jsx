import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { api } from './api'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import Projects from './pages/Projects'
import logo from './assets/neohealth-logo.svg?raw'

const StagesContext = createContext([])
export const useStages = () => useContext(StagesContext)

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
  const [stages, setStages] = useState([])
  const [waking, setWaking] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    const started = Date.now()
    const attempt = () => {
      api.stages()
        .then((s) => { if (!cancelled) setStages(s) })
        .catch(() => {
          if (cancelled) return
          if (Date.now() - started > 120000) return setFailed(true)
          setWaking(true)
          setTimeout(attempt, 3000)
        })
    }
    attempt()
    const t = setTimeout(() => !cancelled && setWaking(true), 2500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])
  useEffect(load, [load])

  if (failed) return <p className="fatal">Cannot reach the server. Please refresh in a moment.</p>
  if (!stages.length) return <Splash waking={waking} />

  return (
    <StagesContext.Provider value={stages}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </StagesContext.Provider>
  )
}
