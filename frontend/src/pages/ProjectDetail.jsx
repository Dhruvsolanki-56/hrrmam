import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import ActionPanel from '../components/ActionPanel'
import Layout from '../components/Layout'
import StageList from '../components/StageList'
import Timeline from '../components/Timeline'
import { StageBar, StatusPill, fmtDate } from '../components/bits'

export default function ProjectDetail() {
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.project(id).then(setProject).catch((e) => setError(e.message))
  }, [id])

  if (error) return <Layout title="Project" back="/projects"><p className="error">{error}</p></Layout>
  if (!project) return <Layout title="Project" back="/projects" />

  return (
    <Layout title={project.name} subtitle={project.code || 'Project code is issued on Director approval'} back="/projects">
      <section className="panel summary-panel">
        <div className="meta">
          <StatusPill status={project.status} />
          <span className="chip plain">{project.project_type}</span>
          {project.category && <span className="chip plain">{project.category}</span>}
          {project.initiator && <span className="muted">Initiated by <b>{project.initiator}</b></span>}
          <span className="muted">Started {fmtDate(project.created_at)}</span>
        </div>
        {project.summary && <p className="summary">{project.summary}</p>}
        <StageBar project={project} big />
      </section>

      <div className="detail-grid">
        <div className="stack">
          <ActionPanel project={project} onChange={setProject} />
          <section className="panel">
            <header><h3>Activity</h3></header>
            <Timeline events={project.events} />
          </section>
        </div>
        <section className="panel">
          <header><h3>Project journey</h3><span className="muted">12 stages</span></header>
          <StageList project={project} />
        </section>
      </div>
    </Layout>
  )
}
