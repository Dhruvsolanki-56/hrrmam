import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { Empty, HealthPill, Tabs, entityTone, fmtDate, fmtDay, fmtDateTime, label } from '../components/bits'
import { useStages } from '../context'

const KPI_ICON = { total: 'folder', green: 'check', amber: 'alert', red: 'alert', approvals: 'clock' }

export default function Dashboard() {
  const stages = useStages()
  const [entity, setEntity] = useState('')
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.director(entity).then(setD).catch((e) => setError(e.message)), [entity])
  useEffect(() => { load() }, [load])

  const decide = async (req, action) => {
    const note = action === 'reject_date' ? window.prompt('Why does the original date stay?') : ''
    if (action === 'reject_date' && !note) return
    try { await api.taskAct(req.task.id, { action, note }); load() } catch (e) { window.alert(e.message) }
  }

  if (!d) return <Layout title="Director overview" subtitle={error || 'Loading portfolio…'} />

  const pending = [
    ...d.pending_approvals.map((x) => ({ key: `s${x.project_id}${x.stage_key}`, id: x.project_id, tag: 'Stage', title: x.project_name, sub: `${x.stage_name} · ${x.approver}`, meta: `${x.days_waiting}d waiting` })),
    ...d.task_approvals.map((t) => ({ key: `t${t.id}`, id: t.project_id, tab: 'tasks', tag: 'Task', title: t.title, sub: `${t.project_name} · by ${t.assignee.name}`, meta: fmtDay(t.due_at) })),
    ...d.doc_approvals.map((x) => ({ key: `d${x.id}`, id: x.project_id, tab: 'artwork', tag: 'Artwork', title: x.title, sub: `${x.project_name} · V${x.current_version}`, meta: 'Director approval' })),
  ]
  const delayedIds = new Set(d.delayed.map((p) => p.id))
  const max = Math.max(1, ...Object.values(d.per_stage))
  const c = d.counts
  const kpis = [
    { k: 'total', label: 'Live projects', value: c.live, note: `${c.total} in total`, tone: 'dark' },
    { k: 'green', label: 'On track', value: c.green, note: 'healthy', tone: 'green' },
    { k: 'amber', label: 'At risk', value: c.amber, note: 'needs a look', tone: 'amber' },
    { k: 'red', label: 'Critical', value: c.red, note: 'blocked or late', tone: 'red' },
    { k: 'approvals', label: 'Pending approvals', value: pending.length, note: 'waiting for a decision', tone: 'bright' },
  ]

  return (
    <Layout title="Director overview" subtitle="Portfolio health, approvals and deadlines across Neo Health Australia and Neo India"
      actions={<Tabs value={entity} onChange={setEntity} tabs={[{ key: '', label: 'All' }, { key: 'AU', label: 'Australia' }, { key: 'IN', label: 'India' }]} />}>
      <section className="kpis">
        {kpis.map((k) => (
          <article key={k.k} className="kpi">
            <span className={`kpi-icon tone-bg-${k.tone}`}><Icon name={KPI_ICON[k.k]} size={20} /></span>
            <div><span className="kpi-label">{k.label}</span><b>{k.value}</b><small>{k.note}</small></div>
          </article>
        ))}
      </section>

      <section className="grid-2">
        <div className="panel">
          <header><h3>Projects at risk or delayed</h3><span className="muted">{d.at_risk.length} projects</span></header>
          {!d.at_risk.length && <Empty>Every live project is on track.</Empty>}
          <ul className="rows">
            {d.at_risk.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>
                  <div><strong>{p.name}</strong><small>{p.health_reasons.slice(0, 2).join(' · ')}</small></div>
                  <span className="row-end">{delayedIds.has(p.id) && <span className="age age-over">Delayed</span>}<HealthPill health={p.health} reasons={p.health_reasons} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>Pending approvals</h3><span className="muted">{pending.length}</span></header>
          {!pending.length && <Empty>Nothing is waiting for approval.</Empty>}
          <ul className="rows">
            {pending.map((x) => (
              <li key={x.key}>
                <Link to={`/projects/${x.id}${x.tab ? `?tab=${x.tab}` : ''}`}>
                  <div><strong>{x.title}</strong><small><span className="chip plain tiny">{x.tag}</span> {x.sub}</small></div>
                  <span className="go">{x.meta}<Icon name="arrow" size={14} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid-3">
        <div className="panel">
          <header><h3>Deadline-change requests</h3><span className="muted">{d.date_requests.length}</span></header>
          {!d.date_requests.length && <Empty>No requests to decide.</Empty>}
          <ul className="rows block">
            {d.date_requests.map((r) => (
              <li key={r.id}>
                <div><strong>{r.task.title}</strong><small>{r.task.project_name} · {r.requested_by.name}</small>
                  <small>{fmtDate(r.previous_due)} → <b>{fmtDate(r.proposed_due)}</b> · “{r.reason}”</small></div>
                <div className="actions tight">
                  <button className="btn primary sm" onClick={() => decide(r, 'approve_date')}>Approve</button>
                  <button className="btn line sm" onClick={() => decide(r, 'reject_date')}>Keep date</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>Unsigned agreements</h3><Link to="/legal" className="link">Legal register</Link></header>
          {!d.unsigned_agreements.length && <Empty>All agreements are signed.</Empty>}
          <ul className="rows">
            {d.unsigned_agreements.slice(0, 7).map((a) => (
              <li key={a.id}>
                <Link to={`/projects/${a.project_id}?tab=legal`}>
                  <div><strong>{a.label}</strong><small>{a.project_name} · {label(a.status)}</small></div>
                  <span className={`age ${a.overdue ? 'age-over' : (a.age_days || 0) > 21 ? 'age-warn' : 'age-ok'}`}>{a.age_days}d open</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>RFI deadlines</h3><span className="muted">{d.rfi_deadlines.length} open</span></header>
          {!d.rfi_deadlines.length && <Empty>No open RFI cases.</Empty>}
          <ul className="rows">
            {d.rfi_deadlines.map((r) => (
              <li key={r.id}>
                <Link to={`/projects/${r.project_id}?tab=rfi`}>
                  <div><strong>{r.reference || 'RFI'} · {r.authority}</strong><small>{r.project_name} · {r.questions.filter((q) => q.task?.state === 'approved').length}/{r.questions.length} answered</small></div>
                  <span className={`age ${r.overdue ? 'age-over' : 'age-ok'}`}>{fmtDay(r.due_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel">
          <header><h3>Pipeline by phase</h3><span className="muted">Live projects per phase</span></header>
          <ul className="bars">
            {stages.map((s) => (
              <li key={s.key}>
                <span className="bar-name"><small>{String(s.phase).padStart(2, '0')}</small>{s.name}</span>
                <span className="bar-track"><span className={`bar-fill tone-${entityTone(s.entity)}`} style={{ width: `${(d.per_stage[s.key] / max) * 100}%` }} /></span>
                <b>{d.per_stage[s.key]}</b>
              </li>
            ))}
          </ul>
          <footer className="legend">
            <span><i className="tone-otc" />Neo Health Australia</span><span><i className="tone-india" />Neo India</span>
            <span><i className="tone-both" />Joint</span><span><i className="tone-other" />Manufacturing partner</span>
          </footer>
        </div>
        <div className="panel">
          <header><h3>Recent activity</h3><Link to="/audit" className="link">Audit trail</Link></header>
          <ul className="rows">
            {d.recent.map((e) => (
              <li key={e.id}>
                <Link to={`/projects/${e.project_id}?tab=activity`}>
                  <div><strong>{label(e.action)} · {e.project_name}</strong><small>{e.note ? `${e.note.slice(0, 80)}${e.note.length > 80 ? '…' : ''} · ` : ''}{e.actor} · {fmtDateTime(e.created_at)}</small></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Layout>
  )
}
