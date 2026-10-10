import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { AgeChip, HealthPill, Person, StageBar, StatusPill, fmtDay, usePaged } from '../components/bits'
import { useStages } from '../context'

const FILTERS = [['all', 'All'], ['active', 'In progress'], ['on_hold', 'On hold'], ['rejected', 'Rejected'], ['completed', 'Completed']]
const doneCount = (p) => Object.values(p.stage_states || {}).filter((s) => s === 'approved' || s === 'bypassed').length

export default function Projects() {
  const stages = useStages()
  // Board columns follow the stage groups of the live workflow.
  const phases = [...new Set(stages.map((s) => s.group || 'Stages'))].map((name) => ({ name, keys: stages.filter((s) => (s.group || 'Stages') === name).map((s) => s.key) }))
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'board' ? 'board' : 'table'
  const query = params.get('q') || ''
  const [projects, setProjects] = useState(null)
  const filter = FILTERS.some(([k]) => k === params.get('status')) ? params.get('status') : 'all'
  const setFilter = (k) => setParam('status', k === 'all' ? '' : k)
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

  const extra = (p) => p.active_stages.length - 1
  const { items: pageRows, pager } = usePaged(visible, 20, `${filter}|${health}|${stageKey}|${query}`)

  return (
    <Layout title={view === 'board' ? 'Pipeline board' : filter === 'completed' ? 'Completed projects' : 'All projects'}
      subtitle={projects ? `${visible.length} of ${projects.length} projects${filter !== 'all' || health || stageKey || query ? ' match the filters' : ''}` : 'Loading…'}
      actions={<>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setParam('view', '')}><Icon name="list" size={14} />List</button>
          <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setParam('view', 'board')}><Icon name="board" size={14} />Board</button>
        </div>
        <a className="btn line" href={api.exportUrl({ status: filter, stage: stageKey, health, q: query })} download><Icon name="download" size={15} />Excel</a>
        <button className="btn line" onClick={() => window.print()}><Icon name="print" size={15} />PDF</button>
      </>}>
      <p className="print-only">Neo project report · {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <div className="toolbar panel">
        <div className="filters" role="tablist" aria-label="Status">
          {FILTERS.map(([k, lab]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`filter ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{lab}<b>{counts[k]}</b></button>
          ))}
        </div>
        <div className="tools">
          <select className="select" value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Filter by health">
            <option value="">Any health</option><option value="green">On track</option><option value="amber">At risk</option><option value="red">Critical</option>
          </select>
          <select className="select" value={stageKey} onChange={(e) => setStageKey(e.target.value)} aria-label="Filter by phase">
            <option value="">Any phase</option>
            {stages.map((s) => <option key={s.key} value={s.key}>{s.phase}. {s.name}</option>)}
          </select>
          <input className="search" placeholder="Filter by name, code, product" value={query} onChange={(e) => setParam('q', e.target.value)} aria-label="Filter projects" />
        </div>
      </div>

      {view === 'table' ? (
        <div className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Project</th><th>Phase</th><th>Health</th><th>Progress</th><th>Manager</th><th>Target submission</th></tr></thead>
              <tbody>
                {pageRows.map((p) => {
                  const s = p.stage
                  return (
                    <tr key={p.id} className="row-link" onClick={(e) => { if (!e.target.closest('a, button, select, input')) navigate(`/projects/${p.id}`) }}>
                      <td className="proj-cell">
                        <Link to={`/projects/${p.id}`} className="cell-main">
                          <strong>{p.name}</strong>
                          <small><span className="code">{p.code || 'no code yet'}</span>· {p.project_type}{p.category ? ` · ${p.category}` : ''}</small>
                        </Link>
                      </td>
                      <td data-label="Phase">
                        <span className="stage-name">{s.name}</span>
                        <span className="sub">
                          {p.status !== 'active' ? <StatusPill status={p.status} /> : <AgeChip project={p} />}
                          {extra(p) > 0 && ` · +${extra(p)} in parallel`}
                          {p.awaiting_approval.length > 0 && ' · awaiting approval'}
                        </span>
                      </td>
                      <td data-label="Health"><HealthPill health={p.health} reasons={p.health_reasons} /></td>
                      <td className="progress-cell" data-label="Progress">
                        <div className="progress"><StageBar project={p} /><small>{doneCount(p)}/{p.stage_order.length}</small></div>
                      </td>
                      <td data-label="Manager">{p.project_manager ? <Person user={p.project_manager} short /> : <span className="muted">–</span>}</td>
                      <td className="nowrap num" data-label="Target">{fmtDay(p.target_submission)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {projects && !visible.length && <p className="empty">No projects match these filters.</p>}
          </div>
          {pager}
        </div>
      ) : (
        <div className="board">
          {[...phases, { name: 'Closed', closed: true }].map((col) => {
            const items = visible.filter((p) => col.closed ? (p.status === 'rejected' || p.status === 'completed')
              : p.active_stages.some((k) => col.keys.includes(k)) && p.status !== 'rejected' && p.status !== 'completed')
            return (
              <section key={col.name} className="column">
                <header><h3>{col.name}</h3><span className="count">{items.length}</span></header>
                <div className="cards">
                  {items.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="card">
                      <div className="card-top"><span className="code">{p.code || 'no code yet'}</span><HealthPill health={p.health} reasons={p.health_reasons} /></div>
                      <strong>{p.name}</strong>
                      <span className="card-stage">{p.stage.name}{extra(p) > 0 && ` · +${extra(p)} parallel`}</span>
                      <div className="progress"><StageBar project={p} /><small>{doneCount(p)}/{p.stage_order.length}</small></div>
                      <div className="card-foot">
                        {p.status !== 'active' ? <StatusPill status={p.status} /> : <AgeChip project={p} />}
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
