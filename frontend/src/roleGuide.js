/** Plain-language description of every role, used by the Start-here card and the Help page. */
export const ROLE_GUIDE = {
  super_admin: { title: 'Administrator', does: 'You can do anything, and you manage people, roles and reference material.', first: 'Open Admin to check who has which role.' },
  director: { title: 'Director', does: 'You give the final approval on steps, artwork and reopen requests, and you can clear critical blockers.', first: 'Open My work: everything waiting for your decision is at the top.' },
  project_manager: { title: 'Project Manager', does: 'You start projects, assign tasks, name who leads each step, and keep every project moving.', first: 'Open a project, then use "Choose who is responsible" to name the people for each step.' },
  commercial: { title: 'Commercial', does: 'You own the opportunity, the brief and the feasibility & commercial step.', first: 'Open My work to see the tasks assigned to you.' },
  legal: { title: 'Legal', does: 'You prepare and track agreements: supplier, quality, PV, NDA, CDA, POA and notices.', first: 'Open the Legal tab of a project to see which agreements need you.' },
  regulatory: { title: 'Regulatory', does: 'You build the dossier, review artwork against the rules and answer regulator questions (RFIs).', first: 'Open My work: dossier tasks and review requests are listed there.' },
  artwork: { title: 'Artwork', does: 'You prepare cartons, labels and leaflets, and send them for regulatory review and director approval.', first: 'Open My work: returned artwork and your tasks are listed first.' },
  technical: { title: 'Technical / Manufacturer data', does: 'You collect and submit the manufacturer data: COA, MSDS, stability and batch data.', first: 'Open the Manufacturer tab of a project to see what is missing.' },
  quality: { title: 'Quality / PV', does: 'You own quality agreements, risk assessment and the pharmacovigilance set-up.', first: 'Open My work to see the tasks assigned to you.' },
  reviewer: { title: 'Viewer', does: 'You can read everything that is shared with you but cannot change anything.', first: 'Open any project to follow its progress.' },
}

export const guideFor = (roleKey, fallback = '') => ROLE_GUIDE[roleKey] || { title: fallback || 'Team member', does: 'You work on the steps your role is responsible for.', first: 'Open My work to see what is waiting for you.' }

/** The life of a project in six plain steps. */
export const LIFECYCLE = [
  { n: 1, name: 'Opportunity', text: 'Commercial describes the idea and a Director approves going ahead.' },
  { n: 2, name: 'Project brief', text: 'The product, market and plan are written down and approved.' },
  { n: 3, name: 'Preparation, in parallel', text: 'Legal, Regulatory, Artwork, Manufacturer data and Quality / PV work at the same time. Each has an owner and an approver.' },
  { n: 4, name: 'Dossier Ready', text: 'A checkpoint, not paperwork: it opens by itself once every preparation step is approved.' },
  { n: 5, name: 'Submission', text: 'Regulatory submits the dossier to the regulator and records it.' },
  { n: 6, name: 'Approval & launch', text: 'Questions from the regulator (RFIs) are answered, then the product is approved and launched.' },
]

export const GLOSSARY = [
  ['Step (or phase)', 'One stage of a project, for example Legal / Agreements. It has an owner who does the work and an approver who signs it off.'],
  ['Submit for approval', 'Tells the named approver that the work is done. They are notified at once and see it in My work.'],
  ['Changes requested', 'The approver sent it back with a reason. The person who must fix it sees the reason on the card and in My work.'],
  ['Someone else approves', 'You can never approve your own work. A second person always decides.'],
  ['Dossier Ready', 'A milestone that opens when every preparation step is approved. Nobody works on it directly.'],
  ['Reopen request', 'Approved work is locked. To change it, ask for a reopen: a named person decides and the answer is recorded.'],
  ['RFI', 'Request for information: a question from the regulator that must be answered by a date.'],
  ['Locked', 'Approved and frozen. It cannot change unless a reopen is approved.'],
]

export const QA = [
  ['Where do I start?', 'Open My work. It lists everything waiting for you, most urgent first. Do the top item.'],
  ['Why is a button missing?', 'Your role does not do that step. The card always says who does, by name.'],
  ['I sent something. How do I know who has it?', 'The card says "Waiting for approval from" and the person\'s name, since when, and what they must do next.'],
  ['Someone sent my work back. What now?', 'Open it from My work > Returned to me. Read the reason, fix it, attach the corrected file and send it again.'],
  ['Where is the history?', 'Every card has its own history: who did what, when, and who it went to. The History tab shows the whole project.'],
]
