import { useState } from 'react'
import { api } from '../api'
import { useCan, useConfig, useMe } from '../context'
import { Empty, Person, fmtDay, label, useDo } from './bits'
import FormModal from './FormModal'
import Icon from './Icon'
import { inDays, fromInput, toInput } from './bits'

const closedProject = (p) => p.status === 'rejected' || p.status === 'completed'

/** Select that saves immediately; the server decides if the change is allowed. */
function QuickSelect({ value, options, onSave, disabled, label: aria }) {
  const { busy, error, run } = useDo()
  return (
    <span className="quick">
      <select value={value} disabled={disabled || busy} aria-label={aria} onChange={(e) => run(() => onSave(e.target.value))}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <small className="error" role="alert">{error}</small>}
    </span>
  )
}
/** Submit / approve / request changes for one entry. The server enforces who may do what. */
const ENTRY_UI = {
  agreement: { review: 'in_review', work: ['not_started', 'drafting', 'changes_requested'], act: (id, d) => api.agreementAct(id, d) },
  dossier_item: { review: 'awaiting_approval', work: ['missing', 'draft', 'changes_requested'], act: (id, d) => api.dossierAct(id, d) },
  mfr: { review: 'under_review', work: ['requested', 'received', 'changes_requested'], act: (id, d) => api.mfrAct(id, d) },
}
function EntryApproval({ kind, obj, onChange, disabled }) {
  const ui = ENTRY_UI[kind]
  const { busy, error, run } = useDo()
  const go = (action, ask) => {
    let note = ''
    if (ask) { note = window.prompt('What needs to change? (required)') || ''; if (!note.trim()) return }
    run(async () => onChange(await ui.act(obj.id, { action, note })))
  }
  if (disabled) return null
  return (
    <span className="entry-actions">
      {obj.status === 'changes_requested' && <span className="chip warn">Changes requested</span>}
      {ui.work.includes(obj.status) && <button className="link" disabled={busy} onClick={() => go('submit')}>Submit for approval</button>}
      {obj.status === ui.review && (
        <>
          <button className="link" disabled={busy} onClick={() => go('approve')}>Approve</button>
          <button className="link danger" disabled={busy} onClick={() => go('reject', true)}>Request changes</button>
        </>
      )}
      {error && <small className="error" role="alert">{error}</small>}
    </span>
  )
}
const opts = (list) => list.map((x) => [x, label(x)])
const Link = ({ href }) => (href ? <a className="doc-link" href={href} target="_blank" rel="noreferrer"><Icon name="link" size={13} />Open</a> : <span className="muted">–</span>)

// ================================================================ LEGAL
export function LegalTab({ project, onChange }) {
  const config = useConfig()
  const [adding, setAdding] = useState(false)
  const [edit, setEdit] = useState(null)
  const off = closedProject(project)
  const core = project.agreements.filter((a) => a.core)
  const other = project.agreements.filter((a) => !a.core)
  const signed = core.filter((a) => a.status === 'signed').length

  const table = (rows) => (
    <div className="table-scroll"><table className="table compact">
      <thead><tr><th>Agreement</th><th>Counterparty</th><th>Status</th><th>Owner</th><th>Due</th><th>Signed</th><th>File</th><th /></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} className={a.overdue ? 'row-late' : ''}>
            <td><strong>{a.label}</strong>{a.age_days != null && a.status !== 'not_started' && <small className="sub">open {a.age_days} days</small>}</td>
            <td data-label="Counterparty">{a.counterparty || <span className="muted">–</span>}</td>
            <td data-label="Status"><QuickSelect value={a.status} options={opts(config.agreement_status)} disabled={off} label={`${a.label} status`} onSave={async (v) => onChange(await api.updateAgreement(a.id, { status: v }))} /><EntryApproval kind="agreement" obj={a} onChange={onChange} disabled={off} /></td>
            <td data-label="Owner">{a.owner ? a.owner.name : <span className="muted">–</span>}</td>
            <td data-label="Due" className={a.overdue ? 'late' : ''}>{fmtDay(a.due_date)}</td>
            <td data-label="Signed">{fmtDay(a.signed_date)}</td>
            <td data-label="File"><Link href={a.link} /></td>
            <td><button className="link" disabled={off} onClick={() => setEdit(a)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  )

  const fields = [
    { key: 'counterparty', label: 'Counterparty', type: 'text', placeholder: 'e.g. Zenith Pharma Pvt Ltd' },
    { key: 'owner_id', label: 'Owner', type: 'user', roles: ['legal', 'project_manager', 'director'], half: true },
    { key: 'due_date', label: 'Due date', type: 'date', half: true },
    { key: 'link', label: 'Link to the document', type: 'url', placeholder: 'https://…' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <>
      <section className="panel">
        <header>
          <div><h3>Core agreements</h3><p className="muted">Supplier, Quality and PV run in parallel. Each is reviewed and approved before signature; the Legal workstream can only be submitted when all three are signed.</p></div>
          <span className="chip plain">{signed}/{core.length || 3} signed</span>
        </header>
        {core.length ? table(core) : <Empty>The three core agreements are created when the Legal workstream starts (when the Legal workstream starts in this project's workflow).</Empty>}
      </section>
      <section className="panel">
        <header><h3>NDA / CDA / POA / Notices</h3>{!off && core.length > 0 && <button className="btn line" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add</button>}</header>
        {other.length ? table(other) : <Empty>None recorded.</Empty>}
      </section>
      {adding && (
        <FormModal title="Add to the legal register" fields={[{ key: 'kind', label: 'Type', type: 'select', required: true, options: Object.entries(config.agreement_kinds).filter(([k]) => !config.core_agreements.includes(k)) }, ...fields]}
          initial={{ kind: 'nda' }} onSave={async (d) => onChange(await api.createAgreement(project.id, d))} onClose={() => setAdding(false)} submitLabel="Add" />
      )}
      {edit && (
        <FormModal title={`Edit ${edit.label}`} fields={[...fields, { key: 'signed_date', label: 'Signed on', type: 'date' }]} initial={edit}
          onSave={async (d) => onChange(await api.updateAgreement(edit.id, d))} onClose={() => setEdit(null)} />
      )}
    </>
  )
}

// ================================================================ REGULATORY
export function RegulatoryTab({ project, onChange }) {
  const config = useConfig()
  const can = useCan()
  const me = useMe()
  const [item, setItem] = useState(null) // item being edited, or 'new'
  const [recording, setRecording] = useState(false)
  const off = closedProject(project)
  const types = config.submission_types
  const tmpl = types[project.submission_type] || []
  const modulesAllowed = [...new Set(tmpl.map((t) => t.module).filter(Boolean))]
  const done = project.dossier_items.filter((i) => ['ready', 'reviewed'].includes(i.status)).length
  const total = project.dossier_items.length
  const subRow = project.stages.find((r) => r.key === project.flow.features.submission) || { state: 'pending' }
  const canRecord = subRow.state !== 'pending' && !off && (['regulatory', 'super_admin'].includes(me.role_key) || can('manage_project'))
  const [typeError, setTypeError] = useState('')

  const setType = async (v) => {
    setTypeError('')
    try { onChange(await api.updateProject(project.id, { submission_type: v })) } catch (e) { setTypeError(e.message) }
  }

  return (
    <>
      <section className="panel">
        <header><h3>Submission type</h3></header>
        <div className="row2">
          <label className="field">Submission type <small>(decides which M1–M5 modules are needed)</small>
            <select value={project.submission_type} onChange={(e) => setType(e.target.value)} disabled={off}>
              <option value="">To be decided</option>
              {Object.keys(types).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <div className="field"><span>External platform</span><p className="static">{config.settings.submission_platform}</p></div>
        </div>
        {typeError && <p className="error">{typeError}</p>}
        <p className="muted">M1–M5 apply only where the submission type requires them. The submission platform is configurable (Admin → Settings) until it is confirmed.</p>
      </section>

      <section className="panel">
        <header>
          <div><h3>Dossier checklist</h3><p className="muted">{total ? `${done} of ${total} items ready` : 'Choose a submission type to generate the checklist.'}</p></div>
          {!off && project.submission_type && <button className="btn line" onClick={() => setItem('new')}><Icon name="plus" size={16} />Add item</button>}
        </header>
        {total > 0 && <div className="meter"><i style={{ width: `${(done / total) * 100}%` }} /></div>}
        {total > 0 && (
          <div className="table-scroll"><table className="table compact">
            <thead><tr><th>Module</th><th>Item</th><th>Status</th><th>File</th><th /></tr></thead>
            <tbody>
              {project.dossier_items.map((i) => (
                <tr key={i.id}>
                  <td data-label="Module">{i.module ? <span className="chip plain">{i.module}</span> : <span className="muted">–</span>}</td>
                  <td><strong>{i.title}</strong>{!i.required && <small className="sub">optional</small>}{i.notes && <small className="sub">{i.notes}</small>}</td>
                  <td data-label="Status"><QuickSelect value={i.status} options={opts(config.dossier_status)} disabled={off} label={`${i.title} status`} onSave={async (v) => onChange(await api.updateDossierItem(i.id, { status: v }))} /><EntryApproval kind="dossier_item" obj={i} onChange={onChange} disabled={off} /></td>
                  <td data-label="File"><Link href={i.link} /></td>
                  <td><button className="link" disabled={off} onClick={() => setItem(i)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="panel">
        <header>
          <div><h3>Submission history</h3><p className="muted">Every external submission and RFI response is recorded here.</p></div>
          <button className="btn line" disabled={!canRecord} title={subRow.state === 'pending' ? 'Available once the Dossier Ready milestone is approved' : ''} onClick={() => setRecording(true)}><Icon name="plus" size={16} />Record submission</button>
        </header>
        {!project.submissions.length && <Empty>{subRow.state === 'pending' ? 'No submission yet. Recording opens once the Dossier Ready milestone is approved.' : 'Nothing recorded yet. Record the external submission before the stage can be submitted.'}</Empty>}
        {project.submissions.length > 0 && (
          <div className="table-scroll"><table className="table compact">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Platform</th><th>By</th></tr></thead>
            <tbody>{project.submissions.map((s) => <tr key={s.id}><td data-label="Date">{fmtDay(s.submitted_on)}</td><td data-label="Type">{label(s.kind)}</td><td data-label="Reference"><strong>{s.reference || '–'}</strong>{s.notes && <small className="sub">{s.notes}</small>}</td><td data-label="Platform">{s.platform}</td><td data-label="By">{s.submitted_by}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="panel soft">
        <header><h3>AI regulatory review <span className="chip plain">Phase 2</span></h3></header>
        <p className="muted">Planned for Phase 2, not part of this release: dossier completeness check, current trend / limit review against a versioned regulatory knowledge base, and RFI risk assessment. Human review is mandatory; AI never certifies compliance.</p>
      </section>

      {item && (
        <FormModal title={item === 'new' ? 'Add dossier item' : item.title}
          fields={item === 'new'
            ? [{ key: 'module', label: 'Module', type: 'select', options: modulesAllowed.map((m) => [m, m]), blank: 'No module', hint: modulesAllowed.length ? '' : '(this submission type has no M1–M5 modules)' },
              { key: 'title', label: 'Item', type: 'text', required: true }, { key: 'required', label: 'Required', type: 'checkbox' }]
            : [{ key: 'link', label: 'Link to the file', type: 'url', placeholder: 'https://…' }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'required', label: 'Required', type: 'checkbox' }]}
          initial={item === 'new' ? { required: true } : item}
          onSave={async (d) => onChange(item === 'new' ? await api.createDossierItem(project.id, d) : await api.updateDossierItem(item.id, d))}
          onClose={() => setItem(null)} />
      )}
      {recording && (
        <FormModal title="Record external submission" intro="Records what was submitted, when and where. It cannot be silently changed later."
          fields={[{ key: 'kind', label: 'Type', type: 'select', required: true, options: [['initial', 'Initial submission'], ['variation', 'Variation'], ['rfi_response', 'RFI response']], half: true },
            { key: 'submitted_on', label: 'Submitted on', type: 'date', required: true, half: true },
            { key: 'reference', label: 'Reference / application number', type: 'text' },
            { key: 'platform', label: 'Platform', type: 'text', placeholder: config.settings.submission_platform, hint: '(leave blank to use the configured one)' },
            { key: 'notes', label: 'Notes', type: 'textarea' }]}
          initial={{ kind: 'initial', submitted_on: new Date().toISOString().slice(0, 10) }}
          onSave={async (d) => onChange(await api.recordSubmission(project.id, d))} onClose={() => setRecording(false)} submitLabel="Record" />
      )}
    </>
  )
}

// ================================================================ MANUFACTURER DATA
export function ManufacturerTab({ project, onChange }) {
  const config = useConfig()
  const [edit, setEdit] = useState(null)
  const off = closedProject(project)
  const got = project.mfr_requests.filter((m) => m.status === 'accepted').length
  const fields = [
    { key: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'e.g. Zenith Pharma Pvt Ltd' },
    { key: 'due_date', label: 'Needed by', type: 'date', half: true },
    { key: 'owner_id', label: 'Owner', type: 'user', roles: ['technical', 'regulatory', 'project_manager'], half: true },
    { key: 'required', label: 'Required', hint: ' The workstream cannot be submitted until required data is accepted.', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ]
  return (
    <>
      <section className="panel">
        <header>
          <div><h3>Manufacturer / technical data</h3><p className="muted">COA, MSDS, specification, testing, stability and manufacturing data. {got}/{project.mfr_requests.length} accepted.</p></div>
          {!off && <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={16} />Request data</button>}
        </header>
        <p className="notice soft">Access model: {config.settings.manufacturer_access}</p>
        {!project.mfr_requests.length && <Empty>No data requested yet.</Empty>}
        {project.mfr_requests.length > 0 && (
          <div className="table-scroll"><table className="table compact">
            <thead><tr><th>Data</th><th>Manufacturer</th><th>Status</th><th>Needed by</th><th>Received</th><th>File</th><th /></tr></thead>
            <tbody>
              {project.mfr_requests.map((m) => (
                <tr key={m.id} className={m.overdue ? 'row-late' : ''}>
                  <td><strong>{m.label}</strong>{!m.required && <small className="sub">optional</small>}{m.notes && <small className="sub">{m.notes}</small>}</td>
                  <td data-label="Manufacturer">{m.manufacturer || '–'}</td>
                  <td data-label="Status"><QuickSelect value={m.status} options={opts(config.mfr_status)} disabled={off} label={`${m.label} status`} onSave={async (v) => onChange(await api.updateMfr(m.id, { status: v }))} /><EntryApproval kind="mfr" obj={m} onChange={onChange} disabled={off} /></td>
                  <td data-label="Needed by" className={m.overdue ? 'late' : ''}>{fmtDay(m.due_date)}</td>
                  <td data-label="Received">{fmtDay(m.received_on)}</td>
                  <td data-label="File"><Link href={m.link} /></td>
                  <td><button className="link" disabled={off} onClick={() => setEdit(m)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
      {edit && (
        <FormModal title={edit === 'new' ? 'Request manufacturer data' : `Edit ${edit.label}`}
          fields={edit === 'new' ? [{ key: 'kind', label: 'Data', type: 'select', required: true, options: Object.entries(config.mfr_kinds) }, ...fields]
            : [...fields, { key: 'link', label: 'Link to the file', type: 'url', placeholder: 'https://…' }]}
          initial={edit === 'new' ? { kind: 'coa', required: true } : edit}
          onSave={async (d) => onChange(edit === 'new' ? await api.createMfr(project.id, d) : await api.updateMfr(edit.id, d))}
          onClose={() => setEdit(null)} />
      )}
    </>
  )
}

// ================================================================ RFI
function RfiCard({ rfi, project, onChange }) {
  const me = useMe()
  const can = useCan()
  const [open, setOpen] = useState(rfi.status !== 'closed')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState(rfi.response_link)
  const { busy, error, run } = useDo()
  const off = closedProject(project)
  const isRA = ['regulatory', 'super_admin'].includes(me.role_key) || can('manage_project')
  const go = (action) => run(async () => { onChange(await api.rfiAct(rfi.id, { action, note })); setNote('') })
  const saveLink = () => run(async () => onChange(await api.updateRfi(rfi.id, { response_link: link })))

  return (
    <article className={`rfi r-${rfi.status}`}>
      <header onClick={() => setOpen(!open)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}>
        <div className="t-title"><strong>{rfi.reference || 'RFI'} · {rfi.authority}</strong><small>{rfi.summary || 'No summary'}</small></div>
        <span className={`age ${rfi.overdue ? 'age-over' : 'age-ok'}`}>{rfi.due_date ? `Due ${fmtDay(rfi.due_date)}` : 'No due date'}</span>
        <span className={`dstate rfi-${rfi.status}`}>{label(rfi.status)}</span>
      </header>
      {open && (
        <div className="task-body">
          <ol className="rfi-q">
            {rfi.questions.map((q) => (
              <RfiQuestion key={q.id} q={q} disabled={off || rfi.status === 'closed'} onChange={onChange} />
            ))}
          </ol>
          {!rfi.questions.length && <Empty>No questions yet. Add each question the authority asked and assign it: it becomes a task with a due date.</Empty>}
          {!off && rfi.status === 'open' && isRA && <button className="btn line" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add question</button>}

          <label className="field">Response package link
            <div className="inline"><input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" disabled={off || rfi.status === 'closed'} />
              <button className="btn line" type="button" disabled={busy || link === rfi.response_link || off} onClick={saveLink}>Save</button></div>
          </label>
          {rfi.status === 'closed' && <p className="closed-note">Closed {fmtDay(rfi.closed_on)}. {rfi.closure_note}</p>}
          {error && <p className="error">{error}</p>}
          {!off && isRA && (
            <>
              {['submitted', 'closed'].includes(rfi.status) && (
                <label className="field">Note <small>(required to close or reopen)</small>
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              )}
              <div className="actions">
                {rfi.status === 'open' && <button className="btn primary" disabled={busy} onClick={() => go('ready')}>Mark response ready</button>}
                {rfi.status === 'response_ready' && <button className="btn primary" disabled={busy} onClick={() => go('submit')}>Record response as submitted</button>}
                {rfi.status === 'submitted' && can('approve') && <button className="btn primary" disabled={busy} onClick={() => go('close')}>Close case</button>}
                {rfi.status === 'closed' && can('approve') && <button className="btn line" disabled={busy} onClick={() => go('reopen')}>Reopen case</button>}
              </div>
            </>
          )}
        </div>
      )}
      {adding && (
        <FormModal title="Add RFI question" intro="It becomes a task for the person you choose, with the due date you set."
          fields={[{ key: 'question', label: 'Question from the authority', type: 'textarea', required: true },
            { key: 'assignee_id', label: 'Assign to', type: 'user', assignable: true, half: true },
            { key: 'due_at', label: 'Due', type: 'datetime', required: true, half: true }]}
          initial={{ due_at: inDays(5) }}
          onSave={async (d) => { if (!d.assignee_id) throw new Error('Choose who answers this.'); onChange(await api.addQuestion(rfi.id, { ...d, due_at: fromInput(d.due_at) })) }}
          onClose={() => setAdding(false)} submitLabel="Assign question" />
      )}
    </article>
  )
}

function RfiQuestion({ q, disabled, onChange }) {
  const me = useMe()
  const [response, setResponse] = useState(q.response)
  const [evidence, setEvidence] = useState(q.evidence_link)
  const { busy, error, run } = useDo()
  const t = q.task
  const dirty = response !== q.response || evidence !== q.evidence_link
  return (
    <li>
      <div className="q-head">
        <b>Q{q.number}</b><span>{q.question}</span>
      </div>
      {t && <div className="q-meta"><Person user={t.assignee} /><span className="muted">due {fmtDay(t.due_at)}</span><span className={`tstate tstate-${t.state}`}>{label(t.state)}</span>{t.overdue && <span className="age age-over">Overdue</span>}</div>}
      <textarea rows={2} value={response} disabled={disabled} onChange={(e) => setResponse(e.target.value)} placeholder="Response / evidence summary…" />
      <div className="inline">
        <input type="url" value={evidence} disabled={disabled} onChange={(e) => setEvidence(e.target.value)} placeholder="Link to evidence (https://…)" />
        <button className="btn line" disabled={disabled || busy || !dirty} onClick={() => run(async () => onChange(await api.updateQuestion(q.id, { response, evidence_link: evidence })))}>Save</button>
      </div>
      {error && <p className="error">{error}</p>}
      {t && <p className="muted tiny">The question's task is accepted, worked and approved in the Tasks tab{t.assignee.id === me.id ? ' (it is assigned to you)' : ''}.</p>}
    </li>
  )
}

export function RfiTab({ project, onChange }) {
  const can = useCan()
  const me = useMe()
  const [creating, setCreating] = useState(false)
  const off = closedProject(project)
  const isRA = ['regulatory', 'super_admin'].includes(me.role_key) || can('manage_project')
  const subDone = ['approved', 'bypassed'].includes(project.stage_states.submission)
  return (
    <section className="panel">
      <header>
        <div><h3>RFI management</h3><p className="muted">Authority questions are assigned as tasks, evidence is linked, and the response package is tracked to closure. The RFI / Changes stage can only be submitted when every case is closed.</p></div>
        {!off && isRA && <button className="btn primary" disabled={!subDone} title={subDone ? '' : 'RFIs follow a recorded submission'} onClick={() => setCreating(true)}><Icon name="plus" size={16} />Open RFI case</button>}
      </header>
      {!project.rfis.length && <Empty>{subDone ? 'No RFI cases. If the authority raises questions, open a case here.' : 'RFIs can be opened once the Regulatory Submission stage is approved.'}</Empty>}
      <div className="tasklist">{project.rfis.map((r) => <RfiCard key={r.id} rfi={r} project={project} onChange={onChange} />)}</div>
      {creating && (
        <FormModal title="Open RFI case" fields={[
          { key: 'authority', label: 'Authority', type: 'text', required: true, half: true }, { key: 'reference', label: 'Reference', type: 'text', half: true },
          { key: 'received_on', label: 'Received on', type: 'date', required: true, half: true }, { key: 'due_date', label: 'Response due', type: 'date', half: true },
          { key: 'summary', label: 'Summary', type: 'textarea' }]}
          initial={{ authority: 'TGA', received_on: new Date().toISOString().slice(0, 10) }}
          onSave={async (d) => onChange(await api.createRfi(project.id, d))} onClose={() => setCreating(false)} submitLabel="Open case" />
      )}
    </section>
  )
}
