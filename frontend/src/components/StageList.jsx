import { useStages } from '../App'
import { EntityChip } from './bits'

/** Full journey: every stage with the entity and team responsible. */
export default function StageList({ project }) {
  const stages = useStages()
  const idx = stages.findIndex((s) => s.key === project.stage_key)
  return (
    <ol className="stagelist">
      {stages.map((s, i) => {
        const state = project.status === 'completed' || i < idx ? 'done' : i === idx ? 'current' : 'todo'
        return (
          <li key={s.key} className={state}>
            <span className="node">{state === 'done' ? '✓' : i + 1}</span>
            <div>
              <strong>{s.name}</strong>
              <span className="owner">{s.owner}</span>
              <EntityChip entity={s.entity} />
            </div>
            {s.gate && <span className="gate">Decision</span>}
          </li>
        )
      })}
    </ol>
  )
}
