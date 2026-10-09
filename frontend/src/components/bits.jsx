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

/** Row of small capsules, one per stage: done / current / upcoming. */
export function StageBar({ project, big }) {
  const stages = useStages()
  const idx = stages.findIndex((s) => s.key === project.stage_key)
  const done = project.status === 'completed' ? stages.length : idx
  return (
    <div className={`stagebar ${big ? 'big' : ''}`} role="img" aria-label={`Stage ${idx + 1} of ${stages.length}`}>
      {stages.map((s, i) => {
        let cls = 'todo'
        if (i < done) cls = 'done'
        else if (i === idx) cls = `current ${project.status}`
        return <span key={s.key} className={cls} title={s.name} />
      })}
    </div>
  )
}

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
