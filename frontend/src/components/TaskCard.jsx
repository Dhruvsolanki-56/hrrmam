import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { stageOf, useCan, useMe, useStages } from '../context'
import { DueChip, Person, TaskChip, UserSelect, fmtDateTime, fromInput, inDays, label, toast, useDo, useFocus } from './bits'
import FormModal from './FormModal'
import { ReopenButton } from './Reopen'
import { MiniHistory } from './Timeline'

/** One task with its whole cycle: accept -> work -> submit -> approve / changes requested, plus date negotiation. */
export default function TaskCard({ task, onChanged, showProject, defaultOpen, project }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const st = stageOf(stages, task.stage_key)
  const focus = useFocus()
  const [open, setOpen] = useState(!!defaultOpen || focus === `task-${task.id}`)
  const [posting, setPosting] = useState(false)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [proposed, setProposed] = useState(inDays(3))
  const [asking, setAsking] = useState(false)
  const [noting, setNoting] = useState(false)
  const [newOwner, setNewOwner] = useState(null)
  const [attaching, setAttaching] = useState(false)
  const { busy, error, run } = useDo()

  const isAssignee = me.id === task.assignee.id || me.role_key === 'super_admin'
  const isAssigner = me.id === task.assigner?.id
  const awaiting = ['submitted', 'resubmitted'].includes(task.state)
  const canDecide = awaiting && (me.id !== task.assignee.id || me.role_key === 'super_admin')
    && (isAssigner || (can('approve') && (me.role_key === 'super_admin' || st.approver_roles.includes(me.role_key))))
  const req = task.pending_request
  const canDates = isAssigner || can('change_dates')

  const approverName = task.assigner?.name || 'the approver'
  const holder = {
    assigned: <>With <b>{task.assignee.name}</b>: waiting for them to accept the task.</>,
    accepted: <>With <b>{task.assignee.name}</b>: accepted, not started yet.</>,
    in_progress: <>With <b>{task.assignee.name}</b>: work in progress.</>,
    submitted: <>Waiting for approval from <b>{approverName}</b>. Submitted by {task.submitted?.by || task.assignee.name}{task.submitted ? ` on ${fmtDateTime(task.submitted.at)}` : ''}.</>,
    resubmitted: <>Waiting for approval from <b>{approverName}</b>. Resubmitted by {task.submitted?.by || task.assignee.name}{task.submitted ? ` on ${fmtDateTime(task.submitted.at)}` : ''}.</>,
    changes_requested: <>Back with <b>{task.assignee.name}</b> to make the changes.</>,
    approved: <>Approved. Nothing more to do.</>,
    locked: <>Approved and locked.</>,
  }[task.state] || label(task.state)

  const others = [task.assignee, task.assigner].filter((u) => u && u.id !== me.id).map((u) => u.name).join(' and ')
  const SAID = {
    submit: `Sent to ${approverName} for approval. They have been notified.`,
    approve: `Approved. ${task.assignee.name} has been told.`,
    request_changes: `Sent back to ${task.assignee.name} with your reason. They have been notified.`,
    request_date: `Request sent to ${task.assigner?.name || 'the assigner'}. The original date stands until they decide.`,
    approve_date: `New date approved. ${task.assignee.name} has been told.`,
    reject_date: `Original date kept. ${task.assignee.name} has been told why.`,
    accept: `Accepted. ${task.assigner?.name || 'The assigner'} can see you have taken it on.`,
    comment: `Note posted${others ? ` and sent to ${others}` : ''}.`,
    reassign: 'Reassigned. The new owner has been notified.',
  }
  const go = (action, extra = {}) => run(async () => {
    const body = action === 'comment' ? text : note
    if (action === 'comment' && !body.trim()) throw new Error('Write the note first.')
    const result = await api.taskAct(task.id, { action, note: body, ...extra })
    setNote(''); setText(''); setPosting(false); setAsking(false)
    onChanged?.(result)
    if (SAID[action]) toast(SAID[action])
  })
  const nextLine = {
    assigned: <><b>{task.assignee.name}</b> must accept the task.</>,
    accepted: <><b>{task.assignee.name}</b> must start the work.</>,
    in_progress: <><b>{task.assignee.name}</b> must finish it and submit it for approval.</>,
    submitted: <><b>{approverName}</b> must approve it or request changes.</>,
    resubmitted: <><b>{approverName}</b> must approve it or request changes.</>,
    changes_requested: <><b>{task.assignee.name}</b> must fix it and resubmit.</>,
  }[task.state]

  return (
    <article id={`task-${task.id}`} className={`task t-${task.state} ${task.overdue ? 'is-late' : ''} ${showProject && task.assignee.id === me.id ? 'mine' : ''}`}>
      <header onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <div className="t-title">
          <strong>{task.title}</strong>
          <small>
            {showProject && <Link to={`/projects/${task.project_id}?tab=tasks&focus=task-${task.id}`} onClick={(e) => e.stopPropagation()}>{task.project_name} · </Link>}
            {st.name}{!task.required && ' · optional'}{task.rework_count > 0 && ` · ↺ ${task.rework_count}`}
          </small>
          {task.state === 'changes_requested' && task.last_changes && <small className="muted">Returned by {task.last_changes.by}: “{task.last_changes.note || 'no reason written'}”</small>}
        </div>
        <Person user={task.assignee} />
        <div className="t-end">
          <DueChip task={task} />
          <TaskChip state={task.state} />
        </div>
      </header>

      {open && (
        <div className="task-body">
          {task.description && <p className="t-desc">{task.description}</p>}
          <p className="muted">Assigned by {task.assigner?.name || '–'} · due {fmtDateTime(task.due_at)}</p>
          <div className={`handoff t-${task.state}`}>
            <p className="handoff-line">{holder}</p>
            {nextLine && <p className="handoff-next"><span>Next action</span> {nextLine}</p>}
          </div>
          {task.last_changes && (
            <div className="sentback" role="note">
              <b>Changes requested by {task.last_changes.by} on {fmtDateTime(task.last_changes.at)}</b>
              <p>Reason: “{task.last_changes.note || 'No reason was written.'}”</p>
              <small>Fix this, attach the corrected file, then resubmit.</small>
            </div>
          )}

          <div className="t-files">
            {task.attachments?.length > 0 && (
              <ul className="versions">
                {[...task.attachments].reverse().map((a) => (
                  <li key={a.id}><b>V{a.version_no}</b><span>{a.name}{a.note ? ` · ${a.note}` : ''}</span>
                    <small>{a.created_by} · {fmtDateTime(a.created_at)} · <a href={a.link} target="_blank" rel="noreferrer">open</a></small></li>
                ))}
              </ul>
            )}
            {task.open && (isAssignee || isAssigner || can('manage_project')) && <button className="link" onClick={() => setAttaching(true)}>+ Attach a file</button>}
            {task.attachments?.length > 0 && <small className="muted">Everyone on this project can open these files.</small>}
            {task.state === 'changes_requested' && task.attachments?.length > 0 && isAssignee && <small className="muted">Attach the corrected file as a new version, then resubmit.</small>}
          </div>

          {req && (
            <div className="datereq">
              <b>{req.requested_by.name} asks for {fmtDateTime(req.proposed_due)}</b>
              <span>“{req.reason}”</span>
              {canDates && (
                <div className="actions tight">
                  <button className="btn primary sm" disabled={busy} onClick={() => go('approve_date')}>Approve new date</button>
                  <button className="btn line sm" disabled={busy} onClick={() => { if (!note.trim()) { setNoting(true); return } go('reject_date') }}>Keep original</button>
                </div>
              )}
              {!canDates && <small className="muted">Sent to {task.assigner?.name || 'the assigner'} on {fmtDateTime(req.created_at)}. Waiting for their decision. Until then the original date stands.</small>}
            </div>
          )}

          {(noting || asking) && (
            <label className="field">{asking ? 'Why do you need a different date? (required)' : canDecide ? `Reason for ${task.assignee.name} (required to request changes, kept in the record)` : 'Note (kept in the record)'}
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" autoFocus />
            </label>
          )}
          {asking && (
            <label className="field">Proposed new due date
              <input type="datetime-local" value={proposed} onChange={(e) => setProposed(e.target.value)} />
            </label>
          )}
          {error && <p className="error">{error}</p>}

          <div className="actions">
            {isAssignee && task.state === 'assigned' && <button className="btn primary" disabled={busy} onClick={() => go('accept')}>Accept task</button>}
            {isAssignee && task.state === 'accepted' && <button className="btn primary" disabled={busy} onClick={() => go('start')}>Start work</button>}
            {isAssignee && ['accepted', 'in_progress'].includes(task.state) && <button className="btn primary" disabled={busy} onClick={() => go('submit')}>Submit for approval</button>}
            {isAssignee && task.state === 'changes_requested' && <button className="btn primary" disabled={busy} onClick={() => go('submit')}>Resubmit</button>}
            {isAssignee && ['assigned', 'accepted', 'in_progress', 'changes_requested'].includes(task.state) && !req && (
              asking
                ? <button className="btn line" disabled={busy} onClick={() => go('request_date', { due_at: fromInput(proposed) })}>Send date request (reason in note)</button>
                : <button className="btn line" onClick={() => setAsking(true)}>Request a different date</button>
            )}
            {canDecide && <button className="btn primary" disabled={busy} onClick={() => go('approve')}>Approve</button>}
            {canDecide && <button className="btn line" disabled={busy} onClick={() => { if (!note.trim()) { setNoting(true); return } go('request_changes') }}>Request changes</button>}
            {project && ['approved', 'locked'].includes(task.state) && (isAssignee || isAssigner || can('manage_project')) && !can('lock_unlock') && <ReopenButton project={project} kind="task" refId={task.id} onChange={onChanged} />}
            {project && ['approved', 'locked'].includes(task.state) && (isAssignee || isAssigner || can('manage_project')) && can('lock_unlock') && <ReopenButton project={project} kind="task" refId={task.id} onChange={onChanged} text="Request reopen (amend)" />}
            {task.state === 'approved' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('lock')}>Lock</button>}
            {task.state === 'locked' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => { if (!note.trim()) { setNoting(true); return } go('unlock') }}>Unlock</button>}
            {!task.required && task.open && can('bypass_optional') && <button className="btn line" disabled={busy} onClick={() => go('bypass')}>Bypass optional work</button>}
          </div>

          {(task.notes?.length > 0 || posting) && (
            <div className="t-notes">
              <h4>Notes</h4>
              <ul>
                {(task.notes || []).map((n) => <li key={n.id}><p>{n.note}</p><small>{n.by} · {fmtDateTime(n.at)}</small></li>)}
              </ul>
              {posting && (
                <label className="field">Your note{others ? ` (goes to ${others})` : ''}
                  <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Write it here. It is saved on this task with your name and the time." />
                </label>
              )}
            </div>
          )}
          {posting && <div className="actions tight"><button className="btn primary sm" disabled={busy} onClick={() => go('comment')}>Post note</button><button className="btn ghost sm" onClick={() => { setPosting(false); setText('') }}>Cancel</button></div>}
          {!posting && task.state !== 'locked' && <button className="link note-link" onClick={() => setPosting(true)}>+ Add a note</button>}

          {can('reassign') && task.open && (
            <details className="more">
              <summary>Reassign</summary>
              <div className="more-row">
                <UserSelect value={newOwner} onChange={setNewOwner} placeholder="Choose a person…" />
                <button className="btn line" disabled={busy || !newOwner} onClick={() => go('reassign', { assignee_id: newOwner })}>Reassign</button>
              </div>
            </details>
          )}

          {task.history?.length > 0 && (
            <details className="more">
              <summary>History of this task ({task.history.length})</summary>
              <MiniHistory rows={task.history} />
            </details>
          )}
          {task.date_requests.filter((r) => r.status !== 'pending').length > 0 && (
            <details className="more">
              <summary>Date history</summary>
              <ul className="mini">
                {task.date_requests.filter((r) => r.status !== 'pending').map((r) => (
                  <li key={r.id}>{label(r.status)}: {fmtDateTime(r.previous_due)} → {fmtDateTime(r.proposed_due)} · “{r.reason}”{r.decided_by && ` · decided by ${r.decided_by.name}`}{r.decision_note && ` (“${r.decision_note}”)`}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {attaching && (
        <FormModal title="Attach a file" intro="Add a link to the file. Attaching the same name again creates the next version; earlier versions are kept."
          fields={[{ key: 'name', label: 'File name', type: 'text', placeholder: task.title }, { key: 'link', label: 'Link', type: 'url', required: true, placeholder: 'https://…' },
            { key: 'note', label: 'What is this version?', type: 'textarea' }]}
          initial={{ name: task.attachments?.[task.attachments.length - 1]?.name || '' }}
          onSave={async (d) => { onChanged?.(await api.addAttachment(task.id, d)); toast(`File attached to this task${others ? ` and ${others} ${others.includes(' and ') ? 'have' : 'has'} been notified` : ''}.`) }} onClose={() => setAttaching(false)} submitLabel="Attach" />
      )}
    </article>
  )
}
