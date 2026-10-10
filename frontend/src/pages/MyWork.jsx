import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'
import { Empty, usePaged } from '../components/bits'

const BUCKETS = [
  ['needs_decision', 'Needs my decision'], ['overdue', 'Overdue'], ['due_today', 'Due today'], ['due_this_week', 'Due this week'],
  ['returned_for_changes', 'Returned to me'], ['waiting_for_someone', 'Waiting on others'], ['submitted_for_approval', 'Submitted'],
  ['upcoming', 'Upcoming'], ['completed', 'Completed'],
]
const HELP = {
  needs_decision: 'Work submitted to you, date requests and stages waiting for your approval.',
  overdue: 'Past the due date. Submit it, or ask for a new date.',
  due_today: 'Due before the end of today.', due_this_week: 'Due in the next 7 days.',
  returned_for_changes: 'An approver asked for changes. Update and resubmit.',
  waiting_for_someone: 'Tasks you assigned that are still open.',
  submitted_for_approval: 'Your work, waiting for the approver.',
  upcoming: 'More than a week away, or no due date.', completed: 'The 20 most recently approved or locked.',
}

export default function MyWork() {
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

  const listFor = (k) => (!data || !k ? [] : k === 'needs_decision' ? data.needs_decision : data.buckets[k] || [])
  const { items, pager } = usePaged(listFor(tab), 10, tab)

  if (!data) return <Layout title="My work"><p className="muted">{error || 'Loading…'}</p></Layout>
  const count = (k) => (k === 'needs_decision' ? data.needs_decision.length : data.counts[k])
  const current = BUCKETS.find(([k]) => k === tab)

  const body = () => {
    if (tab === 'needs_decision') {
      if (!data.needs_decision.length) return <Empty>Nothing is waiting for your decision.</Empty>
      return items.map((x, i) => x.type === 'stage' ? (
        <Link key={`s${i}`} to={`/projects/${x.project_id}`} className="decide-row">
          <div><strong>{x.stage_name} approval</strong><small>{x.project_name} · waiting {x.days_waiting}d</small></div>
          <span className="go">Review<Icon name="arrow" size={14} /></span>
        </Link>
      ) : <TaskCard key={`${x.type}${x.task.id}`} task={x.task} showProject onChanged={load} />)
    }
    if (!items.length) return <Empty>Nothing here.</Empty>
    return items.map((t) => <TaskCard key={t.id} task={t} showProject onChanged={load} />)
  }

  return (
    <Layout title="My work">
      <div className="mw">
        <nav className="mw-nav" aria-label="Task groups">
          {BUCKETS.map(([k, l]) => {
            const n = count(k)
            return (
              <button key={k} className={`${tab === k ? 'on' : ''} ${n ? '' : 'zero'} ${k === 'overdue' && n ? 'hot' : ''}`} onClick={() => setTab(k)} aria-current={tab === k ? 'true' : undefined}>
                <span>{l}</span><b>{n}</b>
              </button>
            )
          })}
        </nav>
        <section className="mw-main">
          <header>
            <h2>{current?.[1]}</h2>
            <p className="muted">{HELP[tab]}</p>
          </header>
          <div className="tasklist">{body()}</div>
          {pager}
        </section>
      </div>
    </Layout>
  )
}
