import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { actionLabel } from '../components/Timeline'
import Layout from '../components/Layout'
import { Skeleton, fmtDateTime, label, usePaged } from '../components/bits'
import { useStages } from '../context'

const AREAS = ['', 'stage', 'task', 'legal', 'dossier', 'artwork', 'manufacturer', 'rfi', 'document', 'project']

export default function Audit() {
  const stages = useStages()
  const navigate = useNavigate()
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
  const { items, pager } = usePaged(rows, 25, `${project}|${area}|${q}`)
  const stageName = (k) => stages.find((s) => s.key === k)?.name || ''

  return (
    <Layout title="Audit trail" subtitle="Every change, deadline update, reassignment, return, approval, lock and reopen: who did it, when, and why">
      <div className="toolbar panel audit-tools">
        <div className="tools">
          <select className="select" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Filter by area">
            {AREAS.map((a) => <option key={a} value={a}>{a ? label(a) : 'Every area'}</option>)}
          </select>
          <select className="select" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="search" placeholder="Search the trail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the audit trail" />
        </div>
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>When</th><th>Project</th><th>Area</th><th>Action</th><th>Detail</th><th>By</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className={`audit-row ${e.link ? 'row-link' : ''}`} onClick={(ev) => { if (e.link && !ev.target.closest('a')) navigate(`/projects/${e.project_id}?${e.link}`) }}>
                  <td className="nowrap muted" data-label="When">{fmtDateTime(e.created_at)}</td>
                  <td data-label="Project" className="audit-proj"><Link to={`/projects/${e.project_id}?tab=activity`}><strong>{e.project_name}</strong></Link><small className="sub">{stageName(e.stage_key)}</small></td>
                  <td data-label="Area"><span className="chip plain">{label(e.area)}</span></td>
                  <td data-label="Action" className="nowrap">{actionLabel(e)}</td>
                  <td data-label="Detail" className={`wrap ${e.note ? '' : 'no-note'}`}>{e.note}{e.to && <small className="sub">Sent to {e.to}</small>}</td>
                  <td data-label="By" className="nowrap">{e.actor}</td>
                  <td className="ev-go">{e.link && <Link to={`/projects/${e.project_id}?${e.link}`} aria-label={`Open ${actionLabel(e)} in ${e.project_name}`}>›</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows && <Skeleton rows={8} card={false} />}
          {rows && !rows.length && <p className="empty">No entries match.</p>}
        </div>
        {pager}
      </div>
    </Layout>
  )
}
