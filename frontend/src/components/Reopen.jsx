import { useState } from 'react'
import { api } from '../api'
import { useCan, useMe, useStages } from '../context'
import { fmtDate, label, useDo } from './bits'
import FormModal from './FormModal'

/** "Request reopen" for approved or locked work: it is decided by someone with unlock permission, never silently edited. */
export function ReopenButton({ project, kind, refId, onChange, text = 'Request reopen' }) {
  const [open, setOpen] = useState(false)
  if (['rejected', 'completed', 'on_hold'].includes(project.status)) return null
  if (project.reopen_requests.some((r) => r.status === 'pending' && r.kind === kind && r.ref === String(refId))) return <span className="chip plain">Reopen requested</span>
  return (
    <>
      <button className="btn line" onClick={() => setOpen(true)}>{text}</button>
      {open && (
        <FormModal title="Request a reopen" intro="Approved work is locked. Say why it has to change; someone with permission to unlock records decides, and the decision is recorded."
          fields={[{ key: 'reason', label: 'Why does it have to be reopened?', type: 'textarea', required: true }]}
          onSave={async (d) => onChange(await api.requestReopen(project.id, { kind, ref: String(refId), reason: d.reason }))}
          onClose={() => setOpen(false)} submitLabel="Send request" />
      )}
    </>
  )
}

function Row({ r, project, onChange }) {
  const me = useMe()
  const can = useCan()
  const [note, setNote] = useState('')
  const { busy, error, run } = useDo()
  const may = r.status === 'pending' && can('lock_unlock') && (me.id !== r.requested_by.id || me.role_key === 'super_admin')
  const go = (approve) => run(async () => { onChange(await api.decideReopen(r.id, { approve, note })); setNote('') })
  return (
    <li className={`reopen reopen-${r.status}`}>
      <div><b>{label(r.kind)}: {r.label}</b>
        <small>{r.requested_by.name} · {fmtDate(r.created_at)} · “{r.reason}”</small>
        {r.status !== 'pending' && <small>{label(r.status)} by {r.decided_by?.name || '–'}{r.decision_note ? ` · “${r.decision_note}”` : ''}</small>}
      </div>
      {r.status === 'pending' ? (
        may ? (
          <div className="reopen-act">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (needed to decline)" aria-label="Decision note" />
            <button className="btn primary sm" disabled={busy} onClick={() => go(true)}>Approve reopen</button>
            <button className="btn line sm" disabled={busy} onClick={() => go(false)}>Decline</button>
            {error && <small className="error">{error}</small>}
          </div>
        ) : <span className="chip plain">Waiting for a decision</span>
      ) : <span className={`dstate reopen-s-${r.status}`}>{label(r.status)}</span>}
    </li>
  )
}

/** Overview panel: pending reopen requests, plus a way to ask for an approved stage to be reopened. */
export default function ReopenPanel({ project, onChange }) {
  const stages = useStages()
  const [asking, setAsking] = useState(false)
  const done = stages.filter((s) => project.stage_states[s.key] === 'approved')
  const list = [...project.reopen_requests].reverse()
  const live = project.status === 'active'
  if (!list.length && !(live && done.length)) return null
  return (
    <section className="panel">
      <header>
        <div><h3>Reopen requests</h3><p className="muted">Approved work is only changed through a request that someone with permission decides.</p></div>
        {live && done.length > 0 && <button className="btn line" onClick={() => setAsking(true)}>Request reopen of a stage</button>}
      </header>
      {!list.length && <p className="empty-note">No requests.</p>}
      <ul className="reopens">{list.map((r) => <Row key={r.id} r={r} project={project} onChange={onChange} />)}</ul>
      {asking && (
        <FormModal title="Request a stage reopen" intro="The stage and everything after it restarts its approval cycle if this is approved. Everything already recorded stays in the history."
          fields={[{ key: 'ref', label: 'Stage', type: 'select', required: true, options: done.map((s) => [s.key, s.name]) },
            { key: 'reason', label: 'Why does it have to be reopened?', type: 'textarea', required: true }]}
          initial={{ ref: done[done.length - 1]?.key }}
          onSave={async (d) => onChange(await api.requestReopen(project.id, { kind: 'stage', ref: d.ref, reason: d.reason }))}
          onClose={() => setAsking(false)} submitLabel="Send request" />
      )}
    </section>
  )
}
