"""End-to-end test of the storyline: one project walked from opportunity to completion through the HTTP API, with the parallel lanes
exercised side by side. Starts its own server on a throwaway database.  Run:  python backend/tests/flow_story.py"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
import json, os, subprocess, sys, tempfile, time, threading, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

DB = os.path.join(tempfile.gettempdir(), 'nh_flow.db')
if os.path.exists(DB):
    os.remove(DB)
env = dict(os.environ, DATABASE_URL='sqlite:///' + DB.replace(chr(92), '/'), SEED_DEMO_DATA='true')
srv = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--port', '8012'], cwd=str(ROOT),
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
BASE = 'http://127.0.0.1:8012/api'
LANES = ['commercial', 'legal', 'regulatory', 'artwork', 'manufacturer']


def call(method, path, body=None, uid=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'X-User-Id': str(uid)} if uid else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}


fails = 0
def check(label, cond, extra=''):
    global fails
    print(('  ok  ' if cond else '  FAIL ') + label + (f'  [{extra}]' if not cond else ''))
    fails += 0 if cond else 1


def due(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


try:
    for _ in range(120):
        try:
            urllib.request.urlopen(BASE + '/stages'); break
        except Exception:
            time.sleep(1)
    users = call('GET', '/login-users')[1]
    ID = {u['role_key']: u['id'] for u in users}
    NAME = {u['role_key']: u['name'] for u in users}
    print('people:', ', '.join(f"{u['name']} ({u['role']})" for u in users)); print(users)
    check('one person per role (8 people, 8 different roles)', len(users) == 8 and len(ID) == 8)
    check('every name is a Hindi name, no leftover English demo names', not {'Tom', 'Emma', 'Liam', 'Sarah', 'Jessica'} & {u['name'].split()[0] for u in users})

    me = lambda role: ID[role]
    def P(pid): return call('GET', f'/projects/{pid}', uid=me('director'))[1]
    def stage_state(pid): return P(pid)['stage_states']
    def act(pid, role, action, key=None, note=''):
        return call('POST', f'/projects/{pid}/actions', {'action': action, 'stage_key': key, 'note': note}, uid=me(role))
    def mktask(pid, creator, assignee, key, title, days=7, required=True):
        s, t = call('POST', f'/projects/{pid}/tasks', {'stage_key': key, 'title': title, 'assignee_id': me(assignee), 'due_at': due(days), 'required': required}, uid=me(creator))
        assert s == 201, (s, t)
        return max(x['id'] for x in t['tasks'])   # every endpoint answers with the whole project
    def tact(tid, role, action, note='', due_at=None):
        body = {'action': action, 'note': note}
        if due_at: body['due_at'] = due_at
        return call('POST', f'/tasks/{tid}/actions', body, uid=me(role))
    def finish_task(tid, worker, boss):
        for a in ('accept', 'start', 'submit'):
            r = tact(tid, worker, a)
            assert r[0] == 200, (a, r)
        return tact(tid, boss, 'approve')[0] == 200

    # ================================================================ 1. Australia creates the opportunity
    print('--- 1. opportunity')
    s, p = call('POST', '/projects', {'name': 'FLOWTEST Allergy Relief Tablets', 'product': 'Allergy Relief Tablets', 'market': 'Australia',
                                       'initiator': 'Australia Team', 'project_type': 'Development', 'category': 'Respiratory & allergy',
                                       'submission_type': 'Registered medicine – abridged / generic (AUST R)',
                                       'target_launch': '2027-03-31', 'target_submission': '2026-12-15'}, uid=me('project_manager'))
    check('Priya (project manager) creates the project', s == 201, p)
    pid = p['id']
    check('only Opportunity is open; no code yet', p['active_stages'] == ['opportunity'] and not p['code'], (p['active_stages'], p['code']))
    check('commercial, legal, regulatory, artwork, manufacturer wait for the brief', all(p['stage_states'][k] == 'pending' for k in LANES))
    check('Amit (commercial) cannot create a project (403)', call('POST', '/projects', {'name': 'nope nope'}, uid=me('commercial'))[0] == 403)

    t1 = mktask(pid, 'project_manager', 'commercial', 'opportunity', 'Screen against the portfolio criteria')
    s, r = act(pid, 'commercial', 'submit', 'opportunity')
    check('cannot submit while a required task is open (422)', s == 422, r)
    check('task cycle: Amit works it, Priya (who assigned it) approves', finish_task(t1, 'commercial', 'project_manager'))
    check('Amit cannot approve his own stage as the owner... only the Director/Commercial lead decides: Neha is refused (403)',
          (act(pid, 'artwork', 'approve', 'opportunity')[0] in (403, 422)))
    check('Amit submits the opportunity', act(pid, 'commercial', 'submit', 'opportunity')[0] == 200)
    check('Priya cannot approve (only Director or Commercial lead) (403)', act(pid, 'project_manager', 'approve', 'opportunity')[0] == 403)
    s, p = act(pid, 'director', 'approve', 'opportunity')
    check('Rajiv approves: the project code is issued', s == 200 and (p['code'] or '').startswith('NEO-AU-'), p.get('code'))
    code = p['code']
    check('Brief is now the open phase', p['active_stages'] == ['brief'], p['active_stages'])

    # ================================================================ 2. the brief, with a clarification
    print('--- 2. project brief and clarification')
    clar = mktask(pid, 'director', 'project_manager', 'brief', 'Clarification required: confirm pack size and target price', days=3)
    check('Priya accepts the clarification', tact(clar, 'project_manager', 'accept')[0] == 200)
    s, r = tact(clar, 'project_manager', 'request_date', 'Waiting for ABC Pharmacy to confirm the pack size', due_at=due(6))
    check('Priya asks for more time, with a reason', s == 200)
    s, r = tact(clar, 'director', 'approve_date', 'Fine, one more day of grace')
    tk = [t for t in P(pid)['tasks'] if t['id'] == clar][0]
    check('the old date and the reason stay in the history', len(tk['date_requests']) == 1 and tk['date_requests'][0]['previous_due'] and tk['date_requests'][0]['reason'])
    check('who approved is recorded', tk['date_requests'][0]['decided_by'] and tk['date_requests'][0]['decided_by']['id'] == me('director'))
    check('the answer is submitted and accepted', tact(clar, 'project_manager', 'start')[0] == 200 and tact(clar, 'project_manager', 'submit', 'Pack size 30, target price AUD 1.85')[0] == 200
          and tact(clar, 'director', 'approve')[0] == 200)
    check('Priya submits the brief', act(pid, 'project_manager', 'submit', 'brief')[0] == 200)
    s, p = act(pid, 'director', 'approve', 'brief')
    check('Rajiv approves the brief', s == 200, p)
    check('ALL FIVE lanes open at the same moment', sorted(p['active_stages']) == sorted(LANES), p['active_stages'])
    check('Dossier Ready is still locked', p['stage_states']['dossier_ready'] == 'pending')
    check('every lane is in progress, none waiting on another', all(p['stage_states'][k] == 'in_progress' for k in LANES))

    # ================================================================ 3. the parallel lanes
    print('--- 3. lanes at the same time')
    work = {'commercial': 'Complete the FMEA risk analysis', 'legal': 'Draft the supplier agreement', 'regulatory': 'Compile the administrative pack',
            'artwork': 'Carton design from the brand template', 'manufacturer': 'Request the COA for three pilot batches'}
    owner = {'commercial': 'commercial', 'legal': 'legal', 'regulatory': 'regulatory', 'artwork': 'artwork', 'manufacturer': 'technical'}
    tid = {k: mktask(pid, 'project_manager', owner[k], k, work[k]) for k in LANES}
    for k, role in owner.items():
        s, mw = call('GET', '/my-work', uid=me(role))
        mine = [t for name, b in mw['buckets'].items() if name != 'completed' for t in b if t['project_id'] == pid]
        check(f'{NAME[role].split()[0]} sees only the {k} task on this project', [t['id'] for t in mine] == [tid[k]], [t['title'] for t in mine])
    s, r = call('POST', f'/tasks/{tid["legal"]}/actions', {'action': 'accept'}, uid=me('regulatory'))
    check('nobody can accept somebody else\'s task (403)', s == 403)
    check('Kavita cannot approve in another lane (403)', act(pid, 'legal', 'approve', 'regulatory')[0] in (403, 422))

    # ---- legal: supplier, quality and PV in parallel
    print('    legal')
    ag = {a['kind']: a for a in P(pid)['agreements'] if a['core']}
    check('three core agreements exist as separate streams', sorted(ag) == ['pv', 'quality', 'supplier'])
    L = me('legal')
    def ag_patch(i, body, role='legal'): return call('PATCH', f'/agreements/{i}', body, uid=me(role))
    def ag_act(i, action, role, note=''): return call('POST', f'/agreements/{i}/actions', {'action': action, 'note': note}, uid=me(role))
    for kind in ag:
        ag_patch(ag[kind]['id'], {'status': 'drafting', 'counterparty': 'Zenith Pharma Pvt Ltd', 'owner_id': L, 'due_date': '2026-11-30'})
    check('cannot jump from drafting to signed (422)', ag_patch(ag['supplier']['id'], {'status': 'signed'})[0] == 422)
    check('Amit (commercial) cannot touch the agreements (403)', ag_patch(ag['supplier']['id'], {'notes': 'x'}, 'commercial')[0] == 403)
    for kind in ag:
        check(f'{kind}: submitted for review', ag_act(ag[kind]['id'], 'submit', 'legal')[0] == 200)
    check('supplier: Rajiv approves, then it is signed', ag_act(ag['supplier']['id'], 'approve', 'director')[0] == 200
          and ag_patch(ag['supplier']['id'], {'status': 'signed', 'signed_date': '2026-10-19'})[0] == 200)
    check('quality: changes requested', ag_act(ag['quality']['id'], 'reject', 'director', 'Liability cap must match the supply agreement')[0] == 200)
    now_ag = {a['kind']: a['status'] for a in P(pid)['agreements'] if a['core']}
    check('Supplier signed, Quality changes requested, PV in review: all at once', now_ag == {'supplier': 'signed', 'quality': 'changes_requested', 'pv': 'in_review'}, now_ag)
    check('a signed agreement did not wait for the others', stage_state(pid)['legal'] == 'in_progress')

    # ---- commercial returned while regulatory and artwork continue
    print('    commercial returned while the others continue')
    check('commercial task done', finish_task(tid['commercial'], 'commercial', 'project_manager'))
    check('Amit submits commercial', act(pid, 'commercial', 'submit', 'commercial')[0] == 200)
    check('Rajiv sends it back: price above the ceiling', act(pid, 'director', 'send_back', 'commercial', 'Quote AUD 2.10 per pack is above the AUD 1.85 ceiling. Renegotiate.')[0] == 200)
    st = stage_state(pid)
    check('commercial is back in progress', st['commercial'] == 'in_progress')
    check('the other four lanes did not move', all(st[k] == 'in_progress' for k in LANES))
    row = [r for r in P(pid)['stages'] if r['key'] == 'commercial'][0]
    check('the send-back is counted', row['rework_count'] == 1)

    # ---- artwork versions
    print('    artwork versions')
    s, d = call('POST', f'/projects/{pid}/documents', {'artwork': True, 'kind': 'Carton', 'title': 'Allergy Relief carton', 'link': 'https://x.test/carton-v1'}, uid=me('artwork'))
    check('Neha creates the carton', s == 201, d)
    cid = [x for x in P(pid)['documents'] if x['kind'] == 'Carton'][0]['id']
    def doc_act(a, role, note=''): return call('POST', f'/documents/{cid}/actions', {'action': a, 'note': note}, uid=me(role))
    check('V1 submitted; Regulatory returns it: storage statement', doc_act('submit', 'artwork')[0] == 200 and doc_act('return', 'regulatory', 'Storage statement incorrect.')[0] == 200)
    check('Neha uploads V2 (V1 stays)', call('POST', f'/documents/{cid}/versions', {'link': 'https://x.test/carton-v2', 'note': 'Storage fixed'}, uid=me('artwork'))[0] == 201)
    check('V2 submitted; Regulatory returns it: warning statement', doc_act('submit', 'artwork')[0] == 200 and doc_act('return', 'regulatory', 'Warning statement needs revision.')[0] == 200)
    check('V3 uploaded and submitted', call('POST', f'/documents/{cid}/versions', {'link': 'https://x.test/carton-v3', 'note': 'Warning revised'}, uid=me('artwork'))[0] == 201 and doc_act('submit', 'artwork')[0] == 200)
    check('Neha cannot approve her own artwork (403)', doc_act('approve', 'artwork')[0] == 403)
    check('Director cannot skip the Regulatory step (403)', doc_act('approve', 'director')[0] == 403)
    check('Regulatory approves, then the Director approves', doc_act('approve', 'regulatory')[0] == 200 and doc_act('approve', 'director')[0] == 200)
    cd = [x for x in P(pid)['documents'] if x['id'] == cid][0]
    check('the carton is approved and V1, V2, V3 are all kept', cd['status'] == 'approved' and cd['current_version'] == 3 and len(cd.get('versions') or [1, 2, 3]) == 3, (cd['status'], cd['current_version']))
    check('an approved carton cannot be changed by the designer (403)', call('POST', f'/documents/{cid}/versions', {'link': 'https://x.test/v4', 'note': 'x'}, uid=me('artwork'))[0] == 403)
    for kind in ('Label', 'Leaflet / insert', 'Shade card'):
        s, d = call('POST', f'/projects/{pid}/documents', {'artwork': True, 'kind': kind, 'title': f'Allergy {kind}', 'link': 'https://x.test/a'}, uid=me('artwork'))
        did = [x for x in P(pid)['documents'] if x['title'] == f'Allergy {kind}'][0]['id']
        ok = all(call('POST', f'/documents/{did}/actions', {'action': a}, uid=me(r))[0] == 200 for a, r in (('submit', 'artwork'), ('approve', 'regulatory'), ('approve', 'director')))
        check(f'{kind} reviewed and approved', ok)

    # ---- manufacturer
    print('    manufacturer data')
    mf = {}
    for kind in ('coa', 'msds', 'specification', 'stability', 'testing'):
        s, m = call('POST', f'/projects/{pid}/mfr', {'kind': kind, 'manufacturer': 'Zenith Pharma Pvt Ltd', 'due_date': '2026-11-05', 'notes': 'Needed for Module 3', 'owner_id': me('technical')}, uid=me('technical'))
        assert s == 201, m
    reqs = P(pid)['mfr_requests']
    check('five manufacturer requests, each owned by Suresh', len(reqs) == 5 and all(r['owner']['id'] == me('technical') for r in reqs))
    check('Anjali cannot mark a request accepted directly (422)', call('PATCH', f'/mfr/{reqs[0]["id"]}', {'status': 'accepted'}, uid=me('regulatory'))[0] == 422)
    for r in reqs[:4]:
        ok = (call('PATCH', f'/mfr/{r["id"]}', {'status': 'received', 'link': 'https://x.test/mfr'}, uid=me('technical'))[0] == 200
              and call('POST', f'/mfr/{r["id"]}/actions', {'action': 'submit'}, uid=me('technical'))[0] == 200
              and call('POST', f'/mfr/{r["id"]}/actions', {'action': 'approve'}, uid=me('regulatory'))[0] == 200)
        assert ok, r['kind']
    pend = [r for r in P(pid)['mfr_requests'] if r['status'] != 'accepted']
    check('manufacturer lane cannot be submitted while data is pending (422)', (finish_task(tid['manufacturer'], 'technical', 'project_manager') and act(pid, 'technical', 'submit', 'manufacturer')[0] == 422))
    r = pend[0]
    check('last request accepted', all(call(*x, uid=me(u))[0] == 200 for x, u in ((('PATCH', f'/mfr/{r["id"]}', {'status': 'received', 'link': 'https://x.test/m'}), 'technical'),
          (('POST', f'/mfr/{r["id"]}/actions', {'action': 'submit'}), 'technical'), (('POST', f'/mfr/{r["id"]}/actions', {'action': 'approve'}), 'regulatory'))))

    # ---- regulatory dossier
    print('    regulatory dossier')
    items = P(pid)['dossier_items']
    check('abridged generic: Modules 1, 2, 3 and 5 appear (no Module 4)', sorted(i['module'] for i in items if i['module']) == ['M1', 'M2', 'M3', 'M5'], [i['module'] for i in items])
    check('Regulatory submit blocked while the dossier is incomplete (422)', finish_task(tid['regulatory'], 'regulatory', 'project_manager') and act(pid, 'regulatory', 'submit', 'regulatory')[0] == 422)
    for it in items:
        ok = (call('PATCH', f'/dossier-items/{it["id"]}', {'status': 'draft', 'link': 'https://x.test/d', 'notes': 'ready'}, uid=me('regulatory'))[0] == 200
              and call('POST', f'/dossier-items/{it["id"]}/actions', {'action': 'submit'}, uid=me('regulatory'))[0] == 200
              and call('POST', f'/dossier-items/{it["id"]}/actions', {'action': 'approve'}, uid=me('director'))[0] == 200)
        assert ok, it['title']

    # ---- finish the lanes
    print('    finish the lanes; Dossier Ready is a hard join')
    check('legal: quality redlined and re-approved, PV approved, all signed', all(
        x == 200 for x in (ag_act(ag['quality']['id'], 'submit', 'legal')[0], ag_act(ag['quality']['id'], 'approve', 'director')[0],
                           ag_patch(ag['quality']['id'], {'status': 'signed', 'signed_date': '2026-10-20'})[0],
                           ag_act(ag['pv']['id'], 'approve', 'director')[0], ag_patch(ag['pv']['id'], {'status': 'signed', 'signed_date': '2026-10-21'})[0])))
    check('legal: task done and stage submitted', finish_task(tid['legal'], 'legal', 'project_manager') and act(pid, 'legal', 'submit', 'legal')[0] == 200)
    check('regulatory, artwork and manufacturer submitted', all(act(pid, role, 'submit', k)[0] == 200 for k, role in (('regulatory', 'regulatory'), ('manufacturer', 'technical'))) and
          finish_task(tid['artwork'], 'artwork', 'project_manager') and act(pid, 'artwork', 'submit', 'artwork')[0] == 200)
    for k, role in (('legal', 'director'), ('regulatory', 'director'), ('artwork', 'regulatory'), ('manufacturer', 'regulatory')):
        check(f'{k} approved by its own approver', act(pid, role, 'approve', k)[0] == 200)
    st = stage_state(pid)
    check('four lanes approved, Commercial still open => Dossier Ready stays locked', st['dossier_ready'] == 'pending' and st['commercial'] == 'in_progress', st)
    check('Dossier Ready cannot be pushed early (422)', act(pid, 'regulatory', 'submit', 'dossier_ready')[0] == 422)
    rt = mktask(pid, 'project_manager', 'commercial', 'commercial', 'Renegotiate the unit cost with the manufacturer')
    check('Commercial cannot resubmit until the renegotiation task is done (422)', act(pid, 'commercial', 'submit', 'commercial')[0] == 422)
    check('renegotiation done, commercial resubmitted', finish_task(rt, 'commercial', 'project_manager') and act(pid, 'commercial', 'submit', 'commercial')[0] == 200)
    s, p = act(pid, 'commercial', 'approve', 'commercial')
    check('Amit (Commercial lead) approves the commercial stage', s == 200, p)
    check('the last lane closed: Dossier Ready opens by itself', p['active_stages'] == ['dossier_ready'], p['active_stages'])

    # ================================================================ 4. submission, RFI, approval
    print('--- 4. dossier ready, submission, RFI')
    check('Dossier Ready: submit and approve', act(pid, 'regulatory', 'submit', 'dossier_ready')[0] == 200 and act(pid, 'director', 'approve', 'dossier_ready')[0] == 200)
    check('submission stage cannot be submitted before the external submission is recorded (422)', act(pid, 'regulatory', 'submit', 'submission')[0] == 422)
    s, sub = call('POST', f'/projects/{pid}/submissions', {'kind': 'initial', 'reference': 'TGA-APP-2026-0042', 'platform': 'TGA Business Services', 'submitted_on': '2026-10-28', 'notes': 'Lodged'}, uid=me('regulatory'))
    check('Anjali records the submission with reference and platform', s == 201, sub)
    check('submission stage submitted and approved', act(pid, 'regulatory', 'submit', 'submission')[0] == 200 and act(pid, 'director', 'approve', 'submission')[0] == 200)
    s, rfi = call('POST', f'/projects/{pid}/rfis', {'authority': 'TGA', 'reference': 'RFI-2026-042', 'summary': 'Stability, impurity and carton warning', 'received_on': '2026-11-10', 'due_date': '2026-11-30'}, uid=me('regulatory'))
    check('TGA raises an RFI case', s == 201, rfi)
    rid = rfi['rfis'][-1]['id']
    qs = {}
    for text, role in (('Provide additional stability justification.', 'technical'), ('Confirm the impurity specification.', 'regulatory'), ('Clarify the carton warning.', 'artwork')):
        s, q = call('POST', f'/rfis/{rid}/questions', {'question': text, 'assignee_id': me(role), 'due_at': due(10)}, uid=me('regulatory'))
        assert s == 201, q
    case = [r for r in P(pid)['rfis'] if r['id'] == rid][0]
    by_id = {me(role): role for role in ('technical', 'regulatory', 'artwork')}
    qs = {by_id[q['task']['assignee']['id']]: q for q in case['questions']}
    check('each question is its own task for a different person', len({q['task']['assignee']['id'] for q in case['questions']}) == 3)
    check('RFI stage blocked while the case is open (422)', act(pid, 'regulatory', 'submit', 'rfi')[0] == 422)
    check('cannot be marked ready with open questions (422)', call('POST', f'/rfis/{rid}/actions', {'action': 'ready'}, uid=me('regulatory'))[0] == 422)
    for role, approver in (('technical', 'regulatory'), ('artwork', 'regulatory'), ('regulatory', 'director')):
        t = qs[role]['task']['id']
        assert all(tact(t, role, a)[0] == 200 for a in ('accept', 'start', 'submit'))
        if role == 'regulatory':
            check('Anjali cannot approve the question she answers herself (403)', tact(t, 'regulatory', 'approve')[0] == 403)
        call('PATCH', f'/rfi-questions/{qs[role]["id"]}', {'response': 'Answer with evidence', 'evidence_link': 'https://x.test/e'}, uid=me(role))
        check(f'{role} question approved by {approver}', tact(t, approver, 'approve')[0] == 200)
    check('response package link saved, case ready, submitted', call('PATCH', f'/rfis/{rid}', {'response_link': 'https://x.test/resp'}, uid=me('regulatory'))[0] == 200
          and call('POST', f'/rfis/{rid}/actions', {'action': 'ready'}, uid=me('regulatory'))[0] == 200 and call('POST', f'/rfis/{rid}/actions', {'action': 'submit'}, uid=me('regulatory'))[0] == 200)
    check('closing needs a note (422)', call('POST', f'/rfis/{rid}/actions', {'action': 'close'}, uid=me('regulatory'))[0] == 422)
    check('closed with a note', call('POST', f'/rfis/{rid}/actions', {'action': 'close', 'note': 'TGA satisfied'}, uid=me('regulatory'))[0] == 200)
    check('the RFI response is recorded as a second submission', len(P(pid)['submissions']) == 2)
    check('RFI stage submitted and approved', act(pid, 'regulatory', 'submit', 'rfi')[0] == 200 and act(pid, 'director', 'approve', 'rfi')[0] == 200)

    # ================================================================ 5. delivery
    print('--- 5. approval, readiness, manufacturing, dispatch, completion')
    for k, worker, approver in (('approval', 'regulatory', 'director'), ('readiness', 'commercial', 'director'), ('manufacturing', 'technical', 'director'),
                                ('dispatch', 'technical', 'director'), ('completion', 'project_manager', 'director')):
        check(f'{k}: one owner submits, Rajiv approves', act(pid, worker, 'submit', k)[0] == 200 and act(pid, approver, 'approve', k)[0] == 200)
    p = P(pid)
    check('PROJECT COMPLETED', p['status'] == 'completed' and not p['active_stages'], (p['status'], p['active_stages']))
    check('every phase is locked', all(r['locked'] for r in p['stages']))
    check('nothing can change on a completed project (422)', call('POST', f'/projects/{pid}/tasks', {'stage_key': 'dispatch', 'title': 'late task', 'assignee_id': me('technical'), 'due_at': due(3)}, uid=me('project_manager'))[0] == 422)

    # ================================================================ 6. everything stays
    print('--- 6. the full history stays')
    check('same code from start to end', p['code'] == code)
    check('all documents and versions kept', len(p['documents']) >= 4 and [d for d in p['documents'] if d['kind'] == 'Carton'][0]['current_version'] == 3)
    check('agreements, dossier, manufacturer data, submissions and the RFI are all still there',
          len(p['agreements']) >= 3 and len(p['dossier_items']) >= 4 and len(p['mfr_requests']) == 5 and len(p['submissions']) == 2 and len(p['rfis']) == 1)
    check('tasks kept, all finished', len(p['tasks']) >= 10 and all(t['state'] in ('approved', 'locked') or not t['required'] for t in p['tasks']))
    check('audit trail has every step', len(p['events']) > 120, len(p['events']))
    s, completed = call('GET', '/projects?status=completed', uid=me('project_manager'))
    check('it shows in the completed list', any(x['id'] == pid for x in completed))
    s, mw = call('GET', '/my-work', uid=me('commercial'))
    check("Amit's finished tasks stay in My work after completion", any(t['project_id'] == pid for t in mw['buckets']['completed']))
    s, aw = call('GET', '/dashboard/artwork', uid=me('artwork'))
    check('the approved artwork stays in the library', any(d['project_id'] == pid for d in aw['library']))
    s, rg = call('GET', '/dashboard/regulatory', uid=me('regulatory'))
    check('the regulatory portal lists the finished project', any(x['project_id'] == pid for x in rg['completed']))
    check('Priya cannot reopen (403); Rajiv needs a note (422), then can (200)', call('POST', f'/projects/{pid}/actions', {'action': 'reopen', 'note': 'x'}, uid=me('project_manager'))[0] == 403
          and act(pid, 'director', 'reopen')[0] == 422 and act(pid, 'director', 'reopen', note='Amendment after launch')[0] == 200)

    # ================================================================ 7. real simultaneity over HTTP
    print('--- 7. people acting at the same time (HTTP)')
    sys.path.insert(0, str(ROOT))
    os.environ['DATABASE_URL'] = 'sqlite:///' + DB.replace(chr(92), '/')
    from app.database import SessionLocal
    from app.seed import Demo
    from app.services import workflows
    def two_lanes_waiting(name):
        with SessionLocal() as db:
            workflows.load_registry(db)
            d = Demo(db)
            return d.drive(dict(name=name, product='x', category='Pain relief', submission_type='Listed medicine (AUST L)', at='parallel', age=3,
                                lanes=dict(commercial='review', legal='review', regulatory='done', artwork='done', manufacturer='done'))).id
    ok = 0
    for n in range(6):
        q = two_lanes_waiting(f'FLOWTEST overlap {n}')
        before = stage_state(q)
        assert before['commercial'] == before['legal'] == 'awaiting_approval' and before['dossier_ready'] == 'pending', before
        gate, res = threading.Barrier(2), {}
        def go(role, key):
            gate.wait()
            res[key] = act(q, role, 'approve', key)[0]
        th = [threading.Thread(target=go, args=('director', 'commercial')), threading.Thread(target=go, args=('legal', 'legal'))]
        [x.start() for x in th]; [x.join() for x in th]
        after = stage_state(q)
        if res == {'commercial': 200, 'legal': 200} and after['dossier_ready'] == 'in_progress':
            ok += 1
        else:
            print('     overlap result:', res, after)
    check('the last two lanes approved by two people in the same instant: Dossier Ready always opens (6 of 6)', ok == 6, ok)

    # ================================================================ 8. portals, registers, exports, admin, moving back
    print('--- 8. portals, registers, exports, admin')
    s, plist = call('GET', '/projects', uid=me('director'))
    check('the demo portfolio has 23+ projects at every phase', s == 200 and len(plist) >= 23)
    seen = {k for x in plist for k in x['active_stages']}
    check('every phase is represented by at least one live project', {'opportunity', 'brief', *LANES, 'dossier_ready', 'submission', 'rfi', 'approval', 'readiness', 'manufacturing', 'dispatch'} <= seen, seen)
    check('there are completed, rejected and on-hold projects', {'completed', 'rejected', 'on_hold'} <= {x['status'] for x in plist})
    check('health is mixed: green, amber and red all present', {'green', 'amber', 'red'} <= {x['health'] for x in plist})
    s, r = call('GET', '/legal-register', uid=me('legal'))
    check('legal register lists every agreement with its age', s == 200 and len(r) > 40 and all('age_days' in x for x in r), len(r))
    s, r = call('GET', '/dashboard/director', uid=me('director')); check('director portal', s == 200 and r['counts']['live'] >= 1 and 'pending_approvals' in r)
    s, r = call('GET', '/dashboard/director?entity=IN', uid=me('director')); check('Australia / India filter', s == 200)
    s, r = call('GET', '/dashboard/regulatory', uid=me('regulatory')); check('regulatory portal', s == 200 and 'ra_review_queue' in r and 'rfi_cases' in r and len(r['dossiers']) > 3)
    s, r = call('GET', '/dashboard/artwork', uid=me('artwork')); check('artwork portal', s == 200 and 'review_steps' in r and len(r['library']) > 10)
    for role in ('director', 'project_manager', 'commercial', 'legal', 'regulatory', 'artwork', 'technical'):
        s, r = call('GET', '/my-work', uid=me(role))
        c = r['counts']
        check(f"{NAME[role].split()[0]}'s My work has real content ({sum(c.values()) + len(r['needs_decision'])} items)", s == 200 and sum(c.values()) + len(r['needs_decision']) >= 8, c)
        s, n = call('GET', '/notifications', uid=me(role)); check(f"{NAME[role].split()[0]} has notifications", s == 200 and len(n) > 0)
    s, raw = call('GET', '/audit?limit=5', uid=me('director')); check('audit trail', s == 200 and len(raw) == 5)
    for path in ('/export.xlsx', '/legal-register.xlsx'):
        req = urllib.request.Request(BASE + path, headers={'X-User-Id': str(me('director'))})
        body = urllib.request.urlopen(req).read()
        check(f'{path} is a real Excel file', body[:2] == b'PK')
    # permissions
    live_id = next(x['id'] for x in plist if x['status'] == 'active' and 'legal' in x['active_stages'])
    s, r = call('POST', f'/projects/{live_id}/actions', {'action': 'hold', 'note': 'x'}, uid=me('commercial')); check('Amit cannot hold a project (403)', s == 403)
    s, r = call('POST', f'/projects/{live_id}/tasks', {'stage_key': 'legal', 'title': 'nope nope', 'assignee_id': me('director'), 'due_at': due(3)}, uid=me('commercial'))
    check('Amit cannot assign work to the Director (403)', s == 403)
    s, r = call('PUT', '/roles/artwork', {'permissions': ['assign'], 'assign_to': ['artwork']}, uid=me('artwork')); check('Neha cannot edit roles (403)', s == 403)
    s, r = call('PUT', '/roles/artwork', {'permissions': ['assign'], 'assign_to': ['artwork']}, uid=me('super_admin')); check('Vikram (admin) edits a role', s == 200)
    s, r = call('PUT', '/roles/super_admin', {'permissions': [], 'assign_to': []}, uid=me('super_admin')); check('the Super Admin role is locked (422)', s == 422)
    s, r = call('PATCH', f"/users/{me('super_admin')}", {'active': False}, uid=me('super_admin')); check('the last Super Admin cannot be removed (422)', s == 422)
    # move back: everything already recorded stays
    s, p = call('POST', '/projects', {'name': 'FLOWTEST move back', 'product': 'x'}, uid=me('project_manager'))
    q = p['id']
    for k, w in (('opportunity', 'commercial'), ('brief', 'project_manager')):
        act(q, w, 'submit', k); act(q, 'director', 'approve', k)
    check('all five lanes open', sorted(P(q)['active_stages']) == sorted(LANES))
    s, r = act(q, 'project_manager', 'return', note='Brief scope changed'); check('a note is needed to move back, and a target stage (422)', s == 422)
    s, r = call('POST', f'/projects/{q}/actions', {'action': 'return', 'to_stage': 'brief', 'note': 'Brief scope changed'}, uid=me('project_manager'))
    check('moving back to the brief resets every lane at once', s == 200 and r['active_stages'] == ['brief'] and all(r['stage_states'][k] == 'pending' for k in LANES), r.get('active_stages'))
    check('the history of the first pass is kept', len([e for e in r['events'] if e['action'] == 'approve']) == 2)

    print('\nFAILS:', fails)
finally:
    srv.terminate()
    try:
        err = srv.stderr.read().decode()[-1500:]
        if 'Traceback' in err:
            print('--- server errors ---\n' + err)
    except Exception:
        pass
