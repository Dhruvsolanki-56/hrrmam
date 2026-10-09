import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useStages } from '../App'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { EntityChip, StageBar, StatusPill, fmtDate } from '../components/bits'

const FILTERS = [['all', 'All'], ['active', 'In progress'], ['on_hold', 'On hold'], ['clarification', 'Clarification'], ['rejected', 'Rejected'], ['completed', 'Completed']]

// High-level phases for the board view: columns group the 12 stages.
const PHASES = [
  { name: 'Initiation', keys: ['screening', 'validation', 'director_approval', 'brief'] },
  { name: 'Review & feasibility', keys: ['india_review', 'feasibility', 'commercial_approval'] },
  { name: 'Preparation', keys: ['agreements', 'artwork', 'regulatory'] },
  { name: 'Delivery', keys: ['manufacturing', 'launch'] },
]

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export default function Projects() {
  const stages = useStages()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'board' ? 'board' : 'table'
  const query = params.get('q') || ''
  const [projects, setProjects] = useState(null)
  const [filter, setFilter] = useState('all')
  const [stageKey, setStageKey] = useState('')
  useEffect(() => { api.projects().then(setProjects) }, [])

  const setParam = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, on_hold: 0, clarification: 0, rejected: 0, completed: 0 }
    ;(projects || []).forEach((p) => { c.all++; c[p.status]++ })
    return c
  }, [projects])

  const visible = (projects || []).filter((p) =>
    (filter === 'all' || p.status === filter) &&
    (!stageKey || p.stage_key === stageKey) &&
    `${p.name} ${p.code || ''} ${p.category}`.toLowerCase().includes(query.toLowerCase()))

  const stageOf = (p) => stages.find((s) => s.key === p.stage_key)

  return (
    <Layout title="Projects" subtitle="Track every project and its current stage"
      actions={
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setParam('view', '')}><Icon name="list" size={15} />Table</button>
          <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setParam('view', 'board')}><Icon name="board" size={15} />Board</button>
        </div>
      }>
      <div className="toolbar panel">
        <div className="filters">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {label}<b>{counts[k]}</b>
            </button>
          ))}
        </div>
        <div className="tools">
          <select className="select" value={stageKey} onChange={(e) => setStageKey(e.target.value)} aria-label="Filter by stage">
            <option value="">All stages</option>
            {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <input className="search" placeholder="Filter by name or code…" value={query} onChange={(e) => setParam('q', e.target.value)} aria-label="Filter projects" />
        </div>
      </div>

      {view === 'table' ? (
        <div className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Project</th><th>Current stage</th><th>Entity</th><th>Progress</th><th>Status</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const s = stageOf(p)
                  return (
                    <tr key={p.id}>
                      <td className="proj-cell">
                        <Link to={`/projects/${p.id}`} className="cell-main">
                          <span className={`avatar ${p.project_type === 'In-Licence' ? 'alt' : ''}`}>{initials(p.name)}</span>
                          <span>
                            <strong>{p.name}</strong>
                            <small>{p.code || 'Code pending'} · {p.project_type}{p.category ? ` · ${p.category}` : ''}</small>
                          </span>
                        </Link>
                      </td>
                      <td data-label="Stage"><strong className="stage-name">{s.name}</strong><small className="sub">{s.owner}</small></td>
                      <td data-label="Entity"><EntityChip entity={s.entity} /></td>
                      <td className="progress-cell" data-label="Progress"><StageBar project={p} /></td>
                      <td data-label="Status"><StatusPill status={p.status} /></td>
                      <td className="muted nowrap" data-label="Updated">{fmtDate(p.updated_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {projects && !visible.length && <p className="empty">No projects match these filters.</p>}
          </div>
        </div>
      ) : (
        <div className="board">
          {[...PHASES, { name: 'Closed', closed: true }].map((col) => {
            const items = visible.filter((p) => col.closed ? (p.status === 'rejected' || p.status === 'completed')
              : col.keys.includes(p.stage_key) && p.status !== 'rejected' && p.status !== 'completed')
            return (
              <section key={col.name} className="column">
                <header><h3>{col.name}</h3><span className="count">{items.length}</span></header>
                <div className="cards">
                  {items.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="card">
                      <span className="code">{p.code || 'Code pending'}</span>
                      <strong>{p.name}</strong>
                      <span className="card-stage">{stageOf(p).name}</span>
                      <StageBar project={p} />
                      <div className="card-foot">
                        <EntityChip entity={stageOf(p).entity} />
                        {p.status !== 'active' && <StatusPill status={p.status} />}
                      </div>
                    </Link>
                  ))}
                  {!items.length && <p className="col-empty">No projects</p>}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Layout>
  )
}
