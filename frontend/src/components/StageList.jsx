import { useStages } from '../context'
import { EntityChip, STATE } from './bits'

/** The project journey. Stages that can run at the same time (same prerequisites) are grouped as "run in parallel". */
export default function StageList({ project }) {
  const stages = useStages()
  const states = project.stage_states
  const by = Object.fromEntries(stages.map((s) => [s.key, s]))
  const detail = (k) => project.stages.find((r) => r.key === k)
  const name = (k) => by[k]?.name

  const row = (s) => {
    const st = states[s.key]
    const d = detail(s.key)
    const join = st === 'pending' && s.requires.length > 1
    return (
      <li key={s.key} className={`st-${st}`}>
        <span className="node">{['approved', 'bypassed'].includes(st) ? '✓' : s.phase}</span>
        <div className="st-main">
          <strong>{s.name}{d?.locked && <i className="gate">locked</i>}</strong>
          <span className="owner">
            {st === 'pending'
              ? join ? `Starts when ${s.requires.map(name).join(', ')} are complete` : s.requires.length ? `Starts after ${name(s.requires[0])}` : 'Not started'
              : `${STATE[st]}${d?.rework_count ? ` · sent back ${d.rework_count}×` : ''}${d?.tasks_total ? ` · ${d.tasks_done}/${d.tasks_total} tasks` : ''}`}
          </span>
          <span className="owner">Approver: {s.approver}</span>
        </div>
        <EntityChip entity={s.entity} />
      </li>
    )
  }

  return (
    <ol className="stagelist">
      {project.flow.layers.map((layer) => {
        const list = layer.map((k) => by[k]).filter(Boolean)
        if (list.length < 2) return list.map(row)
        return (
          <li key={layer.join('-')} className="parallel">
            <span className="parallel-label">Run in parallel · {list.length} phases at the same time</span>
            <ol>{list.map(row)}</ol>
          </li>
        )
      })}
    </ol>
  )
}
