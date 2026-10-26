import { useState } from 'react'
import { stageOf, useCan, useMe, useStages } from '../context'
import { turnOf } from './ActionPanel'
import { summarise } from './Lanes'
import { fmtDate, fmtDay, groupLabel } from './bits'

const DONE = ['approved', 'bypassed']
const LIVE = ['in_progress', 'awaiting_approval']
const short = (people = []) => people.map((p) => p.split(' (')[0]).join(' or ')

/** The project's phases in order, each with its steps and how far it has got. */
function phasesOf(project) {
  const groups = []
  project.flow.stages.forEach((s) => {
    const name = s.group || 'Steps'
    let g = groups[groups.length - 1]
    if (!g || g.name !== name) { g = { name, steps: [] }; groups.push(g) }
    const row = project.stages.find((r) => r.key === s.key)
    g.steps.push({ s, row, st: project.status === 'completed' ? 'approved' : project.stage_states[s.key] })
  })
  return groups.map((g) => {
    const done = g.steps.filter((x) => DONE.includes(x.st)).length
    const live = g.steps.filter((x) => LIVE.includes(x.st)).length
    const state = done === g.steps.length ? 'done' : live || done ? 'now' : 'todo'
    const last = g.steps.map((x) => x.row?.decided_at).filter(Boolean).sort().pop()
    return { ...g, done, live, state, last }
  })
}

/** "Where the project is", read top to bottom like a parcel tracker. Finished and future phases fold to one line;
 *  the phase that is happening now is open and lists its steps with who has each one. */
export function Journey({ project, onPick }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const phases = phasesOf(project)
  const [open, setOpen] = useState(() => new Set(phases.filter((g) => g.state === 'now').map((g) => g.name)))
  const flip = (name) => setOpen((o) => { const n = new Set(o); n.has(name) ? n.delete(name) : n.add(name); return n })
  const total = project.flow.stages.length
  const doneAll = phases.reduce((n, g) => n + g.done, 0)
  const prevName = (i) => (i > 0 ? groupLabel(phases[i - 1].name).split(' (')[0] : '')

  return (
    <section className="panel journey-card" aria-label="Where the project is">
      <header>
        <h3>Where the project is</h3>
        <span className="muted">{project.status === 'completed' ? 'Complete' : `${doneAll} of ${total} steps done`}</span>
      </header>
      <ol className="jr">
        {phases.map((g, i) => {
          const isOpen = open.has(g.name)
          const sum = g.state === 'done' ? `Done${g.last ? ` ${fmtDate(g.last)}` : ''}`
            : g.state === 'now' ? `${g.done} of ${g.steps.length} approved${g.live ? ` · ${g.live} in progress` : ''}`
              : i > 0 && phases[i - 1].state !== 'done' ? `Starts after ${prevName(i)}` : 'Not started'
          return (
            <li key={g.name} className={`jr-phase jr-${g.state} ${isOpen ? 'open' : ''}`}>
              <button type="button" className="jr-head" onClick={() => flip(g.name)} aria-expanded={isOpen}>
                <span className="jr-dot" aria-hidden="true">{g.state === 'done' ? '✓' : i + 1}</span>
                <b>{groupLabel(g.name)}{g.state === 'now' && <em className="jr-tag">now</em>}</b>
                <span className="jr-sum">{sum}</span>
                <span className="jr-chev" aria-hidden="true">›</span>
              </button>
              {isOpen && (
                <ul className="jr-steps">
                  {g.steps.map(({ s, row, st }) => {
                    const mine = row && LIVE.includes(st) && project.status === 'active' && !!turnOf(project, row, me, stageOf(stages, s.key) || s, can)
                    const w = row?.handoff?.with
                    const info = DONE.includes(st) ? `${st === 'bypassed' ? 'Not needed' : 'Approved'}${row?.decided_at ? ` ${fmtDate(row.decided_at)}` : ''}`
                      : s.workstream && row && LIVE.includes(st) ? summarise(project, s, row).text
                        : st === 'awaiting_approval' ? 'Waiting for approval' : st === 'in_progress' ? 'In progress' : 'Not started'
                    const who = LIVE.includes(st) && w?.people?.length ? `${w.action === 'approve' ? 'Approval: ' : ''}${short(w.people)}` : ''
                    const late = project.tasks.filter((t) => t.stage_key === s.key && t.overdue).length
                    const cls = DONE.includes(st) ? 'done' : st === 'awaiting_approval' ? 'awaiting' : st === 'in_progress' ? 'current' : 'todo'
                    return (
                      <li key={s.key}>
                        <button type="button" className={`jr-step ${mine ? 'mine' : ''}`} onClick={() => onPick(s.key)}>
                          <span className={`jr-sdot st-${cls}`} aria-hidden="true" />
                          <span className="jr-sname">{s.name}{mine && <em className="jr-you">your turn</em>}</span>
                          <span className="jr-sinfo">{info}{late > 0 && <span className="jr-late">{late} late</span>}</span>
                          <span className="jr-who">{who}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** What this person has to do on this project, first thing on the right. */
export function TurnCard({ project, onPick, goTab }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const mine = project.status === 'active'
    ? project.stages.filter((r) => LIVE.includes(r.state)).map((r) => ({ r, st: stageOf(stages, r.key), t: turnOf(project, r, me, stageOf(stages, r.key), can) })).filter((x) => x.t && x.st)
    : []
  const myTasks = project.tasks.filter((t) => t.open && t.assignee.id === me.id).length
  const verb = { submit: 'The work is done. Submit it for approval.', finish: 'Finish the work, then submit it.', decide: 'Approve it or send it back.' }
  return (
    <section className={`side-card turn-card ${mine.length ? 'has' : ''}`} aria-label="Your turn">
      <span className="hc-label">{mine.length ? 'Your turn' : 'For you'}</span>
      {mine.map(({ r, st, t }) => (
        <div key={r.key} className="turn-item">
          <b>{st.name}</b>
          <small>{t === 'finish' && !(st.owner_roles || []).includes(me.role_key) ? 'You oversee this step.' : verb[t]}</small>
          <button className="btn primary sm" onClick={() => onPick(r.key)}>Open</button>
        </div>
      ))}
      {!mine.length && <p className="muted">Nothing needs you on this project right now.</p>}
      {myTasks > 0 && <button className="link" onClick={() => goTab('tasks')}>You have {myTasks} open task{myTasks > 1 ? 's' : ''} here →</button>}
    </section>
  )
}

/** The facts people look for first. Everything else is on the Brief tab. */
export function FactsCard({ project, onBrief }) {
  const late = project.status === 'active' && !project.submissions.length && project.target_submission && new Date(project.target_submission) < new Date()
  return (
    <section className="side-card" aria-label="Key facts">
      <span className="hc-label">Key facts</span>
      <dl className="kf">
        <div><dt>Submit by</dt><dd>{fmtDay(project.target_submission)}{late && <em className="late-flag"> · passed</em>}</dd></div>
        <div><dt>Launch by</dt><dd>{fmtDay(project.target_launch)}</dd></div>
        <div><dt>Manager</dt><dd>{project.project_manager?.name || 'Not assigned'}</dd></div>
        <div><dt>Client</dt><dd>{project.potential_client || '–'}</dd></div>
        <div><dt>Product</dt><dd>{project.product || '–'}</dd></div>
      </dl>
      <button className="link" onClick={onBrief}>All details →</button>
    </section>
  )
}

const HEALTH_WORD = { green: 'On track', amber: 'At risk', red: 'Critical', closed: 'Closed' }

/** How the project is doing and why, with the critical blocker (if any) right under the reasons. */
export function HealthCard({ project, blockerEvent, canClear, confirmClear, setConfirmClear, clear, clearing, onReport }) {
  const h = project.health
  const pm = project.project_manager?.name
  return (
    <section className={`side-card health-card hc-${h}`} aria-label="Project health">
      <span className="hc-label">Health</span>
      <b className="hc-state"><i />{HEALTH_WORD[h]}</b>
      {project.health_reasons.length > 0
        ? <ul className="hc-reasons">{project.health_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        : <p className="hc-ok">Nothing is late or sent back.</p>}
      {(project.critical_blocker || canClear) && (
        <div className={`hc-blocker ${project.critical_blocker ? 'on' : ''}`}>
          {project.critical_blocker ? (
            <>
              <span className="hc-label">Critical blocker</span>
              <p><b>{project.critical_blocker}</b></p>
              {blockerEvent && <small>Reported by {blockerEvent.actor}. It keeps the project red until it is cleared.</small>}
              {canClear && !confirmClear && <button className="btn line sm" onClick={() => setConfirmClear(true)}>Mark as resolved</button>}
              {canClear && confirmClear && (
                <span className="blocker-confirm">Is this fixed?
                  <button className="btn primary sm" disabled={clearing.busy} onClick={clear}>Yes, clear it</button>
                  <button className="btn line sm" onClick={() => setConfirmClear(false)}>Not yet</button></span>
              )}
              {!canClear && <small>Only a project manager{pm ? ` (${pm})` : ''} or a Director can clear it.</small>}
              {clearing.error && <p className="error">{clearing.error}</p>}
            </>
          ) : null}
          {canClear && <button className="link" onClick={onReport}>{project.critical_blocker ? 'Change the wording' : 'Report a critical blocker'}</button>}
        </div>
      )}
    </section>
  )
}
