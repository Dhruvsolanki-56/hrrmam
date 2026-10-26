import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'
import { Empty, Skeleton, fmtDateTime, orList, projectUrl, usePaged } from '../components/bits'

const BUCKETS = [
  ['needs_decision', 'Needs my decision'], ['returned_for_changes', 'Returned to me'], ['overdue', 'Overdue'], ['due_today', 'Due today'],
  ['due_this_week', 'Due this week'], ['upcoming', 'Upcoming'],
  ['waiting_for_someone', 'Waiting on others'], ['submitted_for_approval', 'Submitted by me'], ['completed', 'Completed'],
]
const GROUP = { needs_decision: 'Do now', due_this_week: 'Coming up', waiting_for_someone: 'Nothing for you to do' }
const HELP = {
  needs_decision: 'Everything sent to you to approve, review or decide: steps, tasks, agreements, dossier items, artwork, documents and reopen requests.',
  overdue: 'Past the due date. Submit it, or ask for a new date.',
  due_today: 'Due before the end of today.', due_this_week: 'Due in the next 7 days.',
  returned_for_changes: 'Someone asked for changes. It says who, why and what to do. Fix it and send it again.',
  waiting_for_someone: 'Tasks you assigned that are still open.',
  submitted_for_approval: 'Work you sent. It says who has it now and since when.',
  upcoming: 'More than a week away, or no due date.', completed: 'Your 50 most recent approved or locked tasks, including finished projects.',
}

const KIND_WORD = { agreement: 'agreement', dossier_item: 'dossier item', mfr: 'manufacturer data', document: 'document', stage: 'step' }

/** One agreement, dossier item, manufacturer request, document, step or reopen request, with who has it and what to do next. */
function RecordRow({ x, mode }) {
  const word = x.type === 'reopen' ? 'reopen request' : KIND_WORD[x.kind] || KIND_WORD[x.type] || 'item'
  const head = { decide: x.type === 'reopen' ? 'Decide on the reopen of' : x.type === 'document' ? 'Review' : 'Approve', returned: 'Fix', waiting: 'Waiting on' }[mode]
  const lines = []
  if (x.type === 'reopen') lines.push(`Requested by ${x.request.requested_by.name}: “${x.request.reason}”`)
  else if (mode === 'returned' && x.changes) lines.push(`Changes requested by ${x.changes.by}, ${fmtDateTime(x.changes.at)}: “${x.changes.note || 'no reason written'}”`)
  else if (x.submitted) lines.push(`Submitted by ${x.submitted.by}, ${fmtDateTime(x.submitted.at)}`)
  if (mode === 'waiting' && x.with?.people?.length) lines.push(`With ${orList(x.with.people)}${x.with.since ? ` since ${fmtDateTime(x.with.since)}` : ''}`)
  if (x.next) lines.push(x.next)
  return (
    <Link to={projectUrl(x.project_id, x.link)} className={`decide-row rec-${mode}`}>
      <div>
        <strong>{head}: {x.title}</strong>
        <small>{x.project_name} · {word}{x.days_waiting ? ` · waiting ${x.days_waiting}d` : ''}</small>
        {lines.map((l) => <small key={l} className="rec-line">{l}</small>)}
      </div>
      <span className="go">Open<Icon name="arrow" size={14} /></span>
    </Link>
  )
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

  const listFor = (k) => {
    if (!data || !k) return []
    if (k === 'needs_decision') return [...data.needs_decision]
    return [...(data.items?.[k] || []), ...(data.buckets[k] || [])]
  }
  const { items, pager } = usePaged(listFor(tab), 10, tab)

  if (!data) return <Layout title="My work">{error ? <p className="error">{error}</p> : <Skeleton rows={5} />}</Layout>
  const count = (k) => (k === 'needs_decision' ? data.needs_decision.length : data.counts[k])
  const current = BUCKETS.find(([k]) => k === tab)

  const body = () => {
    if (tab === 'needs_decision') {
      if (!data.needs_decision.length) return <Empty>Nothing is waiting for your decision.</Empty>
      return items.map((x, i) => x.task === undefined ? <RecordRow key={`${x.type}${x.id}${i}`} x={x} mode="decide" /> : (
        <div key={`${x.type}${x.task.id}`} className="decide-wrap">
          <p className="decide-tag">{x.type === 'date_request'
            ? <><b>Date request</b> · {x.request.requested_by.name} asks for {fmtDateTime(x.request.proposed_due)}</>
            : <><b>Submitted</b> · {x.task.assignee.name} says it is done</>}</p>
          <TaskCard task={x.task} showProject onChanged={load} />
        </div>
      ))
    }
    if (!items.length) return <Empty>Nothing here.</Empty>
    const mode = tab === 'returned_for_changes' ? 'returned' : 'waiting'
    return items.map((t) => (t.type ? <RecordRow key={`${t.type}${t.id}`} x={t} mode={mode} /> : <TaskCard key={t.id} task={t} showProject onChanged={load} />))
  }

  return (
    <Layout title="My work">
      <div className="mw">
        <nav className="mw-nav" aria-label="Task groups">
          {BUCKETS.map(([k, l]) => {
            const n = count(k)
            return (
              <Fragment key={k}>
              {GROUP[k] && <span className="mw-group">{GROUP[k]}</span>}
              <button className={`${tab === k ? 'on' : ''} ${n ? '' : 'zero'} ${k === 'overdue' && n ? 'hot' : ''} ${['waiting_for_someone', 'completed'].includes(k) ? 'quiet' : ''}`} onClick={() => setTab(k)} aria-current={tab === k ? 'true' : undefined}>
                <span>{l}</span><b>{n}</b>
              </button>
              </Fragment>
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
