const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request(path, options) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Something went wrong')
  }
  return res.json()
}

export const api = {
  stages: () => request('/stages'),
  projects: () => request('/projects'),
  project: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  act: (id, data) => request(`/projects/${id}/actions`, { method: 'POST', body: JSON.stringify(data) }),
}
