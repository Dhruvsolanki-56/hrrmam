import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import logo from '../assets/neohealth-logo.svg?raw'
import { useApp, useCan, useMe } from '../context'
import { guideFor } from '../roleGuide'

// shown once per person: remembered on their account (any device) and in this browser (so it holds even offline)
const KEY = (name, id) => `nh-tour-${name}-${id}`
const seen = (name, me) => {
  if ((me.tours_seen || []).includes(name)) return true
  try { return localStorage.getItem(KEY(name, me.id)) === '1' } catch { return false }
}
const mark = (name, id) => {
  try { localStorage.setItem(KEY(name, id), '1') } catch { /* private mode */ }
  api.tourSeen(name).catch(() => {})
}

/** Forget that this person has seen the tours, so they play again (Help page, "Take the tour again"). */
export async function resetTours(id) {
  try { ['app', 'project'].forEach((n) => localStorage.removeItem(KEY(n, id))) } catch { /* private mode */ }
  await api.resetTours().catch(() => {})
}

const WORKSTREAM = {
  regulatory: ['/regulatory', 'Your review queue', 'Dossier items, manufacturer documents and RFIs waiting for Regulatory, oldest first.'],
  artwork: ['/artwork', 'The Artwork portal', 'Every carton, label and leaflet, grouped by where it is in review, plus the approved library.'],
  legal: ['/legal', 'Agreements', 'Every agreement on every project, who it is with and how long it has been open.'],
}

function appSteps(me, can) {
  const g = guideFor(me.role_key, me.role?.name)
  const first = me.name.split(' ')[0]
  const ws = WORKSTREAM[me.role_key]
  return [
    { center: true, welcome: true, title: `Welcome, ${first}`, body: `You are on the ${g.title}${g.title === 'Administrator' ? '' : ' team'}. ${g.does} This short tour shows you where everything is. It takes under a minute.` },
    { target: '.starthere .sh-next', title: 'Start here every day', body: 'This box always tells you the one thing to do next, and the button takes you straight to it.', place: 'bottom' },
    { target: '.menu-btn', title: 'The menu', body: 'My work, all projects, your team’s pages and Help are all in here.', place: 'bottom' },
    { target: '.side-nav a[href="/my-work"]', title: 'My work', body: 'Every task, approval and item sent back to you, across all projects, in one list. Most of your day starts here.', place: 'right' },
    { target: '.side-nav a[href="/projects"]', title: 'All projects', body: 'Every project, the step it is at and how healthy it is. Click a row to open the project.', place: 'right' },
    ws && { target: `.side-nav a[href="${ws[0]}"]`, title: ws[1], body: ws[2], place: 'right' },
    { target: '.gsearch', title: 'Find anything', body: 'Search a project by name or code. Press / from any page to jump here.', place: 'bottom' },
    { target: '.hdr-right .pop-wrap', title: 'Notifications', body: 'When work is handed to you, approved or sent back, you hear about it here. The number shows what is new.', place: 'bottom' },
    can('manage_project') && { target: '.hdr-right > .btn.primary', title: 'Start a project', body: 'A new project begins as an opportunity. Once it is approved it gets its code and the teams can start.', place: 'bottom' },
    { target: '.side-nav a[href="/help"]', title: 'Help is always here', body: 'A plain-language guide to every step, role and word. You can replay this tour from there.', place: 'right' },
    { center: true, title: 'You are ready', body: 'Open any project and we will show you how a project page works.', done: 'Let’s go' },
  ].filter(Boolean)
}

const projectSteps = () => [
  { target: '.proj-card', title: 'The project page', body: 'Name, status and how long it has been at its current step. Everything about the project is one click from here.', place: 'bottom' },
  { target: '.journey-card', title: 'Where the project is', body: 'Read it top to bottom. Finished phases are folded. The current phase is open and lists every step, its progress and who has it. Click a step to open it.', place: 'right' },
  { target: '.turn-card', title: 'Your turn', body: 'If anything on this project is waiting for you, it shows here with a button straight to it.', place: 'left' },
  { target: '.health-card', title: 'Health', body: 'On track, at risk or critical, and exactly why. A critical blocker shows here too.', place: 'left' },
  { target: '.proj-card .tabs', title: 'Every team’s work', body: 'The brief, tasks, each team’s workstream, documents and the full history. Nothing is ever overwritten.', place: 'bottom', done: 'Got it' },
]

const visible = (el) => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth ? r : null
}

/** A first-time walkthrough: the page dims, one area is lit at a time, and a card explains it. */
function Tour({ name, steps: all, delay = 700 }) {
  const me = useMe()
  const { refreshMe } = useApp()
  const [i, setI] = useState(-1)
  const [steps, setSteps] = useState(all)
  const [rect, setRect] = useState(null)
  const dir = useRef(1)
  const nextBtn = useRef(null)
  const cardRef = useRef(null)
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 })
  const step = steps[i]

  useEffect(() => {
    if (seen(name, me) || navigator.webdriver) return undefined
    // leave out what is off screen on this device (the sidebar on a phone), so the count is honest
    const t = setTimeout(() => {
      setSteps(all.filter((s) => s.center || !document.querySelector(s.target) || visible(document.querySelector(s.target))))
      setI(0)
      mark(name, me.id) // counted as seen the moment it opens, so leaving halfway does not bring it back
    }, delay)
    return () => clearTimeout(t)
  }, [name, me.id, delay, all]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => { setI(-1); setRect(null); refreshMe() }, [refreshMe])
  const go = useCallback((d) => {
    dir.current = d
    setI((x) => { const n = x + d; return n >= steps.length ? -1 : Math.max(0, n) })
  }, [steps.length])

  // find the step's target (pages load in stages), bring it into view and light it; skip it if it is not on screen
  useEffect(() => {
    if (!step) return undefined
    if (step.center) { setRect(null); return undefined }
    let tries = 0, timer
    const find = () => {
      const el = document.querySelector(step.target)
      if (!el && tries++ < 25) { timer = setTimeout(find, 120); return }
      const r0 = el && el.getBoundingClientRect()
      if (!el || !r0.width || r0.right <= 0 || r0.left >= window.innerWidth) { go(dir.current); return }
      if (r0.top < 72 || r0.bottom > window.innerHeight - 24) el.scrollIntoView({ block: r0.height > window.innerHeight * 0.6 ? 'start' : 'center', behavior: 'smooth' })
      timer = setTimeout(() => setRect(visible(el)), 380)
    }
    find()
    return () => clearTimeout(timer)
  }, [step, go])

  // follow the target while the page scrolls or resizes
  useEffect(() => {
    if (!step || step.center) return undefined
    let raf = 0
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const r = visible(document.querySelector(step.target)); if (r) setRect(r) }) }
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on) }
  }, [step])

  useEffect(() => {
    if (!step) return undefined
    const k = (e) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft' && i > 0) go(-1)
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [step, i, go, close])

  useEffect(() => { if (step && (step.center || rect)) nextBtn.current?.focus({ preventScroll: true }) }, [step, rect])
  useLayoutEffect(() => {
    const c = cardRef.current
    if (c) setCardSize((s) => (s.w === c.offsetWidth && s.h === c.offsetHeight ? s : { w: c.offsetWidth, h: c.offsetHeight }))
  })

  if (!step || (!step.center && !rect)) return step ? createPortal(<div className="tour-block" />, document.body) : null

  const vw = window.innerWidth, vh = window.innerHeight, pad = 8, gap = 16, m = 16
  const phone = vw < 640
  let spot = null, pos, arrow = null
  if (rect) {
    spot = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    const { w, h } = cardSize
    const room = { right: vw - (spot.left + spot.width), left: spot.left, bottom: vh - (spot.top + spot.height), top: spot.top }
    const fits = { right: room.right >= w + gap + m, left: room.left >= w + gap + m, bottom: room.bottom >= h + gap + m, top: room.top >= h + gap + m }
    const place = phone ? null : [step.place, 'right', 'bottom', 'left', 'top'].find((p) => p && fits[p])
    const clampX = (x) => Math.min(Math.max(m, x), vw - w - m)
    const clampY = (y) => Math.min(Math.max(m, y), vh - h - m)
    if (place === 'right') pos = { left: spot.left + spot.width + gap, top: clampY(spot.top) }
    else if (place === 'left') pos = { left: spot.left - gap - w, top: clampY(spot.top) }
    else if (place === 'bottom') pos = { left: clampX(spot.left), top: spot.top + spot.height + gap }
    else if (place === 'top') pos = { left: clampX(spot.left), top: spot.top - gap - h }
    else pos = phone ? { left: m, right: m, bottom: m } : { left: clampX(spot.left), top: clampY(vh - h - m) }
    // a small pointer on the card's edge, aimed at the middle of the lit area
    const along = (a, size) => Math.min(Math.max(20, a), size - 20)
    if (place === 'right' || place === 'left') arrow = { cls: place === 'right' ? 'a-left' : 'a-right', style: { top: along(spot.top + spot.height / 2 - pos.top, h) } }
    else if (place === 'bottom' || place === 'top') arrow = { cls: place === 'bottom' ? 'a-top' : 'a-bottom', style: { left: along(spot.left + spot.width / 2 - pos.left, w) } }
  }
  const last = i === steps.length - 1
  const count = steps.filter((s) => !s.center).length
  const n = steps.slice(0, i + 1).filter((s) => !s.center).length

  return createPortal(
    <div className={`tour ${step.center ? 'tour-center' : ''}`} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-block" />
      <div className={`tour-spot ${spot ? '' : 'off'}`} style={spot || { top: vh / 2, left: vw / 2, width: 0, height: 0 }} aria-hidden="true" />
      <div ref={cardRef} className={`tour-card ${step.welcome ? 'welcome' : ''} ${phone && !step.center ? 'docked' : ''}`} style={pos} key={i}>
        {arrow && <i className={`tour-arrow ${arrow.cls}`} style={arrow.style} aria-hidden="true" />}
        {step.welcome && <div className="tour-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logo }} />}
        <div className="tour-top">
          {!step.center && <span className="tour-count">{n} of {count}</span>}
          <button className="tour-x" onClick={close} aria-label="Close the tour">×</button>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-foot">
          {!step.center && <span className="tour-dots" aria-hidden="true">{steps.filter((s) => !s.center).map((s, k) => <i key={k} className={k < n ? 'on' : ''} />)}</span>}
          <span className="tour-btns">
            {step.welcome
              ? <button className="btn line" onClick={close}>Not now</button>
              : i > 0 && !step.center && <button className="btn line" onClick={() => go(-1)}>Back</button>}
            <button ref={nextBtn} className="btn primary" onClick={() => (last ? close() : go(1))}>
              {step.welcome ? 'Show me around' : step.done || (last ? 'Finish' : 'Next')}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function AppTour() {
  const me = useMe()
  const can = useCan()
  const steps = useMemo(() => appSteps(me, can), [me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Tour name="app" steps={steps} />
}

export function ProjectTour() {
  const steps = useMemo(projectSteps, [])
  return <Tour name="project" steps={steps} delay={900} />
}
