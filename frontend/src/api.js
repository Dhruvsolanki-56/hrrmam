const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

// DEMO identity: the chosen user's id is sent with every request. Replace with real sign-in before production.
let uid = (() => { try { return localStorage.getItem('nh-uid') } catch { return null } })()
export const getUid = () => uid
export const setUid = (id) => {
  uid = id ? String(id) : null
  try { id ? localStorage.setItem('nh-uid', String(id)) : localStorage.removeItem('nh-uid') } catch { /* private mode */ }
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(uid ? { 'X-User-Id': uid } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const d = data.detail
    const err = new Error(typeof d === 'string' ? d
      : Array.isArray(d) ? d.map((x) => (x.msg || '').replace(/^Value error, /, '')).filter(Boolean).join(' ') || 'Please check the details and try again.'
      : 'Something went wrong')
    err.status = res.status
    throw err
  }
  return res.json()
}

const qs = (params = {}) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  return p.toString() ? `?${p}` : ''
}
const post = (path, body) => request(path, { method: 'POST', body })
const patch = (path, body) => request(path, { method: 'PATCH', body })
const put = (path, body) => request(path, { method: 'PUT', body })
const file = (path, params) => `${BASE}/api${path}${qs({ ...params, uid })}`

export const api = {
  // public
  stages: () => request('/stages'),
  config: () => request('/config'),
  loginUsers: () => request('/login-users'),
  // identity & admin
  me: () => request('/me'),
  users: (all) => request(`/users${all ? '?all=true' : ''}`),
  createUser: (d) => post('/users', d),
  updateUser: (id, d) => patch(`/users/${id}`, d),
  roles: () => request('/roles'),
  updateRole: (key, d) => put(`/roles/${key}`, d),
  settings: () => request('/settings'),
  putSettings: (values) => put('/settings', { values }),
  adminLog: () => request('/admin-log'),
  notifications: () => request('/notifications'),
  markRead: (d) => post('/notifications/read', d),
  // portals & registers
  director: (entity) => request(`/dashboard/director${qs({ entity })}`),
  regulatory: () => request('/dashboard/regulatory'),
  artwork: () => request('/dashboard/artwork'),
  myWork: () => request('/my-work'),
  audit: (params) => request(`/audit${qs(params)}`),
  legalRegister: (params) => request(`/legal-register${qs(params)}`),
  legalExportUrl: (params) => file('/legal-register.xlsx', params),
  exportUrl: (params) => file('/export.xlsx', params),
  // projects
  projects: () => request('/projects'),
  project: (id) => request(`/projects/${id}`),
  createProject: (d) => post('/projects', d),
  updateProject: (id, d) => patch(`/projects/${id}`, d),
  act: (id, d) => post(`/projects/${id}/actions`, d),
  // tasks
  createTask: (pid, d) => post(`/projects/${pid}/tasks`, d),
  updateTask: (id, d) => patch(`/tasks/${id}`, d),
  taskAct: (id, d) => post(`/tasks/${id}/actions`, d),
  // modules
  createAgreement: (pid, d) => post(`/projects/${pid}/agreements`, d),
  updateAgreement: (id, d) => patch(`/agreements/${id}`, d),
  createDossierItem: (pid, d) => post(`/projects/${pid}/dossier-items`, d),
  updateDossierItem: (id, d) => patch(`/dossier-items/${id}`, d),
  recordSubmission: (pid, d) => post(`/projects/${pid}/submissions`, d),
  createMfr: (pid, d) => post(`/projects/${pid}/mfr`, d),
  updateMfr: (id, d) => patch(`/mfr/${id}`, d),
  createRfi: (pid, d) => post(`/projects/${pid}/rfis`, d),
  updateRfi: (id, d) => patch(`/rfis/${id}`, d),
  addQuestion: (rid, d) => post(`/rfis/${rid}/questions`, d),
  updateQuestion: (id, d) => patch(`/rfi-questions/${id}`, d),
  rfiAct: (rid, d) => post(`/rfis/${rid}/actions`, d),
  createDocument: (pid, d) => post(`/projects/${pid}/documents`, d),
  addVersion: (id, d) => post(`/documents/${id}/versions`, d),
  docAct: (id, d) => post(`/documents/${id}/actions`, d),
}
