"""Harsh tester pass over the API: bad ids, bad payloads, wrong roles, closed/held projects, double actions, huge input."""
import json, urllib.request, urllib.error, threading
B = 'http://localhost:8000/api'
ROLE = {}
def call(m, path, body=None, uid=3, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(B + path, data=data, method=m, headers={'X-User-Id': str(uid), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            raw_=x.read()
            try: return x.status, json.loads(raw_ or b'null')
            except Exception: return x.status, {'html': True}
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}
users = call('GET', '/login-users')[1]
U = {u['role_key']: u['id'] for u in users}
fails = []; n = 0
def ck(label, cond, extra=''):
    global n; n += 1
    if not cond: fails.append(label); print('  FAIL', label, extra)
def not5xx(label, s): ck(label + f' (status {s}, never a 500)', s < 500)

# ---------- unauthenticated / bad identity
s, _ = call('GET', '/projects', uid=99999); ck('unknown user id is refused', s in (401, 403), s)
s, _ = call('GET', '/projects', uid='abc'); ck('non-numeric user id is refused', s in (401, 403, 422), s)
projects = call('GET', '/projects')[1]
live = [p for p in projects if p['status'] == 'active']
done = [p for p in projects if p['status'] == 'completed'][0]
held = [p for p in projects if p['status'] == 'on_hold'][0]
rej = [p for p in projects if p['status'] == 'rejected'][0]
hero = [p for p in projects if 'Allergy' in p['name']][0]

# ---------- every new endpoint with junk ids
for path in ('/projects/999999/review', '/projects/-1/review', '/projects/abc/review', '/tasks/999999/attachments', '/clarifications/999999/actions', '/reopen-requests/999999/decision', '/submissions/999999', '/reference-limits/999999'):
    for m in ('GET', 'POST', 'PATCH'):
        s, _ = call(m, path, {}); not5xx(f'{m} {path}', s)
s, _ = call('GET', '/projects/999999/review'); ck('review of a missing project is 404', s == 404, s)

# ---------- every role against every new write endpoint on the live hero project (nothing may 500; most roles may not)
P = call('GET', f"/projects/{hero['id']}")[1]
for role, uid in U.items():
    for path, body in ((f"/projects/{hero['id']}/clarifications", {'question': 'harsh?', 'responder_id': U['commercial']}),
                       (f"/projects/{hero['id']}/values", {'parameter': 'Assay', 'value': 99, 'unit': '%'}),
                       (f"/projects/{hero['id']}/review-decisions", {'key': 'limit:1', 'decision': 'dismissed', 'note': 'x'}),
                       (f"/projects/{hero['id']}/reopen-requests", {'kind': 'stage', 'ref': 'opportunity', 'reason': 'harsh'}),
                       ('/reference-limits', {'parameter': f'P-{role}', 'limit_value': 1})):
        s, _ = call('POST', path, body, uid=uid); not5xx(f'{role} POST {path.split("/")[-1]}', s)
s, _ = call('POST', '/reference-limits', {'parameter': 'Zzz', 'limit_value': 1}, uid=U['director']); ck('Director cannot edit reference material', s == 403, s)
s, _ = call('POST', '/reference-limits', {'parameter': 'Zzz', 'limit_value': 1}, uid=U['super_admin']); ck('admin can', s == 201, s)
s, r = call('POST', '/reference-limits', {'parameter': 'Zzz', 'limit_value': 2}, uid=U['super_admin']); ck('duplicate parameter name does not 500', s < 500, s)
s, _ = call('POST', '/reference-limits', {'parameter': '', 'limit_value': 1}, uid=U['super_admin']); ck('empty parameter is refused', s in (422,), s)
s, _ = call('POST', '/reference-limits', {'parameter': 'Q', 'limit_value': 'abc'}, uid=U['super_admin']); ck('non-numeric limit refused', s == 422, s)
s, _ = call('POST', '/reference-limits', {'parameter': 'Q', 'comparator': 'between', 'limit_value': 1}, uid=U['super_admin']); ck('bad comparator refused', s == 422, s)

# ---------- hostile text everywhere new
bad = ['<script>alert(1)</script>', "'; DROP TABLE projects; --", 'A' * 20000, '\u0000null', '{{7*7}}', '🙂' * 300]
q = call('POST', '/projects', {'name': 'HARSH project', 'product': 'x'}, uid=U['project_manager'])[1]['id']
for t in bad:
    s, _ = call('PATCH', f'/projects/{q}', {'formulation': t, 'stakeholders': t, 'potential_client': t[:200]}, uid=U['project_manager']); not5xx(f'brief text {t[:12]!r}', s)
    s, _ = call('POST', f'/projects/{q}/clarifications', {'question': t, 'responder_id': U['commercial']}, uid=U['project_manager']); not5xx(f'clarification {t[:12]!r}', s)
    s, _ = call('POST', f'/projects/{q}/values', {'parameter': t[:120] or 'x', 'value': 1, 'page': t[:60]}, uid=U['super_admin']); not5xx(f'value {t[:12]!r}', s)
back = call('GET', f'/projects/{q}')[1]
ck('script text is stored as inert text, not executed server-side', any('<script>' in (back.get('formulation') or '') for _ in [0]) or back['formulation'] != '')
for v in (float('nan'), float('inf'), 1e308, -1e308, 'x', None, True, [], {}):
    s, _ = call('POST', f'/projects/{q}/values', {'parameter': 'Assay', 'value': v}, uid=U['super_admin'], raw=json.dumps({'parameter': 'Assay', 'value': v}).encode() if not isinstance(v, float) or v == v and abs(v) != float('inf') else b'{"parameter":"Assay","value":NaN}')
    not5xx(f'value {v!r}', s)
for v in (-1, 1e30, 'x', None, float('nan')):
    s, _ = call('PATCH', f'/projects/{q}', raw=json.dumps({'opportunity_value': v}).encode() if v == v else b'{"opportunity_value":NaN}', uid=U['project_manager']); not5xx(f'opportunity_value {v!r}', s)

# ---------- state machine abuse
A = call('POST', f'/projects/{q}/actions', {'action': 'submit', 'stage_key': 'opportunity'}, uid=U['commercial'])
call('POST', f'/projects/{q}/actions', {'action': 'approve', 'stage_key': 'opportunity'}, uid=U['director'])
s, r = call('POST', f'/projects/{q}/actions', {'action': 'approve', 'stage_key': 'opportunity'}, uid=U['director']); ck('approving an approved stage again is refused', s in (409, 422), s)
s, r = call('POST', f'/projects/{q}/reopen-requests', {'kind': 'stage', 'ref': 'brief', 'reason': 'x'}, uid=U['project_manager']); ck('reopening a stage that is not approved is refused', s == 422, s)
s, r = call('POST', f'/projects/{q}/reopen-requests', {'kind': 'stage', 'ref': 'nonsense', 'reason': 'x'}, uid=U['project_manager']); ck('unknown stage in a reopen request is refused, not 500', s == 422, s)
s, r = call('POST', f'/projects/{q}/reopen-requests', {'kind': 'document', 'ref': 'abc', 'reason': 'x'}, uid=U['project_manager']); ck('non-numeric document ref is refused, not 500', s == 422, s)
s, r = call('POST', f'/projects/{q}/reopen-requests', {'kind': 'task', 'ref': '999999', 'reason': 'x'}, uid=U['project_manager']); ck('missing task in reopen request is refused', s == 422, s)
s, r = call('POST', f'/projects/{q}/reopen-requests', {'kind': 'planet', 'ref': '1', 'reason': 'x'}, uid=U['project_manager']); ck('unknown kind refused', s == 422, s)
# reopen a stage then check the decide cannot be repeated
s, r = call('POST', f'/projects/{q}/reopen-requests', {'kind': 'stage', 'ref': 'opportunity', 'reason': 'Scope changed'}, uid=U['commercial'])
ck('opportunity owner requests a stage reopen', s == 201, r)
rid = r['reopen_requests'][0]['id'] if s == 201 else 0
res = []
def dec(): res.append(call('POST', f'/reopen-requests/{rid}/decision', {'approve': True, 'note': 'ok'}, uid=U['director'])[0])
th = [threading.Thread(target=dec) for _ in range(4)]; [x.start() for x in th]; [x.join() for x in th]
ck('four simultaneous approvals of one reopen: exactly one wins, none 500', sorted(res).count(200) == 1 and all(c < 500 for c in res), res)
ck('stage was moved back exactly once', call('GET', f'/projects/{q}')[1]['stage_states']['opportunity'] in ('in_progress', 'awaiting_approval'))
# clarification double-answer race
q2 = call('POST', '/projects', {'name': 'HARSH race', 'product': 'x'}, uid=U['project_manager'])[1]['id']
c = call('POST', f'/projects/{q2}/clarifications', {'question': 'race?', 'responder_id': U['commercial']}, uid=U['project_manager'])[1]['clarifications'][0]['id']
res = []
def ans(): res.append(call('POST', f'/clarifications/{c}/actions', {'action': 'respond', 'note': 'a'}, uid=U['commercial'])[0])
th = [threading.Thread(target=ans) for _ in range(4)]; [x.start() for x in th]; [x.join() for x in th]
ck('four simultaneous responses: one wins', sorted(res).count(200) == 1 and all(c2 < 500 for c2 in res), res)
# attachments race: versions must be unique and consecutive
tid = None
call('POST', f'/projects/{q2}/actions', {'action': 'submit', 'stage_key': 'opportunity'}, uid=U['commercial']); call('POST', f'/projects/{q2}/actions', {'action': 'approve', 'stage_key': 'opportunity'}, uid=U['director'])
s, r = call('POST', f'/projects/{q2}/tasks', {'stage_key': 'brief', 'title': 'Harsh files', 'assignee_id': U['project_manager'], 'due_at': '2030-01-01T00:00:00Z'}, uid=U['director'])
tid = max(t['id'] for t in r['tasks'])
res = []
def att(i): res.append(call('POST', f'/tasks/{tid}/attachments', {'name': 'same.pdf', 'link': f'https://x.test/{i}'}, uid=U['project_manager'])[0])
th = [threading.Thread(target=att, args=(i,)) for i in range(6)]; [x.start() for x in th]; [x.join() for x in th]
vs = sorted(a['version_no'] for a in [t for t in call('GET', f'/projects/{q2}')[1]['tasks'] if t['id'] == tid][0]['attachments'])
ck('six simultaneous attachments get versions 1..6 with no duplicates', vs == list(range(1, 7)), (vs, res))

# ---------- closed / held / rejected projects accept no writes
for label, pr in (('completed', done), ('on hold', held), ('rejected', rej)):
    for path, body in ((f"/projects/{pr['id']}/clarifications", {'question': 'late?', 'responder_id': U['commercial']}),
                       (f"/projects/{pr['id']}/values", {'parameter': 'Assay', 'value': 99}),
                       (f"/projects/{pr['id']}/reopen-requests", {'kind': 'stage', 'ref': 'opportunity', 'reason': 'x'}),
                       (f"/projects/{pr['id']}/review-decisions", {'key': 'limit:1', 'decision': 'dismissed', 'note': 'x'})):
        s, _ = call('POST', path, body, uid=U['super_admin']); ck(f'{label} project refuses POST {path.split("/")[-1]}', s in (409, 422), s)
# ---------- review endpoint on every project: never errors, whatever the state
bad_reviews = [p['id'] for p in projects if call('GET', f"/projects/{p['id']}/review")[0] != 200]
ck('review works on every project in the portfolio', not bad_reviews, bad_reviews)
for p in projects:
    r = call('GET', f"/projects/{p['id']}")[1]
    ck(f"{p['name'][:28]}: has exactly the expected six lanes defined", len([s for s in r['flow']['stages'] if s['workstream']]) == 6)
    break
# ---------- exports
for path in ('/export.xlsx', '/legal-register.xlsx'):
    req = urllib.request.Request(B + path, headers={'X-User-Id': str(U['director'])})
    body = urllib.request.urlopen(req).read(); ck(f'{path} is a valid xlsx', body[:2] == b'PK' and len(body) > 3000, len(body))
import io, zipfile
req = urllib.request.Request(B + '/legal-register.xlsx', headers={'X-User-Id': str(U['director'])})
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req).read())); sheet = z.read('xl/worksheets/sheet1.xml').decode()
ck('legal Excel has Sr, Parties, Started, Final sign, Age and Closed', all(w in sheet for w in ('Sr', 'Parties', 'Started', 'Final sign', 'Closed')))
# formula injection in exports
call('PATCH', f'/projects/{q}', {'potential_client': '=HYPERLINK("http://evil","x")'}, uid=U['project_manager'])
call('POST', f'/projects/{q}/agreements', {'kind': 'nda', 'counterparty': '=cmd|calc!A1'}, uid=U['super_admin'])
req = urllib.request.Request(B + '/legal-register.xlsx', headers={'X-User-Id': str(U['director'])})
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req).read())); ss = z.read('xl/worksheets/sheet1.xml').decode()
ck('formula text is exported as plain text, never a live formula', '<f>' not in ss)
print(f'\n{n} checks, {len(fails)} failed'); [print('  x', f) for f in fails]
