import { useState } from 'react'
import { Modal, UserSelect, useDo } from './bits'

/** A small config-driven form in a modal, so each module does not need its own.
 *  fields: [{ key, label, type: text|textarea|date|datetime|select|checkbox|user|url, options?: [[value, label]], placeholder, hint, required, half, roles }] */
export default function FormModal({ title, intro, fields, initial = {}, submitLabel = 'Save', onSave, onClose, wide }) {
  const [v, setV] = useState(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? (f.type === 'checkbox' ? false : '')])))
  const { busy, error, run } = useDo()
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }))

  const submit = () => run(async () => {
    const out = {}
    for (const f of fields) {
      let x = v[f.key]
      if (f.type === 'user') x = x ? Number(x) : null
      else if (['date', 'datetime'].includes(f.type)) x = x || null
      out[f.key] = x
    }
    await onSave(out)
    onClose()
  })

  const input = (f) => {
    const common = { id: `f-${f.key}`, required: f.required, placeholder: f.placeholder }
    switch (f.type) {
      case 'textarea': return <textarea rows={3} {...common} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} />
      case 'select': return (
        <select {...common} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)}>
          {!f.required && <option value="">{f.blank ?? '–'}</option>}
          {f.options.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
        </select>
      )
      case 'user': return <UserSelect value={v[f.key]} onChange={(x) => set(f.key, x)} roles={f.roles} assignable={f.assignable ?? false} />
      case 'checkbox': return <input type="checkbox" checked={!!v[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
      case 'date': return <input type="date" {...common} value={v[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />
      case 'datetime': return <input type="datetime-local" {...common} value={v[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />
      case 'url': return <input type="url" {...common} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} />
      default: return <input {...common} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} />
    }
  }

  // consecutive `half` fields share a row
  const rows = []
  fields.forEach((f) => {
    const last = rows[rows.length - 1]
    if (f.half && last && last.length === 1 && last[0].half) last.push(f)
    else rows.push([f])
  })

  return (
    <Modal title={title} intro={intro} busy={busy} error={error} onClose={onClose} onSubmit={submit} submitLabel={submitLabel} wide={wide}>
      {rows.map((r, i) => (
        <div key={i} className={r.length > 1 ? 'row2' : undefined}>
          {r.map((f) => (
            <label key={f.key} className={f.type === 'checkbox' ? 'check' : undefined} htmlFor={`f-${f.key}`}>
              {f.type === 'checkbox' ? <>{input(f)}<span>{f.label}{f.hint && <small>{f.hint}</small>}</span></>
                : <>{f.label}{f.hint && <small className="muted"> {f.hint}</small>}{input(f)}</>}
            </label>
          ))}
        </div>
      ))}
    </Modal>
  )
}
