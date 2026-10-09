import { useState } from 'react'
import { api } from '../api'
import { useStages } from '../context'
import { Modal, UserSelect, fromInput, inDays, useDo } from './bits'

/** Assign a task: the assigner sets the due date and time; the assignee can accept or ask for another date. */
export default function NewTaskModal({ project, stageKey, onClose, onCreated }) {
  const stages = useStages()
  const { busy, error, run } = useDo()
  const open = stages.filter((s) => !['approved', 'bypassed'].includes(project.stage_states[s.key]))
  const [f, setF] = useState({ stage_key: stageKey || open[0]?.key || stages[0].key, title: '', description: '', assignee_id: null, due: inDays(7), required: true })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const submit = () => run(async () => {
    if (!f.assignee_id) throw new Error('Choose who to assign this to.')
    if (!f.due) throw new Error('Set a due date and time.')
    onCreated(await api.createTask(project.id, { stage_key: f.stage_key, title: f.title, description: f.description,
      assignee_id: f.assignee_id, due_at: fromInput(f.due), required: f.required }))
  })

  return (
    <Modal title="Assign a task" busy={busy} error={error} onClose={onClose} onSubmit={submit} submitLabel="Assign task"
      intro="The assignee can accept it or propose a different date with a reason. You then approve or reject the new date.">
      <label>Task <input value={f.title} onChange={set('title')} required minLength={2} autoFocus placeholder="e.g. Compile Module 3 (Quality)" /></label>
      <label>Details <textarea rows={2} value={f.description} onChange={set('description')} placeholder="What needs to be done, and what does done look like?" /></label>
      <div className="row2">
        <label>Workstream / stage
          <select value={f.stage_key} onChange={set('stage_key')}>{open.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select>
        </label>
        <label>Assign to
          <UserSelect value={f.assignee_id} onChange={(v) => setF({ ...f, assignee_id: v })} />
        </label>
      </div>
      <div className="row2">
        <label>Due date and time <input type="datetime-local" value={f.due} onChange={set('due')} required /></label>
        <label className="check"><input type="checkbox" checked={f.required} onChange={set('required')} />
          <span>Required<small>The stage cannot be submitted until required tasks are approved.</small></span>
        </label>
      </div>
    </Modal>
  )
}
