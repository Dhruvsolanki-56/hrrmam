import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import FlowDiagram from '../components/FlowDiagram'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { useDo } from '../components/bits'
import { useConfig } from '../context'

const FIELDS = ['key', 'name', 'phase', 'entity', 'owner', 'approver', 'owner_roles', 'approver_roles', 'description', 'requires', 'group', 'workstream',
  'milestone', 'optional', 'can_close', 'sla_days', 'features']
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '')

function Roles({ value, onChange, roles, label }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])
  return (
    <fieldset className="chipset"><legend>{label}</legend>
      {roles.filter((r) => r.key !== 'super_admin').map((r) => (
        <label key={r.key} className={`pick ${value.includes(r.key) ? 'on' : ''}`}><input type="checkbox" checked={value.includes(r.key)} onChange={() => toggle(r.key)} />{r.name}</label>
      ))}
    </fieldset>
  )
}

function StageEditor({ s, i, all, set, move, remove, roles, config }) {
  const [open, setOpen] = useState(false)
  const others = all.filter((x) => x.key !== s.key)
  const toggleReq = (k) => set({ requires: s.requires.includes(k) ? s.requires.filter((x) => x !== k) : [...s.requires, k] })
  const taken = (f) => all.some((x) => x.key !== s.key && x.features.includes(f))
  return (
    <li className="panel stage-edit">
      <header>
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}><b>{i + 1}. {s.name || 'Unnamed stage'}</b>
          <small className="muted"> · {s.requires.length ? `after ${s.requires.map((r) => all.find((x) => x.key === r)?.name || r).join(' + ')}` : 'starts first'}</small></button>
        <span className="row-end">
          <button className="iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => move(-1)}>↑</button>
          <button className="iconbtn" aria-label="Move down" disabled={i === all.length - 1} onClick={() => move(1)}>↓</button>
          <button className="iconbtn" aria-label="Remove stage" onClick={remove}><Icon name="trash" size={15} /></button>
        </span>
      </header>
      {open && (
        <div className="stage-edit-body">
          <div className="row2">
            <label className="field">Name<input value={s.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="field">Key <small className="muted">(internal id)</small><input value={s.key} onChange={(e) => set({ key: slug(e.target.value) })} /></label>
          </div>
          <label className="field">What happens in this stage<textarea rows={2} value={s.description} onChange={(e) => set({ description: e.target.value })} /></label>
          <div className="row2">
            <label className="field">Done by (shown to people)<input value={s.owner} onChange={(e) => set({ owner: e.target.value })} /></label>
            <label className="field">Approved by (shown to people)<input value={s.approver} onChange={(e) => set({ approver: e.target.value })} /></label>
          </div>
          <Roles label="Roles that do the work" value={s.owner_roles} roles={roles} onChange={(v) => set({ owner_roles: v })} />
          <Roles label="Roles that approve" value={s.approver_roles} roles={roles} onChange={(v) => set({ approver_roles: v })} />
          <fieldset className="chipset"><legend>Starts after (waits for these to be approved; leave empty to start first)</legend>
            {others.map((o) => <label key={o.key} className={`pick ${s.requires.includes(o.key) ? 'on' : ''}`}><input type="checkbox" checked={s.requires.includes(o.key)} onChange={() => toggleReq(o.key)} />{o.name}</label>)}
          </fieldset>
          <p className="muted tiny">Two stages that wait for the same things run at the same time. A stage that waits for several others starts only when all of them are approved.</p>
          <div className="row2">
            <label className="field">Entity<select value={s.entity} onChange={(e) => set({ entity: e.target.value })}>{config.entities.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Target days<input type="number" min="1" value={s.sla_days} onChange={(e) => set({ sla_days: Number(e.target.value) || 1 })} /></label>
          </div>
          <label className="field">Pipeline column<input value={s.group} onChange={(e) => set({ group: e.target.value })} /></label>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={s.workstream} onChange={(e) => set({ workstream: e.target.checked })} /><span>Show as a workstream card</span></label>
            <label className="check"><input type="checkbox" checked={s.milestone} onChange={(e) => set({ milestone: e.target.checked })} /><span>Milestone lock (only one per workflow)</span></label>
            <label className="check"><input type="checkbox" checked={s.optional} onChange={(e) => set({ optional: e.target.checked })} /><span>Optional: may be bypassed</span></label>
            <label className="check"><input type="checkbox" checked={s.can_close} onChange={(e) => set({ can_close: e.target.checked })} /><span>Approver may reject the whole project</span></label>
          </div>
          <fieldset className="chipset"><legend>Built-in modules (each can be used by one stage)</legend>
            {Object.entries(config.features).map(([f, d]) => (
              <label key={f} title={d} className={`pick ${s.features.includes(f) ? 'on' : ''} ${taken(f) ? 'off' : ''}`}>
                <input type="checkbox" disabled={taken(f)} checked={s.features.includes(f)} onChange={(e) => set({ features: e.target.checked ? [...s.features, f] : s.features.filter((x) => x !== f) })} />{f.replace('_', ' ')}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </li>
  )
}

function RulesEditor({ rules, setRules, roles, config }) {
  const upd = (k, patch) => setRules({ ...rules, [k]: { ...rules[k], ...patch } })
  const steps = rules.artwork.steps
  const setStep = (i, patch) => upd('artwork', { steps: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  return (
    <section className="panel">
      <header><div><h3>Approval cycle for every entry</h3><p className="muted">Switch approval on or off per kind of entry and choose who decides. Rejection always returns the entry to its owner with the reason.</p></div></header>
      <div className="rules-edit">
        {['task', 'document'].map((k) => (
          <label key={k} className="check"><input type="checkbox" checked={rules[k].approval} onChange={(e) => upd(k, { approval: e.target.checked })} /><span><b>{config.rule_labels[k]}</b> need approval</span></label>
        ))}
        {['agreement', 'dossier_item', 'mfr'].map((k) => (
          <div key={k} className="rule-row">
            <label className="check"><input type="checkbox" checked={rules[k].approval} onChange={(e) => upd(k, { approval: e.target.checked })} /><span><b>{config.rule_labels[k]}</b> need approval</span></label>
            <Roles label="Who can approve" value={rules[k].roles} roles={roles} onChange={(v) => upd(k, { roles: v })} />
          </div>
        ))}
        <div className="rule-row">
          <b>{config.rule_labels.rfi_close}</b>
          <Roles label="Who can close an RFI" value={rules.rfi_close.roles} roles={roles} onChange={(v) => upd('rfi_close', { roles: v })} />
        </div>
        <div className="rule-row">
          <b>{config.rule_labels.artwork}: review steps in order</b>
          {steps.map((s, i) => (
            <div key={i} className="step-edit">
              <label className="field">Step {i + 1} name<input value={s.label} onChange={(e) => setStep(i, { label: e.target.value, status: slug(e.target.value) || s.status })} /></label>
              <Roles label="Who approves this step" value={s.roles} roles={roles} onChange={(v) => setStep(i, { roles: v })} />
              <button className="link danger" disabled={steps.length < 1} onClick={() => upd('artwork', { steps: steps.filter((_, j) => j !== i) })}>Remove step</button>
            </div>
          ))}
          <button className="btn line sm" onClick={() => upd('artwork', { steps: [...steps, { status: `step_${steps.length + 1}`, label: `Step ${steps.length + 1}`, roles: ['director'] }] })}><Icon name="plus" size={14} />Add review step</button>
        </div>
      </div>
    </section>
  )
}

export default function WorkflowEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const config = useConfig()
  const [wf, setWf] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [stages, setStages] = useState([])
  const [rules, setRules] = useState(null)
  const [saved, setSaved] = useState(false)
  const { busy, error, run } = useDo()

  useEffect(() => {
    api.workflow(id).then((w) => {
      setWf(w); setName(w.name); setDescription(w.description)
      setStages(w.flow.stages.map((s) => Object.fromEntries(FIELDS.map((f) => [f, s[f]]))))
      setRules(w.flow.rules)
    })
  }, [id])

  const definition = useMemo(() => ({ stages: stages.map((s, i) => ({ ...s, phase: i + 1 })), rules }), [stages, rules])
  const preview = useMemo(() => {
    if (!wf) return null
    // layers computed locally so the diagram follows edits before they are saved
    const depth = {}
    stages.forEach((s) => { depth[s.key] = 0 })
    for (let n = 0; n < stages.length; n += 1) stages.forEach((s) => { depth[s.key] = Math.max(0, ...s.requires.filter((r) => r in depth).map((r) => depth[r] + 1)) })
    const layers = []
    stages.forEach((s) => { (layers[depth[s.key]] = layers[depth[s.key]] || []).push(s.key) })
    const cleaned = layers.filter(Boolean)
    return { ...wf.flow, stages: stages.map((s, i) => ({ ...s, phase: i + 1, parallel_with: [] })), layers: cleaned.length ? cleaned : [[]] }
  }, [wf, stages])

  if (!wf) return <Layout title="Edit workflow" back="/workflows" backLabel="Workflows" />
  const setStage = (i, patch) => {
    setSaved(false)
    setStages((all) => {
      const old = all[i].key
      const next = all.map((s, j) => (j === i ? { ...s, ...patch } : s))
      // keep dependencies pointing at a renamed key
      return patch.key && patch.key !== old ? next.map((s) => ({ ...s, requires: s.requires.map((r) => (r === old ? patch.key : r)) })) : next
    })
  }
  const move = (i, d) => { setSaved(false); setStages((all) => { const n = [...all]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n }) }
  const remove = (i) => {
    setSaved(false)
    setStages((all) => { const k = all[i].key; return all.filter((_, j) => j !== i).map((s) => ({ ...s, requires: s.requires.filter((r) => r !== k) })) })
  }
  const add = () => {
    setSaved(false)
    setStages((all) => {
      let n = all.length + 1
      while (all.some((s) => s.key === `stage_${n}`)) n += 1
      return [...all, { key: `stage_${n}`, name: `New stage ${n}`, phase: n, entity: config.entities[0], owner: 'Project team', approver: 'Director', owner_roles: ['project_manager'],
        approver_roles: ['director'], description: '', requires: all.length ? [all[all.length - 1].key] : [], group: 'Stages', workstream: false, milestone: false,
        optional: false, can_close: false, sla_days: 14, features: [] }]
    })
  }
  const save = (then) => run(async () => {
    await api.updateWorkflow(wf.id, { name, description, definition })
    setSaved(true)
    if (then) nav(`/workflows/${wf.id}`)
  })

  return (
    <Layout title={`Edit: ${wf.name}`} subtitle="Changes are saved to this draft only. Nothing affects running projects until it is published." back={`/workflows/${wf.id}`} backLabel="Review page"
      actions={<><button className="btn line" disabled={busy} onClick={() => save(false)}>Save</button><button className="btn primary" disabled={busy} onClick={() => save(true)}>Save & review</button></>}>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && !error && <p className="notice">Saved.</p>}
      <section className="panel">
        <div className="row2">
          <label className="field">Name<input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} /></label>
          <label className="field">Description<input value={description} onChange={(e) => { setDescription(e.target.value); setSaved(false) }} /></label>
        </div>
      </section>
      <section className="panel">
        <header><h3>Live preview</h3><span className="muted">Updates as you change what each stage waits for</span></header>
        <FlowDiagram flow={preview} />
      </section>
      <ol className="stage-edit-list">
        {stages.map((s, i) => <StageEditor key={i} s={s} i={i} all={stages} roles={config.roles} config={config} set={(p) => setStage(i, p)} move={(d) => move(i, d)} remove={() => remove(i)} />)}
      </ol>
      <p><button className="btn line" onClick={add}><Icon name="plus" size={16} />Add stage</button></p>
      <RulesEditor rules={rules} setRules={(r) => { setRules(r); setSaved(false) }} roles={config.roles} config={config} />
    </Layout>
  )
}
