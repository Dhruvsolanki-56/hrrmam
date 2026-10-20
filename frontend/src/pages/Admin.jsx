import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import FormModal from '../components/FormModal'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { Avatar, Tabs, fmtDateTime, label, useDo } from '../components/bits'
import { useApp, useConfig } from '../context'

function Users() {
  const config = useConfig()
  const { refreshMe } = useApp()
  const [users, setUsers] = useState(null)
  const [adding, setAdding] = useState(false)
  const { error, run } = useDo()
  const load = useCallback(() => api.users(true).then(setUsers), [])
  useEffect(() => { load() }, [load])
  const save = (id, d) => run(async () => { await api.updateUser(id, d); await load(); refreshMe() })
  return (
    <section className="panel">
      <header><div><h3>Users</h3><p className="muted">Each person has one role. The role decides what they can do; the server enforces it.</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add user</button></header>
      {error && <p className="error">{error}</p>}
      <div className="table-scroll"><table className="table compact">
        <thead><tr><th>Person</th><th>Role</th><th>Country</th><th>Active</th></tr></thead>
        <tbody>
          {(users || []).map((u) => (
            <tr key={u.id} className={u.active ? '' : 'row-off'}>
              <td className="u-person"><span className="person"><Avatar name={u.name} /><span><b>{u.name}</b><small>{u.email || 'no email'}</small></span></span></td>
              <td data-label="Role"><select value={u.role_key} onChange={(e) => save(u.id, { role_key: e.target.value })} aria-label={`Role for ${u.name}`}>
                {config.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></td>
              <td data-label="Country"><select value={u.country} onChange={(e) => save(u.id, { country: e.target.value })} aria-label={`Country for ${u.name}`}>
                <option value="AU">Neo Health Australia</option><option value="IN">Neo India</option><option value="Partner">Manufacturing partner</option></select></td>
              <td className="u-active"><label className="switch"><input type="checkbox" checked={u.active} onChange={(e) => save(u.id, { active: e.target.checked })} aria-label={`${u.name} active`} /><i /></label></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {adding && (
        <FormModal title="Add user" fields={[
          { key: 'name', label: 'Name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email' },
          { key: 'role_key', label: 'Role', type: 'select', required: true, options: config.roles.map((r) => [r.key, r.name]), half: true },
          { key: 'country', label: 'Country', type: 'select', required: true, options: [['AU', 'Neo Health Australia'], ['IN', 'Neo India'], ['Partner', 'Manufacturing partner']], half: true }]}
          initial={{ role_key: 'project_manager', country: 'AU' }}
          onSave={async (d) => { await api.createUser(d); await load() }} onClose={() => setAdding(false)} submitLabel="Add user" />
      )}
    </section>
  )
}

const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort())

/** Every role and every permission in one grid: tick a box, press one Save. */
function Roles() {
  const config = useConfig()
  const { refreshMe } = useApp()
  const [roles, setRoles] = useState(null)
  const [draft, setDraft] = useState({})
  const [saved, setSaved] = useState(false)
  const { busy, error, run } = useDo()
  const load = useCallback(() => api.roles().then((r) => {
    setRoles(r)
    setDraft(Object.fromEntries(r.map((x) => [x.key, { p: new Set(x.permissions), a: new Set(x.assign_to) }])))
  }), [])
  useEffect(() => { load() }, [load])
  if (!roles) return null
  const perms = Object.entries(config.permissions)
  const locked = (r) => r.key === 'super_admin'
  const dirty = roles.filter((r) => !locked(r) && (!same(draft[r.key].p, r.permissions) || !same(draft[r.key].a, r.assign_to)))
  const flip = (key, part, v) => {
    setSaved(false)
    setDraft((d) => { const n = new Set(d[key][part]); n.has(v) ? n.delete(v) : n.add(v); return { ...d, [key]: { ...d[key], [part]: n } } })
  }
  const save = () => run(async () => {
    for (const r of dirty) await api.updateRole(r.key, { permissions: [...draft[r.key].p], assign_to: [...draft[r.key].a] })
    setSaved(true); await load(); refreshMe()
  })
  return (
    <section className="panel">
      <header>
        <div><h3>Who can do what</h3><p className="muted">Tick what each role may do. Super Admin always can. Changes apply when you save and are logged.</p></div>
        <button className="btn primary" disabled={busy || !dirty.length} onClick={save}>{saved && !dirty.length ? 'Saved' : dirty.length ? `Save ${dirty.length} change${dirty.length > 1 ? 's' : ''}` : 'Save'}</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="table-scroll"><table className="table matrix">
        <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.key} title={`${r.users} active user${r.users === 1 ? '' : 's'}`}>{r.name}</th>)}</tr></thead>
        <tbody>
          {perms.map(([k, desc]) => (
            <tr key={k}>
              <th scope="row" title={desc}>{label(k)}</th>
              {roles.map((r) => (
                <td key={r.key}><input type="checkbox" aria-label={`${r.name}: ${label(k)}`} checked={locked(r) || draft[r.key].p.has(k)} disabled={locked(r)} onChange={() => flip(r.key, 'p', k)} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table></div>
      <details className="more">
        <summary>Who can assign work to whom</summary>
        <div className="table-scroll"><table className="table matrix">
          <thead><tr><th>Can assign to →</th><th>Anyone</th>{roles.map((r) => <th key={r.key}>{r.name}</th>)}</tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.name}</th>
                <td><input type="checkbox" aria-label={`${r.name} can assign to anyone`} disabled={locked(r)} checked={locked(r) || draft[r.key].a.has('*')} onChange={() => flip(r.key, 'a', '*')} /></td>
                {roles.map((t) => (
                  <td key={t.key}>{t.key === r.key ? <span className="muted">–</span>
                    : <input type="checkbox" aria-label={`${r.name} can assign to ${t.name}`} disabled={locked(r) || draft[r.key].a.has('*')} checked={locked(r) || draft[r.key].a.has('*') || draft[r.key].a.has(t.key)} onChange={() => flip(r.key, 'a', t.key)} />}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></div>
      </details>
    </section>
  )
}

function Settings() {
  const [v, setV] = useState(null)
  const { busy, error, run } = useDo()
  const [saved, setSaved] = useState(false)
  useEffect(() => { api.settings().then(setV) }, [])
  if (!v) return null
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setSaved(false) }
  return (
    <section className="panel">
      <header><h3>Settings</h3></header>
      <div className="settings">
        <label className="field">Reminder days before a due date <small>comma-separated; 0 = due today (default 7,3,1,0)</small>
          <input value={v.reminder_days} onChange={set('reminder_days')} /></label>
        <label className="field">Escalate when overdue by (days) <small>notifies the assigner and project manager</small>
          <input value={v.escalate_after_days} onChange={set('escalate_after_days')} /></label>
        <label className="field">External submission platform <small>configurable until confirmed</small>
          <input value={v.submission_platform} onChange={set('submission_platform')} /></label>
        <label className="field">Manufacturer access model <small>to be confirmed: account / secure upload / internal entry</small>
          <input value={v.manufacturer_access} onChange={set('manufacturer_access')} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={() => run(async () => { setV(await api.putSettings(v)); setSaved(true) })}>{saved ? 'Saved' : 'Save settings'}</button>
    </section>
  )
}

function Log() {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.adminLog().then(setRows) }, [])
  return (
    <section className="panel">
      <header><h3>Admin changes</h3><span className="muted">Users, roles, permissions and settings</span></header>
      {rows && !rows.length && <p className="muted">No changes yet.</p>}
      <ul className="timeline">
        {(rows || []).map((e) => (<li key={e.id}><span className="dot" /><div><strong>{label(e.action)}</strong><p>{e.note}</p><small>{e.actor} · {fmtDateTime(e.created_at)}</small></div></li>))}
      </ul>
    </section>
  )
}

function References() {
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null)
  const load = () => api.referenceLimits().then(setRows)
  useEffect(() => { load() }, [])
  const fields = [
    { key: 'parameter', label: 'Parameter', type: 'text', required: true, placeholder: 'e.g. Impurity X' },
    { key: 'comparator', label: 'Rule', type: 'select', required: true, half: true, options: [['max', 'Must not exceed'], ['min', 'Must not be below']] },
    { key: 'limit_value', label: 'Limit', type: 'text', required: true, half: true },
    { key: 'unit', label: 'Unit', type: 'text', half: true },
    { key: 'reference_date', label: 'Reference dated', type: 'date', half: true },
    { key: 'source', label: 'Source', type: 'text', placeholder: 'e.g. ICH Q3B(R2)' },
    { key: 'active', label: 'In use', type: 'checkbox' },
  ]
  return (
    <section className="panel">
      <header><div><h3>Controlled reference material</h3><p className="muted">Limits the review assistant compares dossier values with. Only values listed here are checked; everything else is flagged for a manual look.</p></div>
        <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={16} />Add reference</button></header>
      <div className="table-scroll"><table className="table compact">
        <thead><tr><th>Parameter</th><th>Rule</th><th>Source</th><th>Dated</th><th>In use</th><th /></tr></thead>
        <tbody>{(rows || []).map((r) => (
          <tr key={r.id} className={r.active ? '' : 'row-off'}>
            <td><strong>{r.parameter}</strong></td><td data-label="Rule">{r.comparator === 'max' ? '≤' : '≥'} {r.limit_value} {r.unit}</td>
            <td data-label="Source">{r.source || '–'}</td><td data-label="Dated">{r.reference_date || '–'}</td><td data-label="In use">{r.active ? 'Yes' : 'No'}</td>
            <td><button className="link" onClick={() => setEdit(r)}>Edit</button></td>
          </tr>))}</tbody>
      </table></div>
      {edit && (
        <FormModal title={edit === 'new' ? 'Add reference' : `Edit ${edit.parameter}`} fields={fields}
          initial={edit === 'new' ? { comparator: 'max', unit: '%', active: true } : edit}
          onSave={async (d) => { const n = Number(d.limit_value); if (!Number.isFinite(n)) throw new Error('The limit must be a number.'); const body = { ...d, limit_value: n }
            edit === 'new' ? await api.createReference(body) : await api.updateReference(edit.id, body); load() }}
          onClose={() => setEdit(null)} />
      )}
    </section>
  )
}

export default function Admin() {
  const [tab, setTab] = useState('users')
  return (
    <Layout title="Admin" subtitle="Users, roles and permissions, reminder rules, and a log of every admin change">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Users' }, { key: 'roles', label: 'Roles & permissions' }, { key: 'settings', label: 'Settings' }, { key: 'refs', label: 'Reference material' }, { key: 'log', label: 'Admin log' }]} />
      {tab === 'users' && <Users />}
      {tab === 'roles' && <Roles />}
      {tab === 'settings' && <Settings />}
      {tab === 'refs' && <References />}
      {tab === 'log' && <Log />}
    </Layout>
  )
}
