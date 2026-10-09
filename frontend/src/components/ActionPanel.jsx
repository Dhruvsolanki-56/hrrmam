import { useState } from 'react'
import { api } from '../api'
import { stageOf, useCan, useMe, useStages } from '../context'
import { AgeChip, EntityChip, StateChip, useDo } from './bits'

export const TAB_OF = { legal: 'legal', regulatory: 'regulatory', dossier_ready: 'regulatory', submission: 'regulatory', artwork: 'artwork',
  manufacturer: 'manufacturer', rfi: 'rfi' }

/** work -> submit -> approval -> (approved | sent back and the cycle repeats) */
function Cycle({ row }) {
  const steps = ['Work', 'Approval', 'Approved']
  const at = row.state === 'in_progress' ? 0 : 1
  return (
    <div className="cycle" aria-label="Approval cycle">
      <ol>{steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}><i>{i < at ? '✓' : i + 1}</i>{s}</li>)}</ol>
      {row.rework_count > 0 && <span className="rework" title="Times this was sent back for rework">↺ Sent back {row.rework_count}×</span>}
    </div>
  )
}

function StageCard({ project, row, onChange, goTab, locked }) {
  const stages = useStages()
  const me = useMe()
  const can = useCan()
  const st = stageOf(stages, row.key)
  const [note, setNote] = useState('')
  const { busy, error, run } = useDo()
  const sup = me.role_key === 'super_admin'
  const canSubmit = sup || st.owner_roles.includes(me.role_key) || can('manage_project')
  const canDecide = (sup || st.approver_roles.includes(me.role_key))
  const waitsOn = (k) => stageOf(stages, k).name
  const dependents = stages.filter((s) => s.requires.includes(st.key))
  const unlocks = dependents.filter((s) => s.requires.every((r) => r === st.key || ['approved', 'bypassed'].includes(project.stage_states[r])))
  const waiting = dependents.flatMap((s) => s.requires.filter((r) => r !== st.key && !['approved', 'bypassed'].includes(project.stage_states[r])).map(waitsOn))
  const blocked = row.blockers.length > 0
  const disabled = busy || locked

  const go = (action) => run(async () => {
    onChange(await api.act(project.id, { action, note, stage_key: row.key }))
    setNote('')
  })

  return (
    <section className="panel callout stagecard">
      <header>
        <span className="eyebrow">Phase {st.phase} of 12{st.workstream && ' · workstream (runs in parallel)'}</span>
        <StateChip state={row.state} />
      </header>
      <h2>{st.name}</h2>
      <div className="chips">
        <EntityChip entity={st.entity} />
        <AgeChip project={{ status: project.status, days_in_stage: row.days_in_stage, sla_days: row.sla_days, overdue: row.overdue }} />
        {row.tasks_total > 0 && <span className="chip plain">{row.tasks_done}/{row.tasks_total} tasks approved</span>}
      </div>
      <Cycle row={row} />
      <dl className="who">
        <dt>Work by</dt><dd>{st.owner}</dd>
        <dt>Approved by</dt><dd>{st.approver}</dd>
        <dt>Next</dt>
        <dd>
          {dependents.length === 0 ? 'Closes the project'
            : unlocks.length ? unlocks.map((s) => s.name).join(' + ')
              : `Waits for ${[...new Set(waiting)].join(', ')}`}
        </dd>
      </dl>
      <p className="callout-desc">{st.description}</p>

      {blocked && (
        <div className="blockers" role="note">
          <b>{row.state === 'in_progress' ? 'Before this can be submitted' : 'Needs attention before approval'}</b>
          <ul>{row.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <button className="link" onClick={() => goTab(TAB_OF[st.key] || 'tasks')}>Open {TAB_OF[st.key] ? 'the workstream' : 'tasks'} →</button>
        </div>
      )}

      <label className="field">Note <small>(required to send back, reject or bypass)</small>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" disabled={locked} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {row.state === 'in_progress' && canSubmit && (
          <button className="btn primary" disabled={disabled || blocked} onClick={() => go('submit')}>Submit for approval</button>
        )}
        {row.state === 'in_progress' && !canSubmit && <span className="muted">Work is submitted by {st.owner}.</span>}
        {row.state === 'awaiting_approval' && canDecide && (
          <>
            <button className="btn primary" disabled={disabled || blocked} onClick={() => go('approve')}>{dependents.length ? 'Approve' : 'Approve & close project'}</button>
            <button className="btn line" disabled={disabled} onClick={() => go('send_back')}>Send back for rework</button>
            {st.can_close && <button className="btn danger" disabled={disabled} onClick={() => go('reject')}>Reject project</button>}
          </>
        )}
        {row.state === 'awaiting_approval' && !canDecide && <span className="muted">Waiting for {st.approver} to decide.</span>}
        {st.optional && can('bypass_optional') && <button className="btn line" disabled={disabled} onClick={() => go('bypass')}>Not needed: bypass</button>}
        {TAB_OF[st.key] && <button className="btn ghost" onClick={() => goTab(TAB_OF[st.key])}>Open workstream</button>}
      </div>
    </section>
  )
}

/** Project-wide controls: hold / resume, move back, reopen, lock. */
function ProjectControls({ project, onChange }) {
  const stages = useStages()
  const can = useCan()
  const [note, setNote] = useState('')
  const [back, setBack] = useState('')
  const { busy, error, run } = useDo()

  const closed = project.status === 'rejected' || project.status === 'completed'
  const onHold = project.status === 'on_hold'
  const done = stages.filter((s) => ['approved', 'bypassed'].includes(project.stage_states[s.key]))
  const row = (k) => project.stages.find((r) => r.key === k)
  const backTo = done.some((s) => s.key === back) ? back : done[done.length - 1]?.key
  const rejection = [...project.events].reverse().find((e) => e.action === 'reject')
  const nothing = !can('manage_project') && !can('lock_unlock')
  if (nothing && !closed) return null

  const go = (action, extra = {}) => run(async () => {
    onChange(await api.act(project.id, { action, note, ...extra }))
    setNote('')
  })

  return (
    <section className="panel controls">
      <header><h3>{closed ? 'Project closed' : 'Project controls'}</h3></header>
      {project.status === 'rejected' && (
        <p className="closed-note">Rejected at {stageOf(stages, rejection?.stage_key || project.stage_key)?.name}.{rejection?.note && <> “{rejection.note}”</>}</p>
      )}
      {project.status === 'completed' && <p className="closed-note">Every stage is complete. The record is locked and the full history is retained.</p>}
      {onHold && <p className="notice">This project is on hold. Resume it to continue the approval cycle.</p>}

      <label className="field">Note <small>{closed ? '(required to reopen)' : '(required to hold, move back or unlock)'}</small>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {closed && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('reopen')}>Reopen project</button>}
        {closed && !can('lock_unlock') && <span className="muted">Reopening a closed project needs permission to unlock records.</span>}
        {onHold && can('manage_project') && <button className="btn primary" disabled={busy} onClick={() => go('resume')}>Resume project</button>}
        {!closed && !onHold && can('manage_project') && <button className="btn line" disabled={busy} onClick={() => go('hold')}>Put on hold</button>}
      </div>
      {!closed && done.length > 0 && can('manage_project') && (
        <details className="more">
          <summary>Move back for changes</summary>
          <div className="more-row">
            <select value={backTo} onChange={(e) => setBack(e.target.value)} aria-label="Stage to move back to">
              {done.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <button className="btn line" disabled={busy} onClick={() => go('return', { to_stage: backTo })}>Move back</button>
          </div>
          <small className="muted">That stage and everything after it restarts its approval cycle. Everything already recorded stays in the history.</small>
        </details>
      )}
      {!closed && done.length > 0 && can('lock_unlock') && (
        <details className="more">
          <summary>Lock or unlock approved stages</summary>
          <ul className="lock-list">
            {done.map((s) => (
              <li key={s.key}>
                <span>{s.name}</span>
                {row(s.key).locked
                  ? <button className="btn line" disabled={busy} onClick={() => go('unlock', { stage_key: s.key })}>🔒 Unlock</button>
                  : <button className="btn line" disabled={busy} onClick={() => go('lock', { stage_key: s.key })}>Lock</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

export default function ActionPanel({ project, onChange, goTab }) {
  const live = project.status === 'active' || project.status === 'on_hold'
  const active = project.stages.filter((r) => ['in_progress', 'awaiting_approval'].includes(r.state))
  return (
    <>
      {live && active.length > 1 && (
        <p className="parallel-banner">
          <b>{active.length} workstreams are running in parallel.</b> Each has its own status and approval cycle. The next milestone starts only when all required ones are approved.
        </p>
      )}
      {live && (
        <div className={`stagecards ${active.length > 1 ? 'multi' : ''}`}>
          {active.map((row) => <StageCard key={row.key} project={project} row={row} onChange={onChange} goTab={goTab} locked={project.status === 'on_hold'} />)}
        </div>
      )}
      <ProjectControls project={project} onChange={onChange} />
    </>
  )
}
