import { useState } from 'react'
import { api } from '../api'
import { useCan, useConfig, useMe, useStages } from '../context'
import { Empty, Person, fmtDate, label, useDo } from './bits'
import FormModal from './FormModal'
import Icon from './Icon'

const FLOW_LABEL = { draft: 'Draft', in_review: 'In review', regulatory_review: 'Regulatory review', director_approval: 'Director approval', approved: 'Approved' }
const STATUS_LABEL = { ...FLOW_LABEL, returned: 'Returned for changes', locked: 'Locked' }

function Flow({ doc }) {
  const idx = doc.status === 'returned' ? 0 : doc.status === 'locked' ? doc.flow.length - 1 : doc.flow.indexOf(doc.status)
  return (
    <ol className="docflow" aria-label="Review flow">
      {doc.flow.map((s, i) => <li key={s} className={i < idx || doc.status === 'locked' ? 'done' : i === idx ? (doc.status === 'returned' ? 'returned' : 'now') : ''}>{FLOW_LABEL[s]}</li>)}
    </ol>
  )
}

/** A document (or artwork item): V1/V2/V3, review -> approve -> lock, return for changes. */
function Doc({ doc, onChange }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [version, setVersion] = useState(false)
  const { busy, error, run } = useDo()
  const reviewing = doc.flow.slice(1, -1).includes(doc.status)
  const sup = me.role_key === 'super_admin'
  const roles = doc.is_artwork ? (doc.status === 'regulatory_review' ? ['regulatory'] : ['director'])
    : (stages.find((s) => s.key === doc.stage_key)?.approver_roles || ['director', 'project_manager'])
  const mayReview = reviewing && (sup || roles.includes(me.role_key))
  const latest = doc.versions[doc.versions.length - 1]
  const go = (action) => run(async () => { onChange(await api.docAct(doc.id, { action, note })); setNote('') })

  return (
    <article className={`doc d-${doc.status}`}>
      <header onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <div className="t-title">
          <strong>{doc.title}</strong>
          <small>{doc.kind} · V{doc.current_version}{!doc.required && ' · optional'}</small>
        </div>
        <Person user={doc.owner} />
        <span className={`dstate dstate-${doc.status}`}>{STATUS_LABEL[doc.status]}</span>
      </header>
      {open && (
        <div className="task-body">
          <Flow doc={doc} />
          {latest?.link && <p><a className="doc-link" href={latest.link} target="_blank" rel="noreferrer"><Icon name="link" size={14} />Open V{latest.version_no}</a></p>}
          <ul className="versions">
            {[...doc.versions].reverse().map((v) => (
              <li key={v.id}><b>V{v.version_no}</b><span>{v.note || 'No note'}</span><small>{v.created_by} · {fmtDate(v.created_at)}{v.link && <> · <a href={v.link} target="_blank" rel="noreferrer">open</a></>}</small></li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
          {(reviewing || doc.status === 'locked' || doc.status === 'approved') && (
            <label className="field">Note <small>(needed to return for changes, unlock)</small>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" />
            </label>
          )}
          <div className="actions">
            {['draft', 'returned'].includes(doc.status) && <button className="btn primary" disabled={busy} onClick={() => go('submit')}>{doc.is_artwork ? 'Send to regulatory review' : 'Submit for review'}</button>}
            {['draft', 'returned', 'approved'].includes(doc.status) && <button className="btn line" onClick={() => setVersion(true)}>Upload new version</button>}
            {mayReview && <button className="btn primary" disabled={busy} onClick={() => go('approve')}>{doc.is_artwork && doc.status === 'regulatory_review' ? 'Approve (regulatory)' : doc.is_artwork ? 'Approve (director)' : 'Approve'}</button>}
            {mayReview && <button className="btn line" disabled={busy} onClick={() => go('return')}>Return for changes</button>}
            {reviewing && !mayReview && <span className="muted">Waiting for {roles.map((r) => label(r)).join(' / ')}.</span>}
            {doc.status === 'approved' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('lock')}>Lock</button>}
            {doc.status === 'locked' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('unlock')}>Unlock</button>}
          </div>
        </div>
      )}
      {version && (
        <FormModal title={`New version of ${doc.title}`} intro={`This becomes V${doc.current_version + 1}. Earlier versions stay in the history.`}
          fields={[{ key: 'link', label: 'Link to the file', type: 'url', placeholder: 'https://…' }, { key: 'note', label: 'What changed?', type: 'textarea', required: doc.status === 'approved' }]}
          onSave={async (d) => onChange(await api.addVersion(doc.id, d))} onClose={() => setVersion(false)} submitLabel="Add version" />
      )}
    </article>
  )
}

/** List of documents for one workstream (or all) with an "add" button. `artwork` switches to the artwork kinds + flow. */
export default function DocList({ project, onChange, stageKey, artwork, title }) {
  const config = useConfig()
  const stages = useStages()
  const can = useCan()
  const me = useMe()
  const [adding, setAdding] = useState(false)
  const docs = project.documents.filter((d) => (artwork ? d.is_artwork : stageKey ? d.stage_key === stageKey : !d.is_artwork))
  const closed = project.status === 'rejected' || project.status === 'completed'
  const mayAdd = !closed && (can('manage_project') || me.role_key === 'super_admin' || (artwork ? ['artwork', 'regulatory'].includes(me.role_key) : true))
  const kinds = artwork ? Object.values(config.artwork_kinds) : config.doc_kinds

  return (
    <section className="panel">
      <header>
        <h3>{title || (artwork ? 'Artwork & packaging' : 'Documents')}</h3>
        {mayAdd && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{artwork ? 'New artwork item' : 'Add document'}</button>}
      </header>
      {!docs.length && <Empty>{artwork ? 'No artwork yet. Add the carton, label, leaflet, print proof or shade card; each goes through regulatory review, then director approval.' : 'No documents yet. Add a link and it is versioned (V1, V2, V3…) with review, approval and lock.'}</Empty>}
      <div className="tasklist">{docs.map((d) => <Doc key={d.id} doc={d} onChange={onChange} />)}</div>
      {adding && (
        <FormModal title={artwork ? 'New artwork item' : 'Add a document'} wide
          intro={artwork ? 'Starts as V1 (draft). Send it to regulatory review, then director approval.' : 'Starts as V1 (draft). Reviewers approve it; approved documents can be locked.'}
          fields={[
            ...(artwork ? [] : [{ key: 'stage_key', label: 'Belongs to', type: 'select', half: true, blank: 'Whole project', options: stages.map((s) => [s.key, s.name]) }]),
            { key: 'kind', label: 'Kind', type: 'select', required: true, half: !artwork, options: kinds.map((k) => [k, k]) },
            { key: 'title', label: 'Title', type: 'text', required: true, placeholder: artwork ? 'e.g. 50 g tube carton' : 'e.g. Supplier agreement draft' },
            { key: 'link', label: 'Link to the file', type: 'url', placeholder: 'https://…', hint: '(SharePoint, Drive…)' },
            { key: 'note', label: 'Note', type: 'textarea' },
            { key: 'required', label: 'Required', hint: ' Must be approved before the workstream can be submitted.', type: 'checkbox' },
          ]}
          initial={{ stage_key: stageKey || '', kind: kinds[0], required: true }}
          onSave={async (d) => onChange(await api.createDocument(project.id, { ...d, stage_key: artwork ? 'artwork' : d.stage_key || stageKey || '' }))}
          onClose={() => setAdding(false)} submitLabel="Add" />
      )}
    </section>
  )
}
