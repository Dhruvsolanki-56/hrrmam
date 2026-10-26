import { useState } from 'react'
import { api } from '../api'
import { stageOf, useAccess, useCan, useMe, useStages, useUsers } from '../context'
import FormModal from './FormModal'
import { StateChip, fmtDateTime, orList, toast, useDo } from './bits'
import { MiniHistory } from './Timeline'

const tabOf = (st) => (st.tab && st.tab !== 'tasks' ? st.tab : null)


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

function YourTurn({ project, active, onPick }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const mine = active.map((r) => ({ r, t: turnOf(project, r, me, stageOf(stages, r.key), can) })).filter((x) => x.t)
  if (!active.length) return null
  if (!mine.length) return <p className="yourturn quiet" role="status"><b>Nothing needs you on this project right now.</b></p>
  const verb = { submit: 'The work is done. Submit it for approval.', finish: 'Finish the work, then submit it for approval.', decide: 'Review it, then approve it or send it back with a reason.' }
  return (
    <div className="yourturn" role="status">
      <h3>What you need to do on this project</h3>
      <ul>
        {mine.map(({ r, t }) => (
          <li key={r.key}>
            <div><strong>{stageOf(stages, r.key).name}</strong><span>{t === 'finish' && !(stageOf(stages, r.key).owner_roles || []).includes(me.role_key) ? 'You oversee this step. Open it to check progress or step in.' : verb[t]}</span></div>
            <button className="btn line" onClick={() => onPick?.(r.key)}>Open</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function withText(h) {
  if (!h) return ''
  const p = h.people || []
  if (!p.length) return h.label
  return orList(p)
}

/** Everything the project knows about one step, oldest first: started, submitted, sent back, approved, assigned, notes and the work done inside it. */
export function stepEvents(project, key) {
  return (project.events || []).filter((e) => e.stage_key === key).map((e) => ({ ...e, by: e.actor, at: e.created_at }))
}

function PhaseHistory({ project, stageKey }) {
  const rows = stepEvents(project, stageKey)
  return (
    <details className="more phase-hist">
      <summary>History of this step ({rows.length})</summary>
      <MiniHistory rows={rows} empty="Nothing has happened on this step yet." />
    </details>
  )
}

/** Who does the work, who approves, who oversees, and a way for a project manager to name them. */
function Responsibility({ project, row, st, onChange }) {
  const can = useCan()
  const users = useUsers()
  const [open, setOpen] = useState(false)
  const h = row.handoff || {}
  const live = ['in_progress', 'awaiting_approval'].includes(row.state)
  const mayName = can('manage_project') && live && project.status === 'active'
  const workers = users.filter((u) => u.active !== false && (st.owner_roles.includes(u.role_key) || u.role_key === 'super_admin'))
  const approvers = users.filter((u) => u.active !== false && st.approver_roles.includes(u.role_key))
  return (
    <>
      <dl className="who who-live">
        <dt>Responsible for the work</dt><dd>{h.owners?.length ? orList(h.owners) : st.owner}{h.lead ? <small> · chosen by the project manager</small> : null}</dd>
        <dt>Approves</dt><dd>{h.approvers?.length ? orList(h.approvers) : st.approver}{h.approver ? <small> · chosen by the project manager</small> : null}</dd>
        {h.oversight?.length > 0 && <><dt>Project manager</dt><dd>{h.oversight.join(', ')}</dd></>}
      </dl>
      {mayName && <button className="link" onClick={() => setOpen(true)}>Choose who is responsible or who approves</button>}
      {open && (
        <FormModal title={`Who is responsible for ${st.name}?`} intro="Name one person for the work and/or one person to approve it. Everyone else on the project can still read it; they just will not be asked to act."
          fields={[{ key: 'lead_id', label: 'Does the work', type: 'select', half: true, blank: 'Leave as the team', options: workers.map((u) => [u.id, `${u.name} · ${u.role}`]) },
            { key: 'approver_id', label: 'Approves', type: 'select', half: true, blank: 'Leave as the approvers', options: approvers.map((u) => [u.id, `${u.name} · ${u.role}`]) },
            { key: 'note', label: 'Why? (optional)', type: 'text' }]}
          initial={{ lead_id: h.lead?.id || '', approver_id: h.approver?.id || '' }}
          onSave={async (d) => {
            const body = { note: d.note || '' }
            if (d.lead_id) body.lead_id = Number(d.lead_id); else if (h.lead) body.clear_lead = true
            if (d.approver_id) body.approver_id = Number(d.approver_id); else if (h.approver) body.clear_approver = true
            const p = await api.assignStage(project.id, st.key, body)
            onChange(p)
            toast('Saved. The people you chose have been notified and it is now on their list.')
          }}
          onClose={() => setOpen(false)} submitLabel="Save" />
      )}
    </>
  )
}

/** The Dossier Ready (milestone) step is a checkpoint over the whole project: list what it checks and what is missing. */
function Checks({ row, goTab }) {
  if (!row.checks?.length) return null
  const open = row.checks.filter((c) => !c.ok).length
  const h = row.handoff || {}
  return (
    <div className="checks">
      <b>What this step checks{open ? ` (${open} not done yet)` : ' (everything is done)'}</b>
      <p className="muted">This is a checkpoint, not paperwork: nothing new is uploaded here. {h.owners?.length ? `${orList(h.owners)} confirm` : 'Regulatory confirms'} the dossier is complete and {h.approvers?.length ? `${orList(h.approvers)} approve` : 'an RA reviewer or the Director approves'} it. Approving locks the dossier for external submission.</p>
      <ul>
        {row.checks.map((c) => (
          <li key={c.label} className={c.ok ? 'ok' : ''}>
            <span aria-hidden="true">{c.ok ? '✓' : '○'}</span>
            <span>{c.label}<small>{c.detail}</small></span>
            {!c.ok && c.tab && <button className="link" onClick={() => goTab(c.tab)}>Open</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StageCard({ project, row, onChange, goTab, locked, fold, inTab }) {
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
  // nobody approves their own work, so the person who did it is never named as its approver
  const doer = awaiting ? h.submitted?.by : ['submit', 'finish'].includes(turn) ? me.name : ''
  const skip = doer ? [doer] : row.state === 'in_progress' ? (h.owners || []).map((o) => o.split(' (')[0]) : []
  const others = (list) => { const k = (list || []).filter((n) => !skip.some((d) => n.startsWith(`${d} (`))); return k.length ? k : list || [] }
  const owners = withText({ people: h.owners, label: st.owner })
  const approvers = withText({ people: others(h.approvers), label: st.approver })
  const since = row.days_in_stage ? `In this step for ${row.days_in_stage} day${row.days_in_stage === 1 ? '' : 's'}` : 'Opened today'
  const afterApprove = dependents.length === 0 ? 'the project closes' : unlocks.length ? `${unlocks.map((s) => s.name).join(' and ')} opens` : `it then waits for ${[...new Set(waiting)].join(', ')}`

  const go = (action) => {
    if (['send_back', 'reject', 'bypass'].includes(action) && !note.trim()) {
      setShowNote(true)
      setError(action === 'send_back' ? 'Write the reason first. The person who did the work will see it on this card.' : 'Add a short note first: it goes to the audit trail.')
      return
    }
    run(async () => {
      const p = await api.act(project.id, { action, note, stage_key: row.key })
      onChange(p)
      setNote(''); setShowNote(false)
      const after = p.stages.find((r) => r.key === row.key)?.handoff || {}
      const opened = stages.filter((s) => s.requires.includes(row.key) && p.stage_states[s.key] === 'in_progress').map((s) => s.name)
      toast({
        submit: `Submitted. It is now with ${orList(after.approvers || []) || st.approver} for approval. They have been notified.`,
        approve: opened.length ? `Approved. ${opened.join(' and ')} ${opened.length > 1 ? 'have' : 'has'} started and the people responsible have been notified.` : p.status === 'completed' ? 'Approved. The project is complete.' : `Approved. ${h.submitted?.by || 'The person who did the work'} has been told.`,
        send_back: `Sent back to ${orList(after.owners || []) || owners} with your reason. They have been notified.`,
        reject: 'Project rejected. The project manager has been notified.', bypass: 'Marked as not needed. The next steps have been opened.',
      }[action])
    })
  }

  const mine = !locked && ['submit', 'decide'].includes(turn)
  const Wrap = fold ? 'details' : 'div'
  const head = fold
    ? <summary><h2>{st.name}</h2><span>{mine && <span className="you">Your turn · </span>}<StateChip state={row.state} /></span>
      <small className="fold-who">{awaiting ? `Waiting for approval from ${approvers}` : `Work is with ${owners}`}</small></summary>
    : <><header><span className="eyebrow">Step {st.phase} of {Math.max(...stages.map((x) => x.phase))}</span><span>{mine && <span className="you-chip">Your turn</span>}<StateChip state={row.state} /></span></header><h2>{st.name}</h2></>
  return (
    <section className="panel callout stagecard" id={`step-${row.key}`}>
      <Wrap className={fold ? 'stagecard-fold' : undefined} {...(fold ? { open: mine || (awaiting && selfSubmitted) } : {})}>
      {head}
      <p className="now-who">{awaiting ? <>Waiting for approval from <b>{approvers}</b></> : <>Being worked on by <b>{owners}</b></>}</p>
      {awaiting && h.submitted && <p className="now-sub">Submitted by {h.submitted.by} on {fmtDateTime(h.submitted.at)}{h.since ? ` · waiting since ${fmtDateTime(h.since)}` : ''}{h.submitted.note ? <> · “{h.submitted.note}”</> : null}</p>}
      {!awaiting && h.since && <p className="now-sub">{h.started?.note ? `${h.started.note}. ` : ''}Since {fmtDateTime(h.since)}{row.days_in_stage ? ` (${row.days_in_stage} day${row.days_in_stage === 1 ? '' : 's'})` : ''}.</p>}
      <Checks row={row} goTab={goTab} />

      {h.sent_back && !h.sent_back.resolved && (
        <div className="sentback" role="note">
          <b>Sent back by {h.sent_back.by}, {fmtDateTime(h.sent_back.at)}</b>
          <p>“{h.sent_back.note || 'No reason was written.'}”</p>
        </div>
      )}

      {!acting && <p className="handoff-next"><span>Next action</span> {awaiting
        ? <><b>{approvers}</b> must approve it or send it back.</>
        : blocked ? <><b>{owners}</b> must finish what is listed below, then submit it for approval.</> : <><b>{owners}</b> must submit it for approval.</>}</p>}

      {blocked && (
        <div className="todo-box" role="note">
          <b>{awaiting ? 'Approval is not possible yet. Still open:' : 'Before this can be submitted'}</b>
          <ul>{row.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          {!inTab && <button className="link" onClick={() => goTab(tabOf(st) || 'tasks')}>Open {tabOf(st) ? 'the workstream' : 'tasks'} →</button>}
        </div>
      )}

      {(turn === 'decide' || showNote)
        ? <label className="field">{turn === 'decide' ? 'Reason (needed if you send it back)' : 'Message for the approver (optional)'}
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={turn === 'decide' ? 'Say what is wrong, so the team knows what to fix…' : 'Anything the approver should know…'} disabled={locked} /></label>
        : acting && !blocked && <button className="link note-toggle" onClick={() => setShowNote(true)}>+ Add a message for the approver</button>}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {row.state === 'in_progress' && canSubmit && (
          <button className="btn primary" disabled={disabled || blocked} onClick={() => go('submit')}>Submit for approval</button>
        )}
        {awaiting && canDecide && (
          <>
            <button className="btn primary" disabled={disabled || blocked} onClick={() => go('approve')}>{dependents.length ? 'Approve' : 'Approve & close project'}</button>
            <button className="btn line" disabled={disabled} onClick={() => go('send_back')}>Send back</button>
            {st.can_close && <button className="btn danger" disabled={disabled} onClick={() => go('reject')}>Reject project</button>}
          </>
        )}
        {st.optional && can('bypass_optional') && <button className="btn line" disabled={disabled} onClick={() => go('bypass')}>Not needed: bypass</button>}
      </div>
      {((row.state === 'in_progress' && canSubmit) || (awaiting && canDecide)) && (
        <p className="act-hint">{awaiting ? `Approving: ${afterApprove}. Sending back: returns it to ${owners}.` : `Submitting sends it to ${approvers} to approve.`}</p>
      )}
      {!acting && awaiting && selfSubmitted && <p className="act-hint">You submitted this, so someone else has to approve it.</p>}
      {!acting && awaiting && !selfSubmitted && !canDecide && <p className="act-hint">Only {approvers} can approve or send this back. You can follow it here.</p>}
      {!acting && row.state === 'in_progress' && !canSubmit && <p className="act-hint">Only {owners} submit this step. You can follow it here.</p>}
      {!acting && row.state === 'in_progress' && canSubmit && !(sup || st.owner_roles.includes(me.role_key)) && <p className="act-hint">{owners} do the work and submit it. You can step in as project manager.</p>}

      <Responsibility project={project} row={row} st={st} onChange={onChange} />
      <PhaseHistory project={project} stageKey={row.key} />

      <details className="more step-about">
        <summary>About this step</summary>
        <p>{st.description}</p>
        {st.requires.length > 0 && <p className="muted">Started after: {st.requires.map((k) => `${waitsOn(k)} (${project.stage_states[k] === 'approved' ? 'approved' : project.stage_states[k] === 'bypassed' ? 'not needed' : 'not approved'})`).join(', ')}.</p>}
        {row.warnings?.map((w) => <p key={w.text} className="dep-note">{w.text}</p>)}
        <p className="muted">{since}. When approved: {afterApprove}.</p>
      </details>
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
      <p className="callout-desc">{st.description}</p>
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
      <Checks row={row} goTab={goTab} />
      <dl className="who">
        <dt>Work by</dt><dd>{st.owner}</dd>
        <dt>Approved by</dt><dd>{h.decided ? h.decided.by : st.approver}</dd>
        {h.started && <><dt>Started</dt><dd>{fmtDateTime(h.started.at)}{h.started.note ? ` · ${h.started.note}` : ''}</dd></>}
      </dl>
      <PhaseHistory project={project} stageKey={stageKey} />
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
        ? <StageCard project={project} row={row} onChange={onChange} goTab={goTab} locked={project.status === 'on_hold'} inTab={inTab} />
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

export default function ActionPanel({ project, onChange, goTab, skip, onPick }) {
  const live = project.status === 'active' || project.status === 'on_hold'
  const active = project.stages.filter((r) => ['in_progress', 'awaiting_approval'].includes(r.state))
  const shown = active.filter((r) => r.key !== skip)
  return (
    <>
      {project.status === 'active' && active.length > 1 && <YourTurn project={project} active={active} onPick={onPick} />}
      {live && shown.length === 1 && (
        <div className={`stagecards ${shown.length > 1 ? 'multi' : ''}`}>
          {shown.map((row) => <StageCard key={row.key} project={project} row={row} onChange={onChange} goTab={goTab} fold={shown.length > 1} locked={project.status === 'on_hold'} />)}
        </div>
      )}
      <ProjectControls project={project} onChange={onChange} />
    </>
  )
}
