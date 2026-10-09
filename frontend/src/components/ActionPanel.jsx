import { useState } from 'react'
import { api } from '../api'
import { useStages } from '../App'
import { AgeChip, EntityChip, StateChip } from './bits'

const useActor = () => {
  const [actor, setActor] = useState(localStorage.getItem('nh-actor') || '')
  const save = (v) => { setActor(v); if (v) localStorage.setItem('nh-actor', v) }
  return [actor, save]
}

/** work -> submit -> approval -> (approved | sent back and the cycle repeats) */
function Cycle({ stage, row }) {
  const steps = stage.decision_only ? ['Decision', 'Approved'] : ['Work', 'Approval', 'Approved']
  const at = row.state === 'in_progress' ? 0 : stage.decision_only ? 0 : 1
  return (
    <div className="cycle" aria-label="Approval cycle">
      <ol>
        {steps.map((s, i) => (
          <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}><i>{i < at ? '✓' : i + 1}</i>{s}</li>
        ))}
      </ol>
      {row.rework_count > 0 && <span className="rework" title="Times this was sent back for rework">↺ Sent back {row.rework_count}×</span>}
    </div>
  )
}

function StageCard({ project, stage, row, total, onChange, locked }) {
  const stages = useStages()
  const [note, setNote] = useState('')
  const [actor, setActor] = useActor()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const name = (k) => stages.find((s) => s.key === k)?.name
  const states = project.stage_states

  // what approving this stage starts, and what it is still waiting on
  const dependents = stages.filter((s) => s.requires.includes(stage.key))
  const unlocks = dependents.filter((s) => s.requires.every((r) => r === stage.key || states[r] === 'approved'))
  const joining = dependents.filter((s) => !unlocks.includes(s))
  const last = dependents.length === 0

  async function act(action) {
    setBusy(true)
    setError('')
    try {
      onChange(await api.act(project.id, { action, note, actor, stage_key: stage.key }))
      setNote('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const detail = project.stages?.find((r) => r.key === stage.key)
  const idx = stages.findIndex((s) => s.key === stage.key)

  return (
    <section className="panel callout stagecard">
      <header>
        <span className="eyebrow">
          Stage {idx + 1} of {total}{stage.parallel_with.length > 0 && ' · runs in parallel'}
        </span>
        <StateChip state={row.state} />
      </header>
      <h2>{stage.name}</h2>
      <div className="chips">
        <EntityChip entity={stage.entity} full />
        {detail && <AgeChip project={{ ...project, status: project.status, days_in_stage: detail.days_in_stage, sla_days: detail.sla_days, overdue: detail.overdue }} />}
      </div>
      <Cycle stage={stage} row={row} />
      <dl className="who">
        {!stage.decision_only && <><dt>Work by</dt><dd>{stage.owner}</dd></>}
        <dt>Approved by</dt>
        <dd>{stage.approver}</dd>
        <dt>Next</dt>
        <dd>
          {last ? 'Closes the project'
            : unlocks.length ? unlocks.map((s) => s.name).join(' + ')
              : `Waits for ${joining.map((s) => s.requires.filter((r) => r !== stage.key && states[r] !== 'approved').map(name).join(', ')).join(', ')} to finish`}
          {unlocks.length > 1 && <span className="muted"> (start together)</span>}
        </dd>
      </dl>
      <p className="callout-desc">{stage.description}</p>
      {row.state === 'clarification' && <p className="notice">Waiting for the project team to send the missing information.</p>}

      <label className="field">
        Note <small>(required to send back, reject or ask for information)</small>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" disabled={locked} />
      </label>
      <label className="field">
        Acting as
        <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Your name" disabled={locked} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {row.state === 'in_progress' && (
          <button className="btn primary" disabled={busy || locked} onClick={() => act('submit')}>Submit for approval</button>
        )}
        {row.state === 'awaiting_approval' && (
          <>
            <button className="btn primary" disabled={busy || locked} onClick={() => act('approve')}>
              {last ? 'Approve & close project' : 'Approve'}
            </button>
            <button className="btn line" disabled={busy || locked} onClick={() => act('send_back')}>
              {stage.rework_to ? `Send back to ${name(stage.rework_to)}` : 'Send back for rework'}
            </button>
            {stage.clarify && <button className="btn line" disabled={busy || locked} onClick={() => act('clarify')}>Request information</button>}
            {stage.can_close && <button className="btn danger" disabled={busy || locked} onClick={() => act('reject')}>Reject project</button>}
          </>
        )}
        {row.state === 'clarification' && (
          <button className="btn primary" disabled={busy || locked} onClick={() => act('info')}>Information received</button>
        )}
      </div>
    </section>
  )
}

/** Project-wide controls: hold / resume, move back, reopen. */
function ProjectControls({ project, onChange }) {
  const stages = useStages()
  const [note, setNote] = useState('')
  const [actor, setActor] = useActor()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [back, setBack] = useState('')

  const closed = project.status === 'rejected' || project.status === 'completed'
  const onHold = project.status === 'on_hold'
  const approved = stages.filter((s) => project.stage_states[s.key] === 'approved')
  const backTo = approved.some((s) => s.key === back) ? back : approved[approved.length - 1]?.key
  const rejection = [...project.events].reverse().find((e) => e.action === 'reject')

  async function act(action, extra = {}) {
    setBusy(true)
    setError('')
    try {
      onChange(await api.act(project.id, { action, note, actor, ...extra }))
      setNote('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel controls">
      <header><h3>{closed ? 'Project closed' : 'Project controls'}</h3></header>
      {project.status === 'rejected' && (
        <p className="closed-note">
          Rejected at {stages.find((s) => s.key === (rejection?.stage_key || project.stage_key))?.name}.
          {rejection?.note && <> “{rejection.note}”</>}
        </p>
      )}
      {project.status === 'completed' && <p className="closed-note">Every stage is approved and the project is complete.</p>}
      {onHold && <p className="notice">This project is on hold. Resume it to continue the approval cycle.</p>}

      {!onHold && (
        <label className="field">
          Note <small>{closed ? '(required to reopen)' : '(required to hold or move back)'}</small>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" />
        </label>
      )}
      <label className="field">
        Acting as
        <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Your name" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {closed && <button className="btn line" disabled={busy} onClick={() => act('reopen')}>Reopen project</button>}
        {onHold && <button className="btn primary" disabled={busy} onClick={() => act('resume')}>Resume project</button>}
        {!closed && !onHold && <button className="btn line" disabled={busy} onClick={() => act('hold')}>Put on hold</button>}
      </div>
      {!closed && approved.length > 0 && (
        <details className="more">
          <summary>Move back to an approved stage</summary>
          <div className="more-row">
            <select value={backTo} onChange={(e) => setBack(e.target.value)} aria-label="Stage to move back to">
              {approved.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <button className="btn line" disabled={busy} onClick={() => act('return', { to_stage: backTo })}>Move back</button>
          </div>
          <small className="muted">Everything after that stage restarts its approval cycle. Add a note above first.</small>
        </details>
      )}
    </section>
  )
}

export default function ActionPanel({ project, onChange }) {
  const stages = useStages()
  const live = project.status === 'active' || project.status === 'on_hold' || project.status === 'clarification'
  const active = project.active_stages || []
  return (
    <>
      {live && active.length > 1 && (
        <p className="parallel-banner">
          <b>{active.length} phases are running in parallel.</b> Each has its own approval cycle. The next phase starts when all of them are approved.
        </p>
      )}
      {live && (
        <div className={`stagecards ${active.length > 1 ? 'multi' : ''}`}>
          {active.map((key) => (
            <StageCard
              key={key} project={project} stage={stages.find((s) => s.key === key)}
              row={{ state: project.stage_states[key], rework_count: project.stages?.find((r) => r.key === key)?.rework_count || 0 }}
              total={stages.length} onChange={onChange} locked={project.status === 'on_hold'}
            />
          ))}
        </div>
      )}
      <ProjectControls project={project} onChange={onChange} />
    </>
  )
}
