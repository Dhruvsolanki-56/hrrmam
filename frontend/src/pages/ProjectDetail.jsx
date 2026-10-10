import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import ActionPanel from '../components/ActionPanel'
import DocList from '../components/DocCard'
import FormModal from '../components/FormModal'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import NewProjectModal from '../components/NewProjectModal'
import StageList from '../components/StageList'
import TasksTab from '../components/TasksTab'
import Timeline from '../components/Timeline'
import { LegalTab, ManufacturerTab, RegulatoryTab, RfiTab } from '../components/Workstreams'
import { AgeChip, HealthPill, Person, StageBar, StateChip, StatusPill, Tabs, fmtDate, fmtDay, label } from '../components/bits'
import { FlowScope, useCan, useStages } from '../context'

const AREAS = ['all', 'stage', 'task', 'legal', 'dossier', 'artwork', 'manufacturer', 'rfi', 'document', 'project']

function Workstreams({ project, goTab }) {
  const stages = useStages()
  const ws = stages.filter((s) => s.workstream)
  const ms = stages.find((s) => s.milestone)
  const milestone = ms && project.stages.find((r) => r.key === ms.key)
  if (!ws.length) return null
  return (
    <section className="panel">
      <header>
        <div><h3>Workstreams</h3><p className="muted">{ws.length} workstreams run in parallel, each with its own status and approval cycle.{ms && <> <b>{ms.name}</b> is the milestone lock: it needs all of them approved (or bypassed when optional).</>}</p></div>
        {milestone && <StateChip state={milestone.state} />}
      </header>
      <div className="ws-grid">
        {ws.map((s) => {
          const r = project.stages.find((x) => x.key === s.key)
          const tab = s.tab || 'tasks'
          return (
            <button key={s.key} className={`ws ws-${r.state}`} onClick={() => goTab(tab)}>
              <b>{s.name}</b>
              <StateChip state={r.state} locked={r.locked} />
              <small>{r.tasks_total ? `${r.tasks_done}/${r.tasks_total} tasks approved` : 'No tasks yet'}</small>
              {r.blockers.length > 0 && <small className="ws-block">{r.blockers.length} thing{r.blockers.length > 1 ? 's' : ''} to finish</small>}
              {r.rework_count > 0 && <small>↺ sent back {r.rework_count}×</small>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'overview'
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [blocker, setBlocker] = useState(false)
  const [area, setArea] = useState('all')

  useEffect(() => { api.project(id).then(setProject).catch((e) => setError(e.message)) }, [id])
  const goTab = (t) => { const n = new URLSearchParams(params); n.set('tab', t); setParams(n, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (error) return <Layout title="Project" back="/projects"><p className="error">{error}</p></Layout>
  if (!project) return <Layout title="Project" back="/projects" />

  const openTasks = project.tasks.filter((t) => t.open).length
  const openRfi = project.rfis.filter((r) => r.status !== 'closed').length
  const nonArt = project.documents.filter((d) => !d.is_artwork).length
  const events = area === 'all' ? project.events : project.events.filter((e) => e.area === area)
  const manage = can('manage_project')

  const done = Object.values(project.stage_states).filter((x) => x === 'approved' || x === 'bypassed').length
  const activeNames = project.stages.filter((r) => ['in_progress', 'awaiting_approval'].includes(r.state)).map((r) => project.flow.stages.find((s) => s.key === r.key)?.name).filter(Boolean)
  const editable = manage && project.status !== 'rejected' && project.status !== 'completed'

  return (
    <FlowScope stages={project.flow.stages}>
    <Layout title={project.name} back="/projects" head={false}>
      <div className="proj-head">
        <div className="meta">
          <span className="code">{project.code || 'Code issued at brief approval'}</span>
          <StatusPill status={project.status} />
          <HealthPill health={project.health} reasons={project.health_reasons} />
          <AgeChip project={project} />
        </div>
        <div className="proj-title">
          <h1>{project.name}</h1>
          {editable && <button className="btn line" onClick={() => setEditing(true)}><Icon name="edit" size={15} /><span className="hide-m">Edit details</span></button>}
        </div>
        {project.summary && <p className="summary">{project.summary}</p>}
        <div className="journey">
          <div className="journey-top">
            <span><b>{done} of {project.flow.stages.length}</b> stages approved</span>
            <span className="journey-now">{activeNames.length ? `Now: ${activeNames.join(', ')}` : project.status === 'completed' ? 'Complete' : ''}</span>
          </div>
          <StageBar project={project} big />
        </div>
      </div>

      <div className="proj-grid">
        <div className="proj-main">
          <Tabs value={tab} onChange={goTab} tabs={[
            { key: 'overview', label: 'Overview' }, { key: 'tasks', label: 'Tasks', count: openTasks || null },
            { key: 'legal', label: 'Legal' }, { key: 'regulatory', label: 'Regulatory' }, { key: 'artwork', label: 'Artwork' },
            { key: 'manufacturer', label: 'Manufacturer data' }, { key: 'rfi', label: 'RFI', count: openRfi || null },
            { key: 'documents', label: 'Documents', count: nonArt || null }, { key: 'activity', label: 'History' },
          ]} />

          {tab === 'overview' && (
            <>
              <Workstreams project={project} goTab={goTab} />
              <ActionPanel project={project} onChange={setProject} goTab={goTab} />
              <section className="panel">
                <header><h3>Project journey</h3><span className="muted">{project.flow.stages.length} phases · {project.workflow?.name}{project.workflow?.version ? ` v${project.workflow.version}` : ""}</span></header>
                <StageList project={project} />
              </section>
            </>
          )}
          {tab === 'tasks' && <TasksTab project={project} onChange={setProject} />}
          {tab === 'legal' && <LegalTab project={project} onChange={setProject} />}
          {tab === 'regulatory' && <RegulatoryTab project={project} onChange={setProject} />}
          {tab === 'artwork' && <DocList project={project} onChange={setProject} artwork />}
          {tab === 'manufacturer' && <ManufacturerTab project={project} onChange={setProject} />}
          {tab === 'rfi' && <RfiTab project={project} onChange={setProject} />}
          {tab === 'documents' && <DocList project={project} onChange={setProject} />}
          {tab === 'activity' && (
            <section className="panel">
              <header><h3>History</h3><span className="muted">{project.events.length} entries · nothing is overwritten</span></header>
              <Tabs value={area} onChange={setArea} tabs={AREAS.map((a) => ({ key: a, label: a === 'all' ? 'All' : label(a) }))} />
              <Timeline events={events} />
            </section>
          )}
        </div>

        <aside className="props" aria-label="Project details">
          <div>
            <h3>Details</h3>
            <dl className="p360">
              <div><dt>Project code</dt><dd>{project.code ? <span className="code">{project.code}</span> : 'Pending'}</dd></div>
              <div><dt>Product</dt><dd>{project.product || '–'}</dd></div>
              <div><dt>Type</dt><dd>{project.project_type}{project.category && <small> · {project.category}</small>}</dd></div>
              <div><dt>Market</dt><dd>{project.market}</dd></div>
              <div><dt>Manager</dt><dd>{project.project_manager ? <Person user={project.project_manager} /> : '–'}</dd></div>
              <div><dt>Submission</dt><dd>{project.submission_type || 'To be decided'}</dd></div>
              <div><dt>Target submit</dt><dd className="num">{fmtDay(project.target_submission)}</dd></div>
              <div><dt>Target launch</dt><dd className="num">{fmtDay(project.target_launch)}</dd></div>
              <div><dt>Started</dt><dd className="num">{fmtDate(project.created_at)}{project.initiator && <small> · {project.initiator}</small>}</dd></div>
            </dl>
          </div>
          <div className={`blocker ${project.critical_blocker ? 'on' : ''}`}>
            <Icon name="alert" size={16} />
            <div><b>Critical blocker</b><span>{project.critical_blocker || 'None reported'}</span></div>
            {manage && !['rejected', 'completed'].includes(project.status) && <button className="link" onClick={() => setBlocker(true)}>{project.critical_blocker ? 'Update' : 'Report a blocker'}</button>}
          </div>
          {project.health_reasons.length > 0 && (
            <div className="reasons-box">
              <h3>Why it is {project.health === 'red' ? 'critical' : 'at risk'}</h3>
              <ul className="reasons">{project.health_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
        </aside>
      </div>

      {editing && <NewProjectModal project={project} onClose={() => setEditing(false)} onCreated={(p) => { setProject(p); setEditing(false) }} />}
      {blocker && (
        <FormModal title="Critical blocker" intro="Anything that stops the project moving. A blocker turns the project's health red until it is cleared (leave the box empty to clear it)."
          fields={[{ key: 'critical_blocker', label: 'What is blocking the project?', type: 'textarea' }]} initial={project}
          onSave={async (d) => setProject(await api.updateProject(project.id, d))} onClose={() => setBlocker(false)} />
      )}
    </Layout>
    </FlowScope>
  )
}
