import { useState } from 'react'
import { api } from '../api'
import { useAccess, useCan, useConfig, useMe, useStages } from '../context'
import { Empty, Person, fmtDate, holderOf, label, toast, useDo, useFocus } from './bits'
import FormModal from './FormModal'
import Icon from './Icon'
import { ReopenButton } from './Reopen'
import ReviewBlock from './ReviewBlock'

const FLOW_LABEL = { draft: 'Draft', in_review: 'In review', regulatory_review: 'Regulatory review', director_approval: 'Director approval', approved: 'Approved' }
const STATUS_LABEL = { ...FLOW_LABEL, returned: 'Returned for changes', locked: 'Locked' }

function Flow({ doc }) {
  const idx = doc.status === 'returned' ? 0 : doc.status === 'locked' ? doc.flow.length - 1 : doc.flow.indexOf(doc.status)
  return (
    <ol className="docflow" aria-label="Review flow">
      {doc.flow.map((s, i) => <li key={s} className={i < idx || doc.status === 'locked' ? 'done' : i === idx ? (doc.status === 'returned' ? 'returned' : 'now') : ''}>{doc.flow_labels?.[s] || FLOW_LABEL[s] || label(s)}</li>)}
    </ol>
  )
}

/** What was just done and who has it now, in one sentence, so nobody has to look for where it went. */
function confirmation(action, before, after, noteTo) {
  const to = holderOf(after.review)
  const sender = before.review?.submitted?.by
  if (action === 'submit') return `Sent for ${after.review.step?.toLowerCase() || 'review'}${to ? ` to ${to}` : ''}. They have been notified.`
  if (action === 'approve') return to ? `Approved. It is now with ${to} for ${after.review.step?.toLowerCase() || 'the next review'}. They have been notified.` : `Approved.${sender ? ` ${sender} has been told.` : ''}`
  if (action === 'return') return `Returned for changes${to ? ` to ${to}` : ''}. They have been notified with your reason.`
  if (action === 'comment') return `Note saved with this item${noteTo ? ` and sent to ${noteTo}` : ''}.`
  return ''
}

/** A document (or artwork item): V1/V2/V3, review -> approve -> lock, return for changes. */
function Doc({ doc, onChange, project }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const access = useAccess()
  const focus = useFocus()
  const [open, setOpen] = useState(focus === `doc-${doc.id}`)
  const [note, setNote] = useState('')
  const [version, setVersion] = useState(false)
  const [noting, setNoting] = useState(false)
  const { busy, error, run } = useDo()
  const reviewing = doc.flow.slice(1, -1).includes(doc.status)
  const sup = me.role_key === 'super_admin'
  const roles = doc.is_artwork ? (doc.review_roles?.length ? doc.review_roles : ['director'])
    : (stages.find((s) => s.key === doc.stage_key)?.approver_roles || ['director'])
  const mayReview = reviewing && (sup || roles.includes(me.role_key)) && can('approve') && doc.review?.submitted?.by !== me.name
  const stage = stages.find((s) => s.key === doc.stage_key)
  const mayWork = access(stage).work
  const latest = doc.versions[doc.versions.length - 1]
  const rv = doc.review || {}
  const who = holderOf(rv)
  const you = (t) => !!t && t.includes(me.name)
  const noteTo = who && !you(who) ? who : (rv.changes?.by && rv.changes.by !== me.name ? rv.changes.by : rv.submitted?.by && rv.submitted.by !== me.name ? rv.submitted.by : '')
  const go = (action) => run(async () => {
    if (['return'].includes(action) && !note.trim()) throw new Error('Write the reason first. The person who must fix it will see it.')
    if (action === 'comment' && !note.trim()) throw new Error('Write the note first.')
    const p = await api.docAct(doc.id, { action, note })
    const after = p.documents.find((d) => d.id === doc.id)
    onChange(p); setNote(''); setNoting(false)
    const msg = after && confirmation(action, doc, after, noteTo)
    if (msg) toast(msg)
  })
  const sendLabel = (doc.is_artwork ? `Send to ${doc.flow_labels?.[doc.flow[1]]?.toLowerCase() || 'review'}` : 'Submit for review') + (doc.status === 'returned' && rv.changes?.by ? ` (back to ${rv.changes.by})` : '')
  // one text box per card: it carries the decision note, the message sent with the work, or a note on its own
  const boxShown = mayReview || (['draft', 'returned'].includes(doc.status) && mayWork)

  return (
    <article className={`doc d-${doc.status}`} id={`doc-${doc.id}`}>
      <header onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)} aria-expanded={open}>
        <div className="t-title">
          <strong>{doc.title}</strong>
          <small>{doc.kind} · V{doc.current_version}{!doc.required && ' · optional'}{who && !['approved', 'locked'].includes(doc.status) ? ` · with ${you(who) && !who.includes(' or ') ? 'you' : who}` : ''}</small>
        </div>
        <Person user={doc.owner} />
        <span className={`dstate dstate-${doc.status}`}>{doc.flow_labels?.[doc.status] || STATUS_LABEL[doc.status] || label(doc.status)}</span>
      </header>
      {open && (
        <div className="task-body">
          <ReviewBlock review={rv} step={reviewing || doc.status === 'returned' ? rv.step : ''} kind="document" />
          <Flow doc={doc} />
          {latest?.link && <p><a className="doc-link" href={latest.link} target="_blank" rel="noreferrer"><Icon name="link" size={14} />Open V{latest.version_no} in a new tab</a></p>}
          <ul className="versions">
            {[...doc.versions].reverse().map((v) => (
              <li key={v.id}><b>V{v.version_no}</b><span>{v.note || 'No note'}</span><small>{v.created_by} · {fmtDate(v.created_at)}{v.link && <> · <a href={v.link} target="_blank" rel="noreferrer">Open</a></>}</small></li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
          {(boxShown || noting) && (
            <label className="field">
              {mayReview ? `Your decision note${rv.submitted?.by ? ` (goes to ${rv.submitted.by}; needed to return it)` : ''}`
                : noting ? `Note${noteTo ? ` for ${noteTo}` : ''}`
                  : `Message for ${noteTo || 'the reviewer'} (optional)`}
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a short comment for the record…" />
            </label>
          )}
          <div className="actions">
            {['draft', 'returned'].includes(doc.status) && mayWork && <button className="btn primary" disabled={busy} onClick={() => go('submit')}>{sendLabel}</button>}
            {['draft', 'returned', 'approved'].includes(doc.status) && mayWork && <button className="btn line" onClick={() => setVersion(true)}>Upload new version</button>}
            {mayReview && <button className="btn primary" disabled={busy} onClick={() => go('approve')}>{doc.is_artwork ? `Approve (${doc.flow_labels[doc.status] || 'review'})` : 'Approve'}</button>}
            {mayReview && <button className="btn line" disabled={busy} onClick={() => go('return')}>Return for changes</button>}
            {reviewing && !mayReview && <span className="muted">{rv.submitted?.by === me.name ? `You sent this. ${who || roles.map((r) => label(r)).join(' / ')} must review it.` : `Only ${who || roles.map((r) => label(r)).join(' / ')} can review this step. You can follow it here.`}</span>}
            {['approved', 'locked'].includes(doc.status) && project && mayWork && <ReopenButton project={project} kind="document" refId={doc.id} onChange={onChange} />}
            {doc.status === 'approved' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('lock')}>Lock</button>}
            {doc.status === 'locked' && can('lock_unlock') && <button className="btn line" disabled={busy} onClick={() => go('unlock')}>Unlock</button>}
            {!['locked'].includes(doc.status) && (mayWork || mayReview) && (
              noting || boxShown ? <button className="btn line" disabled={busy} onClick={() => go('comment')}>{noting ? 'Send note' : 'Send as a note only'}{noteTo ? ` to ${noteTo}` : ''}</button>
                : <button className="link note-link" onClick={() => setNoting(true)}>+ Add a note</button>
            )}
          </div>
          {!mayWork && !mayReview && !reviewing && <p className="act-hint">You can view this item. Only {stage ? `${stage.owner}` : 'the project team'} can change it.</p>}
        </div>
      )}
      {version && (
        <FormModal title={`New version of ${doc.title}`} intro={`This becomes V${doc.current_version + 1}. Earlier versions stay in the history.${who && doc.status === 'returned' ? ` Then send it back to ${who}.` : ''}`}
          fields={[{ key: 'link', label: 'Link to the file', type: 'url', placeholder: 'https://…' }, { key: 'note', label: 'What changed?', type: 'textarea', required: doc.status === 'approved' }]}
          onSave={async (d) => { onChange(await api.addVersion(doc.id, d)); toast(`V${doc.current_version + 1} saved. Send it for review when it is ready.`) }} onClose={() => setVersion(false)} submitLabel="Add version" />
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
  const access = useAccess()
  const [adding, setAdding] = useState(false)
  const docs = project.documents.filter((d) => (artwork ? d.is_artwork : stageKey ? d.stage_key === stageKey : !d.is_artwork))
  const closed = project.status === 'rejected' || project.status === 'completed'
  const lead = can('manage_project') || me.role_key === 'super_admin'
  // people add documents only to the steps they work on, so nobody is offered a button for someone else's workstream
  const workable = stages.filter((s) => access(s).work)
  const mayAdd = !closed && (lead || (artwork ? ['artwork', 'regulatory'].includes(me.role_key) : stageKey ? access(stages.find((s) => s.key === stageKey)).work : workable.length > 0))
  const kinds = artwork ? Object.values(config.artwork_kinds) : config.doc_kinds
  const wsStage = stages.find((s) => (artwork ? (s.features || []).includes('artwork') : s.key === stageKey))

  return (
    <section className="panel">
      <header>
        <h3>{title || (artwork ? 'Artwork & packaging' : 'Documents')}</h3>
        {mayAdd && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{artwork ? 'New artwork item' : 'Add document'}</button>}
      </header>
      {artwork && !mayAdd && !closed && <p className="notice soft">You can follow every artwork item here. Only the Artwork team, Regulatory and project managers add or change them{wsStage ? ` (${wsStage.owner})` : ''}.</p>}
      {!docs.length && <Empty>{artwork ? 'No artwork yet. Add the carton, label, leaflet, print proof or shade card; each goes through regulatory review, then director approval.' : 'No documents yet. Add a link and it is versioned (V1, V2, V3…) with review, approval and lock.'}</Empty>}
      <div className="tasklist">{docs.map((d) => <Doc key={d.id} doc={d} project={project} onChange={onChange} />)}</div>
      {adding && (
        <FormModal title={artwork ? 'New artwork item' : 'Add a document'} wide
          intro={artwork ? 'Starts as V1 (draft). Send it to regulatory review, then director approval.' : 'Starts as V1 (draft). Reviewers approve it; approved documents can be locked.'}
          fields={[
            ...(artwork ? [] : [{ key: 'stage_key', label: 'Belongs to', type: 'select', half: true, ...(lead ? { blank: 'Whole project' } : {}), options: (lead ? stages : workable).map((s) => [s.key, s.name]) }]),
            { key: 'kind', label: 'Kind', type: 'select', required: true, half: !artwork, options: kinds.map((k) => [k, k]) },
            { key: 'title', label: 'Title', type: 'text', required: true, placeholder: artwork ? 'e.g. 50 g tube carton' : 'e.g. Supplier agreement draft' },
            { key: 'link', label: 'Link to the file', type: 'url', placeholder: 'https://…', hint: '(SharePoint, Drive…)' },
            { key: 'note', label: 'Note', type: 'textarea' },
            { key: 'required', label: 'Required', hint: ' Must be approved before the workstream can be submitted.', type: 'checkbox' },
          ]}
          initial={{ stage_key: stageKey || (lead ? '' : workable[0]?.key || ''), kind: kinds[0], required: true }}
          onSave={async (d) => { onChange(await api.createDocument(project.id, { ...d, artwork: !!artwork, stage_key: artwork ? 'artwork' : d.stage_key || stageKey || '' })); toast(`${d.title} was added as V1 (draft). It is with you until you send it for review.`) }}
          onClose={() => setAdding(false)} submitLabel="Add" />
      )}
    </section>
  )
}
