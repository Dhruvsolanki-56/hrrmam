import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useStages } from '../App'
import Layout from '../components/Layout'
import { EntityChip, STATUS, StatusPill, entityTone, fmtDate } from '../components/bits'

const DONUT = { active: 'var(--neo-green)', on_hold: '#9fa1a1', clarification: 'var(--neo-dark)', completed: 'var(--neo-bright)', rejected: 'var(--neo-black)' }

export default function Dashboard() {
  const stages = useStages()
  const [projects, setProjects] = useState(null)
  useEffect(() => { api.projects().then(setProjects) }, [])

  const d = useMemo(() => {
    const ps = projects || []
    const live = ps.filter((p) => p.status !== 'rejected' && p.status !== 'completed')
    const count = (s) => ps.filter((p) => p.status === s).length
    const perStage = Object.fromEntries(stages.map((s) => [s.key, live.filter((p) => p.stage_key === s.key).length]))
    const stage = (p) => stages.find((s) => s.key === p.stage_key)
    const perEntity = {}
    live.forEach((p) => { const e = stage(p).entity; perEntity[e] = (perEntity[e] || 0) + 1 })
    return {
      total: ps.length, active: count('active'), on_hold: count('on_hold'), clarification: count('clarification'), completed: count('completed'), rejected: count('rejected'),
      perStage, perEntity, max: Math.max(1, ...Object.values(perStage)), stage,
      decisions: ps.filter((p) => p.status === 'active' && stage(p).gate),
      recent: ps.slice(0, 5),
    }
  }, [projects, stages])

  if (!projects) return <Layout title="Overview" />

  const segs = ['active', 'on_hold', 'clarification', 'completed', 'rejected']
  let acc = 0
  const donut = d.total
    ? segs.map((k) => { const a = acc; acc += (d[k] / d.total) * 100; return `${DONUT[k]} ${a}% ${acc}%` }).join(', ')
    : 'var(--neo-grey) 0 100%'

  const kpis = [
    { label: 'Total projects', value: d.total, note: 'across all stages' },
    { label: 'In progress', value: d.active, note: 'moving through the pipeline' },
    { label: 'On hold', value: d.on_hold, note: 'paused for now' },
    { label: 'Clarification', value: d.clarification, note: 'awaiting updated brief' },
    { label: 'Completed', value: d.completed, note: `${d.rejected} rejected` },
  ]

  return (
    <Layout title="Overview" subtitle="Where every project stands, at a glance">
      <section className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi ${k.hero ? 'hero' : ''}`}>
            <span className="eyebrow">{k.label}</span>
            <b>{k.value}</b>
            <small>{k.note}</small>
          </div>
        ))}
      </section>

      <section className="grid-2">
        <div className="panel">
          <header><h3>Pipeline by stage</h3><span className="muted">Live projects per stage</span></header>
          <ul className="bars">
            {stages.map((s, i) => (
              <li key={s.key}>
                <span className="bar-name"><small>{String(i + 1).padStart(2, '0')}</small>{s.name}</span>
                <span className="bar-track">
                  <span className={`bar-fill tone-${entityTone(s.entity)}`} style={{ width: `${(d.perStage[s.key] / d.max) * 100}%` }} />
                </span>
                <b>{d.perStage[s.key]}</b>
              </li>
            ))}
          </ul>
          <footer className="legend">
            <span><i className="tone-otc" />Neo Health (OTC)</span>
            <span><i className="tone-india" />Neo India Lifeline</span>
            <span><i className="tone-both" />Joint</span>
            <span><i className="tone-other" />CMO / CDMO</span>
          </footer>
        </div>

        <div className="stack">
          <div className="panel">
            <header><h3>Status mix</h3></header>
            <div className="donut-wrap">
              <div className="donut" style={{ background: `conic-gradient(${donut})` }}>
                <span><b>{d.total}</b><small>projects</small></span>
              </div>
              <ul className="donut-legend">
                {segs.map((k) => (
                  <li key={k}><i style={{ background: DONUT[k] }} />{STATUS[k].label}<b>{d[k]}</b></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="panel">
            <header><h3>Waiting on an entity</h3></header>
            {Object.keys(d.perEntity).length === 0 && <p className="muted">Nothing in progress.</p>}
            <ul className="entity-list">
              {Object.entries(d.perEntity).sort((a, b) => b[1] - a[1]).map(([e, n]) => (
                <li key={e}><EntityChip entity={e} /><b>{n}</b></li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid-2 even">
        <div className="panel">
          <header><h3>Awaiting a decision</h3><span className="muted">Approval gates</span></header>
          {!d.decisions.length && <p className="muted">No projects are waiting on an approval.</p>}
          <ul className="rows">
            {d.decisions.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>
                  <div><strong>{p.name}</strong><small>{d.stage(p).name} · {d.stage(p).owner}</small></div>
                  <span className="go">Review →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>Recently updated</h3><Link to="/projects" className="link">View all</Link></header>
          <ul className="rows">
            {d.recent.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>
                  <div><strong>{p.name}</strong><small>{d.stage(p).name} · {fmtDate(p.updated_at)}</small></div>
                  <StatusPill status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Layout>
  )
}
