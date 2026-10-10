import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import FormModal from '../components/FormModal'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { Empty, fmtDate, label } from '../components/bits'
import { useCan, useConfig } from '../context'

export const WF_STATUS = { published: 'Live', draft: 'Draft', archived: 'Archived' }
export const WfPill = ({ status }) => <span className={`wfpill wf-${status}`}>{WF_STATUS[status] || label(status)}</span>

export default function Workflows() {
  const can = useCan()
  const config = useConfig()
  const nav = useNavigate()
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const load = useCallback(() => api.workflows().then(setList).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const manage = can('manage_workflow')

  const source = [...config.presets.map((p) => [`preset:${p.key}`, `Preset: ${p.name}`]), ...(list || []).map((w) => [`copy:${w.id}`, `Copy of: ${w.name}${w.version ? ` (v${w.version})` : ' (draft)'}`])]

  return (
    <Layout title="Workflows" subtitle="The process every project follows: stages, what can run in parallel, and who approves each entry"
      actions={manage && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />New draft</button>}>
      <section className="panel callout">
        <h3>How this works</h3>
        <p className="muted">A workflow is the agreed process. Create a draft, adjust the stages and approval rules, then share its review link with the team or the client to collect feedback.
          Publishing makes it the process for <b>new</b> projects; projects already running keep the version they started on.</p>
      </section>
      {error && <p className="error">{error}</p>}
      {!list && !error && <Empty>Loading…</Empty>}
      <div className="wf-grid">
        {list?.map((w) => (
          <Link key={w.id} to={`/workflows/${w.id}`} className={`panel wf-card wf-card-${w.status}`}>
            <header><WfPill status={w.status} />{w.version ? <span className="chip plain">v{w.version}</span> : null}</header>
            <h3>{w.name}</h3>
            <p className="muted">{w.description || w.based_on}</p>
            <dl className="wf-facts">
              <div><dt>Stages</dt><dd>{w.stage_count}</dd></div>
              <div><dt>Parallel steps</dt><dd>{w.parallel_layers}</dd></div>
              <div><dt>Projects</dt><dd>{w.projects}</dd></div>
              <div><dt>Open feedback</dt><dd>{w.feedback_open}</dd></div>
            </dl>
            <small className="muted">{w.published_at ? `Published ${fmtDate(w.published_at)}` : `Updated ${fmtDate(w.updated_at || w.created_at)}`} · {w.created_by}</small>
          </Link>
        ))}
      </div>
      {creating && (
        <FormModal title="New workflow draft" intro="Start from a preset or copy an existing workflow. Nothing changes for running projects until a draft is published."
          fields={[
            { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Option C: client review' },
            { key: 'source', label: 'Start from', type: 'select', required: true, options: source },
            { key: 'description', label: 'Description', type: 'textarea', placeholder: 'What is different about this option?' },
          ]}
          initial={{ source: source[0]?.[0] }} submitLabel="Create draft"
          onSave={async (d) => {
            const [kind, ref] = d.source.split(':')
            const w = await api.createWorkflow({ name: d.name, description: d.description, ...(kind === 'preset' ? { preset: ref } : { from_id: Number(ref) }) })
            nav(`/workflows/${w.id}`)
          }}
          onClose={() => setCreating(false)} />
      )}
    </Layout>
  )
}
