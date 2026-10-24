import { useState } from 'react'
import { api } from '../api'
import { useCan, useMe, useStages } from '../context'
import { fmtDate, fmtDateTime, label, toast, useDo, useFocus } from './bits'
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
          onSave={async (d) => { const p = await api.requestReopen(project.id, { kind, ref: String(refId), reason: d.reason }); onChange(p); toast(`Request sent to ${p.reopen_requests[p.reopen_requests.length - 1]?.deciders?.join(' or ') || 'the people who can unlock records'}. They have been notified.`) }}
          onClose={() => setOpen(false)} submitLabel="Send request" />
      )}
    </>
  )
}

function Row({ r, project, onChange }) {
  const me = useMe()
  const can = useCan()
  const focus = useFocus()
  const [note, setNote] = useState('')
  const { busy, error, run } = useDo()
  const may = r.status === 'pending' && can('lock_unlock') && (me.id !== r.requested_by.id || me.role_key === 'super_admin')
  const go = (approve) => run(async () => {
    onChange(await api.decideReopen(r.id, { approve, note })); setNote('')
    toast(approve ? `Reopen approved. ${r.requested_by.name} has been told and can now change it.` : `Reopen declined. ${r.requested_by.name} has been told why.`)
  })
  return (
    <li id={`reopen-${r.id}`} className={`reopen reopen-${r.status} ${focus === `reopen-${r.id}` ? 'focus-flash' : ''}`}>
      <div><b>{label(r.kind)}: {r.label}</b>
        <small>Requested by {r.requested_by.name} · {fmtDateTime(r.created_at)} · “{r.reason}”</small>
        {r.status === 'pending' && <small className="reopen-who">Waiting for <b>{r.deciders?.length ? r.deciders.join(' or ') : 'someone who can unlock records'}</b>{r.waiting_days != null ? ` · ${r.waiting_days === 0 ? 'since today' : `${r.waiting_days} day${r.waiting_days === 1 ? '' : 's'}`}` : ''}</small>}
        {r.status === 'pending' && !may && <small>{r.requested_by.id === me.id ? 'You asked for this. Until it is decided, nothing changes.' : 'Only people who can unlock records decide this. You can follow it here.'}</small>}
        {r.status !== 'pending' && <small>{label(r.status)} by {r.decided_by?.name || '–'}{r.decided_at ? `, ${fmtDateTime(r.decided_at)}` : ''}{r.decision_note ? ` · “${r.decision_note}”` : ''}</small>}
      </div>
      {r.status === 'pending' ? (
        may ? (
          <div className="reopen-act">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (needed to decline)" aria-label="Decision note" />
            <button className="btn primary sm" disabled={busy} onClick={() => go(true)}>Approve reopen</button>
            <button className="btn line sm" disabled={busy} onClick={() => go(false)}>Decline</button>
            {error && <small className="error">{error}</small>}
          </div>
        ) : <span className="chip plain">With {r.deciders?.[0]?.split(' (')[0] || 'a decider'}{r.deciders?.length > 1 ? ` +${r.deciders.length - 1}` : ''}</span>
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
          onSave={async (d) => { const p = await api.requestReopen(project.id, { kind: 'stage', ref: d.ref, reason: d.reason }); onChange(p); toast(`Request sent to ${p.reopen_requests[p.reopen_requests.length - 1]?.deciders?.join(' or ') || 'the people who can unlock records'}. They have been notified.`) }}
          onClose={() => setAsking(false)} submitLabel="Send request" />
      )}
    </section>
  )
}
