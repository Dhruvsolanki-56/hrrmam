import { useState } from 'react'
import { useCan, useStages } from '../context'
import { Empty, Tabs } from './bits'
import Icon from './Icon'
import NewTaskModal from './NewTaskModal'
import TaskCard from './TaskCard'

export default function TasksTab({ project, onChange }) {
  const stages = useStages()
  const can = useCan()
  const [stage, setStage] = useState('all')
  const [adding, setAdding] = useState(false)
  const withTasks = stages.filter((s) => project.tasks.some((t) => t.stage_key === s.key))
  const list = project.tasks.filter((t) => stage === 'all' || t.stage_key === stage)
  const open = list.filter((t) => t.open).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'))
  const done = list.filter((t) => !t.open)
  const closed = project.status === 'rejected' || project.status === 'completed'

  return (
    <section className="panel">
      <header>
        <h3>Tasks</h3>
        {can('assign') && !closed && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Assign a task</button>}
      </header>
      {withTasks.length > 1 && (
        <Tabs value={stage} onChange={setStage}
          tabs={[{ key: 'all', label: 'All', count: project.tasks.length }, ...withTasks.map((s) => ({ key: s.key, label: s.name, count: project.tasks.filter((t) => t.stage_key === s.key).length }))]} />
      )}
      {!project.tasks.length && <Empty>No tasks yet. Assign work to people in the relevant workstream; each task is accepted, done, submitted and approved here.</Empty>}
      <div className="tasklist">
        {open.map((t) => <TaskCard key={t.id} task={t} onChanged={onChange} />)}
      </div>
      {done.length > 0 && (
        <details className="more" open={!open.length}>
          <summary>{done.length} finished task{done.length > 1 ? 's' : ''}</summary>
          <div className="tasklist">{done.map((t) => <TaskCard key={t.id} task={t} onChanged={onChange} />)}</div>
        </details>
      )}
      {adding && <NewTaskModal project={project} stageKey={stage !== 'all' ? stage : undefined} onClose={() => setAdding(false)} onCreated={(p) => { setAdding(false); onChange(p) }} />}
    </section>
  )
}
