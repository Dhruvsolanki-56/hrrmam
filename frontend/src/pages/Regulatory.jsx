import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'
import { Empty, fmtDay, label } from '../components/bits'

export default function Regulatory() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.regulatory().then(setD).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!d) return <Layout title="Regulatory portal" subtitle={error || 'Loading…'} />

  return (
    <Layout title="Regulatory portal" subtitle="Your tasks, dossier status, review queue, RFI cases and submission deadlines">
      <section className="grid-2 even">
        <div className="panel">
          <header><h3>My tasks</h3><span className="muted">{d.my_tasks.length} open</span></header>
          {!d.my_tasks.length && <Empty>No open tasks assigned to you.</Empty>}
          <div className="tasklist">{d.my_tasks.map((t) => <TaskCard key={t.id} task={t} showProject onChanged={load} />)}</div>
        </div>
        <div className="panel">
          <header><h3>RA review queue</h3><span className="muted">{d.ra_review_queue.length} waiting</span></header>
          {!d.ra_review_queue.length && <Empty>Nothing is waiting for regulatory review.</Empty>}
          <ul className="rows">
            {d.ra_review_queue.map((x, i) => (
              <li key={i}>
                {x.type === 'stage' && <Link to={`/projects/${x.project_id}`}><div><strong>{x.stage_name}</strong><small>{x.project_name} · stage awaiting approval</small></div><span className="go">Review<Icon name="arrow" size={14} /></span></Link>}
                {x.type === 'artwork' && <Link to={`/projects/${x.document.project_id}?tab=artwork`}><div><strong>{x.document.title}</strong><small>{x.document.project_name} · artwork V{x.document.current_version} · regulatory review</small></div><span className="go">Review<Icon name="arrow" size={14} /></span></Link>}
                {x.type === 'manufacturer' && <Link to={`/projects/${x.request.project_id}?tab=manufacturer`}><div><strong>{x.request.label}</strong><small>{x.request.project_name} · {label(x.request.status)}</small></div><span className="go">Review<Icon name="arrow" size={14} /></span></Link>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <header><h3>Dossiers and module status</h3><span className="muted">M1–M5 appear only where the submission type needs them</span></header>
        {!d.dossiers.length && <Empty>No dossiers in preparation.</Empty>}
        <div className="dossier-grid">
          {d.dossiers.map((x) => (
            <Link key={x.project_id} to={`/projects/${x.project_id}?tab=regulatory`} className="dossier">
              <strong title={x.project_name}>{x.project_name}</strong>
              <span className="meter"><i style={{ width: x.total ? `${(x.done / x.total) * 100}%` : 0 }} /></span>
              <small>{x.done}/{x.total} items ready{x.target_submission && ` · target ${fmtDay(x.target_submission)}`}</small>
              {x.modules.length > 0 && <span className="mods">{x.modules.map((m) => <i key={m.module} className={`mod mod-${m.status}`} title={`${m.module} ${m.title}: ${m.status}`}>{m.module}</i>)}</span>}
              <small className="dossier-type">{x.submission_type || 'Submission type to be decided'}</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid-3">
        <div className="panel">
          <header><h3>Missing manufacturer data</h3><span className="muted">{d.missing_manufacturer_data.length}</span></header>
          {!d.missing_manufacturer_data.length && <Empty>Nothing outstanding.</Empty>}
          <ul className="rows">
            {d.missing_manufacturer_data.map((m) => (
              <li key={m.id}><Link to={`/projects/${m.project_id}?tab=manufacturer`}>
                <div><strong>{m.label}</strong><small>{m.project_name} · {m.manufacturer || 'manufacturer'}</small></div>
                <span className={`age ${m.overdue ? 'age-over' : 'age-ok'}`}>{m.due_date ? fmtDay(m.due_date) : label(m.status)}</span>
              </Link></li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>RFI cases</h3><span className="muted">{d.rfi_cases.length} open</span></header>
          {!d.rfi_cases.length && <Empty>No open RFI cases.</Empty>}
          <ul className="rows">
            {d.rfi_cases.map((r) => (
              <li key={r.id}><Link to={`/projects/${r.project_id}?tab=rfi`}>
                <div><strong>{r.reference || 'RFI'} · {r.authority}</strong><small>{r.project_name} · {label(r.status)} · {r.questions.length} questions</small></div>
                <span className={`age ${r.overdue ? 'age-over' : 'age-ok'}`}>{fmtDay(r.due_date)}</span>
              </Link></li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <header><h3>Upcoming submission deadlines</h3></header>
          {!d.submission_deadlines.length && <Empty>No target dates set.</Empty>}
          <ul className="rows">
            {d.submission_deadlines.map((x) => (
              <li key={x.project_id}><Link to={`/projects/${x.project_id}`}>
                <div><strong>{x.project_name}</strong><small>{x.project_code || 'Code pending'}</small></div>
                <span className={`age ${new Date(x.target_submission) < new Date() ? 'age-over' : 'age-ok'}`}>{fmtDay(x.target_submission)}</span>
              </Link></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel soft">
        <header><h3>AI review <span className="chip plain">Phase 2</span></h3></header>
        <p className="muted">Dossier completeness check, current trend / limit review, and RFI risk assessment are planned for Phase 2 and are not part of this release. Human review will remain mandatory; AI never certifies compliance.</p>
      </section>
    </Layout>
  )
}
