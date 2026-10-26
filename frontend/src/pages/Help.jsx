import Layout from '../components/Layout'
import { useMe } from '../context'
import { GLOSSARY, LIFECYCLE, QA, ROLE_GUIDE, guideFor } from '../roleGuide'

export default function Help() {
  const me = useMe()
  const mine = guideFor(me.role_key, me.role?.name)
  return (
    <Layout title="How this works">
      <div className="help">
        <nav className="help-jump" aria-label="On this page">
          {[['life', 'The life of a project'], ['steps', 'How a step works'], ['qa', 'Common questions'], ['words', 'Words used'], ['roles', 'Who does what']].map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
        </nav>

        <section className="help-card help-you">
          <h2>Your role: {mine.title}</h2>
          <p>{mine.does}</p>
          <p><b>First thing to do:</b> {mine.first}</p>
        </section>

        <section className="help-card" id="life">
          <h2>The life of a project</h2>
          <ol className="help-steps">
            {LIFECYCLE.map((s) => <li key={s.n}><span className="n">{s.n}</span><div><b>{s.name}</b><p>{s.text}</p></div></li>)}
          </ol>
        </section>

        <section className="help-card" id="steps">
          <h2>Every step works the same way</h2>
          <ol className="help-steps">
            <li><span className="n">1</span><div><b>The owner does the work</b><p>Tasks, agreements, dossier items or artwork are completed and files are attached.</p></div></li>
            <li><span className="n">2</span><div><b>Submit for approval</b><p>The card names the approver. They are notified and it appears in their My work.</p></div></li>
            <li><span className="n">3</span><div><b>Approve, or request changes</b><p>A different person decides. A reason is required when changes are requested.</p></div></li>
            <li><span className="n">4</span><div><b>The next step starts</b><p>The next owner is told. Every action is kept in the history.</p></div></li>
          </ol>
        </section>

        <section className="help-card" id="qa">
          <h2>Common questions</h2>
          <dl className="help-qa">{QA.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
        </section>

        <section className="help-card" id="words">
          <h2>Words used in the app</h2>
          <dl className="help-qa">{GLOSSARY.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
        </section>

        <section className="help-card" id="roles">
          <h2>Who does what</h2>
          <dl className="help-qa">{Object.entries(ROLE_GUIDE).map(([k, r]) => <div key={k}><dt>{r.title}</dt><dd>{r.does}</dd></div>)}</dl>
        </section>
      </div>
    </Layout>
  )
}
