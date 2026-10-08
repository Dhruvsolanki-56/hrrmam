import { useState } from 'react'
import { api } from '../api'

const CATEGORIES = ['Pain', 'Eye care', 'Respiratory', 'Nasal care', 'Gastro / IBS / bowel', 'Hydration',
  'Nail care', 'Skin care', 'Ear & throat care', 'Other']

export default function NewProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
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
      if (form.initiator) localStorage.setItem('nh-actor', form.initiator)
      onCreated(await api.createProject(form))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New project</h2>
        <p className="muted">It starts at Opportunity Screening with the Project Initiator.</p>

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
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
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
          <button className="btn primary" disabled={busy}>Create project</button>
        </div>
      </form>
    </div>
  )
}
