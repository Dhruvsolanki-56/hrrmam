import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from '../components/Icon'
import Layout from '../components/Layout'
import { fmtDay, label } from '../components/bits'
import { useConfig } from '../context'

export default function Legal() {
  const config = useConfig()
  const [rows, setRows] = useState(null)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => { api.legalRegister({ status, q }).then(setRows) }, [status, q])
  const unsigned = (rows || []).filter((r) => r.status !== 'signed')
  const oldest = unsigned.reduce((m, r) => Math.max(m, r.age_days || 0), 0)

  return (
    <Layout title="Legal register" subtitle="Live register of every agreement across projects, with ageing"
      actions={<a className="btn line" href={api.legalExportUrl({ status, q })} download><Icon name="download" size={16} />Excel</a>}>
      <section className="kpis three">
        <article className="kpi"><span className="kpi-icon tone-bg-dark"><Icon name="scale" size={20} /></span><div><span className="kpi-label">In the register</span><b>{rows?.length ?? '–'}</b></div></article>
        <article className="kpi"><span className="kpi-icon tone-bg-amber"><Icon name="clock" size={20} /></span><div><span className="kpi-label">Unsigned</span><b>{rows ? unsigned.length : '–'}</b>{oldest > 0 && <small>oldest open {oldest} days</small>}</div></article>
        <article className="kpi"><span className="kpi-icon tone-bg-red"><Icon name="alert" size={20} /></span><div><span className="kpi-label">Past due</span><b>{rows ? rows.filter((r) => r.overdue).length : '–'}</b></div></article>
      </section>
      <div className="toolbar panel">
        <div className="filters">
          {[['', 'All'], ...config.agreement_status.map((s) => [s, label(s)])].map(([k, l]) => (
            <button key={k} className={`filter ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <div className="tools"><input className="search" placeholder="Search the register" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter register" /></div>
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Project</th><th>Agreement</th><th>Counterparty</th><th>Status</th><th>Owner</th><th>Due</th><th>Signed</th><th>Age</th></tr></thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id} className={r.overdue ? 'row-late' : ''}>
                  <td className="proj-cell"><Link to={`/projects/${r.project_id}?tab=legal`} className="cell-main"><span><strong>{r.project_name}</strong><small>{r.project_code || 'Code pending'}</small></span></Link></td>
                  <td data-label="Agreement">{r.label}{r.core && <small className="sub">Core</small>}</td>
                  <td data-label="Counterparty">{r.counterparty || '–'}</td>
                  <td data-label="Status"><span className={`dstate ag-${r.status}`}>{label(r.status)}</span></td>
                  <td data-label="Owner">{r.owner?.name || '–'}</td>
                  <td data-label="Due" className={r.overdue ? 'late' : ''}>{fmtDay(r.due_date)}</td>
                  <td data-label="Signed">{fmtDay(r.signed_date)}</td>
                  <td data-label="Age">{r.age_days != null && r.status !== 'not_started' ? `${r.age_days}d` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <p className="empty">Nothing matches.</p>}
        </div>
      </div>
    </Layout>
  )
}
