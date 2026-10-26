import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../context'
import { guideFor } from '../roleGuide'
import { projectUrl } from './bits'

const cache = { data: null }

/** First thing a person sees: who they are here, what to do right now, and a way to learn the rest. */
export default function StartHere({ work }) {
  const me = useMe()
  const g = guideFor(me.role_key, me.role?.name)
  const first = me.name.split(' ')[0]
  const [mine, setMine] = useState(work || cache.data)
  useEffect(() => { if (!work && !cache.data) api.myWork().then((d) => { cache.data = d; setTimeout(() => { cache.data = null }, 15000); setMine(d) }).catch(() => {}) }, [work])
  const c = mine?.counts || {}
  const decide = mine?.needs_decision || []
  const returned = c.returned_for_changes || 0
  const next = decide[0]

  let line, to, cta
  if (next) { line = `${decide.length} ${decide.length === 1 ? 'thing is' : 'things are'} waiting for your decision. Start with “${next.title || next.task?.title}”.`; to = projectUrl(next.project_id || next.task?.project_id, next.link || `tab=tasks&focus=task-${next.task?.id || next.id}`); cta = 'Open it' }
  else if (returned) { line = `${returned} ${returned === 1 ? 'item was' : 'items were'} sent back to you for changes. Each one says who asked and why.`; to = '/my-work'; cta = 'See what to fix' }
  else if (c.overdue) { line = `${c.overdue} of your tasks ${c.overdue === 1 ? 'is' : 'are'} overdue. Submit them or ask for a new date.`; to = '/my-work'; cta = 'Open My work' }
  else if (c.due_today || c.due_this_week) { line = `Nothing is urgent. ${(c.due_today || 0) + (c.due_this_week || 0)} tasks are due this week.`; to = '/my-work'; cta = 'Open My work' }
  else { line = 'You are all caught up. Nothing is waiting for you.'; to = '/projects'; cta = 'Browse projects' }

  return (
    <section className="starthere" aria-label="Start here">
      <div className="sh-who">
        <p className="sh-hello">Hello, {first}</p>
        <h2>You are {g.title === 'Administrator' ? 'the' : 'on the'} {g.title}{g.title === 'Administrator' ? '' : ' team'}</h2>
        <p className="sh-does">{g.does}</p>
      </div>
      <div className="sh-next">
        <span className="sh-label">Your next step</span>
        {mine ? (
          <>
            <p>{line}</p>
            <div className="sh-actions">
              <Link to={to} className="btn primary big">{cta}</Link>
              <Link to="/help" className="link">How this works</Link>
            </div>
          </>
        ) : <div className="skel sh-skel" aria-busy="true" aria-label="Checking what is waiting for you"><i /><i style={{ width: '60%' }} /></div>}
      </div>
    </section>
  )
}
