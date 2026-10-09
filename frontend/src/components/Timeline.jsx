import { useStages } from '../context'
import { fmtDateTime, label } from './bits'

const VERB = {
  created: 'Created', submit: 'Submitted for approval', approve: 'Approved', send_back: 'Sent back for rework', reject: 'Rejected, project closed',
  bypass: 'Bypassed (not needed)', hold: 'Put on hold', resume: 'Resumed', reopen: 'Reopened', lock: 'Locked', unlock: 'Unlocked',
  edit: 'Details edited', update: 'Updated', assigned: 'Task assigned', accept: 'Task accepted', start: 'Work started',
  request_changes: 'Changes requested', request_date: 'Date change requested', approve_date: 'Date change approved',
  reject_date: 'Date change rejected', reassign: 'Reassigned', version: 'New version', return: 'Moved back', requested: 'Requested',
  opened: 'RFI opened', question: 'RFI question assigned', response: 'RFI response updated', ready: 'Response package ready',
  submission: 'Submission recorded', close: 'Closed',
}

export default function Timeline({ events }) {
  const stages = useStages()
  const name = (k) => stages.find((s) => s.key === k)?.name
  const title = (e) => {
    if (e.action === 'return') return `Moved back to ${name(e.to_stage)}`
    const base = VERB[e.action] || label(e.action)
    const where = ['created', 'edit', 'hold', 'resume', 'reopen'].includes(e.action) && e.area === 'project' ? '' : name(e.stage_key)
    return where ? `${base} · ${where}` : base
  }
  return (
    <ul className="timeline">
      {[...events].reverse().map((e) => (
        <li key={e.id} className={`ev-${e.action} ar-${e.area}`}>
          <span className="dot" />
          <div>
            <strong>{title(e)}</strong>
            {e.note && <p>{e.note}</p>}
            <small>{[label(e.area), e.actor, fmtDateTime(e.created_at)].filter(Boolean).join(' · ')}</small>
          </div>
        </li>
      ))}
    </ul>
  )
}
