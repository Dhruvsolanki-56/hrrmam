import logo from '../assets/neohealth-logo.svg?raw'
import { Avatar } from '../components/bits'

const GROUPS = [['AU', 'Neo Health Australia'], ['IN', 'Neo India'], ['Partner', 'Partners & reviewers']]

/** DEMO sign-in: pick who you are. Real authentication (SSO / passwords) replaces this before production. */
export default function Login({ users, onPick }) {
  return (
    <div className="login">
      <header className="login-bar">
        <div className="hdr-in">
          <div className="login-logo" dangerouslySetInnerHTML={{ __html: logo }} />
          <span className="muted">Demo environment</span>
        </div>
      </header>
      <main className="login-in">
        <div>
          <h1>Product lifecycle &amp; regulatory operations</h1>
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
        <p className="login-note">No passwords in the demo. Real sign-in replaces this before production.</p>
      </main>
    </div>
  )
}
