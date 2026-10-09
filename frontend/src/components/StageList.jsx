import { useStages } from '../context'
import { EntityChip, STATE } from './bits'

/** The 12-phase journey. The five workstreams are grouped as "run in parallel"; Dossier Ready is the join milestone. */
export default function StageList({ project }) {
  const stages = useStages()
  const states = project.stage_states
  const detail = (k) => project.stages.find((r) => r.key === k)
  const name = (k) => stages.find((s) => s.key === k)?.name

  const row = (s, i) => {
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
              ? join ? `Starts when all five workstreams are complete` : 'Not started'
              : `${STATE[st]}${d?.rework_count ? ` · sent back ${d.rework_count}×` : ''}${d?.tasks_total ? ` · ${d.tasks_done}/${d.tasks_total} tasks` : ''}`}
          </span>
          <span className="owner">Approver: {s.approver}</span>
        </div>
        <EntityChip entity={s.entity} />
      </li>
    )
  }

  const out = []
  stages.forEach((s, i) => {
    if (s.workstream) {
      if (s.key === stages.find((x) => x.workstream).key) {
        out.push(
          <li key="parallel" className="parallel">
            <span className="parallel-label">Phases 3–4 · run in parallel after {name(s.requires[0])}</span>
            <ol>{stages.filter((x) => x.workstream).map((g) => row(g, stages.indexOf(g)))}</ol>
          </li>,
        )
      }
      return
    }
    out.push(row(s, i))
  })
  return <ol className="stagelist">{out}</ol>
}
