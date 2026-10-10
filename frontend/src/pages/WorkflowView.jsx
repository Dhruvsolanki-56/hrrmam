import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import FlowDiagram, { describeFlow } from '../components/FlowDiagram'
import FormModal from '../components/FormModal'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { EntityChip, Empty, fmtDate, useDo } from '../components/bits'
import { useCan, useConfig } from '../context'
import { WfPill } from './Workflows'

/** Rules are shown as "who approves what", the way the client would describe them. */
export function RulesTable({ rules, roleName }) {
  const config = useConfig()
  const names = (rs = []) => rs.map(roleName).join(', ') || '–'
  const row = (key, on, who) => (
    <tr key={key}><td><strong>{config.rule_labels[key]}</strong></td>
      <td data-label="Approval">{on ? <span className="chip ok">Approval required</span> : <span className="chip plain">No approval</span>}</td>
      <td data-label="Approved by">{who}</td></tr>
  )
  return (
    <div className="table-scroll"><table className="table compact">
      <thead><tr><th>Entry</th><th>Approval cycle</th><th>Approved by</th></tr></thead>
      <tbody>
        {row('task', rules.task.approval, 'The person who assigned the task')}
        {row('document', rules.document.approval, 'The approvers of the stage the document belongs to')}
        <tr><td><strong>{config.rule_labels.artwork}</strong></td><td data-label="Approval"><span className="chip ok">{rules.artwork.steps.length} review steps</span></td>
          <td data-label="Approved by">{rules.artwork.steps.map((s, i) => <span key={s.status} className="step">{i + 1}. {s.label} ({names(s.roles)})</span>)}</td></tr>
        {['agreement', 'dossier_item', 'mfr'].map((k) => row(k, rules[k].approval, names(rules[k].roles)))}
        {row('rfi_close', true, names(rules.rfi_close.roles))}
      </tbody>
    </table></div>
  )
}

/** What would change for people if this draft replaced the live workflow. */
function diffFlows(live, draft, roleName) {
  const out = []
  const a = Object.fromEntries(live.stages.map((s) => [s.key, s]))
  const b = Object.fromEntries(draft.stages.map((s) => [s.key, s]))
  const nm = (k, f) => (f[k] || a[k] || b[k])?.name || k
  Object.keys(b).filter((k) => !a[k]).forEach((k) => out.push(`Added stage: ${b[k].name}`))
  Object.keys(a).filter((k) => !b[k]).forEach((k) => out.push(`Removed stage: ${a[k].name}`))
  Object.keys(b).filter((k) => a[k]).forEach((k) => {
    const x = a[k]
    const y = b[k]
    if (x.requires.join() !== y.requires.join()) {
      out.push(`${y.name}: now starts ${y.requires.length ? `after ${y.requires.map((r) => nm(r, b)).join(' + ')}` : 'at the very start'} (was ${x.requires.length ? `after ${x.requires.map((r) => nm(r, a)).join(' + ')}` : 'at the very start'})`)
    }
    if (x.approver_roles.join() !== y.approver_roles.join()) out.push(`${y.name}: approver is now ${y.approver_roles.map(roleName).join(', ')} (was ${x.approver_roles.map(roleName).join(', ')})`)
    if (x.owner_roles.join() !== y.owner_roles.join()) out.push(`${y.name}: work by ${y.owner_roles.map(roleName).join(', ')} (was ${x.owner_roles.map(roleName).join(', ')})`)
    if (x.sla_days !== y.sla_days) out.push(`${y.name}: target time ${y.sla_days} days (was ${x.sla_days})`)
    if (x.optional !== y.optional) out.push(`${y.name}: ${y.optional ? 'can now' : 'can no longer'} be bypassed`)
  })
  Object.keys(draft.rules).forEach((k) => {
    if (JSON.stringify(draft.rules[k]) !== JSON.stringify(live.rules[k])) out.push(`Approval rule changed: ${k.replace(/_/g, ' ')}`)
  })
  return out
}

function StagePanel({ stage, flow, wf, feedback, canComment, canResolve, reload, roleName }) {
  const by = Object.fromEntries(flow.stages.map((s) => [s.key, s.name]))
  const mine = feedback.filter((f) => f.stage_key === stage.key)
  return (
    <aside className="panel stage-detail">
      <header><h3>{stage.name}</h3><EntityChip entity={stage.entity} /></header>
      <p>{stage.description}</p>
      <dl className="who">
        <dt>Starts</dt><dd>{stage.requires.length ? `After ${stage.requires.map((r) => by[r]).join(' + ')} ${stage.requires.length > 1 ? 'are all approved' : 'is approved'}` : 'At the start of the project'}</dd>
        <dt>Runs with</dt><dd>{stage.parallel_with.length ? stage.parallel_with.map((r) => by[r]).join(', ') : 'Runs on its own'}</dd>
        <dt>Work by</dt><dd>{stage.owner} <small className="muted">({stage.owner_roles.map(roleName).join(', ')})</small></dd>
        <dt>Approved by</dt><dd>{stage.approver} <small className="muted">({stage.approver_roles.map(roleName).join(', ')})</small></dd>
        <dt>Target time</dt><dd>{stage.sla_days} days</dd>
        {stage.features.length > 0 && <><dt>Includes</dt><dd>{stage.features.map((f) => f.replace('_', ' ')).join(', ')}</dd></>}
        {stage.milestone && <><dt>Milestone</dt><dd>Locks until every prerequisite is approved</dd></>}
        {stage.optional && <><dt>Optional</dt><dd>May be bypassed with a reason</dd></>}
      </dl>
      <h4>Feedback on this stage</h4>
      <Feedback wf={wf} stageKey={stage.key} items={mine} canComment={canComment} canResolve={canResolve} reload={reload} />
    </aside>
  )
}

function Feedback({ wf, stageKey, items, canComment, canResolve, reload }) {
  const [body, setBody] = useState('')
  const { busy, error, run } = useDo()
  const send = () => run(async () => { await api.addFeedback(wf.id, { stage_key: stageKey, body }); setBody(''); await reload() })
  const resolve = (f, status) => run(async () => {
    const resolution = status === 'resolved' ? window.prompt('How was this handled? (optional)') ?? '' : ''
    await api.resolveFeedback(f.id, { status, resolution }); await reload()
  })
  return (
    <div className="feedback">
      {items.length === 0 && <p className="muted">No comments yet.</p>}
      <ul>
        {items.map((f) => (
          <li key={f.id} className={f.status === 'resolved' ? 'done' : ''}>
            <div><b>{f.author}</b> <small className="muted">{f.role} · {fmtDate(f.created_at)}</small></div>
            <p>{f.body}</p>
            {f.status === 'resolved' && <small className="resolved">Resolved{f.resolution ? `: ${f.resolution}` : ''}</small>}
            {canResolve && <button className="link" disabled={busy} onClick={() => resolve(f, f.status === 'open' ? 'resolved' : 'open')}>{f.status === 'open' ? 'Mark resolved' : 'Reopen'}</button>}
          </li>
        ))}
      </ul>
      {canComment && (
        <>
          <label className="field">Your comment
            <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={stageKey ? 'e.g. This should wait for…' : 'Comment on the process as a whole…'} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn line" disabled={busy || body.trim().length < 2} onClick={send}>Add comment</button>
        </>
      )}
    </div>
  )
}

export default function WorkflowView() {
  const { id } = useParams()
  const nav = useNavigate()
  const can = useCan()
  const config = useConfig()
  const [wf, setWf] = useState(null)
  const [live, setLive] = useState(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState(null)
  const [dup, setDup] = useState(false)
  const { busy, error: actErr, run } = useDo()
  const roleName = useMemo(() => { const m = Object.fromEntries(config.roles.map((r) => [r.key, r.name])); return (k) => m[k] || k }, [config])

  const load = useCallback(async () => {
    try {
      const [w, all] = await Promise.all([api.workflow(id), api.workflows()])
      setWf(w)
      const l = all.find((x) => x.status === 'published' && x.id !== w.id)
      setLive(l ? await api.workflow(l.id) : null)
    } catch (e) { setError(e.message) }
  }, [id])
  useEffect(() => { load() }, [load])

  if (error) return <Layout title="Workflow" back="/workflows" backLabel="Workflows"><p className="error">{error}</p></Layout>
  if (!wf) return <Layout title="Workflow" back="/workflows" backLabel="Workflows" />

  const manage = can('manage_workflow')
  const isDraft = wf.status === 'draft'
  const flow = wf.flow
  const stage = flow.stages.find((s) => s.key === sel)
  const general = wf.feedback.filter((f) => !f.stage_key)
  const changes = isDraft && live ? diffFlows(live.flow, flow, roleName) : []
  const download = () => {
    const blob = new Blob([JSON.stringify({ name: wf.name, version: wf.version, status: wf.status, stages: flow.stages, rules: flow.rules }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${wf.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const publish = () => {
    if (!window.confirm(`Publish "${wf.name}"? New projects will use it. Running projects keep their current version.`)) return
    run(async () => { await api.publishWorkflow(wf.id); await load() })
  }
  const remove = () => {
    if (!window.confirm('Delete this draft?')) return
    run(async () => { await api.deleteWorkflow(wf.id); nav('/workflows') })
  }

  return (
    <Layout title={wf.name} subtitle={wf.description || wf.based_on} back="/workflows" backLabel="Workflows"
      actions={<>
        <button className="btn line" onClick={() => window.print()}><Icon name="print" size={16} />Print / PDF</button>
        <button className="btn line" onClick={download}><Icon name="download" size={16} />JSON</button>
        {manage && <button className="btn line" onClick={() => setDup(true)}>Copy to new draft</button>}
        {manage && isDraft && <Link className="btn line" to={`/workflows/${wf.id}/edit`}><Icon name="edit" size={16} />Edit</Link>}
        {manage && isDraft && <button className="btn primary" disabled={busy} onClick={publish}>Publish</button>}
      </>}>
      <p className="print-only">Neo process review · {wf.name} · {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <section className="panel">
        <div className="meta">
          <WfPill status={wf.status} />
          {wf.version ? <span className="chip plain">Version {wf.version}</span> : null}
          <span className="chip plain">{wf.stage_count} stages</span>
          <span className="chip plain">{wf.parallel_layers} parallel step{wf.parallel_layers === 1 ? '' : 's'}</span>
          <span className="chip plain">{wf.projects} project{wf.projects === 1 ? '' : 's'} using it</span>
          {wf.feedback_open > 0 && <span className="chip warn">{wf.feedback_open} open comment{wf.feedback_open === 1 ? '' : 's'}</span>}
        </div>
        {actErr && <p className="error">{actErr}</p>}
        {isDraft && <p className="notice">This is a draft for review. It does not affect any project until it is published.</p>}
      </section>

      <section className="panel">
        <header><div><h3>How the process runs</h3><p className="muted">Stages in the same column run at the same time. Select a stage for its details and to leave feedback.</p></div></header>
        <FlowDiagram flow={flow} selected={sel} onSelect={(k) => setSel(k === sel ? null : k)} />
        <ul className="readout">{describeFlow(flow).map((l) => <li key={l}>{l}</li>)}</ul>
      </section>

      {stage && <StagePanel stage={stage} flow={flow} wf={wf} feedback={wf.feedback} canComment canResolve={manage} reload={load} roleName={roleName} />}

      <section className="panel">
        <header><div><h3>Approval cycle for every entry</h3><p className="muted">Anything submitted goes to the approver, who approves it or sends it back with a reason. It then returns to the owner to fix and resubmit.</p></div></header>
        <RulesTable rules={flow.rules} roleName={roleName} />
      </section>

      {isDraft && (
        <section className="panel">
          <header><h3>What changes compared with the live process</h3></header>
          {!live && <Empty>There is no live workflow to compare with.</Empty>}
          {live && !changes.length && <Empty>No differences from “{live.name}”.</Empty>}
          {changes.length > 0 && <ul className="changes">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
        </section>
      )}

      <section className="panel">
        <header><h3>General feedback</h3><span className="muted">{wf.feedback.length} comment{wf.feedback.length === 1 ? '' : 's'} in total</span></header>
        <Feedback wf={wf} stageKey="" items={general} canComment canResolve={manage} reload={load} />
        {wf.feedback.some((f) => f.stage_key) && (
          <>
            <h4>Comments on stages</h4>
            <ul className="feedback-all">
              {wf.feedback.filter((f) => f.stage_key).map((f) => (
                <li key={f.id} className={f.status === 'resolved' ? 'done' : ''}>
                  <button className="link" onClick={() => setSel(f.stage_key)}>{flow.stages.find((s) => s.key === f.stage_key)?.name || f.stage_key}</button>
                  <span><b>{f.author}</b>: {f.body}{f.status === 'resolved' && <small className="resolved"> · resolved{f.resolution ? `: ${f.resolution}` : ''}</small>}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {manage && isDraft && <p><button className="link danger" disabled={busy} onClick={remove}>Delete this draft</button></p>}
      {dup && (
        <FormModal title="Copy to a new draft" fields={[{ key: 'name', label: 'Name', type: 'text', required: true }]} initial={{ name: `${wf.name} (copy)` }} submitLabel="Create draft"
          onSave={async (d) => { const w = await api.createWorkflow({ name: d.name, from_id: wf.id }); nav(`/workflows/${w.id}`) }} onClose={() => setDup(false)} />
      )}
    </Layout>
  )
}
