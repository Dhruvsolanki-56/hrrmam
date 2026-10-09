import { useStages } from '../App'

export const STATUS = {
  active: { label: 'In progress', icon: '●' },
  on_hold: { label: 'On hold', icon: '❚❚' },
  clarification: { label: 'Clarification', icon: '?' },
  rejected: { label: 'Rejected', icon: '✕' },
  completed: { label: 'Completed', icon: '✓' },
}

export function StatusPill({ status }) {
  const s = STATUS[status]
  return (
    <span className={`pill status-${status}`}>
      <i aria-hidden>{s.icon}</i>
      {s.label}
    </span>
  )
}

/** Where one stage is in its approval cycle. */
export const STATE = {
  pending: 'Waiting',
  in_progress: 'Work in progress',
  awaiting_approval: 'Awaiting approval',
  clarification: 'Needs information',
  approved: 'Approved',
}

export function StateChip({ state }) {
  return <span className={`state state-${state}`}>{STATE[state]}</span>
}

export function entityTone(entity) {
  if (entity.includes('+')) return 'both'
  if (entity.includes('India')) return 'india'
  if (entity.includes('OTC')) return 'otc'
  return 'other'
}

export function entityShort(entity) {
  const tone = entityTone(entity)
  if (tone === 'both') return entity.includes('CMO') ? entity : 'OTC + India'
  if (tone === 'india') return 'Neo India Lifeline'
  if (tone === 'otc') return 'Neo Health (OTC)'
  return entity
}

export function EntityChip({ entity, full }) {
  return <span className={`chip entity-${entityTone(entity)}`} title={entity}>{full ? entity : entityShort(entity)}</span>
}

/** Row of small capsules, one per stage: approved / active / not started. Parallel stages show side by side. */
export function StageBar({ project, big }) {
  const stages = useStages()
  const states = project.stage_states || {}
  const approved = stages.filter((s) => states[s.key] === 'approved').length
  const mod = (st) => (project.status === 'on_hold' ? 'on_hold' : project.status === 'rejected' ? 'rejected' : st === 'clarification' ? 'clarification' : '')
  return (
    <div className={`stagebar ${big ? 'big' : ''}`} role="img" aria-label={`${approved} of ${stages.length} stages approved`}>
      {stages.map((s) => {
        const st = states[s.key]
        let cls = 'todo'
        if (project.status === 'completed' || st === 'approved') cls = 'done'
        else if (st && st !== 'pending') cls = `current ${mod(st)}`
        return <span key={s.key} className={cls} title={`${s.name}: ${STATE[st] || 'Waiting'}`} />
      })}
    </div>
  )
}

/** "12d in stage", flagged when it passes the stage's target time. */
export function AgeChip({ project }) {
  if (project.status === 'rejected' || project.status === 'completed' || project.days_in_stage == null) return null
  const d = project.days_in_stage
  const state = project.overdue ? 'over' : d >= project.sla_days * 0.75 ? 'warn' : 'ok'
  return (
    <span className={`age age-${state}`} title={`Target: ${project.sla_days} days in this stage`}>
      {project.overdue ? `Overdue · ${d}d` : `${d}d in stage`}
    </span>
  )
}

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
