import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'
import { Empty, Tabs } from '../components/bits'
import { useMe } from '../context'

const BUCKETS = [
  ['needs_decision', 'Needs my decision'], ['overdue', 'Overdue'], ['due_today', 'Due today'], ['due_this_week', 'Due this week'],
  ['returned_for_changes', 'Returned for changes'], ['waiting_for_someone', 'Waiting for someone'], ['submitted_for_approval', 'Submitted for approval'],
  ['upcoming', 'Upcoming'], ['completed', 'Completed'],
]
const HELP = {
  needs_decision: 'Work submitted to you, due-date requests to decide, and stages waiting for your approval.',
  overdue: 'Past the due date. Submit it, or ask for a new date with a reason.',
  due_today: 'Due before the end of today.', due_this_week: 'Due in the next 7 days.',
  returned_for_changes: 'An approver asked for changes. Update and resubmit.',
  waiting_for_someone: 'Tasks you assigned that are still open, and your own date requests awaiting a decision.',
  submitted_for_approval: 'Your work, submitted and waiting for the approver.',
  upcoming: 'Later than a week away or without a due date.', completed: 'Recently approved or locked.',
}

export default function MyWork() {
  const me = useMe()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.myWork().then((d) => { setData(d); return d }).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load().then((d) => {
      if (!d) return
      const count = (k) => (k === 'needs_decision' ? d.needs_decision.length : d.counts[k])
      setTab((cur) => cur || BUCKETS.find(([k]) => count(k) > 0)?.[0] || 'upcoming')
    })
  }, [load])

  if (!data) return <Layout title="My work" subtitle={error || 'Loading…'} />
  const count = (k) => (k === 'needs_decision' ? data.needs_decision.length : data.counts[k])

  const body = () => {
    if (tab === 'needs_decision') {
      if (!data.needs_decision.length) return <Empty>Nothing is waiting for your decision.</Empty>
      return data.needs_decision.map((x, i) => x.type === 'stage' ? (
        <Link key={`s${i}`} to={`/projects/${x.project_id}`} className="decide-row">
          <div><strong>{x.project_name}</strong><small>{x.stage_name} is awaiting approval · {x.days_waiting}d</small></div>
          <span className="go">Review<Icon name="arrow" size={14} /></span>
        </Link>
      ) : <TaskCard key={`${x.type}${x.task.id}`} task={x.task} showProject onChanged={load} defaultOpen={x.type === 'date_request'} />)
    }
    const list = data.buckets[tab] || []
    if (!list.length) return <Empty>Nothing here.</Empty>
    return list.map((t) => <TaskCard key={t.id} task={t} showProject onChanged={load} />)
  }

  return (
    <Layout title="My work" subtitle={`${me.name} · everything assigned to you, and everything waiting on you`}>
      <section className="kpis mw">
        {[['overdue', 'Overdue', 'alert', 'red'], ['due_today', 'Due today', 'clock', 'amber'], ['due_this_week', 'Due this week', 'tasks', 'green'], ['needs_decision', 'Needs my decision', 'check', 'bright']].map(([k, lab, icon, tone]) => (
          <button key={k} className="kpi click" onClick={() => setTab(k)}>
            <span className={`kpi-icon tone-bg-${tone}`}><Icon name={icon} size={20} /></span>
            <div><span className="kpi-label">{lab}</span><b>{count(k)}</b></div>
          </button>
        ))}
      </section>
      <section className="panel">
        <Tabs value={tab} onChange={setTab} tabs={BUCKETS.map(([k, l]) => ({ key: k, label: l, count: count(k) }))} />
        <p className="muted bucket-help">{HELP[tab]}</p>
        <div className="tasklist">{body()}</div>
        {tab === 'completed' && <p className="muted tiny">Showing the 20 most recent.</p>}
      </section>
    </Layout>
  )
}
