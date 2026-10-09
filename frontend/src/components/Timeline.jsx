import { useStages } from '../App'
import { fmtDateTime } from './bits'

const VERB = {
  created: 'Project created',
  submit: 'Submitted for approval',
  approve: 'Approved',
  send_back: 'Sent back for rework',
  reject: 'Rejected, project closed',
  clarify: 'More information requested',
  info: 'Information received',
  hold: 'Put on hold',
  resume: 'Resumed',
  edit: 'Details edited',
  reopen: 'Reopened',
  advance: 'Completed', // older entries
}

export default function Timeline({ events }) {
  const stages = useStages()
  const name = (k) => stages.find((s) => s.key === k)?.name
  const title = (e) => {
    if (e.action === 'return') return `Moved back · ${name(e.to_stage)}`
    if (e.action === 'send_back' && e.to_stage && e.to_stage !== e.stage_key) return `Sent back · ${name(e.stage_key)} → ${name(e.to_stage)}`
    if (['created', 'edit', 'hold', 'resume'].includes(e.action)) return VERB[e.action]
    return `${VERB[e.action] || e.action} · ${name(e.stage_key)}`
  }
  return (
    <ul className="timeline">
      {[...events].reverse().map((e) => (
        <li key={e.id} className={`ev-${e.action}`}>
          <span className="dot" />
          <div>
            <strong>{title(e)}</strong>
            {e.note && e.action !== 'created' && <p>{e.note}</p>}
            <small>{[e.actor, fmtDateTime(e.created_at)].filter(Boolean).join(' · ')}</small>
          </div>
        </li>
      ))}
    </ul>
  )
}
