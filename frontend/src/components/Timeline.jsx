import { Link } from 'react-router-dom'
import { useStages } from '../context'
import { fmtDateTime, label, projectUrl, usePaged } from './bits'

const VERB = {
  created: 'Created', submit: 'Submitted for approval', approve: 'Approved', send_back: 'Sent back for rework', reject: 'Rejected, project closed',
  bypass: 'Bypassed (not needed)', hold: 'Put on hold', resume: 'Resumed', reopen: 'Reopened', lock: 'Locked', unlock: 'Unlocked',
  edit: 'Details edited', update: 'Updated', assigned: 'Task assigned', accept: 'Task accepted', start: 'Work started',
  request_changes: 'Changes requested', request_date: 'Date change requested', approve_date: 'Date change approved',
  reject_date: 'Date change rejected', reassign: 'Reassigned', version: 'New version', return: 'Moved back', requested: 'Requested',
  opened: 'RFI opened', question: 'RFI question assigned', response: 'RFI response updated', ready: 'Response package ready',
  submission: 'Submission recorded', close: 'Closed', attachment: 'File attached', responded: 'Clarification answered',
  accepted: 'Answer accepted', not_accepted: 'Answer not accepted', reopen_requested: 'Reopen requested',
  reopen_approved: 'Reopen approved', reopen_rejected: 'Reopen declined', reopened: 'Reopened for changes',
  value: 'Dossier value recorded', review_acknowledged: 'Finding acknowledged', review_dismissed: 'Finding dismissed',
  started: 'Step started', note: 'Note added', comment: 'Note added', assign: 'Responsibility assigned',
}

/** Plain wording for one event's action, the same on the history tab, the audit trail and every item's own history. */
export const actionLabel = (e) => {
  if (e.action === 'reject' && e.area !== 'stage') return 'Changes requested'
  if (e.action === 'return' && !['stage', 'project'].includes(e.area)) return 'Returned for changes'
  if (e.action === 'submit' && e.area === 'artwork') return 'Sent for review'
  return VERB[e.action] || label(e.action)
}

/** One record's own history, oldest first: what happened, who did it, who it went to, why, and when. */
export function MiniHistory({ rows, empty = 'Nothing has happened yet.' }) {
  if (!rows?.length) return <p className="muted">{empty}</p>
  return (
    <ol className="minihist">
      {rows.map((r) => (
        <li key={r.id} className={`mh-${r.action}`}>
          <span className="dot" />
          <div>
            <b>{actionLabel(r)}</b>
            <small>{r.by} · {fmtDateTime(r.at || r.created_at)}{r.version ? ` · V${r.version}` : ''}{r.to ? ` · to ${r.to}` : ''}</small>
            {r.note && <p>{r.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function Timeline({ events }) {
  const stages = useStages()
  const name = (k) => stages.find((s) => s.key === k)?.name
  const title = (e) => {
    if (e.action === 'return' && name(e.to_stage)) return `Moved back to ${name(e.to_stage)}`
    if (e.action === 'return' && ['stage', 'project'].includes(e.area)) return `Returned for changes${name(e.stage_key) ? ` · ${name(e.stage_key)}` : ''}`
    const base = actionLabel(e)
    const where = ['created', 'edit', 'hold', 'resume', 'reopen'].includes(e.action) && e.area === 'project' ? '' : name(e.stage_key)
    return where ? `${base} · ${where}` : base
  }
  const { items, pager } = usePaged([...events].reverse(), 20, events.length)
  return (
    <>
    <ul className="timeline">
      {items.map((e) => (
        <li key={e.id} className={`ev-${e.action} ar-${e.area}`}>
          <span className="dot" />
          <div>
            <strong>{title(e)}</strong>
            {e.note && <p>{e.note}</p>}
            <small>{[label(e.area), e.actor, e.to ? `to ${e.to}` : '', fmtDateTime(e.created_at)].filter(Boolean).join(' · ')}</small>
            {e.link && e.project_id && <Link className="ev-open" to={projectUrl(e.project_id, e.link)}>Open</Link>}
          </div>
        </li>
      ))}
    </ul>
    {pager}
    </>
  )
}
