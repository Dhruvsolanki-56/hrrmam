import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { Avatar, Empty, HealthPill, Tabs, entityTone, fmtDate, fmtDay, fmtDateTime, label } from '../components/bits'
import { useMe, useStages } from '../context'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const today = () => new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

/** One line of the activity feed, written as a sentence. */
function FeedItem({ e }) {
  return (
    <li>
      <Avatar name={e.actor} />
      <p>
        <b>{e.actor}</b> {label(e.action).toLowerCase()}{e.stage_name ? <> · {e.stage_name}</> : null} on{' '}
        <Link to={`/projects/${e.project_id}?tab=activity`}><b>{e.project_name}</b></Link>
        {e.note && <span className="note">{e.note.length > 110 ? `${e.note.slice(0, 110)}…` : e.note}</span>}
      </p>
      <small>{fmtDateTime(e.created_at)}</small>
    </li>
  )
}

export default function Dashboard() {
  const stages = useStages()
  const me = useMe()
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

  if (!d) return <Layout title="Dashboard" head={false}><p className="muted">{error || 'Loading portfolio…'}</p></Layout>

  const pending = [
    ...d.pending_approvals.map((x) => ({ key: `s${x.project_id}${x.stage_key}`, id: x.project_id, tag: 'stage', title: `${x.stage_name}`, sub: `${x.project_name} · ${x.approver}`, meta: `${x.days_waiting}d waiting`, wait: x.days_waiting })),
    ...d.task_approvals.map((t) => ({ key: `t${t.id}`, id: t.project_id, tab: 'tasks', tag: 'task', title: t.title, sub: `${t.project_name} · submitted by ${t.assignee.name}`, meta: `due ${fmtDay(t.due_at)}` })),
    ...d.doc_approvals.map((x) => ({ key: `d${x.id}`, id: x.project_id, tab: 'artwork', tag: 'artwork', title: x.title, sub: `${x.project_name} · version ${x.current_version}`, meta: 'needs sign-off' })),
  ]
  const c = d.counts
  const live = Math.max(1, c.green + c.amber + c.red)
  const oldest = Math.max(0, ...pending.map((p) => p.wait || 0))
  const nextRfi = d.rfi_deadlines[0]
  const oldestAg = d.unsigned_agreements[0]
  const flow = d.stages || stages
  const max = Math.max(1, ...Object.values(d.per_stage))
  const riskRows = d.at_risk.slice(0, 8)

  return (
    <Layout title="Dashboard" head={false}>
      <div className="hello">
        <div>
          <h1>{greeting()}, {me.name.replace(/^Dr\.?\s+/, '').split(' ')[0]}</h1>
          <p>{today()} · {c.live} live projects across Neo Health Australia and Neo India</p>
        </div>
        <Tabs variant="seg" value={entity} onChange={setEntity} tabs={[{ key: '', label: 'All entities' }, { key: 'AU', label: 'Australia' }, { key: 'IN', label: 'India' }]} />
      </div>

      <section className="statstrip" aria-label="Portfolio numbers">
        <div className="stat">
          <span>Portfolio health</span>
          <b>{c.live}<small>live · {c.total} in total</small></b>
          <div className="healthbar" role="img" aria-label={`${c.green} on track, ${c.amber} at risk, ${c.red} critical`}>
            {c.green > 0 && <i className="h-green" style={{ width: `${(c.green / live) * 100}%` }} />}
            {c.amber > 0 && <i className="h-amber" style={{ width: `${(c.amber / live) * 100}%` }} />}
            {c.red > 0 && <i className="h-red" style={{ width: `${(c.red / live) * 100}%` }} />}
          </div>
          <div className="healthkey">
            <span><i className="h-green" style={{ background: 'var(--neo-green)' }} />On track <b>{c.green}</b></span>
            <span><i style={{ background: 'var(--warn-dot)' }} />At risk <b>{c.amber}</b></span>
            <span><i style={{ background: 'var(--danger-dot)' }} />Critical <b>{c.red}</b></span>
          </div>
        </div>
        <a className="stat" href="#decisions">
          <span>Waiting for a decision</span>
          <b>{pending.length + d.date_requests.length}</b>
          <small>{oldest ? `oldest stage waiting ${oldest} days` : 'nothing is stuck'}</small>
        </a>
        <div className={`stat ${d.delayed.length ? 'alert' : ''}`}>
          <span>Delayed</span>
          <b>{d.delayed.length}</b>
          <small>past target or with overdue tasks</small>
        </div>
        <Link className="stat" to="/regulatory">
          <span>Open RFIs</span>
          <b>{d.rfi_deadlines.length}</b>
          <small>{nextRfi ? `next due ${fmtDay(nextRfi.due_date)}` : 'none open'}</small>
        </Link>
        <Link className="stat" to="/legal">
          <span>Unsigned agreements</span>
          <b>{d.unsigned_agreements.length}</b>
          <small>{oldestAg ? `oldest open ${oldestAg.age_days} days` : 'all signed'}</small>
        </Link>
      </section>

      <section className="grid-2">
        <div className="stack">
        <div className="panel" id="decisions">
          <header>
            <div><h3>Needs a decision</h3><p className="muted">Stages, tasks and artwork submitted for approval, and requests to move a due date</p></div>
            <span className="count">{pending.length + d.date_requests.length}</span>
          </header>
          {!pending.length && !d.date_requests.length && <Empty>Nothing is waiting for a decision.</Empty>}
          <ul className="inbox">
            {d.date_requests.map((r) => (
              <li key={`r${r.id}`}>
                <div className="row">
                  <span className="tag">date change</span>
                  <div>
                    <strong>{r.task.title}</strong>
                    <small>{r.task.project_name} · {r.requested_by.name}: {fmtDate(r.previous_due)} → {fmtDate(r.proposed_due)} · “{r.reason}”</small>
                  </div>
                  <div className="actions">
                    <button className="btn line sm" onClick={() => decide(r, 'reject_date')}>Keep date</button>
                    <button className="btn primary sm" onClick={() => decide(r, 'approve_date')}>Approve</button>
                  </div>
                </div>
              </li>
            ))}
            {pending.map((x) => (
              <li key={x.key}>
                <Link to={`/projects/${x.id}${x.tab ? `?tab=${x.tab}` : ''}`}>
                  <span className={`tag t-${x.tag}`}>{x.tag}</span>
                  <div><strong>{x.title}</strong><small>{x.sub}</small></div>
                  <span className="meta-r">{x.meta}<Icon name="arrow" size={14} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel table-panel">
          <header>
            <div><h3>At risk</h3><p className="muted">Projects that are critical or need a look, worst first</p></div>
            <Link to="/projects" className="link">All projects</Link>
          </header>
          {!riskRows.length ? <div className="pad"><Empty>Every live project is on track.</Empty></div> : (
            <div className="table-scroll">
              <table className="table compact fit">
                <thead><tr><th>Project</th><th>Health</th><th>Why</th><th>Phase</th></tr></thead>
                <tbody>
                  {riskRows.map((p) => (
                    <tr key={p.id}>
                      <td className="proj-cell"><Link to={`/projects/${p.id}`} className="cell-main"><strong>{p.name}</strong><small><span className="code">{p.code || 'no code yet'}</span></small></Link></td>
                      <td data-label="Health"><HealthPill health={p.health} reasons={p.health_reasons} /></td>
                      <td data-label="Why" className="wrap"><span className="muted">{p.health_reasons[0] || '–'}{p.health_reasons.length > 1 ? ` +${p.health_reasons.length - 1} more` : ''}</span></td>
                      <td data-label="Phase"><span className="stage-name">{p.stage.name}</span>{p.active_stages.length > 1 && <span className="sub">+{p.active_stages.length - 1} in parallel</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        </div>
        <div className="stack">
        <div className="panel">
          <header><div><h3>Pipeline by phase</h3><p className="muted">Live projects in each phase</p></div></header>
          <ul className="bars">
            {flow.map((s) => (
              <li key={s.key} className={d.per_stage[s.key] ? '' : 'zero'}>
                <span className="bar-name"><small>{String(s.phase).padStart(2, '0')}</small>{s.name}</span>
                <span className="bar-track"><span className={`bar-fill tone-${entityTone(s.entity)}`} style={{ width: `${((d.per_stage[s.key] || 0) / max) * 100}%` }} /></span>
                <b>{d.per_stage[s.key] || 0}</b>
              </li>
            ))}
          </ul>
          <footer className="legend">
            <span><i className="tone-otc" />Australia</span><span><i className="tone-india" />India</span>
            <span><i className="tone-both" />Joint</span><span><i className="tone-other" />Partner</span>
          </footer>
        </div>
          <div className="panel">
            <header><h3>RFI deadlines</h3><Link to="/regulatory" className="link">Regulatory</Link></header>
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
          <div className="panel">
            <header><h3>Unsigned agreements</h3><Link to="/legal" className="link">Legal register</Link></header>
            {!d.unsigned_agreements.length && <Empty>All agreements are signed.</Empty>}
            <ul className="rows">
              {d.unsigned_agreements.slice(0, 4).map((a) => (
                <li key={a.id}>
                  <Link to={`/projects/${a.project_id}?tab=legal`}>
                    <div><strong>{a.label}</strong><small>{a.project_name} · {label(a.status)}</small></div>
                    <span className={`age ${a.overdue ? 'age-over' : (a.age_days || 0) > 21 ? 'age-warn' : 'age-ok'}`}>{a.age_days}d open</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <header><h3>Recent activity</h3><Link to="/audit" className="link">Full audit trail</Link></header>
        <ul className="feed">{d.recent.map((e) => <FeedItem key={e.id} e={e} />)}</ul>
      </section>
    </Layout>
  )
}
