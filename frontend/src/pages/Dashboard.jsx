import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useStages } from '../App'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { AgeChip, EntityChip, STATUS, StatusPill, entityTone, fmtDate } from '../components/bits'

const DONUT = { active: 'var(--neo-green)', on_hold: '#9fa1a1', clarification: 'var(--neo-dark)', completed: 'var(--neo-bright)', rejected: 'var(--neo-black)' }

export default function Dashboard() {
  const stages = useStages()
  const [projects, setProjects] = useState(null)
  useEffect(() => { api.projects().then(setProjects) }, [])

  const d = useMemo(() => {
    const ps = projects || []
    const live = ps.filter((p) => p.status !== 'rejected' && p.status !== 'completed')
    const count = (s) => ps.filter((p) => p.status === s).length
    const stage = (p) => stages.find((s) => s.key === p.stage_key)
    const activeOf = (p) => p.active_stages || [p.stage_key]
    const perStage = Object.fromEntries(stages.map((s) => [s.key, live.filter((p) => activeOf(p).includes(s.key)).length]))
    const perEntity = {}
    live.forEach((p) => {
      new Set(activeOf(p).map((k) => stages.find((s) => s.key === k)?.entity).filter(Boolean))
        .forEach((e) => { perEntity[e] = (perEntity[e] || 0) + 1 })
    })
    const decisions = []
    ps.filter((p) => p.status === 'active' || p.status === 'clarification').forEach((p) => {
      activeOf(p).forEach((k) => {
        if (p.stage_states?.[k] === 'awaiting_approval') decisions.push({ p, s: stages.find((s) => s.key === k) })
      })
    })
    return {
      total: ps.length, live: live.length, active: count('active'), on_hold: count('on_hold'),
      clarification: count('clarification'), completed: count('completed'), rejected: count('rejected'),
      perStage, perEntity, max: Math.max(1, ...Object.values(perStage)), stage,
      decisions,
      overdue: ps.filter((p) => p.overdue).sort((a, b) => b.days_in_stage - b.sla_days - (a.days_in_stage - a.sla_days)),
      recent: ps.slice(0, 5),
    }
  }, [projects, stages])

  if (!projects) return <Layout title="Overview" subtitle="Loading projects…" />

  const segs = ['active', 'on_hold', 'clarification', 'completed', 'rejected']
  let acc = 0
  const donut = d.total
    ? segs.map((k) => { const a = acc; acc += (d[k] / d.total) * 100; return `${DONUT[k]} ${a}% ${acc}%` }).join(', ')
    : 'var(--neo-grey) 0 100%'

  const kpis = [
    { label: 'Total projects', value: d.total, note: `${d.live} still live`, icon: 'folder', tone: 'dark' },
    { label: 'In progress', value: d.active, note: 'in the pipeline', icon: 'activity', tone: 'green' },
    { label: 'On hold', value: d.on_hold, note: 'paused for now', icon: 'pause', tone: 'grey' },
    { label: 'Clarification', value: d.clarification, note: 'awaiting brief', icon: 'help', tone: 'bright' },
    { label: 'Completed', value: d.completed, note: `${d.rejected} rejected`, icon: 'check', tone: 'bright' },
  ]

  return (
    <Layout title="Overview" subtitle="Where every project stands, at a glance">
      <section className="kpis">
        {kpis.map((k) => (
          <article key={k.label} className="kpi">
            <span className={`kpi-icon tone-bg-${k.tone}`}><Icon name={k.icon} size={20} /></span>
            <div>
              <span className="kpi-label">{k.label}</span>
              <b>{k.value}</b>
              <small>{k.note}</small>
            </div>
          </article>
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
            <header><h3>Waiting on</h3><span className="muted">By entity</span></header>
            {Object.keys(d.perEntity).length === 0 && <p className="muted">Nothing in progress.</p>}
            <ul className="entity-list">
              {Object.entries(d.perEntity).sort((a, b) => b[1] - a[1]).map(([e, n]) => (
                <li key={e}><EntityChip entity={e} /><b>{n}</b></li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid-3">
        <div className="panel">
          <header><h3>Needs attention</h3><span className="muted">Over the target time</span></header>
          {!d.overdue.length && <p className="muted">Nothing is overdue. Every live project is within its target time.</p>}
          <ul className="rows">
            {d.overdue.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>
                  <div><strong>{p.name}</strong><small>{d.stage(p).name} · target {p.sla_days} days</small></div>
                  <AgeChip project={p} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>Awaiting approval</h3><span className="muted">{d.decisions.length} pending</span></header>
          {!d.decisions.length && <p className="muted">No projects are waiting on an approval.</p>}
          <ul className="rows">
            {d.decisions.map(({ p, s }) => (
              <li key={`${p.id}-${s.key}`}>
                <Link to={`/projects/${p.id}`}>
                  <div><strong>{p.name}</strong><small>{s.name} · {s.approver}</small></div>
                  <span className="go">Review<Icon name="arrow" size={14} /></span>
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
