import { useState } from 'react'
import { api } from '../api'

const CATEGORIES = ['Pain', 'Eye care', 'Respiratory', 'Nasal care', 'Gastro / IBS / bowel', 'Hydration',
  'Nail care', 'Skin care', 'Ear & throat care', 'Other']

export default function NewProjectModal({ onClose, onCreated, project }) {
  const cats = project?.category && !CATEGORIES.includes(project.category) ? [project.category, ...CATEGORIES] : CATEGORIES
  const [form, setForm] = useState(project ? {
    name: project.name, project_type: project.project_type, category: project.category || CATEGORIES[0],
    initiator: project.initiator, summary: project.summary,
  } : {
    name: '', project_type: 'Development', category: CATEGORIES[0],
    initiator: localStorage.getItem('nh-actor') || '', summary: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      if (!project && form.initiator) localStorage.setItem('nh-actor', form.initiator)
      onCreated(project
        ? await api.updateProject(project.id, { ...form, actor: localStorage.getItem('nh-actor') || '' })
        : await api.createProject(form))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{project ? 'Edit project' : 'New project'}</h2>
        <p className="muted">{project ? 'Changes are recorded in the activity log.' : 'It starts at Opportunity Screening with the Project Initiator.'}</p>

        <label>Project name
          <input value={form.name} onChange={set('name')} placeholder="e.g. Ibuprofen Gel 5%" required minLength={2} autoFocus />
        </label>
        <div className="row2">
          <label>Type
            <select value={form.project_type} onChange={set('project_type')}>
              <option>Development</option>
              <option>In-Licence</option>
            </select>
          </label>
          <label>Therapeutic category
            <select value={form.category} onChange={set('category')}>
              {cats.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label>Project initiator
          <input value={form.initiator} onChange={set('initiator')} placeholder="Your name" />
        </label>
        <label>Short summary
          <textarea rows={3} value={form.summary} onChange={set('summary')} placeholder="What is the opportunity?" />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{project ? 'Save changes' : 'Create project'}</button>
        </div>
      </form>
    </div>
  )
}
