import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Layout from '../components/Layout'
import { HealthPill, Tabs } from '../components/bits'
import { useStages } from '../context'

const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
const shortDay = (s) => parseDay(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const KIND = { 'due date': 'Due date request', stage: 'Stage approval', task: 'Task', artwork: 'Artwork' }
const today = () => new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export default function Dashboard() {
  const stages = useStages()
  const [entity, setEntity] = useState('')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.director(entity).then(setD).catch((e) => setError(e.message)), [entity])
  useEffect(() => { load() }, [load])

  if (!d) return <Layout title="Overview" head={false}><p className="muted">{error || 'Loading…'}</p></Layout>

  const c = d.counts
  const decisions = [
    ...d.date_requests.map((r) => ({ key: `r${r.id}`, k: 'due date', to: `/projects/${r.task.project_id}?tab=tasks`, title: r.task.title, sub: r.task.project_name, r: `to ${shortDay(r.proposed_due)}` })),
    ...d.pending_approvals.map((x) => ({ key: `s${x.project_id}${x.stage_key}`, k: 'stage', to: `/projects/${x.project_id}`, title: x.stage_name, sub: x.project_name })),
    ...d.task_approvals.map((t) => ({ key: `t${t.id}`, k: 'task', to: `/projects/${t.project_id}?tab=tasks`, title: t.title, sub: t.project_name })),
    ...d.doc_approvals.map((x) => ({ key: `d${x.id}`, k: 'artwork', to: `/projects/${x.project_id}?tab=artwork`, title: x.title, sub: x.project_name })),
  ]

  // live projects per phase group (a project in parallel stages counts once per group)
  const flow = d.stages || stages
  const live = d.projects.filter((p) => p.status === 'active' || p.status === 'on_hold')
  const groups = [...new Set(flow.map((s) => s.group || 'Stages'))].map((g) => {
    const keys = flow.filter((s) => (s.group || 'Stages') === g).map((s) => s.key)
    return { name: g, n: live.filter((p) => p.active_stages.some((k) => keys.includes(k))).length }
  })
  const gmax = Math.max(1, ...groups.map((g) => g.n))

  const upcoming = [
    ...d.rfi_deadlines.filter((r) => r.due_date).map((r) => ({ key: `rfi${r.id}`, day: r.due_date, title: `${r.reference || 'RFI'} response`, sub: r.project_name, to: `/projects/${r.project_id}?tab=rfi`, late: r.overdue })),
    ...d.unsigned_agreements.filter((a) => a.due_date && a.overdue).map((a) => ({ key: `ag${a.id}`, day: a.due_date, title: a.label, sub: a.project_name, to: `/projects/${a.project_id}?tab=legal`, late: true })),
    ...live.filter((p) => p.target_submission).map((p) => ({ key: `ts${p.id}`, day: p.target_submission, title: 'Target submission', sub: p.name, to: `/projects/${p.id}` })),
  ].sort((a, b) => a.day.localeCompare(b.day)).slice(0, 6)

  const pct = (n) => `${(n / Math.max(1, c.green + c.amber + c.red)) * 100}%`

  return (
    <Layout title="Overview" head={false}>
      <div className="ph">
        <div>
          <p className="ph-date">{today()}</p>
          <h1>Overview</h1>
        </div>
        <Tabs variant="seg" value={entity} onChange={setEntity} tabs={[{ key: '', label: 'All' }, { key: 'AU', label: 'Australia' }, { key: 'IN', label: 'India' }]} />
      </div>

      <section className="metrics" aria-label="Key figures">
        <Link to="/projects" className="metric">
          <span>Live projects</span>
          <b>{c.live}</b>
          <div className="hbar" aria-hidden="true">
            {c.green > 0 && <i className="g" style={{ width: pct(c.green) }} />}
            {c.amber > 0 && <i className="a" style={{ width: pct(c.amber) }} />}
            {c.red > 0 && <i className="r" style={{ width: pct(c.red) }} />}
          </div>
          <div className="hkey">
            <span><i style={{ background: 'var(--neo-green)' }} />On track <b>{c.green}</b></span>
            <span><i style={{ background: 'var(--warn-dot)' }} />At risk <b>{c.amber}</b></span>
            <span><i style={{ background: 'var(--danger-dot)' }} />Critical <b>{c.red}</b></span>
          </div>
        </Link>
        <a href="#approvals" className="metric"><span>Awaiting your decision</span><b>{decisions.length}</b></a>
        <Link to="/projects" className={`metric ${d.delayed.length ? 'alert' : ''}`}><span>Delayed</span><b>{d.delayed.length}</b></Link>
        <Link to="/regulatory" className="metric"><span>Open RFIs</span><b>{d.rfi_deadlines.length}</b></Link>
        <Link to="/legal" className="metric"><span>Unsigned agreements</span><b>{d.unsigned_agreements.length}</b></Link>
      </section>

      <div className="dgrid">
        <section className="dcard" id="approvals">
          <header><h2>Approvals <span className="count">{decisions.length}</span></h2><Link to="/my-work" className="link">My work</Link></header>
          {!decisions.length && <p className="empty-note">Nothing is waiting for you.</p>}
          <ul className="drows">
            {decisions.slice(0, 5).map((x) => (
              <li key={x.key}>
                <Link to={x.to}>
                  <span className="dmain"><strong>{x.title}</strong><small>{KIND[x.k]} · {x.sub}</small></span>
                  <span className="dside">{x.r || 'Review'}</span>
                </Link>
              </li>
            ))}
          </ul>
          {decisions.length > 5 && <Link to="/my-work" className="list-more">{decisions.length - 5} more</Link>}
        </section>

        <section className="dcard">
          <header><h2>Upcoming</h2></header>
          {!upcoming.length && <p className="empty-note">Nothing scheduled.</p>}
          <ul className="drows">
            {upcoming.slice(0, 5).map((x) => (
              <li key={x.key}>
                <Link to={x.to}>
                  <span className="ddate">{shortDay(x.day)}</span>
                  <span className="dmain"><strong>{x.title}</strong><small>{x.sub}</small></span>
                  {x.late && <span className="dside over">Overdue</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="dcard">
          <header><h2>At risk <span className="count">{d.at_risk.length}</span></h2><Link to="/projects" className="link">All projects</Link></header>
          {!d.at_risk.length && <p className="empty-note">Every project is on track.</p>}
          <ul className="drows">
            {d.at_risk.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>
                  <span className="dmain"><strong>{p.name}</strong><small>{p.health_reasons[0]}</small></span>
                  <span className="dside"><HealthPill health={p.health} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="dcard">
          <header><h2>By phase</h2><span className="count">{live.length} live</span></header>
          <ul className="dbars">
            {groups.map((g) => (
              <li key={g.name} className={g.n ? '' : 'zero'}>
                <span>{g.name}</span>
                <b>{g.n}</b>
                <i><em style={{ width: `${(g.n / gmax) * 100}%` }} /></i>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Layout>
  )
}
