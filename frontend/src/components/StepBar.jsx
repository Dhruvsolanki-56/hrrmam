import { STATE } from './bits'
import { withText } from './ActionPanel'

/** The progress bar, one clickable segment per step. Clicking a step opens its details (who has it, why, what next). */
export default function StepBar({ project, selected, onPick }) {
  const stages = project.flow.stages
  const done = stages.filter((s) => ['approved', 'bypassed'].includes(project.stage_states[s.key])).length
  return (
    <div className="stepbar-wrap">
      <div className="stepbar" role="group" aria-label={`${done} of ${stages.length} steps done. Choose a step to see its details`}>
        {stages.map((s, i) => {
          const st = project.stage_states[s.key]
          const row = project.stages.find((r) => r.key === s.key)
          let cls = 'todo'
          if (project.status === 'completed' || ['approved', 'bypassed'].includes(st)) cls = 'done'
          else if (st === 'awaiting_approval') cls = 'awaiting'
          else if (st === 'in_progress') cls = 'current'
          const w = row?.handoff?.with
          const tip = `${i + 1}. ${s.name}: ${STATE[st] || 'Not started'}${w ? ` · ${w.action === 'approve' ? 'approval' : 'work'} with ${withText(w)}` : ''}`
          return (
            <button key={s.key} type="button" className={`${cls} ${selected === s.key ? 'sel' : ''}`} title={tip} aria-label={tip}
              aria-pressed={selected === s.key} onClick={() => onPick(s.key)}><span>{i + 1}</span></button>
          )
        })}
      </div>
      <ul className="stepbar-key" aria-hidden="true">
        <li><i className="done" />Done</li><li><i className="awaiting" />Waiting for approval</li><li><i className="current" />Work in progress</li><li><i className="todo" />Not started</li>
        <li className="stepbar-hint">Click a step for details</li>
      </ul>
    </div>
  )
}
