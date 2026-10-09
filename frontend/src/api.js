const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request(path, options) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const d = body.detail
    throw new Error(typeof d === 'string' ? d
      : Array.isArray(d) ? d.map((x) => (x.msg || '').replace(/^Value error, /, '')).filter(Boolean).join(' ') || 'Please check the details and try again.'
      : 'Something went wrong')
  }
  return res.json()
}

export const api = {
  stages: () => request('/stages'),
  projects: () => request('/projects'),
  project: (id) => request(`/projects/${id}`),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addLink: (id, data) => request(`/projects/${id}/links`, { method: 'POST', body: JSON.stringify(data) }),
  deleteLink: (id, linkId) => request(`/projects/${id}/links/${linkId}`, { method: 'DELETE' }),
  exportUrl: (params) => `${BASE}/api/export.xlsx?${new URLSearchParams(params)}`,
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  act: (id, data) => request(`/projects/${id}/actions`, { method: 'POST', body: JSON.stringify(data) }),
}
