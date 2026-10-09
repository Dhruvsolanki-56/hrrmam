import { useState } from 'react'
import { api } from '../api'
import { useStages } from '../App'
import { EntityChip, StatusPill } from './bits'

/** Current stage: who is responsible and what can happen next. */
export default function ActionPanel({ project, onChange }) {
  const stages = useStages()
  const idx = stages.findIndex((s) => s.key === project.stage_key)
  const stage = stages[idx]
  const next = stages[idx + 1]
  const [note, setNote] = useState('')
  const [actor, setActor] = useState(localStorage.getItem('nh-actor') || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function act(action, extra = {}) {
    setBusy(true)
    setError('')
    try {
      if (actor) localStorage.setItem('nh-actor', actor)
      onChange(await api.act(project.id, { action, note, actor, ...extra }))
      setNote('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const earlier = stages.slice(0, idx)
  const [back, setBack] = useState('')
  const backTo = earlier.some((s) => s.key === back) ? back : earlier[earlier.length - 1]?.key
  const closed = project.status === 'rejected' || project.status === 'completed'
  const waiting = project.status === 'on_hold' || project.status === 'clarification'

  return (
    <section className="panel callout">
      <header>
        <span className="eyebrow">Current stage · {idx + 1} of {stages.length}</span>
        <StatusPill status={project.status} />
      </header>
      <h2>{stage.name}</h2>
      <EntityChip entity={stage.entity} full />
      <dl className="who">
        <dt>Responsible</dt>
        <dd>{stage.owner}</dd>
        <dt>Next step</dt>
        <dd>{project.status === 'completed' ? 'Project closed' : next ? next.name : 'Close the project'}</dd>
      </dl>
      <p className="callout-desc">{stage.description}</p>

      {closed ? (
        <>
          <p className="closed-note">
            {project.status === 'rejected' ? 'This project was rejected and is closed.' : 'This project is complete.'}
          </p>
          <label className="field">
            Note <small>(required to reopen)</small>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is it being reopened?" />
          </label>
          <label className="field">
            Acting as
            <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Your name" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="btn line" disabled={busy} onClick={() => act('reopen')}>Reopen project</button>
          </div>
        </>
      ) : (
        <>
          {project.status === 'clarification' && (
            <p className="notice">India Review is waiting for the project team to send an updated brief.</p>
          )}
          <label className="field">
            Note <small>(needed to reject, hold, clarify or move back)</small>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" />
          </label>
          <label className="field">
            Acting as
            <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Your name" />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {waiting ? (
              <button className="btn primary" disabled={busy} onClick={() => act('resume')}>
                {project.status === 'clarification' ? 'Updated brief received' : 'Resume project'}
              </button>
            ) : (
              <>
                <button className="btn primary" disabled={busy} onClick={() => act(stage.gate ? 'approve' : 'advance')}>
                  {stage.gate ? 'Approve' : 'Complete stage'}{next ? ` → ${next.name}` : ' & close project'}
                </button>
                {stage.gate && (
                  <button className="btn line" disabled={busy} onClick={() => act('reject')}>{stage.reject_label}</button>
                )}
                {stage.clarify && (
                  <button className="btn line" disabled={busy} onClick={() => act('clarify')}>Request clarification</button>
                )}
                <button className="btn line" disabled={busy} onClick={() => act('hold')}>Put on hold</button>
              </>
            )}
          </div>
          {earlier.length > 0 && (
            <details className="more">
              <summary>Move back to an earlier stage</summary>
              <div className="more-row">
                <select value={backTo} onChange={(e) => setBack(e.target.value)} aria-label="Stage to move back to">
                  {earlier.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <button className="btn line" disabled={busy} onClick={() => act('return', { to_stage: backTo })}>Move back</button>
              </div>
              <small className="muted">Add a note above first. The time-in-stage clock restarts.</small>
            </details>
          )}
        </>
      )}
    </section>
  )
}
