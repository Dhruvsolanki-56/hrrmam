import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'
import { Empty, Person, usePaged } from '../components/bits'

function DocRows({ docs, empty }) {
  if (!docs.length) return <Empty>{empty}</Empty>
  return (
    <ul className="rows">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to={`/projects/${d.project_id}?tab=artwork`}>
            <div><strong>{d.title}</strong><small>{d.project_name} · {d.kind} · V{d.current_version}</small></div>
            <span className="row-end"><Person user={d.owner} /><Icon name="arrow" size={14} /></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function Artwork() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.artwork().then(setD).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!d) return <Layout title="Artwork portal" subtitle={error || 'Loading…'} />

  const sections = [
    ['New development', 'new_development', 'No new artwork in development.'],
    ['Returned for changes', 'returned_for_changes', 'Nothing has been returned.'],
    ['Print proof / shade card', 'print_proof_shade_card', 'No print proofs or shade cards in progress.'],
  ]
  return (
    <Layout title="Artwork portal" subtitle="Carton, label, leaflet, print proof and shade card: where each one is in review">
      <section className="panel">
        <header><h3>My artwork tasks</h3><span className="muted">{d.my_tasks.length} open</span></header>
        {!d.my_tasks.length && <Empty>No open artwork tasks assigned to you.</Empty>}
        <div className="tasklist">{d.my_tasks.map((t) => <TaskCard key={t.id} task={t} showProject onChanged={load} />)}</div>
      </section>
      <section className="grid-2 even">
        {[...sections.slice(0, 2).map(([title, key, empty]) => [title, d[key], empty, key]),
          ...d.review_steps.map((s) => [`Awaiting ${s.label.toLowerCase()}`, s.items, `Nothing is waiting for ${s.label.toLowerCase()}.`, s.status]),
          ...sections.slice(2).map(([title, key, empty]) => [title, d[key], empty, key])].map(([title, items, empty, key]) => (
          <div className="panel" key={key}>
            <header><h3>{title}</h3><span className="count">{items.length}</span></header>
            <DocRows docs={items} empty={empty} />
          </div>
        ))}
      </section>
      <Library docs={d.library || []} />
    </Layout>
  )
}

/** Every approved piece of artwork, from live and completed projects, so final files can always be found again. */
function Library({ docs }) {
  const [q, setQ] = useState('')
  const rows = docs.filter((d) => `${d.title} ${d.project_name} ${d.kind}`.toLowerCase().includes(q.toLowerCase()))
  const { items, pager } = usePaged(rows, 10, q)
  return (
    <section className="panel">
      <header>
        <h3>Approved artwork library <span className="count">{docs.length}</span></h3>
        <input className="search" placeholder="Filter by product or kind" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter approved artwork" />
      </header>
      <DocRows docs={items} empty={q ? 'Nothing matches.' : 'No approved artwork yet.'} />
      {pager}
    </section>
  )
}
