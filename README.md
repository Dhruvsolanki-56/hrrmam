# Neo Product Lifecycle & Regulatory Operations Platform

One shared system for Neo Health Australia, Neo India and manufacturing partners: **one Project 360 record, parallel
workstreams, task-driven accountability, versioned documents, controlled approvals and a complete audit trail.**
Built to the "NEO Simple System Flow & Build Requirements" (V1). Phase 2 AI is intentionally not included.

**Stack:** React (Vite) · FastAPI · SQLite (file-based, via SQLAlchemy; swap with `DATABASE_URL`)

## Run it

```powershell
./run.ps1            # builds the frontend, starts the API + UI at http://localhost:8000
```

Development (hot reload):

```powershell
cd backend;  python -m uvicorn app.main:app --reload --port 8000
cd frontend; npm run dev        # http://localhost:5173, proxies /api to :8000
```

The database is `backend/neohealth.db`, created on first start with demo people and eight demo projects.
Delete the file to reset, or set `SEED_DEMO_DATA=false` for an empty start (a single Super Admin is created).
A database from the earlier single-flow version is kept as `*.legacy-*.bak` and a fresh one is created.

> **Sign-in is a demo.** You pick who you are; there are no passwords yet. What each person can do is decided by their
> role and **enforced on the server**. Replace `backend/app/auth.py` with real sign-in (SSO / email + password) before production.

## What is built (mapped to the requirements)

**1. End-to-end flow (12 phases, not a rigid gate tracker).** Opportunity → Brief → Governance → Parallel work → Dossier
Ready → Regulatory Submission → RFI / Changes → Approval → Commercial Readiness → Manufacturing → Samples / Dispatch →
Completion (`backend/app/workflow.py`). Every stage uses the same cycle: *work → submit → approve | send back (repeatable) | reject*.
A project can move backward before the final lock; every return, reassignment, approval and version stays in history.

**2. Project 360 + parallel workstreams.** Project code, product, market, project manager, target submission / launch,
overall health (derived: on track / at risk / critical) and a critical blocker. Five workstreams run in parallel with
independent status: Commercial, Legal, Regulatory, Artwork, Manufacturer data. **Milestone / lock rule:** *Dossier Ready*
completes only when all of them are approved (optional ones can be bypassed with a reason), and a workstream cannot be
submitted until its own conditions hold (required tasks and documents approved, core agreements signed, dossier checklist
ready, required manufacturer data accepted, a submission recorded, no open RFI).

**3. Task, deadline and rework engine.** Assigned → Accepted → In Progress → Submitted → Changes Requested → Resubmitted →
Approved → Locked. **Due-date negotiation:** the assigner sets a date and time; the assignee accepts or proposes a new date
with a reason; the assigner approves or rejects it. **My Work:** due today / this week / overdue / waiting for someone /
returned for changes / submitted for approval / upcoming / completed, plus "needs my decision". **Reminders & escalation**
are configurable (default 7, 3, 1, 0 days and overdue); notifications state project, task, owner, due date and action required.
No silent overwrite: every change, date update, reassignment, return, approval, lock and reopen is in the audit trail.

**4. Modules.** Legal register (Supplier, Quality and PV agreements in parallel, plus NDA / CDA / POA / notices; ageing; Excel
export) · Regulatory / dossier (submission type, checklist with M1–M5 only where the type needs them, RA review, submission
history) · Artwork (carton, label, leaflet, print proof, shade card with versions: regulatory review → director approval) ·
Manufacturer data (COA, MSDS, specification, testing, stability, manufacturing) · RFI management (case, questions assigned as
tasks, evidence, response package, closure) · Documents with V1/V2/V3, review, return, approval, lock / reopen · Dashboards & audit.

**5. Portals.** Director overview (portfolio health, at-risk / delayed, pending approvals, unsigned agreements, deadline-change
requests with inline decisions, RFI deadlines, India / Australia filter) · Regulatory portal · Artwork portal · Legal register ·
Audit trail. The Regulatory portal shows where AI review (Phase 2) will sit; it is not built.

**Users, roles, permissions.** Super Admin controls, per role: assign (and to whom), reassign, approve, request changes,
bypass optional work, change dates, lock / unlock, edit approved records, manage users (Admin page; changes are logged).
No self-approval: the assignee can never approve their own task.

## Decisions still open (kept configurable, per the V1 rules)

- **External submission platform** (TGA): free-text setting (Admin → Settings) until confirmed.
- **Manufacturer access model** (account / secure upload / internal entry): V1 uses internal entry by the Neo technical team; the setting records the decision.
- **Legal AI drafting / search** is not assumed. **Phase 2 AI regulatory intelligence** is not built.
- Files are **links** (SharePoint, Drive…), not uploads; versioning and approval are tracked on the link.
- Notifications are in-app; email / push delivery is not wired up.

## Structure

```
backend/app
  workflow.py        stages, roles & permissions, task states, flows (edit here to change the process)
  models.py          tables: users, roles, projects, project_stages, tasks, agreements, dossier, submissions,
                     manufacturer requests, RFI, documents + versions, notifications, audit events
  services/          engine (approval cycle, guards, health) · tasks · modules · notify · dash
  routers/           thin HTTP layer;  auth.py = who is calling;  serialize.py = JSON shapes
frontend/src
  pages/             Dashboard (Director), Projects, ProjectDetail (360), MyWork, Regulatory, Artwork, Legal, Audit, Admin
  components/        task cards, document / artwork review, workstream tabs, forms, layout
```

**Moving off SQLite:** set `DATABASE_URL` (e.g. `postgresql+psycopg://...`). Only SQLAlchemy is used with no SQLite-specific
features; add Alembic migrations for production.

## Branding

Colours, capsule shapes and type follow the Neo Health Brand Style Guide (Aug 2026): Neo Green `#00817e`,
Neo Dark Green `#004248`, Neo Bright Green `#C1E1C0`, Neo Black `#231F20`, Neo Grey `#DCDDDD`.
The interface uses Inter. The logo is the vector brandmark from the guide.
