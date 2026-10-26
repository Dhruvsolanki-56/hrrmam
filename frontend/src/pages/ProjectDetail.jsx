import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import ActionPanel, { StepPanel } from '../components/ActionPanel'
import BriefTab from '../components/Brief'
import ReopenPanel from '../components/Reopen'
import DocList from '../components/DocCard'
import FormModal from '../components/FormModal'
import Icon from '../components/Icon'
import { FactsCard, HealthCard, Journey, TurnCard } from '../components/ProjectJourney'
import { ProjectTour } from '../components/Tour'
import Layout from '../components/Layout'
import NewProjectModal from '../components/NewProjectModal'
import TasksTab from '../components/TasksTab'
import Timeline from '../components/Timeline'
import { LegalTab, ManufacturerTab, RegulatoryTab, RfiTab } from '../components/Workstreams'
import { AgeChip, HealthPill, StatusPill, Tabs, label, useDo, Skeleton } from '../components/bits'
import { FlowScope, useCan, useStages } from '../context'

const AREAS = ['all', 'stage', 'task', 'clarification', 'legal', 'dossier', 'artwork', 'manufacturer', 'rfi', 'document', 'project']

export default function ProjectDetail() {
  const { id } = useParams()
  const can = useCan()
  const [params, setParams] = useSearchParams()
  // unknown or old tab names in a link fall back to a real tab instead of an empty page
  const TAB_KEYS = ['overview', 'brief', 'tasks', 'legal', 'regulatory', 'artwork', 'manufacturer', 'quality', 'rfi', 'documents', 'activity']
  const asked = params.get('tab') === 'history' ? 'activity' : params.get('tab')
  const tab = TAB_KEYS.includes(asked) ? asked : 'overview'
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [blocker, setBlocker] = useState(false)
  const [area, setArea] = useState('all')
  const [confirmClear, setConfirmClear] = useState(false)
  const clearing = useDo()

  useEffect(() => { api.project(id).then(setProject).catch((e) => setError(e.message)) }, [id])
  const step = params.get('step')
  const focus = params.get('focus')
  useEffect(() => {
    if (!step || !project) return undefined
    const t = setTimeout(() => document.getElementById('step-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    return () => clearTimeout(t)
  }, [!!project]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus || !project) return undefined
    let tries = 0
    const find = () => {
      const el = document.getElementById(focus)
      if (el) {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' })  // lands below the sticky bar (scroll-margin-top)
        el.classList.add('focus-flash')
        setTimeout(() => el.classList.remove('focus-flash'), 3200)
      } else if (tries++ < 20) { timer = setTimeout(find, 80) }
    }
    let timer = setTimeout(find, 40)
    return () => clearTimeout(timer)
  }, [focus, tab, !!project]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (k) => {
    const n = new URLSearchParams(params); n.set('tab', 'overview'); n.set('step', k); setParams(n, { replace: true })
    setTimeout(() => document.getElementById('step-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const unpick = () => { const n = new URLSearchParams(params); n.delete('step'); setParams(n, { replace: true }) }
  const goTab = (t) => { const n = new URLSearchParams(params); n.set('tab', t); n.delete('step'); setParams(n, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (error) return <Layout title="Project" back="/projects"><p className="error">{error}</p></Layout>
  if (!project) return <Layout title="Project" back="/projects"><Skeleton rows={3} /><Skeleton rows={5} /></Layout>

  const openTasks = project.tasks.filter((t) => t.open).length
  const openRfi = project.rfis.filter((r) => r.status !== 'closed').length
  const openClar = project.clarifications.filter((c) => c.status !== 'accepted').length
  const hasQuality = project.flow.stages.some((s) => s.key === 'quality')
  const nonArt = project.documents.filter((d) => !d.is_artwork).length
  const events = area === 'all' ? project.events : project.events.filter((e) => e.area === area)
  const manage = can('manage_project')
  const bEv = project.critical_blocker ? [...project.events].reverse().find((e) => e.area === 'project' && e.action === 'edit' && /Critical blocker:/.test(e.note)) : null
  const canClear = manage && !['rejected', 'completed'].includes(project.status)
  const clear = () => clearing.run(async () => { setProject(await api.updateProject(project.id, { critical_blocker: '' })); setConfirmClear(false) })
  const tabStage = tab === 'tasks' || tab === 'overview' ? null : project.flow.stages.find((s) => s.tab === tab) || project.flow.stages.find((s) => s.key === tab)

  const editable = manage && project.status !== 'rejected' && project.status !== 'completed'

  return (
    <FlowScope stages={project.flow.stages}>
    <Layout title={project.name} back="/projects" head={false}>
      <section className="proj-card">
        <div className="proj-title">
          <h1>{project.name}</h1>
          {editable && <button className="btn line" onClick={() => setEditing(true)}><Icon name="edit" size={15} /><span className="hide-m">Edit details</span></button>}
        </div>
        <div className="meta">
          <StatusPill status={project.status} />
          {!['completed', 'rejected'].includes(project.status) && <HealthPill health={project.health} reasons={project.health_reasons} />}
          <AgeChip project={project} />
          <span className="code">{project.code || 'Code issued when the opportunity is approved'}</span>
        </div>
        {project.summary && <p className="summary" title={project.summary}>{project.summary}</p>}
        <Tabs value={tab} onChange={goTab} tabs={[
          { key: 'overview', label: 'Overview' }, { key: 'brief', label: 'Brief', count: openClar || null }, { key: 'tasks', label: 'Tasks', count: openTasks || null },
          { sep: 'Workstreams' },
          { key: 'legal', label: 'Legal' }, { key: 'regulatory', label: 'Regulatory' }, { key: 'artwork', label: 'Artwork' },
          { key: 'manufacturer', label: 'Manufacturer' }, ...(hasQuality ? [{ key: 'quality', label: 'Quality / PV' }] : []), { key: 'rfi', label: 'RFI', count: openRfi || null },
          { sep: 'Records' },
          { key: 'documents', label: 'Documents', count: nonArt || null }, { key: 'activity', label: 'History' },
        ]} />
      </section>

      <div className={`proj-grid ${tab === 'overview' ? '' : 'one-col'}`}>
        <div className="proj-main">
          {project.critical_blocker && tab !== 'overview' && (
            <p className="blocker-mini" role="note"><b>Critical blocker:</b> {project.critical_blocker} <button className="link" onClick={() => goTab('overview')}>Details</button></p>
          )}
          {tabStage && <StepPanel project={project} stageKey={tabStage.key} onChange={setProject} goTab={goTab} inTab />}
          {tab === 'overview' && (
            <>
              <Journey project={project} onPick={pick} />
              {step && <div id="step-panel"><StepPanel project={project} stageKey={step} onChange={setProject} goTab={goTab} onClose={unpick} /></div>}
              <ActionPanel project={project} onChange={setProject} goTab={goTab} skip={step} onPick={pick} noTurn />
              <ReopenPanel project={project} onChange={setProject} />
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
              <header className="tasks-head">
                <div><h3>History</h3><p className="tasks-sum">{events.length} of {project.events.length} entries · nothing is ever overwritten</p></div>
                <div className="tasks-tools">
                  <select className="select" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Show history for one area">
                    {AREAS.map((a) => <option key={a} value={a}>{a === 'all' ? 'Everything' : label(a)}</option>)}
                  </select>
                </div>
              </header>
              <Timeline events={events} />
            </section>
          )}
        </div>

        {tab === 'overview' && (
          <aside className="ov-side" aria-label="Your turn, health and key facts">
            <TurnCard project={project} onPick={pick} goTab={goTab} />
            <HealthCard project={project} blockerEvent={bEv} canClear={canClear} confirmClear={confirmClear} setConfirmClear={setConfirmClear}
              clear={clear} clearing={clearing} onReport={() => setBlocker(true)} />
            <FactsCard project={project} onBrief={() => goTab('brief')} />
          </aside>
        )}
      </div>

      {tab === 'overview' && !step && <ProjectTour />}
      {editing && <NewProjectModal project={project} onClose={() => setEditing(false)} onCreated={(p) => { setProject(p); setEditing(false) }} />}
      {blocker && (
        <FormModal title="Critical blocker" intro="Anything that stops the project moving. It turns the project's health red and shows a banner on the Overview tab. When it is fixed, use Mark as resolved."
          fields={[{ key: 'critical_blocker', label: 'What is blocking the project?', type: 'textarea' }]} initial={project}
          onSave={async (d) => setProject(await api.updateProject(project.id, d))} onClose={() => setBlocker(false)} />
      )}
    </Layout>
    </FlowScope>
  )
}
