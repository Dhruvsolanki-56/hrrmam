import { useStages } from '../context'
import { StateChip, label, orList } from './bits'

const DOSSIER_DONE = ['reviewed', 'ready']
const MFR_DONE = ['accepted']

/** One line per lane: what it is, how far it has got, in plain words. Counts come from the project's own records. */
function summarise(project, stage, row) {
  const f = stage.features || []
  if (f.includes('agreements')) {
    const core = project.agreements.filter((a) => a.core)
    const signed = core.filter((a) => a.status === 'signed').length
    const open = core.filter((a) => a.status !== 'signed').map((a) => `${a.label.replace(' Agreement', '')} ${label(a.status).toLowerCase()}`)
    return { done: signed, total: core.length, text: `${signed} of ${core.length} core agreements signed`, more: open.join(' · ') }
  }
  if (f.includes('dossier')) {
    const items = project.dossier_items
    const done = items.filter((i) => DOSSIER_DONE.includes(i.status)).length
    const waiting = items.filter((i) => i.status === 'awaiting_approval').length
    return { done, total: items.length, text: items.length ? `${done} of ${items.length} dossier items ready` : 'Dossier not started', more: waiting ? `${waiting} waiting for review` : '' }
  }
  if (f.includes('artwork')) {
    const docs = project.documents.filter((d) => d.is_artwork)
    const done = docs.filter((d) => ['approved', 'locked'].includes(d.status)).length
    const live = docs.filter((d) => !['approved', 'locked', 'draft'].includes(d.status)).sort((a, b) => b.current_version - a.current_version)[0]
    return { done, total: docs.length, text: docs.length ? `${done} of ${docs.length} artwork items approved` : 'No artwork yet',
      more: live ? `${live.kind} V${live.current_version} ${label(live.status).toLowerCase()}` : '' }
  }
  if (f.includes('mfr')) {
    const reqs = project.mfr_requests.filter((m) => m.required)
    const done = reqs.filter((m) => MFR_DONE.includes(m.status)).length
    return { done, total: reqs.length, text: reqs.length ? `${done} of ${reqs.length} documents accepted` : 'Nothing requested yet',
      more: reqs.length - done > 0 ? `${reqs.length - done} pending` : '' }
  }
  if (f.includes('quality')) {
    const docs = project.documents.filter((d) => d.stage_key === stage.key)
    const ok = docs.filter((d) => ['approved', 'locked'].includes(d.status)).length
    const t = `${row.tasks_done} of ${row.tasks_total} tasks approved`
    return { done: row.tasks_done, total: row.tasks_total, text: row.tasks_total ? t : 'No tasks yet', more: docs.length ? `${ok} of ${docs.length} documents approved` : '' }
  }
  return { done: row.tasks_done, total: row.tasks_total, text: row.tasks_total ? `${row.tasks_done} of ${row.tasks_total} tasks approved` : 'No tasks yet', more: '' }
}

/** The person doing most of the lane's work: each phase has one owner. */
function ownerOf(project, key) {
  const count = {}
  project.tasks.filter((t) => t.stage_key === key).forEach((t) => { count[t.assignee.name] = (count[t.assignee.name] || 0) + 1 })
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]
}

export default function Lanes({ project, goTab }) {
  const stages = useStages()
  const lanes = stages.filter((s) => s.workstream)
  const gate = stages.find((s) => s.milestone)
  if (!lanes.length) return null
  const rowOf = (k) => project.stages.find((r) => r.key === k)
  const gateRow = gate && rowOf(gate.key)
  const waitingOn = gate ? gate.requires.filter((k) => !['approved', 'bypassed'].includes(project.stage_states[k])).map((k) => stages.find((s) => s.key === k)?.name) : []

  return (
    <section className="panel lanes-panel">
      <header>
        <div>
          <h3>Workstreams</h3>
          <p className="muted">{lanes.length} workstreams run at the same time. Click one to open it.</p>
        </div>
      </header>
      <ul className="lanes">
        {lanes.map((s) => {
          const r = rowOf(s.key)
          const sum = summarise(project, s, r)
          const w = r.handoff?.with
          const owner = w ? `${w.action === 'approve' ? 'Approval: ' : ''}${orList(w.people) || s.owner}` : ownerOf(project, s.key) || s.owner
          const late = project.tasks.filter((t) => t.stage_key === s.key && t.overdue).length
          const pct = sum.total ? (sum.done / sum.total) * 100 : ['approved', 'bypassed'].includes(r.state) ? 100 : 0
          return (
            <li key={s.key}>
              <button className={`lane lane-${r.state}`} onClick={() => goTab(s.tab || 'tasks')}>
                <span className="lane-name"><b>{s.name}</b><small>{owner}</small></span>
                <span className="lane-state">
                  <span className="lane-top"><StateChip state={r.state} locked={r.locked} />{late > 0 && <span className="lane-late">{late} late</span>}{r.rework_count > 0 && <span className="lane-back">sent back {r.rework_count}×</span>}</span>
                  <small>{sum.text}{sum.more && <> · {sum.more}</>}</small>
                </span>
                <span className="lane-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
              </button>
            </li>
          )
        })}
      </ul>
      {gate && (
        <p className={`lane-gate ${gateRow?.state === 'pending' ? 'blocked' : ''}`}>
          <b>{gate.name}</b>
          {gateRow?.state === 'pending'
            ? <> opens when every lane is approved: {gate.requires.length - waitingOn.length} of {gate.requires.length} done.</>
            : gateRow ? <> <StateChip state={gateRow.state} locked={gateRow.locked} /></> : null}
        </p>
      )}
    </section>
  )
}
