import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { stageOf, useCan, useMe, useStages } from '../context'
import { DueChip, Person, TaskChip, UserSelect, fmtDateTime, fromInput, inDays, label, useDo } from './bits'
import FormModal from './FormModal'
import { ReopenButton } from './Reopen'

/** One task with its whole cycle: accept -> work -> submit -> approve / changes requested, plus date negotiation. */
export default function TaskCard({ task, onChanged, showProject, defaultOpen, project }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const st = stageOf(stages, task.stage_key)
  const [open, setOpen] = useState(!!defaultOpen)
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
  const nextLine = {
    assigned: `Next: ${task.assignee.name} accepts it, does the work and submits it to ${approverName}.`,
    accepted: `Next: ${task.assignee.name} starts the work and submits it to ${approverName}.`,
    in_progress: `Next: when submitted, it goes to ${approverName} to approve or send back.`,
    submitted: `Next: ${approverName} approves it, or sends it back with a reason.`,
    resubmitted: `Next: ${approverName} approves it, or sends it back with a reason.`,
    changes_requested: `Next: after the fix, press Resubmit. It goes to ${approverName} again.`,
    approved: 'The task counts towards its step.',
    locked: 'Unlocking needs permission and a reason.',
  }[task.state] || ''

  const go = (action, extra = {}) => run(async () => {
    const result = await api.taskAct(task.id, { action, note, ...extra })
    setNote(''); setAsking(false)
    onChanged?.(result)
  })

  return (
    <article className={`task t-${task.state} ${task.overdue ? 'is-late' : ''}`}>
      <header onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <div className="t-title">
          <strong>{task.title}</strong>
          <small>
            {showProject && <Link to={`/projects/${task.project_id}?tab=tasks`} onClick={(e) => e.stopPropagation()}>{task.project_name} · </Link>}
            {st.name}{!task.required && ' · optional'}{task.rework_count > 0 && ` · ↺ ${task.rework_count}`}
          </small>
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
            <p className="handoff-why">{nextLine}</p>
          </div>
          {task.last_changes && (
            <div className="sentback" role="note">
              <b>Changes requested by {task.last_changes.by} on {fmtDateTime(task.last_changes.at)}</b>
              <p>Reason: “{task.last_changes.note || 'No reason was written.'}”</p>
              <small>Fix this, attach the corrected file, then resubmit.</small>
            </div>
          )}

          <div className="t-files">
            <div className="t-files-head"><b>Files</b>
              {task.open && (isAssignee || isAssigner || can('manage_project')) && <button className="link" onClick={() => setAttaching(true)}>+ Attach a file</button>}</div>
            {task.attachments?.length > 0 ? (
              <ul className="versions">
                {[...task.attachments].reverse().map((a) => (
                  <li key={a.id}><b>V{a.version_no}</b><span>{a.name}{a.note ? ` · ${a.note}` : ''}</span>
                    <small>{a.created_by} · {fmtDateTime(a.created_at)} · <a href={a.link} target="_blank" rel="noreferrer">open</a></small></li>
                ))}
              </ul>
            ) : <small className="muted">No files attached.</small>}
            {task.state === 'changes_requested' && task.attachments?.length > 0 && Math.max(...task.attachments.map((a) => a.version_no)) >= 1 && isAssignee && <small className="muted">Attach the corrected file as a new version, then resubmit.</small>}
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
            <label className="field">{asking ? 'Why do you need a different date? (required)' : 'Note (kept in the record)'}
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
            {project && ['approved', 'locked'].includes(task.state) && !can('lock_unlock') && <ReopenButton project={project} kind="task" refId={task.id} onChange={onChanged} />}
            {project && ['approved', 'locked'].includes(task.state) && can('lock_unlock') && <ReopenButton project={project} kind="task" refId={task.id} onChange={onChanged} text="Request reopen (amend)" />}
            {task.state === 'approved' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('lock')}>Lock</button>}
            {task.state === 'locked' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => { if (!note.trim()) { setNoting(true); return } go('unlock') }}>Unlock</button>}
            {!task.required && task.open && can('bypass_optional') && <button className="btn line" disabled={busy} onClick={() => go('bypass')}>Bypass optional work</button>}
            {!noting && !asking && task.state !== 'locked' && <button className="link note-link" onClick={() => setNoting(true)}>+ Add a note</button>}
          </div>

          {can('reassign') && task.open && (
            <details className="more">
              <summary>Reassign</summary>
              <div className="more-row">
                <UserSelect value={newOwner} onChange={setNewOwner} placeholder="Choose a person…" />
                <button className="btn line" disabled={busy || !newOwner} onClick={() => go('reassign', { assignee_id: newOwner })}>Reassign</button>
              </div>
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
          onSave={async (d) => onChanged?.(await api.addAttachment(task.id, d))} onClose={() => setAttaching(false)} submitLabel="Attach" />
      )}
    </article>
  )
}
