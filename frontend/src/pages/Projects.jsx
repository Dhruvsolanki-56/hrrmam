import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { AgeChip, EntityChip, HealthPill, Person, StageBar, StatusPill, fmtDay, initials } from '../components/bits'
import { stageOf, useStages } from '../context'

const FILTERS = [['all', 'All'], ['active', 'In progress'], ['on_hold', 'On hold'], ['rejected', 'Rejected'], ['completed', 'Completed']]

// Board columns group the 14 stages into the phases of the flow.
const PHASES = [
  { name: 'Initiation', keys: ['opportunity', 'brief'] },
  { name: 'Governance & parallel work', keys: ['commercial', 'legal', 'regulatory', 'artwork', 'manufacturer'] },
  { name: 'Dossier & regulatory', keys: ['dossier_ready', 'submission', 'rfi', 'approval'] },
  { name: 'Delivery', keys: ['readiness', 'manufacturing', 'dispatch', 'completion'] },
]

export default function Projects() {
  const stages = useStages()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'board' ? 'board' : 'table'
  const query = params.get('q') || ''
  const [projects, setProjects] = useState(null)
  const [filter, setFilter] = useState('all')
  const [health, setHealth] = useState('')
  const [stageKey, setStageKey] = useState('')
  useEffect(() => { api.projects().then(setProjects) }, [])

  const setParam = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, on_hold: 0, rejected: 0, completed: 0 }
    ;(projects || []).forEach((p) => { c.all++; c[p.status]++ })
    return c
  }, [projects])

  const visible = (projects || []).filter((p) =>
    (filter === 'all' || p.status === filter) &&
    (!health || p.health === health) &&
    (!stageKey || p.active_stages.includes(stageKey)) &&
    `${p.name} ${p.code || ''} ${p.category} ${p.product}`.toLowerCase().includes(query.toLowerCase()))

  const primary = (p) => stageOf(stages, p.stage_key)
  const extra = (p) => p.active_stages.length - 1

  return (
    <Layout title="Projects" subtitle="Every project, its active phases and its health"
      actions={<>
        <a className="btn line" href={api.exportUrl({ status: filter, stage: stageKey, health, q: query })} download><Icon name="download" size={16} />Excel</a>
        <button className="btn line" onClick={() => window.print()}><Icon name="print" size={16} />PDF</button>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setParam('view', '')}><Icon name="list" size={15} />Table</button>
          <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setParam('view', 'board')}><Icon name="board" size={15} />Board</button>
        </div>
      </>}>
      <p className="print-only">Neo project report · {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <div className="toolbar panel">
        <div className="filters">
          {FILTERS.map(([k, lab]) => (
            <button key={k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{lab}<b>{counts[k]}</b></button>
          ))}
        </div>
        <div className="tools">
          <select className="select" value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Filter by health">
            <option value="">Any health</option><option value="green">On track</option><option value="amber">At risk</option><option value="red">Critical</option>
          </select>
          <select className="select" value={stageKey} onChange={(e) => setStageKey(e.target.value)} aria-label="Filter by phase">
            <option value="">All phases</option>
            {stages.map((s) => <option key={s.key} value={s.key}>{s.phase}. {s.name}</option>)}
          </select>
          <input className="search" placeholder="Filter by name, code, product…" value={query} onChange={(e) => setParam('q', e.target.value)} aria-label="Filter projects" />
        </div>
      </div>

      {view === 'table' ? (
        <div className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Project</th><th>Current phase</th><th>Entity</th><th>Health</th><th>Progress</th><th>Project manager</th><th>Target submission</th></tr></thead>
              <tbody>
                {visible.map((p) => {
                  const s = primary(p)
                  return (
                    <tr key={p.id}>
                      <td className="proj-cell">
                        <Link to={`/projects/${p.id}`} className="cell-main">
                          <span className={`avatar ${p.project_type === 'In-Licence' ? 'alt' : ''}`}>{initials(p.name)}</span>
                          <span><strong>{p.name}</strong><small>{p.code || 'Code pending'} · {p.project_type}{p.product ? ` · ${p.product}` : ''}</small></span>
                        </Link>
                      </td>
                      <td data-label="Phase">
                        <strong className="stage-name">{s.phase}. {s.name}</strong>
                        {extra(p) > 0 && <span className="state state-parallel">+{extra(p)} in parallel</span>}
                        {p.awaiting_approval.length > 0 && <span className="state state-awaiting_approval">Awaiting approval</span>}
                        {p.status !== 'active' && <span className="tiny-gap"><StatusPill status={p.status} /></span>}
                        <AgeChip project={p} />
                      </td>
                      <td data-label="Entity"><EntityChip entity={s.entity} /></td>
                      <td data-label="Health"><HealthPill health={p.health} reasons={p.health_reasons} /></td>
                      <td className="progress-cell" data-label="Progress"><StageBar project={p} /></td>
                      <td data-label="Manager">{p.project_manager ? <Person user={p.project_manager} /> : <span className="muted">–</span>}</td>
                      <td className="muted nowrap" data-label="Target">{fmtDay(p.target_submission)}</td>
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
              : p.active_stages.some((k) => col.keys.includes(k)) && p.status !== 'rejected' && p.status !== 'completed')
            return (
              <section key={col.name} className="column">
                <header><h3>{col.name}</h3><span className="count">{items.length}</span></header>
                <div className="cards">
                  {items.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="card">
                      <span className="code">{p.code || 'Code pending'}</span>
                      <strong>{p.name}</strong>
                      <span className="card-stage">{primary(p).name}{extra(p) > 0 && ` +${extra(p)} parallel`}</span>
                      <StageBar project={p} />
                      <div className="card-foot">
                        <HealthPill health={p.health} reasons={p.health_reasons} />
                        <AgeChip project={p} />
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
