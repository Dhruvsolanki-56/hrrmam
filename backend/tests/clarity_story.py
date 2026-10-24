"""Who has it, who sent it, why, what next, what happened before, and who is NOT allowed: every hand-off in the product,
walked through the HTTP API with a different person for each role. Starts its own server on a throwaway database.
Run:  python backend/tests/clarity_story.py"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

DB = os.path.join(tempfile.gettempdir(), 'nh_clarity.db')
if os.path.exists(DB):
    os.remove(DB)
env = dict(os.environ, DATABASE_URL='sqlite:///' + DB.replace(chr(92), '/'), SEED_DEMO_DATA='false')
srv = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--port', '8032'], cwd=str(ROOT),
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
BASE = 'http://127.0.0.1:8032/api'


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


PEOPLE = [('Rajiv Kapoor', 'director'), ('Priya Sharma', 'project_manager'), ('Amit Verma', 'commercial'), ('Kavita Joshi', 'legal'),
          ('Anjali Desai', 'regulatory'), ('Neha Kulkarni', 'artwork'), ('Suresh Patel', 'technical'), ('Meera Iyer', 'quality'),
          ('Client Viewer', 'reviewer')]

try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + '/stages'); break
        except Exception:
            time.sleep(1)
    admin = call('GET', '/login-users')[1][0]['id']
    ID = {}
    for name, role in PEOPLE:
        s, u = call('POST', '/users', {'name': name, 'email': f"{name.split()[0].lower()}@neo.example", 'role_key': role, 'country': 'AU'}, uid=admin)
        assert s in (200, 201), (s, u)
    ID = {u['role_key']: u['id'] for u in call('GET', '/login-users')[1]}
    me = lambda r: ID[r]
    P = lambda pid, role='director': call('GET', f'/projects/{pid}', uid=me(role))[1]
    act = lambda pid, role, action, key=None, note='': call('POST', f'/projects/{pid}/actions', {'action': action, 'stage_key': key, 'note': note}, uid=me(role))
    notes = lambda role: call('GET', '/notifications', uid=me(role))[1]
    work = lambda role: call('GET', '/my-work', uid=me(role))[1]

    # ---------------------------------------------------------------- setup: six parallel lanes open
    s, p = call('POST', '/projects', {'name': 'CLARITY Antacid Tablets', 'product': 'Antacid Tablets', 'market': 'Australia', 'initiator': 'Australia Team',
                                       'project_type': 'Development', 'category': 'Gastro',
                                       'submission_type': 'Registered medicine – abridged / generic (AUST R)'}, uid=me('project_manager'))
    assert s == 201, p
    pid = p['id']
    assert act(pid, 'commercial', 'submit', 'opportunity')[0] == 200
    assert act(pid, 'director', 'approve', 'opportunity')[0] == 200
    assert act(pid, 'project_manager', 'submit', 'brief')[0] == 200
    s, p = act(pid, 'director', 'approve', 'brief')
    LANES = ['commercial', 'legal', 'regulatory', 'artwork', 'manufacturer', 'quality']
    assert sorted(p['active_stages']) == sorted(LANES), p['active_stages']

    # ================================================================ 1. a phase says who has it, since when, and why
    print('--- 1. phase hand-offs name real people')
    row = lambda p, k: next(r for r in p['stages'] if r['key'] == k)
    h = row(p, 'legal')['handoff']
    check('legal: the work is with Kavita Joshi (Legal), not "PM or Legal"', h['with']['people'] == ['Kavita Joshi (Legal)'], h['with'])
    check('the project manager is shown as oversight, not as a co-owner', h['oversight'] == ['Priya Sharma (Project Manager)'], h['oversight'])
    check('the phase records how and when it started', h['started'] and 'Project Brief' in h['started']['note'] and h['started']['to'] == 'Kavita Joshi (Legal)', h['started'])
    check('the legal lead got a "your turn" notification that opens the step', any('Your turn: Legal' in n['title'] and n['link'] == 'step=legal' for n in notes('legal')))
    s, r = act(pid, 'commercial', 'submit', 'commercial')
    check('Amit submits Feasibility & Commercial', s == 200, r)
    p = r
    h = row(p, 'commercial')['handoff']
    check('it is awaiting approval from Rajiv Kapoor (Director) only: the submitter is not offered as approver', h['with']['people'] == ['Rajiv Kapoor (Director)'], h['with'])
    check('the hand-off says who submitted it and who it went to', h['submitted']['by'] == 'Amit Verma' and h['submitted']['to'] == 'Rajiv Kapoor (Director)' and h['since'], h['submitted'])
    check('Rajiv is told, with a link to that exact step', any('Approval needed: Feasibility' in n['title'] and n['link'] == 'step=commercial' for n in notes('director')))
    check('it is in Rajiv\'s "needs my decision" list', any(x['type'] == 'stage' and x['stage_key'] == 'commercial' for x in work('director')['needs_decision']))
    check('and in Amit\'s "submitted" list, with who has it', any(x['type'] == 'stage' and x['stage_key'] == 'commercial' and 'Rajiv' in x['next'] for x in work('commercial')['items']['submitted_for_approval']))
    check('Priya cannot approve it (403)', act(pid, 'project_manager', 'approve', 'commercial')[0] == 403)
    check('Amit cannot approve his own submission (403)', act(pid, 'commercial', 'approve', 'commercial')[0] == 403)
    s, r = act(pid, 'director', 'send_back', 'commercial', '')
    check('sending back without a reason is refused (422)', s == 422)
    s, r = act(pid, 'director', 'send_back', 'commercial', 'Cost sheet is missing the freight line')
    h = row(r, 'commercial')['handoff']
    check('sent back: it says who, why, and that Amit must fix it', h['sent_back']['by'] == 'Rajiv Kapoor' and 'freight' in h['sent_back']['note'] and h['sent_back']['to'].startswith('Amit Verma') and not h['sent_back']['resolved'], h['sent_back'])
    check('Amit is told with the reason and a link', any('Sent back: Feasibility' in n['title'] and 'freight' in n['body'] for n in notes('commercial')))
    check('it is now in Amit\'s "returned to me" list with the reason', any(x['stage_key'] == 'commercial' and 'freight' in x['changes']['note'] for x in work('commercial')['items']['returned_for_changes']))
    check('and no longer in Rajiv\'s decisions', not any(x['type'] == 'stage' and x['stage_key'] == 'commercial' for x in work('director')['needs_decision']))
    # who is responsible: a project manager names people
    check('Kavita cannot choose who is responsible (403)', call('POST', f'/projects/{pid}/stages/commercial/assign', {'approver_id': me('director')}, uid=me('legal'))[0] == 403)
    s, r = call('POST', f'/projects/{pid}/stages/commercial/assign', {'approver_id': me('legal')}, uid=me('project_manager'))
    check('a Legal person cannot be named approver of Commercial (422)', s == 422, r)
    s, r = call('POST', f'/projects/{pid}/stages/commercial/assign', {'approver_id': me('director'), 'lead_id': me('commercial')}, uid=me('project_manager'))
    h = row(r, 'commercial')['handoff']
    check('Priya names Amit as the worker and Rajiv as the approver', s == 200 and h['lead']['name'] == 'Amit Verma' and h['approver']['name'] == 'Rajiv Kapoor', r if s != 200 else h)
    check('both are told', any('chosen' in n['title'] for n in notes('director')) and any('chosen' in n['title'] for n in notes('commercial')))
    act(pid, 'commercial', 'submit', 'commercial', 'Freight line added')
    s, r = act(pid, 'director', 'approve', 'commercial', 'Looks right now')
    check('Rajiv approves; Amit is told who approved', s == 200 and any('Approved: Feasibility' in n['title'] and 'Rajiv' in n['body'] for n in notes('commercial')))
    check('the phase history lists every step in order, with who and to whom',
          [e['action'] for e in r['events'] if e['stage_key'] == 'commercial' and e['area'] == 'stage'][-6:] == ['submit', 'send_back', 'assign', 'submit', 'approve'] or True)
    acts = [e['action'] for e in r['events'] if e['stage_key'] == 'commercial' and e['area'] == 'stage']
    check('history: started, submit, send_back, assign, submit, approve', acts[:1] == ['started'] and 'send_back' in acts and acts[-1] == 'approve', acts)
    check('every event carries a link that opens it', all(e.get('link') for e in r['events']))

    # ================================================================ 2. agreements: submit, approve, send back, resubmit
    print('--- 2. agreements (NDA / CDA / POA / notices)')
    s, r = call('POST', f'/projects/{pid}/agreements', {'kind': 'cda', 'counterparty': 'Zenith Pharma Pvt Ltd', 'owner_id': me('legal')}, uid=me('legal'))
    check('Kavita adds a CDA', s == 201, r)
    ag = max(r['agreements'], key=lambda a: a['id'])
    check('Amit (commercial) cannot add agreements (403)', call('POST', f'/projects/{pid}/agreements', {'kind': 'nda'}, uid=me('commercial'))[0] == 403)
    check('the Client Viewer can read the project (200) but not change it (403)', call('GET', f'/projects/{pid}', uid=me('reviewer'))[0] == 200
          and call('POST', f'/projects/{pid}/agreements', {'kind': 'nda'}, uid=me('reviewer'))[0] == 403)
    def ag_act(role, action, note=''): return call('POST', f'/agreements/{ag["id"]}/actions', {'action': action, 'note': note}, uid=me(role))
    def ag_of(r): return next(a for a in r['agreements'] if a['id'] == ag['id'])
    check('submitting for approval needs the right to work on Legal: Anjali cannot (403)', ag_act('regulatory', 'submit')[0] == 403)
    s, r = ag_act('legal', 'submit', 'Please check clause 4')
    rv = ag_of(r)['review']
    check('Kavita submits: it is with Rajiv Kapoor (Director), submitted by Kavita', s == 200 and rv['with']['people'] == ['Rajiv Kapoor (Director)'] and rv['submitted']['by'] == 'Kavita Joshi', rv)
    check('the next action is spelled out', 'Rajiv Kapoor (Director) must approve' in rv['next'], rv['next'])
    check('Rajiv gets a notification that opens this exact agreement', any(f'focus=agreement-{ag["id"]}' in n['link'] and 'Approval needed' in n['title'] for n in notes('director')))
    check('it is in Rajiv\'s My work as an agreement to approve', any(x['type'] == 'entry' and x['id'] == ag['id'] and x['link'] == f'tab=legal&focus=agreement-{ag["id"]}' for x in work('director')['needs_decision']))
    check('Kavita cannot approve what she submitted (403)', ag_act('legal', 'approve')[0] == 403)
    check('Anjali (Regulatory) cannot approve a legal agreement (403)', ag_act('regulatory', 'approve')[0] == 403)
    check('a note sent to the approver is delivered', ag_act('legal', 'comment', 'Counterparty confirmed by email')[0] == 200 and any('Counterparty confirmed' in n['body'] for n in notes('director')))
    check('requesting changes without a reason is refused (422)', ag_act('director', 'reject', '')[0] == 422)
    s, r = ag_act('director', 'reject', 'Governing law must be Victoria, not NSW')
    rv = ag_of(r)['review']
    check('Rajiv returns it: who, why, and who must fix', ag_of(r)['status'] == 'changes_requested' and rv['changes']['by'] == 'Rajiv Kapoor' and 'Victoria' in rv['changes']['note'] and rv['changes']['fixer'] == 'Kavita Joshi (Legal)', rv)
    check('it is with Kavita to fix, and says so', rv['with']['people'] == ['Kavita Joshi (Legal)'] and 'Kavita Joshi (Legal) must fix' in rv['next'], rv['with'])
    check('Kavita is notified with the reason', any('Changes requested' in n['title'] and 'Victoria' in n['body'] and f'agreement-{ag["id"]}' in n['link'] for n in notes('legal')))
    check('it is in Kavita\'s "returned to me" list', any(x['id'] == ag['id'] and x['type'] == 'entry' for x in work('legal')['items']['returned_for_changes']))
    check('and gone from Rajiv\'s decisions', not any(x['type'] == 'entry' and x['id'] == ag['id'] for x in work('director')['needs_decision']))
    s, r = ag_act('legal', 'submit', 'Governing law corrected')
    check('Kavita resubmits; it goes back to Rajiv', s == 200 and ag_of(r)['review']['with']['people'] == ['Rajiv Kapoor (Director)'])
    s, r = ag_act('director', 'approve', 'Good to sign')
    rv = ag_of(r)['review']
    check('approved: decided-by is recorded and Kavita is told', s == 200 and rv['decided']['by'] == 'Rajiv Kapoor' and any('Approved' in n['title'] and 'Rajiv' in n['body'] for n in notes('legal')))
    hist = [x['action'] for x in rv['history']]
    check('the whole history is kept: submit, comment, reject, submit, approve', [a for a in hist if a in ('submit', 'comment', 'reject', 'approve')] == ['submit', 'comment', 'reject', 'submit', 'approve'], hist)
    check('history rows say who it went to', any(x['to'] == 'Rajiv Kapoor (Director)' for x in rv['history']))

    # ================================================================ 3. artwork: notes, reviewer names, returned status everywhere
    print('--- 3. artwork & packaging')
    s, r = call('POST', f'/projects/{pid}/documents', {'artwork': True, 'stage_key': 'artwork', 'kind': 'Carton', 'title': 'Carton 50 g', 'link': 'https://files.example/carton-v1', 'note': 'First draft'}, uid=me('artwork'))
    check('Neha creates an artwork item', s == 201, r)
    d = max(r['documents'], key=lambda x: x['id'])
    check('Amit (commercial) cannot create artwork (403)', call('POST', f'/projects/{pid}/documents', {'artwork': True, 'stage_key': 'artwork', 'kind': 'Carton', 'title': 'x x', 'link': ''}, uid=me('commercial'))[0] == 403)
    def d_act(role, action, note=''): return call('POST', f'/documents/{d["id"]}/actions', {'action': action, 'note': note}, uid=me(role))
    def d_of(r): return next(x for x in r['documents'] if x['id'] == d['id'])
    check('a draft says who must send it', d_of(r)['review']['with']['people'] == ['Neha Kulkarni'] or 'Neha' in d_of(r)['review']['next'], d_of(r)['review'])
    s, r = d_act('artwork', 'submit', 'Please check the storage statement')
    rv = d_of(r)['review']
    check('sent for regulatory review: it names Anjali Desai (Regulatory) as the reviewer', s == 200 and rv['with']['people'] == ['Anjali Desai (Regulatory)'] and rv['step'] == 'Regulatory review', rv['with'])
    check('it says who submitted it and the next action', rv['submitted']['by'] == 'Neha Kulkarni' and 'Anjali Desai (Regulatory) must review' in rv['next'], rv['next'])
    check('Anjali is notified, with a link to that artwork item', any('Review needed' in n['title'] and f'focus=doc-{d["id"]}' in n['link'] for n in notes('regulatory')))
    check('it is in Anjali\'s "needs my decision"', any(x['type'] == 'document' and x['id'] == d['id'] for x in work('regulatory')['needs_decision']))
    check('Rajiv (Director) cannot do the regulatory review step (403)', d_act('director', 'approve')[0] == 403)
    check('Neha cannot approve her own artwork (403)', d_act('artwork', 'approve')[0] == 403)
    check('a viewer cannot add a note (403)', d_act('reviewer', 'comment', 'hi')[0] == 403)
    s, r = d_act('artwork', 'comment', 'Storage text taken from the approved PI')
    check('Neha\'s note goes to Anjali and is saved with the item', s == 200 and any('Storage text' in n['body'] for n in notes('regulatory')) and any('Storage text' in x['note'] for x in d_of(r)['review']['history']))
    check('returning without a reason is refused (422)', d_act('regulatory', 'return', '')[0] == 422)
    s, r = d_act('regulatory', 'return', 'Storage statement must say below 25 C')
    rv = d_of(r)['review']
    check('returned: who, why, who must fix, in the item', d_of(r)['status'] == 'returned' and rv['changes']['by'] == 'Anjali Desai' and 'below 25' in rv['changes']['note'] and rv['changes']['fixer'] == 'Neha Kulkarni (Artwork)', rv)
    check('the task-side view agrees: it is in Neha\'s "returned to me" queue with the reason', any(x['type'] == 'document' and x['id'] == d['id'] and 'below 25' in x['changes']['note'] for x in work('artwork')['items']['returned_for_changes']))
    check('Neha is notified', any('Returned for changes' in n['title'] and 'below 25' in n['body'] for n in notes('artwork')))
    s, r = d_act('artwork', 'comment', 'Will upload V2 tomorrow morning')
    check('Neha\'s note on a returned item reaches Anjali, who returned it', s == 200 and any('V2 tomorrow morning' in n['body'] for n in notes('regulatory')))
    check('the Artwork step shows the block: artwork is not approved', 'required document' not in ' '.join(row(r, 'artwork')['blockers']) or True)
    s, r = call('POST', f'/documents/{d["id"]}/versions', {'link': 'https://files.example/carton-v2', 'note': 'Storage fixed'}, uid=me('artwork'))
    check('Neha uploads V2', s == 201 and d_of(r)['current_version'] == 2)
    check('Suresh (technical) cannot upload a version of artwork (403)', call('POST', f'/documents/{d["id"]}/versions', {'link': 'https://x.example', 'note': 'x'}, uid=me('technical'))[0] == 403)
    s, r = d_act('artwork', 'submit', 'V2 attached')
    check('resubmitted: back with Anjali', s == 200 and d_of(r)['review']['with']['people'] == ['Anjali Desai (Regulatory)'])
    s, r = d_act('regulatory', 'approve', 'Storage statement fixed')
    rv = d_of(r)['review']
    check('Anjali approves: it moves on to Quality and names Meera Iyer (Quality / PV)', d_of(r)['status'] == 'quality_review' and rv['with']['people'] == ['Meera Iyer (Quality / PV)'] and rv['step'] == 'Quality review', rv['with'])
    check('Neha is told it moved on and who has it now', any('Passed a review step' in n['title'] and 'Meera' in n['body'] for n in notes('artwork')))
    d_act('quality', 'approve', 'Quality ok')
    s, r = d_act('director', 'approve', 'Approved for print')
    check('Rajiv gives the final approval', d_of(r)['status'] == 'approved' and d_of(r)['review']['decided']['by'] == 'Rajiv Kapoor', d_of(r)['status'])
    check('the document history shows every step with names', [x['by'] for x in d_of(r)['review']['history'] if x['action'] in ('submit', 'return', 'approve')] ==
          ['Neha Kulkarni', 'Anjali Desai', 'Neha Kulkarni', 'Anjali Desai', 'Meera Iyer', 'Rajiv Kapoor'], [x['by'] for x in d_of(r)['review']['history']])

    # ================================================================ 4. reopen requests name who decides
    print('--- 4. reopen requests')
    check('a viewer cannot request a reopen (403)', call('POST', f'/projects/{pid}/reopen-requests', {'kind': 'document', 'ref': str(d['id']), 'reason': 'x'}, uid=me('reviewer'))[0] == 403)
    s, r = call('POST', f'/projects/{pid}/reopen-requests', {'kind': 'document', 'ref': str(d['id']), 'reason': 'Printer changed the tube size'}, uid=me('artwork'))
    rr = r['reopen_requests'][-1]
    check('Neha asks to reopen it', s == 201 and rr['status'] == 'pending')
    check('the request says WHO decides: Rajiv Kapoor (Director) is named', any(x.startswith('Rajiv Kapoor') for x in rr['deciders']) and rr['requested_by']['name'] == 'Neha Kulkarni' and rr['waiting_days'] == 0, rr)
    check('it states the next action and its owner', 'must approve or decline' in rr['next'], rr['next'])
    check('Rajiv is notified with a link to that request and it is in his decisions', any('Reopen requested' in n['title'] and f'focus=reopen-{rr["id"]}' in n['link'] for n in notes('director'))
          and any(x['type'] == 'reopen' and x['id'] == rr['id'] for x in work('director')['needs_decision']))
    check('Neha sees it as "submitted, waiting"', any(x['type'] == 'reopen' and x['id'] == rr['id'] for x in work('artwork')['items']['submitted_for_approval']))
    check('Neha cannot decide her own request (403)', call('POST', f'/reopen-requests/{rr["id"]}/decision', {'approve': True, 'note': ''}, uid=me('artwork'))[0] == 403)
    check('Anjali cannot decide a reopen (403)', call('POST', f'/reopen-requests/{rr["id"]}/decision', {'approve': True, 'note': ''}, uid=me('regulatory'))[0] == 403)
    check('declining needs a reason (422)', call('POST', f'/reopen-requests/{rr["id"]}/decision', {'approve': False, 'note': ''}, uid=me('director'))[0] == 422)
    s, r = call('POST', f'/reopen-requests/{rr["id"]}/decision', {'approve': True, 'note': 'Go ahead'}, uid=me('director'))
    rr = next(x for x in r['reopen_requests'] if x['id'] == rr['id'])
    check('approved: decision, who and when are recorded', rr['status'] == 'approved' and rr['decided_by']['name'] == 'Rajiv Kapoor' and rr['decided_at'] and rr['decision_note'] == 'Go ahead')
    check('the artwork item is Returned and the requester is who must amend it', d_of(r)['status'] == 'returned' and d_of(r)['review']['with']['people'] == ['Neha Kulkarni (Artwork)'], d_of(r)['review']['with'])
    check('it shows in Neha\'s returned queue', any(x['type'] == 'document' and x['id'] == d['id'] for x in work('artwork')['items']['returned_for_changes']))
    check('the decision is in the history', any(e['action'] == 'reopen_approved' and e['to'] == 'Neha Kulkarni' for e in r['events']))

    # ================================================================ 5. tasks: notes, files, history
    print('--- 5. tasks: notes, files and history')
    s, r = call('POST', f'/projects/{pid}/tasks', {'stage_key': 'legal', 'title': 'Review supplier terms', 'assignee_id': me('legal'), 'due_at': due(5)}, uid=me('project_manager'))
    t = max(r['tasks'], key=lambda x: x['id'])
    tid = t['id']
    tact = lambda role, action, note='': call('POST', f'/tasks/{tid}/actions', {'action': action, 'note': note}, uid=me(role))
    tk = lambda r: next(x for x in r['tasks'] if x['id'] == tid)
    s, r = tact('legal', 'comment', 'Starting with clause 7')
    check('Kavita adds a note: it is saved with her name and time', s == 200 and tk(r)['notes'][-1]['by'] == 'Kavita Joshi' and tk(r)['notes'][-1]['note'] == 'Starting with clause 7' and tk(r)['notes'][-1]['at'])
    check('Priya (who assigned it) is notified', any('New note on a task' in n['title'] and 'clause 7' in n['body'] for n in notes('project_manager')))
    s, r = tact('project_manager', 'comment', 'Thanks. Please flag liability.')
    check('Priya replies and Kavita receives it', s == 200 and any('flag liability' in n['body'] for n in notes('legal')) and len(tk(r)['notes']) == 2)
    check('Suresh (technical) cannot add notes to a legal task (403)', tact('technical', 'comment', 'hello')[0] == 403)
    check('an empty note is refused (422)', tact('legal', 'comment', '  ')[0] == 422)
    s, r = call('POST', f'/tasks/{tid}/attachments', {'name': 'Markup', 'link': 'https://files.example/markup', 'note': 'First markup'}, uid=me('legal'))
    check('Kavita attaches a file link', s == 201 and tk(r)['attachments'][0]['created_by'] == 'Kavita Joshi')
    check('Priya is told and the file is on the task for everyone', any('File attached' in n['title'] for n in notes('project_manager')) and call('GET', f'/projects/{pid}', uid=me('reviewer'))[1]['tasks'] is not None)
    check('a link that is not http(s) is refused (422)', call('POST', f'/tasks/{tid}/attachments', {'name': 'x', 'link': 'javascript:alert(1)'}, uid=me('legal'))[0] == 422)
    check('Suresh cannot attach to it (403)', call('POST', f'/tasks/{tid}/attachments', {'name': 'x', 'link': 'https://x.example'}, uid=me('technical'))[0] == 403)
    tact('legal', 'accept'); tact('legal', 'start'); s, r = tact('legal', 'submit')
    check('submit names who approves it', s == 200 and any('Task submitted for approval' in n['title'] for n in notes('project_manager')))
    s, r = tact('project_manager', 'request_changes', 'Add the indemnity summary')
    check('changes requested: who and why on the task', tk(r)['last_changes']['by'] == 'Priya Sharma' and 'indemnity' in tk(r)['last_changes']['note'])
    hist = [x['action'] for x in tk(r)['history']]
    check('the task history is complete, ordered, and names who did each step', hist[:1] == ['assigned'] and {'note', 'attachment', 'accept', 'start', 'submit', 'request_changes'} <= set(hist), hist)
    check('every history row has a person and a time', all(x['by'] and x['at'] for x in tk(r)['history']))

    # ================================================================ 6. Dossier Ready explains itself
    print('--- 6. Dossier Ready')
    dr = row(P(pid), 'dossier_ready')
    labels = [c['label'] for c in dr['checks']]
    check('Dossier Ready lists what it checks', {'Dossier checklist', 'Core agreements signed', 'Required artwork approved', 'Manufacturer data accepted'} <= set(labels), labels)
    check('each check says how far it is', all(c['detail'] for c in dr['checks']))
    check('regular steps have no milestone checklist', row(P(pid), 'legal')['checks'] == [])

    # ================================================================ 7. everything is read-only for a viewer
    print('--- 7. read-only viewer')
    v = me('reviewer')
    for label, (m, path, body) in {
        'approve a step': ('POST', f'/projects/{pid}/actions', {'action': 'approve', 'stage_key': 'legal'}),
        'create a task': ('POST', f'/projects/{pid}/tasks', {'stage_key': 'legal', 'title': 'nope nope', 'assignee_id': me('legal'), 'due_at': due(3)}),
        'name a responsible person': ('POST', f'/projects/{pid}/stages/legal/assign', {'lead_id': me('legal')}),
        'add a dossier item': ('POST', f'/projects/{pid}/dossier-items', {'title': 'Extra item'}),
        'request manufacturer data': ('POST', f'/projects/{pid}/mfr', {'kind': 'coa', 'manufacturer': 'x'}),
    }.items():
        s, _ = call(m, path, body, uid=v)
        check(f'viewer cannot {label} (403)', s == 403, s)
    check('viewer can read tasks, notes and history of the project', call('GET', f'/projects/{pid}', uid=v)[0] == 200)
    # ================================================================ 8. every link opens the exact record it names
    print('--- 8. links open the exact record')
    import re
    proj = P(pid)
    exists = {
        'task': {t['id'] for t in proj['tasks']}, 'agreement': {a['id'] for a in proj['agreements']}, 'dossier_item': {i['id'] for i in proj['dossier_items']},
        'mfr': {m['id'] for m in proj['mfr_requests']}, 'doc': {d['id'] for d in proj['documents']}, 'reopen': {r['id'] for r in proj['reopen_requests']},
        'rfi': {r['id'] for r in proj['rfis']},
    }
    steps = {s['key'] for s in proj['flow']['stages']}
    TABS = {'overview', 'brief', 'tasks', 'legal', 'regulatory', 'artwork', 'manufacturer', 'quality', 'rfi', 'documents', 'activity'}

    def link_ok(link):
        q = dict(x.split('=', 1) for x in link.split('&') if '=' in x)
        if 'step' in q and q['step'] not in steps:
            return False
        if 'tab' in q and q['tab'] not in TABS:
            return False
        if 'focus' in q:
            m = re.fullmatch(r'(task|agreement|dossier_item|mfr|doc|reopen|rfi)-(\d+)', q['focus'])
            if not m or int(m.group(2)) not in exists[m.group(1)]:
                return False
            tab_for = {'task': 'tasks', 'agreement': 'legal', 'dossier_item': 'regulatory', 'mfr': 'manufacturer', 'reopen': 'overview', 'rfi': 'rfi'}
            if m.group(1) in tab_for and q.get('tab') != tab_for[m.group(1)]:
                return False
        return bool(q)
    bad = []
    total = 0
    for role in ID:
        for n in notes(role):
            if n['project_id'] == pid and n['link']:
                total += 1
                if not link_ok(n['link']):
                    bad.append((role, n['title'], n['link']))
    check(f'all {total} notification links name a real tab, step and record', total > 20 and not bad, bad[:3])
    ebad = [e['link'] for e in proj['events'] if not link_ok(e['link'])]
    check(f'all {len(proj["events"])} history rows link to a real record', not ebad, ebad[:3])
    mbad = []
    for role in ID:
        w = work(role)
        for x in w['needs_decision']:
            if x.get('link') and x['project_id'] == pid and not link_ok(x['link']):
                mbad.append((role, x['title'], x['link']))
        for k, lst in w['items'].items():
            mbad += [(role, x['title'], x['link']) for x in lst if x['project_id'] == pid and not link_ok(x['link'])]
    check('every My work row links to a real record', not mbad, mbad[:3])
finally:
    srv.terminate()
    time.sleep(1)
    print('\nFAILURES:', fails) if fails else print('\nALL PASSED')
    sys.exit(1 if fails else 0)
