import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { HealthPill, Tabs } from '../components/bits'
import { useMe, useStages } from '../context'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }

/** Health donut: green / amber / red share of live projects. */
function Donut({ green, amber, red, size = 132 }) {
  const total = Math.max(1, green + amber + red)
  const r = 52
  const c = 2 * Math.PI * r
  let at = 0
  const seg = (n, color) => {
    const len = (n / total) * c
    const el = n ? <circle key={color} r={r} cx="60" cy="60" fill="none" stroke={color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 3)} ${c}`} strokeDashoffset={-at} transform="rotate(-90 60 60)" /> : null
    at += len
    return el
  }
  return (
    <svg className="donut" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${green} on track, ${amber} at risk, ${red} critical`}>
      <circle r={r} cx="60" cy="60" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="14" />
      {seg(green, '#c1e1c0')}{seg(amber, '#e9b949')}{seg(red, '#f08a7e')}
    </svg>
  )
}

function DateTile({ day }) {
  const d = parseDay(day)
  return <span className="datetile"><b>{d.getDate()}</b><small>{d.toLocaleDateString('en-AU', { month: 'short' })}</small></span>
}

const KIND = {
  stage: { icon: 'check', tone: 'green' },
  task: { icon: 'tasks', tone: 'bright' },
  artwork: { icon: 'image', tone: 'dark' },
  date: { icon: 'clock', tone: 'amber' },
}

export default function Dashboard() {
  const stages = useStages()
  const me = useMe()
  const [entity, setEntity] = useState('')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.director(entity).then(setD).catch((e) => setError(e.message)), [entity])
  useEffect(() => { load() }, [load])

  if (!d) return <Layout title="Dashboard" head={false}><p className="muted">{error || 'Loading…'}</p></Layout>

  const c = d.counts
  const decisions = [
    ...d.date_requests.map((r) => ({ key: `r${r.id}`, kind: 'date', to: `/projects/${r.task.project_id}?tab=tasks`, title: r.task.title, sub: `${r.task.project_name} · new due date` })),
    ...d.pending_approvals.map((x) => ({ key: `s${x.project_id}${x.stage_key}`, kind: 'stage', to: `/projects/${x.project_id}`, title: x.stage_name, sub: x.project_name })),
    ...d.task_approvals.map((t) => ({ key: `t${t.id}`, kind: 'task', to: `/projects/${t.project_id}?tab=tasks`, title: t.title, sub: t.project_name })),
    ...d.doc_approvals.map((x) => ({ key: `d${x.id}`, kind: 'artwork', to: `/projects/${x.project_id}?tab=artwork`, title: x.title, sub: x.project_name })),
  ]

  // live projects per board column (a project in parallel stages counts once per column)
  const flow = d.stages || stages
  const live = d.projects.filter((p) => p.status === 'active' || p.status === 'on_hold')
  const groups = [...new Set(flow.map((s) => s.group || 'Stages'))].map((g) => {
    const keys = flow.filter((s) => (s.group || 'Stages') === g).map((s) => s.key)
    return { name: g, n: live.filter((p) => p.active_stages.some((k) => keys.includes(k))).length }
  })
  const gmax = Math.max(1, ...groups.map((g) => g.n))

  const deadlines = [
    ...d.rfi_deadlines.filter((r) => r.due_date).map((r) => ({ key: `rfi${r.id}`, day: r.due_date, title: `${r.reference || 'RFI'} response`, sub: r.project_name, to: `/projects/${r.project_id}?tab=rfi`, late: r.overdue })),
    ...d.unsigned_agreements.filter((a) => a.due_date && a.overdue).map((a) => ({ key: `ag${a.id}`, day: a.due_date, title: a.label, sub: a.project_name, to: `/projects/${a.project_id}?tab=legal`, late: true })),
    ...live.filter((p) => p.target_submission).map((p) => ({ key: `ts${p.id}`, day: p.target_submission, title: 'Target submission', sub: p.name, to: `/projects/${p.id}` })),
  ].sort((a, b) => a.day.localeCompare(b.day)).slice(0, 5)

  return (
    <Layout title="Dashboard" head={false}>
      <div className="hello">
        <h1>{greeting()}, {me.name.replace(/^Dr\.?\s+/, '').split(' ')[0]}</h1>
        <Tabs variant="seg" value={entity} onChange={setEntity} tabs={[{ key: '', label: 'All' }, { key: 'AU', label: 'Australia' }, { key: 'IN', label: 'India' }]} />
      </div>

      <section className="hero">
        <Link to="/projects" className="hero-main">
          <div>
            <span className="hero-label">Live projects</span>
            <b className="hero-num">{c.live}</b>
            <ul className="hero-key">
              <li><i style={{ background: '#c1e1c0' }} />On track <b>{c.green}</b></li>
              <li><i style={{ background: '#e9b949' }} />At risk <b>{c.amber}</b></li>
              <li><i style={{ background: '#f08a7e' }} />Critical <b>{c.red}</b></li>
            </ul>
          </div>
          <Donut green={c.green} amber={c.amber} red={c.red} />
        </Link>
        <a href="#decisions" className="tile tile-bright">
          <span className="tile-icon"><Icon name="check" size={18} /></span>
          <b>{decisions.length}</b><span>Waiting for you</span>
        </a>
        <Link to="/projects" className={`tile ${d.delayed.length ? 'tile-alert' : ''}`}>
          <span className="tile-icon"><Icon name="clock" size={18} /></span>
          <b>{d.delayed.length}</b><span>Delayed</span>
        </Link>
        <Link to="/regulatory" className="tile">
          <span className="tile-icon"><Icon name="shield" size={18} /></span>
          <b>{d.rfi_deadlines.length}</b><span>Open RFIs</span>
        </Link>
        <Link to="/legal" className="tile">
          <span className="tile-icon"><Icon name="scale" size={18} /></span>
          <b>{d.unsigned_agreements.length}</b><span>Unsigned agreements</span>
        </Link>
      </section>

      <section className="dash-grid">
        <div className="panel" id="decisions">
          <header><h3>Waiting for you</h3><Link to="/my-work" className="link">My work</Link></header>
          {!decisions.length && <p className="empty-note">All clear.</p>}
          <ul className="decide">
            {decisions.slice(0, 6).map((x) => (
              <li key={x.key}>
                <Link to={x.to}>
                  <span className={`ico tone-${KIND[x.kind].tone}`}><Icon name={KIND[x.kind].icon} size={15} /></span>
                  <span className="decide-text"><strong>{x.title}</strong><small>{x.sub}</small></span>
                  <Icon name="arrow" size={14} />
                </Link>
              </li>
            ))}
          </ul>
          {decisions.length > 6 && <Link to="/my-work" className="more-link">+{decisions.length - 6} more</Link>}
        </div>

        <div className="panel">
          <header><h3>Pipeline</h3><span className="muted">{live.length} live</span></header>
          <div className="colchart" role="img" aria-label="Live projects per phase group">
            {groups.map((g, i) => (
              <div key={g.name} className="colbar">
                <b>{g.n}</b>
                <span className="colbar-track"><i className={`cb-${i % 5}`} style={{ height: `${Math.max(4, (g.n / gmax) * 100)}%` }} /></span>
                <small>{g.name}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="dash-grid">
        <div className="panel">
          <header><h3>Needs attention</h3><Link to="/projects" className="link">All projects</Link></header>
          {!d.at_risk.length && <p className="empty-note">Every project is on track.</p>}
          <div className="riskcards">
            {d.at_risk.slice(0, 4).map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className={`riskcard rc-${p.health}`}>
                <div className="riskcard-top"><span className="code">{p.code || 'new'}</span><HealthPill health={p.health} /></div>
                <strong>{p.name}</strong>
                <small>{p.health_reasons[0]}</small>
              </Link>
            ))}
          </div>
        </div>

        <div className="panel">
          <header><h3>Coming up</h3></header>
          {!deadlines.length && <p className="empty-note">Nothing scheduled.</p>}
          <ul className="deadlines">
            {deadlines.map((x) => (
              <li key={x.key}>
                <Link to={x.to}>
                  <DateTile day={x.day} />
                  <span><strong>{x.title}</strong><small>{x.sub}</small></span>
                  {x.late && <span className="age age-over">Overdue</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Layout>
  )
}
