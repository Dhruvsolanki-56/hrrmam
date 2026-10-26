import { useState } from 'react'
import { api } from '../api'
import { useConfig, useMe, useUsers } from '../context'
import { Modal, useDo } from './bits'
import { plainType } from './Workstreams'

const CATEGORIES = ['Pain relief', 'Eye care', 'Respiratory', 'Nasal care', 'Gastro / IBS / bowel', 'Hydration', 'Nail care',
  'Skin care', 'Ear & throat care', 'Cold & flu', 'Vitamins', 'Sleep', 'Dermatology', 'Other']
const MARKETS = ['Australia', 'New Zealand', 'India', 'Australia + New Zealand']

/** Create a project, or edit the Project 360 fields of an existing one. */
export default function NewProjectModal({ onClose, onCreated, project }) {
  const config = useConfig()
  const users = useUsers()
  const me = useMe()
  const { busy, error, run } = useDo()
  const cats = project?.category && !CATEGORIES.includes(project.category) ? [project.category, ...CATEGORIES] : CATEGORIES
  const [form, setForm] = useState(project ? {
    name: project.name, product: project.product, potential_client: project.potential_client || '', opportunity_value: project.opportunity_value ?? '', project_type: project.project_type, category: project.category,
    market: project.market, initiator: project.initiator, summary: project.summary,
    project_manager_id: project.project_manager?.id ?? '', submission_type: project.submission_type,
    target_submission: project.target_submission || '', target_launch: project.target_launch || '',
  } : {
    name: '', product: '', potential_client: '', opportunity_value: '', project_type: 'Development', category: CATEGORIES[0], market: 'Australia', initiator: me.name, summary: '',
    project_manager_id: me.role_key === 'project_manager' ? me.id : '', submission_type: '', target_submission: '', target_launch: '',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = () => run(async () => {
    const body = { ...form, opportunity_value: form.opportunity_value === '' ? null : Number(form.opportunity_value), project_manager_id: form.project_manager_id ? Number(form.project_manager_id) : null,
      target_submission: form.target_submission || null, target_launch: form.target_launch || null }
    onCreated(project ? await api.updateProject(project.id, body) : await api.createProject(body))
  })

  return (
    <Modal title={project ? 'Edit project details' : 'New project'} wide busy={busy} error={error} onClose={onClose} onSubmit={submit}
      submitLabel={project ? 'Save changes' : 'Create project'}
      intro={project ? 'Every change is recorded in the audit trail with the old and new value.' : 'Only the name is needed now. Everything else can be filled in later. The project starts at the Opportunity step, where a Director decides whether to go ahead.'}>
      <label>Project name <small className="req">required</small>
        <input value={form.name} onChange={set('name')} placeholder="e.g. Ibuprofen Gel 5%" required minLength={2} autoFocus />
      </label>
      <div className="row2">
        <label>Product
          <input value={form.product} onChange={set('product')} placeholder="e.g. Ibuprofen 5% gel, 50 g tube" />
        </label>
        <label>Market
          <select value={form.market} onChange={set('market')}>
            {(MARKETS.includes(form.market) ? MARKETS : [form.market, ...MARKETS]).map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      </div>
      <div className="row2">
        <label>Product route
          <select value={form.project_type} onChange={set('project_type')}><option value="Development">New development</option><option value="In-Licence">In-licence</option></select>
        </label>
        <label>Therapeutic category
          <select value={form.category} onChange={set('category')}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
      </div>
      <label>Short summary
        <textarea rows={2} value={form.summary} onChange={set('summary')} placeholder="What is the opportunity, in a sentence or two?" />
      </label>
      <details className="more modal-more" open={!!project}>
        <summary>More details (optional)</summary>
      <div className="row2">
        <label>Potential client
          <input value={form.potential_client} onChange={set('potential_client')} placeholder="e.g. ABC Pharmacy" />
        </label>
        <label>Initial commercial opportunity (AUD)
          <input type="number" min="0" step="1000" value={form.opportunity_value} onChange={set('opportunity_value')} placeholder="e.g. 250000" />
        </label>
      </div>
      <div className="row2">
        <label>Project manager
          <select value={form.project_manager_id} onChange={set('project_manager_id')}>
            <option value="">Not assigned</option>
            {users.filter((u) => ['project_manager', 'director', 'super_admin'].includes(u.role_key)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label>Proposed by
          <input value={form.initiator} onChange={set('initiator')} placeholder="Who suggested this product?" />
        </label>
      </div>
      <label>How it will be registered <small className="muted">(Regulatory can decide this later)</small>
        <select value={form.submission_type} onChange={set('submission_type')}>
          <option value="">To be decided</option>
          {Object.keys(config.submission_types).map((t) => <option key={t} value={t}>{plainType(t)}</option>)}
        </select>
      </label>
      <div className="row2">
        <label>Target submission
          <input type="date" value={form.target_submission} onChange={set('target_submission')} />
        </label>
        <label>Target launch
          <input type="date" value={form.target_launch} onChange={set('target_launch')} />
        </label>
      </div>
      </details>
    </Modal>
  )
}
