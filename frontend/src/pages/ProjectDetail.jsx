import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import ActionPanel, { StepPanel } from '../components/ActionPanel'
import StepBar from '../components/StepBar'
import BriefTab from '../components/Brief'
import ReopenPanel from '../components/Reopen'
import DocList from '../components/DocCard'
import FormModal from '../components/FormModal'
import Icon from '../components/Icon'
import Lanes from '../components/Lanes'
import Layout from '../components/Layout'
import NewProjectModal from '../components/NewProjectModal'
import StageList from '../components/StageList'
import TasksTab from '../components/TasksTab'
import Timeline from '../components/Timeline'
import { LegalTab, ManufacturerTab, RegulatoryTab, RfiTab } from '../components/Workstreams'
import { AgeChip, HealthPill, Person, StatusPill, Tabs, fmtDate, fmtDateTime, fmtDay, label, useDo } from '../components/bits'
import { FlowScope, useCan, useStages } from '../context'

const AREAS = ['all', 'stage', 'task', 'clarification', 'legal', 'dossier', 'artwork', 'manufacturer', 'rfi', 'document', 'project']

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
  const [confirmClear, setConfirmClear] = useState(false)
  const [allSteps, setAllSteps] = useState(false)
  const clearing = useDo()

  useEffect(() => { api.project(id).then(setProject).catch((e) => setError(e.message)) }, [id])
  const step = params.get('step')
  const pick = (k) => {
    const n = new URLSearchParams(params); n.set('tab', 'overview'); n.set('step', k); setParams(n, { replace: true })
    setTimeout(() => document.getElementById('step-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const unpick = () => { const n = new URLSearchParams(params); n.delete('step'); setParams(n, { replace: true }) }
  const goTab = (t) => { const n = new URLSearchParams(params); n.set('tab', t); n.delete('step'); setParams(n, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (error) return <Layout title="Project" back="/projects"><p className="error">{error}</p></Layout>
  if (!project) return <Layout title="Project" back="/projects" />

  const openTasks = project.tasks.filter((t) => t.open).length
  const openRfi = project.rfis.filter((r) => r.status !== 'closed').length
  const openClar = project.clarifications.filter((c) => c.status !== 'accepted').length
  const hasQuality = project.flow.stages.some((s) => s.key === 'quality')
  const nonArt = project.documents.filter((d) => !d.is_artwork).length
  const events = area === 'all' ? project.events : project.events.filter((e) => e.area === area)
  const manage = can('manage_project')
  const bEv = project.critical_blocker ? [...project.events].reverse().find((e) => e.area === 'project' && e.action === 'edit' && /Critical blocker:/.test(e.note)) : null
  const pm = project.project_manager?.name
  const canClear = manage && !['rejected', 'completed'].includes(project.status)
  const clear = () => clearing.run(async () => { setProject(await api.updateProject(project.id, { critical_blocker: '' })); setConfirmClear(false) })
  const tabStage = tab === 'tasks' || tab === 'overview' ? null : project.flow.stages.find((s) => s.tab === tab) || project.flow.stages.find((s) => s.key === tab)

  const done = Object.values(project.stage_states).filter((x) => x === 'approved' || x === 'bypassed').length
  const activeNames = project.stages.filter((r) => ['in_progress', 'awaiting_approval'].includes(r.state)).map((r) => project.flow.stages.find((s) => s.key === r.key)?.name).filter(Boolean)
  const editable = manage && project.status !== 'rejected' && project.status !== 'completed'

  return (
    <FlowScope stages={project.flow.stages}>
    <Layout title={project.name} back="/projects" head={false}>
      <div className="proj-head">
        <div className="meta">
          <span className="code">{project.code || 'Code issued when the opportunity is approved'}</span>
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
            <span><b>{done} of {project.flow.stages.length}</b> steps done</span>
            <span className="journey-now" title={activeNames.join(', ')}>{activeNames.length > 2 ? `Now: ${activeNames.length} workstreams in progress` : activeNames.length ? `Now: ${activeNames.join(', ')}` : project.status === 'completed' ? 'Complete' : ''}</span>
          </div>
          <StepBar project={project} selected={step} onPick={pick} />
          <button className="link steps-toggle" aria-expanded={allSteps} onClick={() => setAllSteps(!allSteps)}>{allSteps ? "Hide the step names" : `Show all ${project.flow.stages.length} steps with their names`}</button>
          {allSteps && <div className="panel steps-all"><StageList project={project} selected={step} onPick={(k) => { setAllSteps(false); pick(k) }} /></div>}
        </div>
      </div>

      <div className="proj-grid">
        <div className="proj-main">
          {project.critical_blocker && (
            <div className="blocker-bar" role="alert">
              <div>
                <b>Critical blocker: {project.critical_blocker}</b>
                <small>{bEv ? `Reported by ${bEv.actor} on ${fmtDateTime(bEv.created_at)}. ` : ''}It keeps the project red until it is cleared.</small>
              </div>
              {canClear && !confirmClear && <button className="btn line" onClick={() => setConfirmClear(true)}>Mark as resolved</button>}
              {canClear && confirmClear && (
                <span className="blocker-confirm">Is this fixed?
                  <button className="btn primary" disabled={clearing.busy} onClick={clear}>Yes, clear it</button>
                  <button className="btn line" onClick={() => setConfirmClear(false)}>Not yet</button></span>
              )}
              {!canClear && <small>Only a project manager{pm ? ` (${pm})` : ''} or a Director can clear it.</small>}
              {clearing.error && <p className="error">{clearing.error}</p>}
            </div>
          )}
          <Tabs value={tab} onChange={goTab} tabs={[
            { key: 'overview', label: 'Overview' }, { key: 'brief', label: 'Brief', count: openClar || null }, { key: 'tasks', label: 'Tasks', count: openTasks || null },
            { key: 'legal', label: 'Legal' }, { key: 'regulatory', label: 'Regulatory' }, { key: 'artwork', label: 'Artwork' },
            { key: 'manufacturer', label: 'Manufacturer' }, ...(hasQuality ? [{ key: 'quality', label: 'Quality / PV' }] : []), { key: 'rfi', label: 'RFI', count: openRfi || null },
            { key: 'documents', label: 'Documents', count: nonArt || null }, { key: 'activity', label: 'History' },
          ]} />

          {tabStage && <StepPanel project={project} stageKey={tabStage.key} onChange={setProject} goTab={goTab} inTab />}
          {tab === 'overview' && (
            <>
              {step && <div id="step-panel"><StepPanel project={project} stageKey={step} onChange={setProject} goTab={goTab} onClose={unpick} /></div>}
              <ActionPanel project={project} onChange={setProject} goTab={goTab} skip={step} />
              <Lanes project={project} goTab={goTab} />
              <ReopenPanel project={project} onChange={setProject} />
              <section className="panel">
                <header><h3>Project journey</h3><span className="muted hide-m">{project.flow.stages.length} steps in {new Set(project.flow.stages.map((x) => x.phase)).size} phases · {project.workflow?.name}{project.workflow?.version ? ` v${project.workflow.version}` : ""}</span></header>
                <StageList project={project} selected={step} onPick={pick} />
              </section>
            </>
          )}
          {tab === 'brief' && <BriefTab project={project} onChange={setProject} />}
          {tab === 'quality' && <DocList project={project} onChange={setProject} stageKey="quality" title="Quality / PV documents" />}
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

        <aside className={`props ${tab === 'overview' ? '' : 'props-off'}`} aria-label="Project details">
          <div>
            <h3>Details</h3>
            <dl className="p360">
              <div><dt>Project code</dt><dd>{project.code ? <span className="code">{project.code}</span> : 'Pending'}</dd></div>
              <div><dt>Product</dt><dd>{project.product || '–'}</dd></div>
              <div><dt>Product route</dt><dd>{project.project_type === 'In-Licence' ? 'In-licence' : 'New development'}{project.category && <small> · {project.category}</small>}</dd></div>
              <div><dt>Client</dt><dd>{project.potential_client || '–'}</dd></div>
              <div><dt>Opportunity</dt><dd className="num">{project.opportunity_value != null ? `AUD ${project.opportunity_value.toLocaleString('en-AU')}` : '–'}</dd></div>
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
            {canClear && <button className="link" onClick={() => setBlocker(true)}>{project.critical_blocker ? 'Change the wording' : 'Report a blocker'}</button>}
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
        <FormModal title="Critical blocker" intro="Anything that stops the project moving. It turns the project's health red and shows a banner on every tab. When it is fixed, use Mark as resolved."
          fields={[{ key: 'critical_blocker', label: 'What is blocking the project?', type: 'textarea' }]} initial={project}
          onSave={async (d) => setProject(await api.updateProject(project.id, d))} onClose={() => setBlocker(false)} />
      )}
    </Layout>
    </FlowScope>
  )
}
