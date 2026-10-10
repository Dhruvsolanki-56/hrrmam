import logo from '../assets/neohealth-logo.svg?raw'
import { Avatar } from '../components/bits'

const GROUPS = [['AU', 'Neo Health Australia'], ['IN', 'Neo India'], ['Partner', 'Partners & reviewers']]
// the 15-phase journey, drawn as the brand motif: approved, in progress, still to come
const JOURNEY = [...Array(15)].map((_, i) => (i < 6 ? 'done' : i < 9 ? 'now' : 'next'))

/** DEMO sign-in: pick who you are. Real authentication (SSO / passwords) replaces this before production. */
export default function Login({ users, onPick }) {
  return (
    <div className="login">
      <aside className="login-brand">
        <div className="login-logo" dangerouslySetInnerHTML={{ __html: logo }} />
        <div>
          <h1>Every product, from opportunity to dispatch.</h1>
          <p>One shared workspace for Neo Health Australia, Neo India and manufacturing partners.</p>
        </div>
        <div className="login-journey" aria-hidden="true">
          {JOURNEY.map((s, i) => <i key={i} className={s} />)}
        </div>
      </aside>
      <main className="login-in">
        <div>
          <h2>Sign in</h2>
          <p>Choose who you are. What each person can see and do comes from their role.</p>
        </div>
        {GROUPS.map(([code, name]) => {
          const list = users.filter((u) => (code === 'Partner' ? !['AU', 'IN'].includes(u.country) : u.country === code))
          if (!list.length) return null
          return (
            <section key={code} className="login-group">
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
            </section>
          )
        })}
        <p className="login-note">Demo environment with sample data. No passwords yet.</p>
      </main>
    </div>
  )
}
