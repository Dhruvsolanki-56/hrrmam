import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { api } from './api'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import Projects from './pages/Projects'

const StagesContext = createContext([])
export const useStages = () => useContext(StagesContext)

export default function App() {
  const [stages, setStages] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.stages().then(setStages).catch(() => setError('Cannot reach the server. Is the backend running?'))
  }, [])
  useEffect(load, [load])

  if (error) return <p className="fatal">{error}</p>
  if (!stages.length) return null

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
