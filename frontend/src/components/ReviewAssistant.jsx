import { useEffect, useState } from 'react'
import { api } from '../api'
import { useMe } from '../context'
import { fmtDay, label } from './bits'
import FormModal from './FormModal'
import Icon from './Icon'

const LEVEL = { high: 'High attention', medium: 'Attention', info: 'Check manually', low: 'Low' }

function Decision({ f, project, canDecide, onDone }) {
  const [open, setOpen] = useState(false)
  if (f.decision) return <small className="muted">{label(f.decision.decision)} by {f.decision.by}: “{f.decision.note}”</small>
  if (!canDecide) return <small className="muted">Waiting for a Regulatory reviewer</small>
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>Record decision</button>
      {open && (
        <FormModal title="Record your decision" intro="The assistant only points things out. You decide, and your note stays on the record."
          fields={[{ key: 'decision', label: 'Decision', type: 'select', required: true, options: [['acknowledged', 'Acknowledged: will act on it'], ['dismissed', 'Dismissed: not an issue']] },
            { key: 'note', label: 'Why?', type: 'textarea', required: true }]}
          initial={{ decision: 'acknowledged' }}
          onSave={async (d) => onDone(await api.reviewDecision(project.id, { key: f.key, ...d }))} onClose={() => setOpen(false)} submitLabel="Record" />
      )}
    </>
  )
}

/** Completeness, limit review and RFI risk. Rule based, shows its evidence, never certifies anything. */
export default function ReviewAssistant({ project }) {
  const me = useMe()
  const [r, setR] = useState(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => { api.review(project.id).then(setR).catch(() => setR(null)) }, [project.id, project.submissions.length, project.dossier_items.map((i) => i.status).join()])
  if (!r) return null
  const canDecide = ['regulatory', 'super_admin', 'project_manager', 'director'].includes(me.role_key)
  const closed = ['rejected', 'completed'].includes(project.status)
  return (
    <section className="panel review">
      <header>
        <div><h3>Regulatory review assistant</h3></div>
        {!closed && <button className="btn line" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Record a dossier value</button>}
      </header>
      <p className="rv-note">A second pair of eyes. It never certifies compliance: a Regulatory reviewer decides on every finding.</p>

      <h4>Dossier completeness</h4>
      {!r.completeness.length && <p className="muted">Choose the submission type to see what is expected.</p>}
      <ul className="rv-chips">
        {r.completeness.map((c) => (
          <li key={c.module || 'list'} className={`rv-${c.status}`} title={c.text}>
            <b>{c.module || c.title}</b>
            <span>{c.status === 'complete' ? '✓' : c.status === 'not_applicable' ? 'Not applicable' : c.text}</span>
          </li>
        ))}
      </ul>
      {r.completeness.filter((c) => c.missing.length > 0).map((c) => (
        <p key={c.module || 'list'} className="rv-missing-line"><b>{c.module ? `${c.module} · ` : ''}{c.title}:</b> {c.missing.join(' · ')}</p>
      ))}

      <h4>Limit review against the controlled reference</h4>
      {!r.values.length && <p className="muted">No values recorded yet. Record a number from the dossier and it is compared with Neo's approved reference limits.</p>}
      {r.limits.length === 0 && r.values.length > 0 && <p className="muted">{r.values.length} recorded value{r.values.length > 1 ? 's are' : ' is'} within the reference limits.</p>}
      <ul className="rv-finds">
        {r.limits.map((f) => (
          <li key={f.key} className={`rv-${f.level}`}>
            <div className="rv-top"><span><b>{LEVEL[f.level]}</b> · {f.parameter} {f.value}</span><span className="rv-where">{f.module || 'No module'} · {f.page || 'no page'}</span></div>
            <p>{f.reason}</p>
            <small>Reference: {f.reference}{f.reference_date && <> · dated {fmtDay(f.reference_date)}</>}</small>
            <Decision f={f} project={project} canDecide={canDecide} onDone={setR} />
          </li>
        ))}
      </ul>

      <h4>RFI risk before submission</h4>
      {!r.risks.length && <p className="muted">No obvious RFI risk found from what is recorded. This is not a guarantee.</p>}
      <ul className="rv-finds">
        {r.risks.map((f) => (
          <li key={f.key} className={`rv-${f.level}`}>
            <div className="rv-top"><span><b>{LEVEL[f.level]}</b> · {f.module} · {f.section}</span><span className="rv-where">{f.result}</span></div>
            <p>{f.reasons.join(' · ')}</p>
            <Decision f={f} project={project} canDecide={canDecide} onDone={setR} />
          </li>
        ))}
      </ul>

      {adding && (
        <FormModal title="Record a dossier value" intro="Read a number from the dossier and note where it is. It is compared with the controlled reference material."
          fields={[{ key: 'parameter', label: 'Parameter', type: 'text', required: true, placeholder: 'e.g. Impurity X' },
            { key: 'value', label: 'Value', type: 'text', required: true, half: true, placeholder: 'e.g. 0.50' },
            { key: 'unit', label: 'Unit', type: 'text', half: true, placeholder: '%' },
            { key: 'module', label: 'Module', type: 'select', half: true, blank: 'No module', options: ['M1', 'M2', 'M3', 'M4', 'M5'].map((m) => [m, m]) },
            { key: 'page', label: 'Dossier page', type: 'text', half: true, placeholder: 'p. 42' }]}
          initial={{ module: 'M3', unit: '%' }}
          onSave={async (d) => { const n = Number(d.value); if (!Number.isFinite(n)) throw new Error('Enter the value as a number.'); setR(await api.addValue(project.id, { ...d, value: n })) }}
          onClose={() => setAdding(false)} submitLabel="Record" />
      )}
    </section>
  )
}
