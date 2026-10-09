import { useStages } from '../App'
import { fmtDateTime } from './bits'

const VERB = {
  created: 'Project created',
  advance: 'Completed',
  approve: 'Approved',
  reject: 'Rejected / returned',
  hold: 'Put on hold',
  clarify: 'Clarification requested',
  resume: 'Resumed',
  edit: 'Details edited',
  reopen: 'Reopened',
}

export default function Timeline({ events }) {
  const stages = useStages()
  const name = (k) => stages.find((s) => s.key === k)?.name
  return (
    <ul className="timeline">
      {[...events].reverse().map((e) => (
        <li key={e.id} className={`ev-${e.action}`}>
          <span className="dot" />
          <div>
            <strong>{e.action === 'return'
              ? `Moved back · ${name(e.stage_key)} → ${name(e.to_stage)}`
              : <>{VERB[e.action]}{e.action !== 'created' && e.action !== 'edit' && ` · ${name(e.stage_key)}`}</>}</strong>
            {e.note && e.action !== 'created' && <p>{e.note}</p>}
            <small>{[e.actor, fmtDateTime(e.created_at)].filter(Boolean).join(' · ')}</small>
          </div>
        </li>
      ))}
    </ul>
  )
}
