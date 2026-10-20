import { useState } from 'react'
import { api } from '../api'
import { stageOf, useCan, useMe, useStages } from '../context'
import { StateChip, fmtDateTime, useDo } from './bits'

const tabOf = (st) => (st.tab && st.tab !== 'tasks' ? st.tab : null)


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

/** Is it this person's move on this stage? One definition, used by the banner and by the cards. */
function turnOf(project, row, me, st, can) {
  const sup = me.role_key === 'super_admin'
  const canSubmit = sup || st.owner_roles.includes(me.role_key)  // managers may step in, but it is not their turn
  const last = [...(project.events || [])].reverse().find((e) => e.stage_key === row.key && e.area === 'stage' && e.action === 'submit')
  const self = !sup && last?.actor === me.name
  const canDecide = (sup || st.approver_roles.includes(me.role_key)) && !self
  const blocked = row.blockers.length > 0
  if (row.state === 'in_progress' && canSubmit) return blocked ? 'finish' : 'submit'
  if (row.state === 'awaiting_approval' && canDecide) return 'decide'
  return ''
}

function YourTurn({ project, active }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const mine = active.map((r) => ({ r, t: turnOf(project, r, me, stageOf(stages, r.key), can) })).filter((x) => x.t)
  if (!active.length) return null
  if (!mine.length) {
    return (
      <div className="yourturn quiet" role="status">
        <span><b>Nothing needs you on this project right now.</b>
          {active.map((r) => <p key={r.key}>{stageOf(stages, r.key).name}: {r.handoff?.with?.action === 'approve' ? 'waiting for approval from' : 'work is with'} {withText(r.handoff?.with)}.</p>)}</span>
      </div>
    )
  }
  const verb = { submit: 'submit your work', finish: 'finish the open items, then submit', decide: 'approve or send it back' }
  return (
    <div className="yourturn" role="status">
      <span><b>It is your turn on {mine.length === 1 ? 'this step' : `${mine.length} steps`}</b>
        {mine.map(({ r, t }) => <p key={r.key}>{stageOf(stages, r.key).name}: {verb[t]}.</p>)}</span>
    </div>
  )
}

/** "Rajiv Kapoor (Director)" or, when nobody holds the role, the role's plain name. */
export function withText(h) {
  if (!h) return ''
  const p = h.people || []
  if (!p.length) return h.label
  return p.length > 2 ? `${p.slice(0, 2).join(', ')} and ${p.length - 2} more` : p.join(' or ')
}

function StageCard({ project, row, onChange, goTab, locked, fold }) {
  const stages = useStages()
  const me = useMe()
  const can = useCan()
  const st = stageOf(stages, row.key)
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const { busy, error, run, setError } = useDo()
  const sup = me.role_key === 'super_admin'
  const canSubmit = sup || st.owner_roles.includes(me.role_key) || can('manage_project')
  const lastSubmit = [...(project.events || [])].reverse().find((e) => e.stage_key === row.key && e.area === 'stage' && e.action === 'submit')
  const selfSubmitted = !sup && lastSubmit?.actor === me.name
  const canDecide = (sup || st.approver_roles.includes(me.role_key)) && !selfSubmitted
  const waitsOn = (k) => stageOf(stages, k).name
  const dependents = stages.filter((s) => s.requires.includes(st.key))
  const unlocks = dependents.filter((s) => s.requires.every((r) => r === st.key || ['approved', 'bypassed'].includes(project.stage_states[r])))
  const waiting = dependents.flatMap((s) => s.requires.filter((r) => r !== st.key && !['approved', 'bypassed'].includes(project.stage_states[r])).map(waitsOn))
  const blocked = row.blockers.length > 0
  const disabled = busy || locked
  const h = row.handoff || {}
  const turn = locked ? '' : turnOf(project, row, me, st, can)
  const acting = ['submit', 'finish', 'decide'].includes(turn)
  const awaiting = row.state === 'awaiting_approval'
  const owners = withText({ people: h.owners, label: st.owner })
  const approvers = withText({ people: h.approvers, label: st.approver })
  const steppingIn = row.state === 'in_progress' && !turn && !locked && (sup || can('manage_project'))
  const since = row.days_in_stage ? `In this step for ${row.days_in_stage} day${row.days_in_stage === 1 ? '' : 's'}` : 'Opened today'
  const afterApprove = dependents.length === 0 ? 'the project closes' : unlocks.length ? `${unlocks.map((s) => s.name).join(' and ')} opens` : `it then waits for ${[...new Set(waiting)].join(', ')}`

  const go = (action) => {
    if (['send_back', 'reject', 'bypass'].includes(action) && !note.trim()) {
      setShowNote(true)
      setError(action === 'send_back' ? 'Write the reason first. The person who did the work will see it on this card.' : 'Add a short note first: it goes to the audit trail.')
      return
    }
    run(async () => {
      onChange(await api.act(project.id, { action, note, stage_key: row.key }))
      setNote(''); setShowNote(false)
    })
  }

  const mine = !locked && ['submit', 'decide'].includes(turn)
  const Wrap = fold ? 'details' : 'div'
  const head = fold
    ? <summary><h2>{st.name}</h2><span>{mine && <span className="you">Your turn · </span>}<StateChip state={row.state} /></span>
      <small className="fold-who">{awaiting ? `Waiting for approval from ${approvers}` : `Work is with ${owners}`}</small></summary>
    : <><header><span className="eyebrow">Phase {st.phase} of {Math.max(...stages.map((x) => x.phase))}</span><StateChip state={row.state} /></header><h2>{st.name}</h2></>
  const youdo = {
    submit: 'Your action: finish the work, then press Submit for approval.',
    finish: 'Your action: finish the open items below, then submit.',
    decide: 'Your action: read the work, then approve it or send it back with a reason.',
  }[turn] || (locked ? 'The project is on hold, so nothing can be done until it is resumed.'
    : awaiting && selfSubmitted ? 'Nothing for you to do. You submitted this, so someone else has to approve it.'
      : steppingIn ? `Nothing is required from you. ${owners} will do the work. As a manager you can also submit it for them.`
        : `Nothing for you to do. ${awaiting ? approvers : owners} will act.`)

  return (
    <section className="panel callout stagecard" id={`step-${row.key}`}>
      <Wrap className={fold ? 'stagecard-fold' : undefined} {...(fold ? { open: mine || (awaiting && selfSubmitted) } : {})}>
      {head}
      <div className={`handoff ${row.state}`}>
        <p className="handoff-line">
          {awaiting ? <>Waiting for approval from <b>{approvers}</b></> : <>Work is with <b>{owners}</b></>}
          <small>{since}</small>
        </p>
        {awaiting && h.submitted && <p className="handoff-sub">Submitted by <b>{h.submitted.by}</b> on {fmtDateTime(h.submitted.at)}{h.submitted.note ? <> with the message “{h.submitted.note}”</> : ' with no message'}.</p>}
        <p className="handoff-why">{awaiting ? 'Every step needs a second person to approve it before the next one opens.'
          : h.sent_back && !h.sent_back.resolved ? 'It was sent back, so the team is fixing it.' : 'This step is open. The team does the work, then submits it for approval.'}</p>
      </div>

      {h.sent_back && !h.sent_back.resolved && (
        <div className="sentback" role="note">
          <b>Sent back by {h.sent_back.by} on {fmtDateTime(h.sent_back.at)}</b>
          <p>Reason: “{h.sent_back.note || 'No reason was written.'}”</p>
          <small>Fix this, then submit again. It goes back to the same approver.</small>
        </div>
      )}
      {h.sent_back?.resolved && (
        <p className="sentback-old">Earlier it was sent back by {h.sent_back.by}: “{h.sent_back.note}”. That was fixed and resubmitted.</p>
      )}

      <Cycle row={row} />
      <p className="callout-desc">{st.description}</p>

      <div className="whatnext">
        <b>What happens next</b>
        <ul>
          {awaiting
            ? <><li><b>Approve</b>: {afterApprove}.</li><li><b>Send back</b>: it returns to {owners} with the reason.</li></>
            : <li><b>Submit</b>: it goes to {approvers} to approve.</li>}
        </ul>
      </div>
      <p className={`youdo ${acting ? 'on' : ''}`}>{youdo}</p>

      {row.warnings?.length > 0 && (
        <ul className="deps">{row.warnings.map((w) => <li key={w.text} className={`dep dep-${w.kind}`}><b>{w.kind === 'soft' ? 'Good to know' : 'Still waiting'}</b> {w.text}</li>)}</ul>
      )}

      {blocked && (
        <details className="blockers" role="note" open={turn === 'finish'}>
          <summary><b>{row.blockers.length} thing{row.blockers.length > 1 ? 's' : ''} to finish before this can be submitted</b></summary>
          <ul>{row.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <button className="link" onClick={() => goTab(tabOf(st) || 'tasks')}>Open {tabOf(st) ? 'the workstream' : 'tasks'} →</button>
        </details>
      )}

      {(turn === 'decide' || showNote)
        ? <label className="field">{turn === 'decide' ? 'Your reason (needed if you send it back)' : turn === 'submit' || turn === 'finish' ? 'Message for the approver (optional)' : 'Note'}
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={turn === 'decide' ? 'Say what is wrong, so the team knows what to fix…' : 'Anything the approver should know…'} disabled={locked} /></label>
        : acting && <button className="link note-toggle" onClick={() => setShowNote(true)}>+ Add a message for the approver</button>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {row.state === 'in_progress' && canSubmit && (
          <button className="btn primary" disabled={disabled || blocked} onClick={() => go('submit')}>Submit for approval</button>
        )}
        {awaiting && canDecide && (
          <>
            <button className="btn primary" disabled={disabled || blocked} onClick={() => go('approve')}>{dependents.length ? 'Approve' : 'Approve & close project'}</button>
            <button className="btn line" disabled={disabled} onClick={() => go('send_back')}>Send back for rework</button>
            {st.can_close && <button className="btn danger" disabled={disabled} onClick={() => go('reject')}>Reject project</button>}
          </>
        )}
        {st.optional && can('bypass_optional') && <button className="btn line" disabled={disabled} onClick={() => go('bypass')}>Not needed: bypass</button>}
      </div>
      </Wrap>
    </section>
  )
}

/** A step that is not active: who finished it and when, or what it is waiting for. */
function StepSummary({ project, stageKey, goTab, inTab }) {
  const stages = useStages()
  const st = stageOf(stages, stageKey)
  const row = project.stages.find((r) => r.key === stageKey)
  if (!st || !row) return null
  const h = row.handoff || {}
  const done = ['approved', 'bypassed'].includes(row.state)
  const need = st.requires.map((k) => ({ k, name: stageOf(stages, k)?.name, state: project.stage_states[k] }))
  const tab = inTab ? null : tabOf(st)
  return (
    <section className="panel callout stagecard" id={`step-${stageKey}`}>
      <header><span className="eyebrow">Phase {st.phase} of {Math.max(...stages.map((x) => x.phase))}</span><StateChip state={row.state} locked={row.locked} /></header>
      <h2>{st.name}</h2>
      <div className={`handoff ${row.state}`}>
        {done && <p className="handoff-line">{row.state === 'bypassed' ? 'Skipped as not needed' : 'Approved'}{h.decided ? <> by <b>{h.decided.by}</b> on {fmtDateTime(h.decided.at)}</> : null}</p>}
        {done && h.decided?.note && <p className="handoff-sub">Note: “{h.decided.note}”</p>}
        {row.state === 'pending' && (
          <>
            <p className="handoff-line">Not started yet. Nobody has to act on it now.</p>
            {need.length > 0 && <ul className="needs">{need.map((n) => <li key={n.k} className={['approved', 'bypassed'].includes(n.state) ? 'ok' : ''}>{['approved', 'bypassed'].includes(n.state) ? '✓' : '○'} {n.name} {['approved', 'bypassed'].includes(n.state) ? 'is approved' : 'must be approved first'}</li>)}</ul>}
          </>
        )}
        {row.state === 'locked' && <p className="handoff-line">Locked. It needs permission to unlock.</p>}
      </div>
      {row.rework_count > 0 && <p className="sentback-old">This step was sent back {row.rework_count} time{row.rework_count > 1 ? 's' : ''} before it was approved. The reasons are in the history.</p>}
      <p className="callout-desc">{st.description}</p>
      <dl className="who">
        <dt>Work by</dt><dd>{st.owner}</dd>
        <dt>Approved by</dt><dd>{st.approver}</dd>
      </dl>
      {tab && <button className="btn line" onClick={() => goTab(tab)}>Open the {tab === 'rfi' ? 'RFI' : tab} tab</button>}
    </section>
  )
}

/** One step, in full, whatever its state: the card with actions when it is active, the summary when it is not. */
export function StepPanel({ project, stageKey, onChange, goTab, onClose, inTab }) {
  const row = project.stages.find((r) => r.key === stageKey)
  if (!row) return null
  const live = project.status === 'active' || project.status === 'on_hold'
  const active = live && ['in_progress', 'awaiting_approval'].includes(row.state)
  return (
    <div className="steppanel">
      {onClose && <div className="steppanel-bar"><button className="link" onClick={onClose}>Close this step ×</button></div>}
      {active
        ? <StageCard project={project} row={row} onChange={onChange} goTab={goTab} locked={project.status === 'on_hold'} />
        : <StepSummary project={project} stageKey={stageKey} goTab={goTab} inTab={inTab} />}
    </div>
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
    <details className="panel controls" open={closed || onHold}>
      <summary><h3>{closed ? 'Project closed' : 'Project actions'}</h3><span className="muted">Hold, move back, lock</span></summary>
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
                  ? <button className="btn line" disabled={busy} onClick={() => go('unlock', { stage_key: s.key })}>Unlock</button>
                  : <button className="btn line" disabled={busy} onClick={() => go('lock', { stage_key: s.key })}>Lock</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </details>
  )
}

export default function ActionPanel({ project, onChange, goTab, skip }) {
  const live = project.status === 'active' || project.status === 'on_hold'
  const active = project.stages.filter((r) => ['in_progress', 'awaiting_approval'].includes(r.state))
  const shown = active.filter((r) => r.key !== skip)
  return (
    <>
      {live && <YourTurn project={project} active={active} />}
      {live && active.length > 1 && (
        <p className="parallel-banner">
          <b>{active.length} workstreams are running in parallel.</b> Each has its own status and approval cycle. The next milestone starts only when all required ones are approved.
        </p>
      )}
      {live && shown.length > 0 && (
        <div className={`stagecards ${shown.length > 1 ? 'multi' : ''}`}>
          {shown.map((row) => <StageCard key={row.key} project={project} row={row} onChange={onChange} goTab={goTab} fold={shown.length > 1} locked={project.status === 'on_hold'} />)}
        </div>
      )}
      <ProjectControls project={project} onChange={onChange} />
    </>
  )
}
