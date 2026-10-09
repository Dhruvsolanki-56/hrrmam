import { useStages } from '../App'
import { EntityChip, STATE } from './bits'

/** Full journey: every stage with its state; parallel phases are grouped. */
export default function StageList({ project }) {
  const stages = useStages()
  const states = project.stage_states
  const detail = (k) => project.stages?.find((r) => r.key === k)
  const name = (k) => stages.find((s) => s.key === k)?.name

  const row = (s, i) => {
    const st = states[s.key]
    const d = detail(s.key)
    const joinWait = st === 'pending' && s.requires.length > 1
    return (
      <li key={s.key} className={`st-${st}`}>
        <span className="node">{st === 'approved' ? '✓' : i + 1}</span>
        <div className="st-main">
          <strong>{s.name}</strong>
          <span className="owner">
            {st === 'pending'
              ? joinWait ? `Starts when ${s.requires.map(name).join(', ')} are approved` : 'Not started'
              : `${STATE[st]}${d?.rework_count ? ` · sent back ${d.rework_count}×` : ''}`}
          </span>
          <span className="owner">Approver: {s.approver}</span>
        </div>
        <EntityChip entity={s.entity} />
      </li>
    )
  }

  // group consecutive parallel stages
  const out = []
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]
    if (s.parallel_with.length) {
      const group = stages.filter((o) => o.key === s.key || s.parallel_with.includes(o.key))
      const first = stages.indexOf(group[0])
      if (i === first) {
        out.push(
          <li key={`g-${s.key}`} className="parallel">
            <span className="parallel-label">Run in parallel · after {name(s.requires[0])}</span>
            <ol>{group.map((g) => row(g, stages.indexOf(g)))}</ol>
          </li>,
        )
      }
      continue
    }
    out.push(row(s, i))
  }
  return <ol className="stagelist">{out}</ol>
}
