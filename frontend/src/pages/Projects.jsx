import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useStages } from '../App'
import Layout from '../components/Layout'
import { EntityChip, StageBar, StatusPill, fmtDate } from '../components/bits'

const FILTERS = [['all', 'All'], ['active', 'In progress'], ['on_hold', 'On hold'], ['clarification', 'Clarification'], ['rejected', 'Rejected'], ['completed', 'Completed']]

export default function Projects() {
  const stages = useStages()
  const [projects, setProjects] = useState(null)
  const [filter, setFilter] = useState('all')
  const [stageKey, setStageKey] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { api.projects().then(setProjects) }, [])

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, on_hold: 0, clarification: 0, rejected: 0, completed: 0 }
    ;(projects || []).forEach((p) => { c.all++; c[p.status]++ })
    return c
  }, [projects])

  const visible = (projects || []).filter((p) =>
    (filter === 'all' || p.status === filter) &&
    (!stageKey || p.stage_key === stageKey) &&
    `${p.name} ${p.code || ''} ${p.category}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <Layout title="Projects" subtitle="Track every project and its current stage">
      <div className="panel table-panel">
        <div className="toolbar">
          <div className="filters">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {label} <b>{counts[k]}</b>
              </button>
            ))}
          </div>
          <div className="tools">
            <select className="select" value={stageKey} onChange={(e) => setStageKey(e.target.value)} aria-label="Filter by stage">
              <option value="">All stages</option>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <input className="search" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Current stage</th><th>Responsible entity</th><th>Progress</th><th>Status</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const s = stages.find((x) => x.key === p.stage_key)
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/projects/${p.id}`} className="cell-main">
                        <span className="code">{p.code || 'Code pending'}</span>
                        <strong>{p.name}</strong>
                        <small>{[p.project_type, p.category].filter(Boolean).join(' · ')}</small>
                      </Link>
                    </td>
                    <td><strong className="stage-name">{s.name}</strong><small className="sub">{s.owner}</small></td>
                    <td><EntityChip entity={s.entity} /></td>
                    <td className="progress-cell"><StageBar project={p} /></td>
                    <td><StatusPill status={p.status} /></td>
                    <td className="muted nowrap">{fmtDate(p.updated_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {projects && !visible.length && <p className="empty">No projects match these filters.</p>}
        </div>
      </div>
    </Layout>
  )
}
