import logo from '../assets/neohealth-logo.svg?raw'
import { Avatar } from '../components/bits'

const GROUPS = [['AU', 'Neo Health Australia'], ['IN', 'Neo India'], ['Partner', 'Partners & reviewers']]
const POINTS = [
  ['01', 'One record per product', 'Project 360 holds the brief, agreements, dossier, artwork, manufacturer data and RFIs.'],
  ['02', 'Work in parallel', 'Legal, Regulatory, Artwork and Manufacturer data run side by side after Commercial approval.'],
  ['03', 'Every entry is approved', 'Submit, approve or send back with a reason. Nothing is overwritten and every step is audited.'],
]

/** DEMO sign-in: pick who you are. Real authentication (SSO / passwords) replaces this before production. */
export default function Login({ users, onPick }) {
  return (
    <div className="login">
      <section className="login-side">
        <div>
          <div className="login-logo" dangerouslySetInnerHTML={{ __html: logo }} />
        </div>
        <div>
          <h1>Product lifecycle &amp; regulatory operations</h1>
          <p>The shared workspace for Neo Health Australia, Neo India and manufacturing partners, from opportunity to dispatch.</p>
        </div>
        <ul className="login-points">
          {POINTS.map(([n, t, d]) => <li key={n}><i>{n}</i><span><b>{t}</b>{d}</span></li>)}
        </ul>
        <p className="login-foot">Demo environment · sample data</p>
      </section>
      <section className="login-pick">
        <div>
          <h2>Choose who you are</h2>
          <p className="muted">There are no passwords in the demo. What each person can see and do comes from their role, and the server enforces it.</p>
        </div>
        {GROUPS.map(([code, name]) => {
          const list = users.filter((u) => (code === 'Partner' ? !['AU', 'IN'].includes(u.country) : u.country === code))
          if (!list.length) return null
          return (
            <div key={code} className="login-group">
              <h3>{name}</h3>
              <ul className="login-users">
                {list.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => onPick(u.id)}>
                      <Avatar name={u.name} />
                      <span><b>{u.name}</b><small>{u.role}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>
    </div>
  )
}
