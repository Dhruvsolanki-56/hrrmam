import { useStages } from '../App'
import { EntityChip } from './bits'

/** Full journey: every stage with the team responsible and the entity it sits with. */
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
            <div className="st-main">
              <strong>{s.name}{s.gate && <em className="gate">Decision</em>}</strong>
              <span className="owner">{s.owner}</span>
            </div>
            <EntityChip entity={s.entity} />
          </li>
        )
      })}
    </ol>
  )
}
