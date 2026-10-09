import logo from '../assets/neohealth-logo.svg?raw'
import { Avatar } from '../components/bits'

/** DEMO sign-in: pick who you are. Real authentication (SSO / passwords) replaces this before production. */
export default function Login({ users, onPick }) {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo" dangerouslySetInnerHTML={{ __html: logo }} />
        <h1>Product Lifecycle &amp; Regulatory Operations</h1>
        <p className="muted">One project record, parallel workstreams, task-driven accountability. Choose who you are to continue.</p>
        <ul className="login-users">
          {users.map((u) => (
            <li key={u.id}>
              <button onClick={() => onPick(u.id)}>
                <Avatar name={u.name} size={40} />
                <span><b>{u.name}</b><small>{u.role} · {u.country === 'IN' ? 'Neo India' : u.country === 'AU' ? 'Neo Health Australia' : 'Partner'}</small></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted tiny">Demo mode: there are no passwords yet. What each person can do is decided by their role and is enforced by the server.</p>
      </div>
    </div>
  )
}
