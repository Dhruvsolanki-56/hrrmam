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
            <strong>{VERB[e.action]}{e.action !== 'created' && ` · ${name(e.stage_key)}`}</strong>
            {e.note && e.action !== 'created' && <p>{e.note}</p>}
            <small>{[e.actor, fmtDateTime(e.created_at)].filter(Boolean).join(' · ')}</small>
          </div>
        </li>
      ))}
    </ul>
  )
}
