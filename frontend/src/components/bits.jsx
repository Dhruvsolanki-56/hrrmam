import { useState } from 'react'
import { useMe, useStages, useUsers } from '../context'

// ---------------------------------------------------------------- dates
const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
export const fmtDay = (s) => (s ? parseDay(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '–')
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '–')
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '–')
const pad = (n) => String(n).padStart(2, '0')
/** ISO -> value for <input type="datetime-local"> */
export const toInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const fromInput = (v) => (v ? new Date(v).toISOString() : null)
export const inDays = (n, hour = 17) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0); return toInput(d.toISOString()) }
export const initials = (name = '') => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^Dr\.?$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
export const label = (s = '') => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

// ---------------------------------------------------------------- statuses
export const STATUS = {
  active: { label: 'In progress', icon: '●' },
  on_hold: { label: 'On hold', icon: '❚❚' },
  rejected: { label: 'Rejected', icon: '✕' },
  completed: { label: 'Completed', icon: '✓' },
}

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.active
  return <span className={`pill status-${status}`}><i aria-hidden>{s.icon}</i>{s.label}</span>
}

export const HEALTH = { green: 'On track', amber: 'At risk', red: 'Critical', closed: 'Closed' }
export function HealthPill({ health, reasons }) {
  return <span className={`health health-${health}`} title={reasons?.length ? reasons.join('\n') : HEALTH[health]}><i />{HEALTH[health]}</span>
}

/** Where one stage / workstream is in its approval cycle. */
export const STATE = {
  pending: 'Waiting',
  in_progress: 'Work in progress',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  bypassed: 'Not needed',
}
export const StateChip = ({ state, locked }) => <span className={`state state-${state}`}>{STATE[state]}{locked ? ' 🔒' : ''}</span>

export const TASK_STATE = {
  assigned: 'Assigned', accepted: 'Accepted', in_progress: 'In progress', submitted: 'Submitted',
  changes_requested: 'Changes requested', resubmitted: 'Resubmitted', approved: 'Approved', locked: 'Locked',
}
export const TaskChip = ({ state }) => <span className={`tstate tstate-${state}`}>{TASK_STATE[state]}</span>

// ---------------------------------------------------------------- entities
export function entityTone(entity = '') {
  if (entity.includes('+')) return 'both'
  if (entity.includes('India')) return 'india'
  if (entity.includes('Australia')) return 'otc'
  return 'other'
}
export const EntityChip = ({ entity }) => <span className={`chip entity-${entityTone(entity)}`}>{entity}</span>

/** One small capsule per stage: approved / active / waiting. Parallel stages sit side by side. */
export function StageBar({ project, big }) {
  const stages = useStages()
  const states = project.stage_states || {}
  const done = stages.filter((s) => ['approved', 'bypassed'].includes(states[s.key])).length
  return (
    <div className={`stagebar ${big ? 'big' : ''}`} role="img" aria-label={`${done} of ${stages.length} stages complete`}>
      {stages.map((s) => {
        const st = states[s.key]
        let cls = 'todo'
        if (project.status === 'completed' || st === 'approved' || st === 'bypassed') cls = 'done'
        else if (st && st !== 'pending') cls = `current ${project.status === 'on_hold' ? 'on_hold' : project.status === 'rejected' ? 'rejected' : st === 'awaiting_approval' ? 'awaiting' : ''}`
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

/** Due date of a task, with how late / soon it is. */
export function DueChip({ task }) {
  if (!task.due_at) return <span className="muted">No due date</span>
  const due = new Date(task.due_at)
  const days = Math.ceil((due - new Date()) / 86400000)
  const done = !task.open
  const cls = done ? 'ok' : task.overdue ? 'over' : days <= 3 ? 'warn' : 'ok'
  const text = done ? fmtDate(task.due_at) : task.overdue ? `Overdue · ${fmtDate(task.due_at)}` : days <= 0 ? 'Due today' : `Due ${fmtDate(task.due_at)}`
  return <span className={`age age-${cls}`} title={fmtDateTime(task.due_at)}>{text}</span>
}

// ---------------------------------------------------------------- small building blocks
export const Avatar = ({ name, size }) => <span className="avatar sm" style={size ? { width: size, height: size } : undefined}>{initials(name)}</span>

export function Person({ user }) {
  if (!user) return <span className="muted">Unassigned</span>
  return <span className="person"><Avatar name={user.name} /><span><b>{user.name}</b><small>{user.role}</small></span></span>
}

/** Run an async action with busy + error state. */
export function useDo() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn) => {
    setBusy(true); setError('')
    try { return await fn() } catch (e) { setError(e.message); return undefined } finally { setBusy(false) }
  }
  return { busy, error, run, setError }
}

/** Users the signed-in person may assign work to (the server checks this too). */
export function UserSelect({ value, onChange, assignable = true, roles, placeholder = 'Choose a person…', ...rest }) {
  const users = useUsers()
  const me = useMe()
  const scope = me.assign_to || []
  const ok = (u) => (!assignable || me.permissions.includes('*') || scope.includes('*') || scope.includes(u.role_key)) && (!roles || roles.includes(u.role_key))
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} {...rest}>
      <option value="">{placeholder}</option>
      {users.filter(ok).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
    </select>
  )
}

export function Modal({ title, intro, onClose, onSubmit, submitLabel = 'Save', busy, error, children, wide }) {
  return (
    <div className="overlay" onClick={onClose}>
      <form className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
        <h2>{title}</h2>
        {intro && <p className="muted">{intro}</p>}
        {children}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </div>
  )
}

export const Empty = ({ children }) => <p className="empty-note">{children}</p>

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count != null && <b>{t.count}</b>}
        </button>
      ))}
    </div>
  )
}
