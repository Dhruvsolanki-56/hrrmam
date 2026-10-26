import logo from '../assets/neohealth-logo.svg?raw'
import { Avatar } from '../components/bits'
import { guideFor } from '../roleGuide'

const GROUPS = [['AU', 'Neo Health Australia'], ['IN', 'Neo India'], ['Partner', 'Partners & reviewers']]

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
        <ul className="login-points">
          <li>See what is waiting for you, most urgent first</li>
          <li>Know who has every item, and why</li>
          <li>Every decision is recorded</li>
        </ul>
      </aside>
      <main className="login-in">
        <div>
          <h2>Sign in</h2>
          <p>Choose who you are. Each person sees and does only what their role allows, and each card says what that role does.</p>
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
                      <span><b>{u.name}</b><small>{u.role}</small><em>{guideFor(u.role_key).does}</em></span>
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
