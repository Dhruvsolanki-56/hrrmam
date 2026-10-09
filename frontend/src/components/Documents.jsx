import { useState } from 'react'
import { api } from '../api'
import Icon from './Icon'

const SUGGESTIONS = ['Project brief', 'Feasibility report', 'Supplier agreement', 'Artwork', 'Regulatory dossier', 'Print proof', 'Other']

const host = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/** Links to documents that live elsewhere (SharePoint, Drive, ...). Nothing is uploaded or stored here. */
export default function Documents({ project, onChange }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onChange(await api.addLink(project.id, { title, url }))
      setTitle('')
      setUrl('')
    } catch (err) {
      setError(err.message.includes('http') ? 'Enter a full link starting with http:// or https://' : err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    onChange(await api.deleteLink(project.id, id))
  }

  return (
    <section className="panel docs">
      <header><h3>Documents</h3><span className="muted">Links to where files live</span></header>
      {project.links.length === 0 && <p className="muted docs-empty">No documents linked yet.</p>}
      <ul className="doclist">
        {project.links.map((l) => (
          <li key={l.id}>
            <span className="doc-icon"><Icon name="link" size={16} /></span>
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              <strong>{l.title}</strong>
              <small>{host(l.url)}</small>
            </a>
            <button className="icon-btn" onClick={() => remove(l.id)} aria-label={`Remove ${l.title}`} title="Remove link">
              <Icon name="trash" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <form className="docform" onSubmit={add}>
        <input list="doc-titles" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Project brief" required maxLength={120} aria-label="Document title" />
        <datalist id="doc-titles">{SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required inputMode="url" aria-label="Document link" />
        <button className="btn line" disabled={busy}>Add link</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
