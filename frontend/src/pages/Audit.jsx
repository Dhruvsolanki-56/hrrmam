import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Layout from '../components/Layout'
import { Tabs, fmtDateTime, label } from '../components/bits'
import { useStages } from '../context'

const AREAS = ['', 'stage', 'task', 'legal', 'dossier', 'artwork', 'manufacturer', 'rfi', 'document', 'project']

export default function Audit() {
  const stages = useStages()
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState('')
  const [area, setArea] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  useEffect(() => { api.projects().then(setProjects) }, [])
  useEffect(() => {
    const t = setTimeout(() => api.audit({ project_id: project, area, q, limit: 300 }).then(setRows), 200)
    return () => clearTimeout(t)
  }, [project, area, q])
  const stageName = (k) => stages.find((s) => s.key === k)?.name || ''

  return (
    <Layout title="Audit trail" subtitle="Every change, deadline update, reassignment, return, approval, lock and reopen: who did it, when, and why">
      <div className="toolbar panel">
        <Tabs value={area} onChange={setArea} tabs={AREAS.map((a) => ({ key: a, label: a ? label(a) : 'Everything' }))} />
        <div className="tools">
          <select className="select" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="search" placeholder="Search notes, people, actions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the audit trail" />
        </div>
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>When</th><th>Project</th><th>Area</th><th>Action</th><th>Detail</th><th>By</th></tr></thead>
            <tbody>
              {(rows || []).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted" data-label="When">{fmtDateTime(e.created_at)}</td>
                  <td data-label="Project"><Link to={`/projects/${e.project_id}?tab=activity`}><strong>{e.project_name}</strong></Link><small className="sub">{stageName(e.stage_key)}</small></td>
                  <td data-label="Area"><span className="chip plain">{label(e.area)}</span></td>
                  <td data-label="Action"><strong>{label(e.action)}</strong></td>
                  <td data-label="Detail" className="wrap">{e.note || '–'}</td>
                  <td data-label="By">{e.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <p className="empty">No entries match.</p>}
        </div>
      </div>
    </Layout>
  )
}
