import { useState } from 'react'
import { api } from '../api'
import { useCan, useMe, useStages } from '../context'
import { Empty, fmtDate, fmtDay, label, useDo } from './bits'
import FormModal from './FormModal'
import Icon from './Icon'

const BRIEF = [
  ['potential_client', 'Customer / client', 'Who is this for?'],
  ['formulation', 'Product and formulation', 'What is being proposed: product, strength, dosage form, pack.'],
  ['commercial_expectations', 'Commercial expectations', 'Price, margin, volume and timing the business expects.'],
  ['manufacturer_info', 'Manufacturer information', 'If already known.'],
  ['regulatory_route', 'Regulatory route', 'How the product will be registered or listed.'],
  ['stakeholders', 'Key stakeholders', 'Who must be kept informed or must decide.'],
]

function ClarificationCard({ c, onChange, off }) {
  const me = useMe()
  const can = useCan()
  const [note, setNote] = useState('')
  const { busy, error, run } = useDo()
  const sup = me.role_key === 'super_admin'
  const mayRespond = c.status === 'open' && (sup || me.id === c.responder?.id)
  const mayDecide = c.status === 'responded' && (sup || (me.id !== c.responder?.id && (me.id === c.requested_by.id || can('approve') || can('manage_project'))))
  const go = (action) => run(async () => { onChange(await api.clarifyAct(c.id, { action, note })); setNote('') })
  return (
    <article className={`clar clar-${c.status}`}>
      <header>
        <div className="t-title"><strong>{c.question}</strong>
          <small>Asked by {c.requested_by.name} · must answer: {c.responder?.name || '–'}{c.due_date && <> · by {fmtDay(c.due_date)}</>}</small></div>
        <span className="end">{c.overdue && <span className="age age-over">Overdue</span>}<span className={`dstate clar-s-${c.status}`}>{label(c.status === 'responded' ? 'answered' : c.status)}</span></span>
      </header>
      {c.response && <p className="clar-answer"><b>Response</b> {c.response}{c.responded_on && <small> · {fmtDate(c.responded_on)}</small>}</p>}
      {c.decision_note && <p className="clar-answer"><b>{c.status === 'accepted' ? 'Accepted' : 'Not accepted'}</b> {c.decision_note}</p>}
      {c.status === 'accepted' && <p className="muted">Accepted{c.decided_by ? ` by ${c.decided_by.name}` : ''}{c.decided_on ? ` · ${fmtDate(c.decided_on)}` : ''}</p>}
      {c.rounds > 0 && c.status !== 'accepted' && <p className="muted">Sent back {c.rounds}×</p>}
      {!off && (mayRespond || mayDecide) && (
        <>
          <label className="field">{mayRespond ? 'Your response' : 'Note'}{mayDecide && <small> (needed if the answer is not accepted)</small>}
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mayRespond ? 'Answer the question…' : 'Add a short comment…'} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {mayRespond && <button className="btn primary" disabled={busy} onClick={() => go('respond')}>Send response</button>}
            {mayDecide && <><button className="btn primary" disabled={busy} onClick={() => go('accept')}>Accept the answer</button>
              <button className="btn line" disabled={busy} onClick={() => go('reject')}>Not enough, ask again</button></>}
          </div>
        </>
      )}
      {c.status === 'responded' && !mayDecide && <p className="muted">Waiting for {c.requested_by.name} to accept the answer.</p>}
    </article>
  )
}

export default function BriefTab({ project, onChange }) {
  const me = useMe()
  const can = useCan()
  const stages = useStages()
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const off = ['rejected', 'completed'].includes(project.status)
  const authorRoles = ['opportunity', 'brief'].flatMap((k) => { const s = stages.find((x) => x.key === k); return s ? [...s.owner_roles, ...s.approver_roles] : [] })
  const mayEdit = !off && (can('manage_project') || authorRoles.includes(me.role_key) || me.role_key === 'super_admin')
  const open = project.clarifications.filter((c) => c.status !== 'accepted')

  const fields = [
    { key: 'potential_client', label: 'Customer / client', type: 'text', placeholder: 'e.g. ABC Pharmacy', half: true },
    { key: 'opportunity_value', label: 'Initial commercial opportunity (AUD)', type: 'text', placeholder: 'e.g. 250000', half: true },
    ...BRIEF.slice(1).map(([key, lab, hint]) => ({ key, label: lab, type: 'textarea', placeholder: hint })),
    { key: 'summary', label: 'Short summary', type: 'textarea' },
    { key: 'target_submission', label: 'Target submission', type: 'date', half: true },
    { key: 'target_launch', label: 'Target launch', type: 'date', half: true },
  ]
  return (
    <>
      <section className="panel">
        <header>
          <div><h3>Opportunity and project brief</h3><p className="muted">Australia creates the brief; India reviews it. What is still missing is raised below as a clarification.</p></div>
          {mayEdit && <button className="btn line" onClick={() => setEditing(true)}><Icon name="edit" size={15} />Edit brief</button>}
        </header>
        <dl className="brief">
          <div><dt>Product</dt><dd>{project.product || '–'}</dd></div>
          <div><dt>Market</dt><dd>{project.market}</dd></div>
          <div><dt>Product route</dt><dd>{project.project_type === 'In-Licence' ? 'In-licence' : 'New development'}</dd></div>
          <div><dt>Opportunity owner</dt><dd>{project.initiator || '–'}</dd></div>
          <div><dt>Initial commercial opportunity</dt><dd className="num">{project.opportunity_value != null ? `AUD ${project.opportunity_value.toLocaleString('en-AU')}` : '–'}</dd></div>
          <div><dt>Target launch</dt><dd className="num">{fmtDay(project.target_launch)}</dd></div>
          <div><dt>Target submission</dt><dd className="num">{fmtDay(project.target_submission)}</dd></div>
          {BRIEF.map(([key, lab]) => <div key={key} className="wide"><dt>{lab}</dt><dd>{project[key] || <span className="muted">Not provided</span>}</dd></div>)}
        </dl>
      </section>

      <section className="panel">
        <header>
          <div><h3>Clarifications</h3><p className="muted">Who asked, what is missing, who must answer, by when, what they said and whether it was accepted. The brief cannot be approved until all are accepted.</p></div>
          {!off && <button className="btn line" onClick={() => setAsking(true)}><Icon name="plus" size={16} />Ask for clarification</button>}
        </header>
        {open.length > 0 && <p className="notice soft">{open.length} open: the brief stage is held until {open.length > 1 ? 'they are' : 'it is'} accepted.</p>}
        {!project.clarifications.length && <Empty>Nothing has been asked. If the brief is missing information, ask here instead of sending a message.</Empty>}
        <div className="clars">{[...project.clarifications].reverse().map((c) => <ClarificationCard key={c.id} c={c} onChange={onChange} off={off} />)}</div>
      </section>

      {editing && (
        <FormModal title="Edit the brief" wide fields={fields}
          initial={{ ...project, opportunity_value: project.opportunity_value ?? '' }}
          onSave={async (d) => onChange(await api.updateProject(project.id, { ...d, opportunity_value: d.opportunity_value === '' || d.opportunity_value == null ? null : Number(d.opportunity_value) }))}
          onClose={() => setEditing(false)} />
      )}
      {asking && (
        <FormModal title="Ask for clarification" intro="The person you choose is notified. Their answer and your decision stay on the record."
          fields={[{ key: 'question', label: 'What exactly is missing?', type: 'textarea', required: true },
            { key: 'responder_id', label: 'Who must respond?', type: 'user', assignable: false, half: true },
            { key: 'due_date', label: 'By when?', type: 'date', half: true }]}
          onSave={async (d) => { if (!d.responder_id) throw new Error('Choose who must respond.'); onChange(await api.createClarification(project.id, d)) }}
          onClose={() => setAsking(false)} submitLabel="Ask" />
      )}
    </>
  )
}

