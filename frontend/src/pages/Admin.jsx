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
              <td><span className="person"><Avatar name={u.name} /><span><b>{u.name}</b><small>{u.email || 'no email'}</small></span></span></td>
              <td><select value={u.role_key} onChange={(e) => save(u.id, { role_key: e.target.value })} aria-label={`Role for ${u.name}`}>
                {config.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></td>
              <td><select value={u.country} onChange={(e) => save(u.id, { country: e.target.value })} aria-label={`Country for ${u.name}`}>
                <option value="AU">Neo Health Australia</option><option value="IN">Neo India</option><option value="Partner">Manufacturing partner</option></select></td>
              <td><label className="switch"><input type="checkbox" checked={u.active} onChange={(e) => save(u.id, { active: e.target.checked })} aria-label={`${u.name} active`} /><i /></label></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {adding && (
        <FormModal title="Add user" fields={[
          { key: 'name', label: 'Name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'text' },
          { key: 'role_key', label: 'Role', type: 'select', required: true, options: config.roles.map((r) => [r.key, r.name]), half: true },
          { key: 'country', label: 'Country', type: 'select', required: true, options: [['AU', 'Neo Health Australia'], ['IN', 'Neo India'], ['Partner', 'Manufacturing partner']], half: true }]}
          initial={{ role_key: 'project_manager', country: 'AU' }}
          onSave={async (d) => { await api.createUser(d); await load() }} onClose={() => setAdding(false)} submitLabel="Add user" />
      )}
    </section>
  )
}

function RoleCard({ role, allRoles, perms, onSaved }) {
  const locked = role.key === 'super_admin'
  const [p, setP] = useState(new Set(role.permissions))
  const [a, setA] = useState(new Set(role.assign_to))
  const { busy, error, run } = useDo()
  const [saved, setSaved] = useState(false)
  const toggle = (set, setter, v) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n); setSaved(false) }
  const dirty = !locked && (JSON.stringify([...p].sort()) !== JSON.stringify([...role.permissions].sort()) || JSON.stringify([...a].sort()) !== JSON.stringify([...role.assign_to].sort()))
  return (
    <article className="panel role">
      <header><div><h3>{role.name}</h3><p className="muted">{role.users} active user{role.users === 1 ? '' : 's'}{locked && ' · always has every permission'}</p></div>
        {!locked && <button className="btn primary" disabled={busy || !dirty} onClick={() => run(async () => { await api.updateRole(role.key, { permissions: [...p], assign_to: [...a] }); setSaved(true); onSaved() })}>{saved ? 'Saved' : 'Save'}</button>}</header>
      <ul className="perm-list">
        {Object.entries(perms).map(([k, desc]) => (
          <li key={k}><label className="check"><input type="checkbox" checked={locked || p.has(k)} disabled={locked} onChange={() => toggle(p, setP, k)} /><span>{label(k)}<small>{desc}</small></span></label></li>
        ))}
      </ul>
      <div className="assign-scope">
        <b>Can assign work to</b>
        <div className="chips">
          <label className="chipcheck"><input type="checkbox" disabled={locked} checked={locked || a.has('*')} onChange={() => toggle(a, setA, '*')} />Anyone</label>
          {allRoles.filter((r) => r.key !== role.key).map((r) => (
            <label key={r.key} className="chipcheck"><input type="checkbox" disabled={locked || a.has('*')} checked={locked || a.has('*') || a.has(r.key)} onChange={() => toggle(a, setA, r.key)} />{r.name}</label>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </article>
  )
}

function Roles() {
  const config = useConfig()
  const { refreshMe } = useApp()
  const [roles, setRoles] = useState(null)
  const load = useCallback(() => api.roles().then(setRoles), [])
  useEffect(() => { load() }, [load])
  if (!roles) return null
  return (
    <>
      <p className="notice">Super Admin decides who can assign, reassign, approve, request changes, bypass optional work, change dates, lock / unlock and edit approved records. Changes apply immediately and are logged.</p>
      <div className="roles-grid">{roles.map((r) => <RoleCard key={r.key} role={r} allRoles={roles} perms={config.permissions} onSaved={() => { load(); refreshMe() }} />)}</div>
    </>
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

export default function Admin() {
  const [tab, setTab] = useState('users')
  return (
    <Layout title="Admin" subtitle="Users, roles and permissions, reminder rules, and a log of every admin change">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Users' }, { key: 'roles', label: 'Roles & permissions' }, { key: 'settings', label: 'Settings' }, { key: 'log', label: 'Admin log' }]} />
      {tab === 'users' && <Users />}
      {tab === 'roles' && <Roles />}
      {tab === 'settings' && <Settings />}
      {tab === 'log' && <Log />}
    </Layout>
  )
}
