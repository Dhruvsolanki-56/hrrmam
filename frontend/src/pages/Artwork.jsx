import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import TaskCard from '../components/TaskCard'
import { Empty, Person, Skeleton, Tabs, usePaged } from '../components/bits'
import { useMe } from '../context'

/** Who has the item now, said only when it is someone other than its owner (the owner is already shown on the right). */
const holder = (d) => (d.review?.with?.people || []).map((x) => x.split(' (')[0]).filter((n) => n !== d.owner?.name).join(' or ')

function DocRows({ docs, empty }) {
  const me = useMe()
  if (!docs.length) return <Empty>{empty}</Empty>
  return (
    <ul className="rows">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to={`/projects/${d.project_id}?tab=artwork&focus=doc-${d.id}`}>
            <div><strong>{d.title}</strong><small>{d.project_name} · {d.kind} · v{d.current_version}{holder(d) ? ` · now with ${holder(d)}` : ''}</small></div>
            <span className="row-end">{d.owner?.id !== me.id && <Person user={d.owner} short />}<Icon name="arrow" size={14} /></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function Artwork() {
  const me = useMe()
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => api.artwork().then(setD).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!d) return <Layout title="Artwork portal" subtitle={error || 'Loading…'}>{!error && <><Skeleton rows={3} /><Skeleton rows={4} /></>}</Layout>

  // the lists people act on come first; the library of finished artwork is always one click away
  const lists = [
    { key: 'returned_for_changes', label: 'Returned for changes', items: d.returned_for_changes, empty: 'Nothing has been returned.' },
    ...d.review_steps.map((x) => ({ key: x.status, label: `Awaiting ${x.label.toLowerCase()}`, items: x.items, empty: `Nothing is waiting for ${x.label.toLowerCase()}.` })),
    { key: 'new_development', label: 'In development', items: d.new_development, empty: 'No new artwork in development.' },
    { key: 'print_proof_shade_card', label: 'Print proof / shade card', items: d.print_proof_shade_card, empty: 'No print proofs or shade cards in progress.' },
    { key: 'library', label: 'Approved library', items: d.library || [], empty: 'No approved artwork yet.' },
  ]
  const cur = lists.find((x) => x.key === tab) || lists.find((x) => x.items.length) || lists[0]
  return (
    <Layout title="Artwork portal" subtitle="Carton, label, leaflet, print proof and shade card: where each one is in review">
      {(d.my_tasks.length > 0 || ['artwork', 'super_admin'].includes(me.role_key)) && (
        <section className="panel">
          <header><h3>My artwork tasks</h3><span className="muted">{d.my_tasks.length} open</span></header>
          {!d.my_tasks.length && <Empty>No open artwork tasks assigned to you.</Empty>}
          <div className="tasklist">{d.my_tasks.map((t) => <TaskCard key={t.id} task={t} showProject onChanged={load} />)}</div>
        </section>
      )}
      <section className="panel art-lists">
        <Tabs value={cur.key} onChange={setTab} tabs={lists.map((x) => ({ key: x.key, label: x.label, count: x.items.length }))} />
        <ArtList key={cur.key} list={cur} search={cur.key === 'library'} />
      </section>
    </Layout>
  )
}

/** One list of artwork, ten at a time; the library can be filtered by product or kind. */
function ArtList({ list, search }) {
  const [q, setQ] = useState('')
  const rows = list.items.filter((d) => `${d.title} ${d.project_name} ${d.kind}`.toLowerCase().includes(q.toLowerCase()))
  const { items, pager } = usePaged(rows, 10, q)
  return (
    <>
      {search && <input className="search art-search" placeholder="Filter by product or kind" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter approved artwork" />}
      <DocRows docs={items} empty={q ? 'Nothing matches.' : list.empty} />
      {pager}
    </>
  )
}
