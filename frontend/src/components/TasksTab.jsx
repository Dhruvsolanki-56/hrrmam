import { useState } from 'react'
import { useCan, useStages } from '../context'
import { Empty, toast, useFocus } from './bits'
import Icon from './Icon'
import NewTaskModal from './NewTaskModal'
import TaskCard from './TaskCard'

export default function TasksTab({ project, onChange }) {
  const stages = useStages()
  const can = useCan()
  const focus = useFocus()
  const [stage, setStage] = useState('all')
  const [adding, setAdding] = useState(false)
  const withTasks = stages.filter((s) => project.tasks.some((t) => t.stage_key === s.key))
  const list = project.tasks.filter((t) => stage === 'all' || t.stage_key === stage)
  const open = list.filter((t) => t.open).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'))
  const done = list.filter((t) => !t.open)
  const closed = project.status === 'rejected' || project.status === 'completed'

  return (
    <section className="panel">
      <header className="tasks-head">
        <div>
          <h3>Tasks</h3>
          <p className="tasks-sum">{open.length} open · {done.length} finished{stage !== 'all' ? ` in ${stages.find((s) => s.key === stage)?.name}` : ''}</p>
        </div>
        <div className="tasks-tools">
          {withTasks.length > 1 && (
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Show tasks for one step">
              <option value="all">All steps ({project.tasks.length})</option>
              {withTasks.map((s) => <option key={s.key} value={s.key}>{s.name} ({project.tasks.filter((t) => t.stage_key === s.key).length})</option>)}
            </select>
          )}
          {can('assign') && !closed && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Assign a task</button>}
        </div>
      </header>
      {open.length > 0 && <div className="task-cols" aria-hidden="true"><span>Task</span><span>Owner</span><span>Due · status</span></div>}
      {!project.tasks.length && <Empty>No tasks yet. Assign work to people in the relevant workstream; each task is accepted, done, submitted and approved here.</Empty>}
      <div className="tasklist">
        {open.map((t) => <TaskCard key={t.id} task={t} project={project} onChanged={onChange} />)}
      </div>
      {done.length > 0 && (
        <details className="more" open={!open.length || done.some((t) => `task-${t.id}` === focus)}>
          <summary>{done.length} finished task{done.length > 1 ? 's' : ''}</summary>
          <div className="tasklist">{done.map((t) => <TaskCard key={t.id} task={t} project={project} onChanged={onChange} />)}</div>
        </details>
      )}
      {adding && <NewTaskModal project={project} stageKey={stage !== 'all' ? stage : undefined} onClose={() => setAdding(false)} onCreated={(p) => { setAdding(false); onChange(p); const t = [...p.tasks].sort((a, b) => b.id - a.id)[0]; if (t) toast(`Assigned to ${t.assignee.name} (${t.assignee.role}). They have been notified and it is on their My work list. They must accept it first.`) }} />}
    </section>
  )
}
