import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { makeJwt, ascClient, distribute, lookAfter } from '../tools/testflight.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

test('the API token is an ES256 JWT for App Store Connect, valid for at most 20 minutes', () => {
  const jwt = makeJwt({ keyId: 'ABC123DEFG', issuerId: 'issuer-1', p8, now: 1000 });
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(part(h), { alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
  assert.deepEqual(part(p), { iss: 'issuer-1', iat: 1000, exp: 1000 + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64);
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig));
});

test('the client sends a fresh token and JSON, and reports Apple errors with their detail', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/v1/fail')) return { ok: false, status: 409, json: async () => ({ errors: [{ code: 'STATE_ERROR', detail: 'already submitted' }] }) };
    if (init.method === 'POST') return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
    return { ok: true, status: 200, json: async () => ({ data: [1] }) };
  };
  let n = 0;
  const api = ascClient({ getToken: () => `t${++n}`, fetchImpl });
  assert.deepEqual(await api('GET', '/v1/apps?filter[bundleId]=x'), { data: [1] });
  assert.equal(await api('POST', '/v1/thing', { data: {} }), null);
  await assert.rejects(api('GET', '/v1/fail'), (e) => e.status === 409 && /STATE_ERROR/.test(e.message) && /already submitted/.test(e.message));
  assert.equal(seen.length, 3, 'a refusal is not retried');
  assert.equal(seen[0].url, 'https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=x');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer t1');
  assert.equal(seen[1].init.headers.Authorization, 'Bearer t2');
  assert.equal(seen[1].init.headers['Content-Type'], 'application/json');
  assert.equal(seen[1].init.body, JSON.stringify({ data: {} }));
});

test('the client retries reads through outages, spurious 401s and dropped connections, and writes only when Apple turned them away unread', async () => {
  const replies = { GET: [503, 'drop', 429, 401, 200], POST: [429, 201, 503, 201] };
  const fetchImpl = async (url, init) => {
    const next = replies[init.method].shift();
    if (next === 'drop') throw new TypeError('fetch failed');
    if (next < 300) return { ok: true, status: next, json: async () => ({ data: [] }) };
    return { ok: false, status: next, json: async () => ({ errors: [{ code: 'UNEXPECTED_ERROR' }] }) };
  };
  const waits = [];
  const api = ascClient({ getToken: () => 't', fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await api('GET', '/v1/builds?x'), { data: [] });
  assert.equal(waits.length, 4);
  assert.ok(waits.every((ms) => ms >= 5_000), `waits ${waits}`);
  assert.deepEqual(await api('POST', '/v1/buildBetaNotifications', { data: {} }), { data: [] });
  assert.equal(waits.length, 5, 'a write turned away with 429 is sent again');
  await assert.rejects(api('POST', '/v1/betaAppReviewSubmissions', { data: {} }), (e) => e.status === 503);
  assert.equal(waits.length, 5, 'a write that failed with 503 is not repeated');
});

test('a read that keeps failing gives up after a few minutes with Apple\'s error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ errors: [{ code: 'UNEXPECTED_ERROR' }] }) });
  let waited = 0;
  const api = ascClient({ getToken: () => 't', fetchImpl, sleep: async (ms) => { waited += ms; } });
  await assert.rejects(api('GET', '/v1/apps'), (e) => e.status === 500 && /UNEXPECTED_ERROR/.test(e.message));
  assert.ok(waited >= 60_000 && waited <= 10 * 60_000, `waited ${waited} ms`);
});

const b8 = { id: 'b8', attributes: { version: '8' } };
// One row of the follow-up run's build list: a build and its external-testing details.
const listed = (version, { uploadedDate = '2026-12-20T10:00:00Z', processingState = 'VALID', external = 'IN_BETA_TESTING', autoNotify = true } = {}) =>
  ({ version, uploadedDate, processingState, external, autoNotify });

// A pretend App Store Connect: answers by route, remembers every call.
// - external: build 9's beta state, or a list with one entry per read; autoNotify: its release flag;
// - inReview: one list of builds per "what is in review" query (the last one repeats);
// - builds: the follow-up run's list of recent builds, newest first;
// - refuse: makes a write to that path fail with Apple's status and code.
function fakeApi({
  states = ['VALID'], external = 'READY_FOR_BETA_SUBMISSION', autoNotify = true, localizations = [],
  groups = [{ id: 'g1', attributes: { name: 'Babam', isInternalGroup: false } }],
  inReview = [[]], builds = [listed('9', { external: 'READY_FOR_BETA_SUBMISSION' })], refuse = {},
} = {}) {
  const calls = [];
  const externals = [].concat(external);
  let poll = 0;
  let reads = 0;
  let reviewQueries = 0;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    const no = method !== 'GET' && refuse[path];
    if (no) throw Object.assign(new Error(`refused ${no.code}`), { status: no.status, code: no.code });
    if (path.startsWith('/v1/apps?')) return { data: [{ id: 'app1' }] };
    if (path.startsWith('/v1/builds?')) {
      if (path.includes('betaReviewState]=WAITING_FOR_REVIEW,IN_REVIEW')) return { data: inReview[Math.min(reviewQueries++, inReview.length - 1)] };
      if (path.includes('filter[version]=')) {
        const state = states[Math.min(poll++, states.length - 1)];
        return { data: state ? [{ id: 'b9', attributes: { version: '9', processingState: state } }] : [] };
      }
      if (path.includes('include=buildBetaDetail')) {
        return {
          data: builds.map((b) => ({
            type: 'builds', id: `b${b.version}`,
            attributes: { version: b.version, uploadedDate: b.uploadedDate, processingState: b.processingState },
            relationships: { buildBetaDetail: { data: { type: 'buildBetaDetails', id: `d${b.version}` } } },
          })),
          included: builds.map((b) => ({ type: 'buildBetaDetails', id: `d${b.version}`, attributes: { externalBuildState: b.external, autoNotifyEnabled: b.autoNotify } })),
        };
      }
      throw new Error(`unexpected ${method} ${path}`);
    }
    if (path.startsWith('/v1/betaGroups?')) return { data: groups };
    if (path === '/v1/builds/b9/betaBuildLocalizations') return { data: localizations };
    if (path === '/v1/builds/b9/buildBetaDetail') {
      const state = externals[Math.min(reads++, externals.length - 1)];
      return { data: { type: 'buildBetaDetails', id: 'd9', attributes: { externalBuildState: state, autoNotifyEnabled: autoNotify } } };
    }
    if (method === 'POST' || method === 'PATCH') return null;
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { api, calls };
}

const run = (api, extra = {}) => distribute({
  api, bundleId: 'com.autovizyon.app', buildNumber: '9', groupName: 'Babam', whatsNew: 'Yeni sürüm',
  sleep: async () => {}, now: () => 0, log: () => {}, ...extra,
});

test('a new build is waited for, added to the father\'s group, given its notes and sent to beta review', async () => {
  const { api, calls } = fakeApi({ states: [null, 'PROCESSING', 'VALID'] });
  const result = await run(api);
  assert.deepEqual(result, { buildId: 'b9', submitted: true, state: 'READY_FOR_BETA_SUBMISSION' });
  const polls = calls.filter((c) => c.path.includes('filter[version]='));
  assert.equal(polls.length, 3);
  assert.ok(calls[0].path.includes('filter[bundleId]=com.autovizyon.app'));
  assert.ok(polls[0].path.includes('filter[app]=app1') && polls[0].path.includes('filter[version]=9'));
  // Apple does not promise to list builds that are still processing (or failed) unless asked for them.
  assert.ok(polls[0].path.includes('filter[processingState]=PROCESSING,FAILED,INVALID,VALID'));
  assert.ok(polls[0].path.includes('sort=-uploadedDate'));
  const add = calls.find((c) => c.path === '/v1/betaGroups/g1/relationships/builds');
  assert.deepEqual(add.body, { data: [{ type: 'builds', id: 'b9' }] });
  const notes = calls.find((c) => c.path === '/v1/betaBuildLocalizations');
  assert.deepEqual(notes.body, {
    data: { type: 'betaBuildLocalizations', attributes: { locale: 'tr', whatsNew: 'Yeni sürüm' }, relationships: { build: { data: { type: 'builds', id: 'b9' } } } },
  });
  const check = calls.find((c) => c.path.includes('betaReviewState]=WAITING_FOR_REVIEW,IN_REVIEW'));
  assert.ok(check.path.includes('filter[app]=app1') && check.path.includes('filter[expired]=false'));
  const submit = calls.find((c) => c.path === '/v1/betaAppReviewSubmissions');
  assert.deepEqual(submit.body, { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: 'b9' } } } } });
  assert.ok(!calls.some((c) => c.method === 'PATCH' || c.path === '/v1/buildBetaNotifications'), 'release flag already on');
});

test('automatic release to testers is switched on before the build is reviewed', async () => {
  for (const state of ['READY_FOR_BETA_SUBMISSION', 'WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW']) {
    const { api, calls } = fakeApi({ external: state, autoNotify: false });
    await run(api);
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/v1/buildBetaDetails/d9');
    assert.deepEqual(patch?.body, { data: { type: 'buildBetaDetails', id: 'd9', attributes: { autoNotifyEnabled: true } } }, state);
    const submit = calls.findIndex((c) => c.path === '/v1/betaAppReviewSubmissions');
    assert.ok(submit === -1 || calls.indexOf(patch) < submit, `${state}: flag before submission`);
  }
});

test('a build approved without automatic release is released to the testers', async () => {
  const note = { data: { type: 'buildBetaNotifications', relationships: { build: { data: { type: 'builds', id: 'b9' } } } } };
  for (const state of ['BETA_APPROVED', 'READY_FOR_BETA_TESTING']) {
    const { api, calls } = fakeApi({ external: state, autoNotify: false });
    assert.deepEqual(await run(api), { buildId: 'b9', submitted: false, state, notified: true });
    assert.deepEqual(calls.find((c) => c.path === '/v1/buildBetaNotifications')?.body, note, state);
    assert.ok(!calls.some((c) => c.method === 'PATCH'), `${state}: no flag change after approval`);
  }

  const byApple = fakeApi({ external: 'BETA_APPROVED', autoNotify: true });
  await run(byApple.api);
  assert.ok(!byApple.calls.some((c) => c.path === '/v1/buildBetaNotifications'), 'Apple releases it by itself');

  const at = '/v1/buildBetaNotifications';
  const already = fakeApi({ external: ['BETA_APPROVED', 'IN_BETA_TESTING'], autoNotify: false, refuse: { [at]: { status: 409, code: 'STATE_ERROR' } } });
  assert.deepEqual(await run(already.api), { buildId: 'b9', submitted: false, state: 'IN_BETA_TESTING' });
  const stuck = fakeApi({ external: 'BETA_APPROVED', autoNotify: false, refuse: { [at]: { status: 409, code: 'STATE_ERROR' } } });
  await assert.rejects(run(stuck.api), (e) => e.status === 409);
});

test('the build waits while Apple is still preparing it for external testing, then goes to review', async () => {
  const { api, calls } = fakeApi({ external: ['PROCESSING', 'PROCESSING', 'READY_FOR_BETA_SUBMISSION'] });
  const result = await run(api);
  assert.equal(result.submitted, true);
  assert.equal(calls.filter((c) => c.path === '/v1/builds/b9/buildBetaDetail').length, 3);
});

test('a build already waiting for or past review is not sent again, and its notes are kept', async () => {
  for (const state of ['WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'BETA_APPROVED', 'READY_FOR_BETA_TESTING', 'IN_BETA_TESTING']) {
    const { api, calls } = fakeApi({ external: state, localizations: [{ id: 'l1', attributes: { locale: 'tr', whatsNew: 'Eski not' } }] });
    const result = await run(api);
    assert.deepEqual(result, { buildId: 'b9', submitted: false, state });
    assert.ok(!calls.some((c) => c.path === '/v1/betaAppReviewSubmissions'), state);
    assert.ok(!calls.some((c) => c.path.startsWith('/v1/betaBuildLocalizations')), state);
  }
});

test('a build that cannot reach the father stops the run with its state, before anything is changed', async () => {
  for (const state of ['MISSING_EXPORT_COMPLIANCE', 'BETA_REJECTED', 'EXPIRED', 'PROCESSING_EXCEPTION']) {
    const { api, calls } = fakeApi({ external: state, autoNotify: false });
    await assert.rejects(run(api), new RegExp(`9.*${state}`));
    assert.ok(!calls.some((c) => c.method !== 'GET'), state);
  }
});

test('an empty note in the build\'s language is filled in place', async () => {
  const { api, calls } = fakeApi({ localizations: [{ id: 'l1', attributes: { locale: 'tr', whatsNew: '' } }] });
  await run(api);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/v1/betaBuildLocalizations/l1');
  assert.deepEqual(patch.body, { data: { type: 'betaBuildLocalizations', id: 'l1', attributes: { whatsNew: 'Yeni sürüm' } } });
});

test('a note another run wrote a moment earlier is not an error', async () => {
  const { api } = fakeApi();
  let notes = [];
  const racing = async (method, path, body) => {
    if (path === '/v1/builds/b9/betaBuildLocalizations') return { data: notes };
    if (method === 'POST' && path === '/v1/betaBuildLocalizations') {
      notes = [{ id: 'l1', attributes: { locale: 'tr', whatsNew: 'Yeni sürüm' } }];
      throw Object.assign(new Error('refused ENTITY_ERROR'), { status: 409, code: 'ENTITY_ERROR' });
    }
    return api(method, path, body);
  };
  assert.equal((await run(racing)).submitted, true);
  const lost = async (method, path, body) => {
    if (method === 'POST' && path === '/v1/betaBuildLocalizations') throw Object.assign(new Error('refused'), { status: 409 });
    return api(method, path, body);
  };
  await assert.rejects(run(lost), (e) => e.status === 409);
});

test('Apple refusing to add the build to the group stops the run', async () => {
  const { api, calls } = fakeApi({ refuse: { '/v1/betaGroups/g1/relationships/builds': { status: 409, code: 'ENTITY_ERROR.RELATIONSHIP.INVALID' } } });
  await assert.rejects(run(api), (e) => e.status === 409);
  assert.ok(!calls.some((c) => c.path === '/v1/betaAppReviewSubmissions'));
});

test('while another build is in review the new one is not submitted, and says which one it waits for', async () => {
  const { api, calls } = fakeApi({ inReview: [[b8]] });
  const result = await run(api);
  assert.deepEqual(result, { buildId: 'b9', submitted: false, state: 'READY_FOR_BETA_SUBMISSION', waitingFor: '8' });
  assert.ok(!calls.some((c) => c.path === '/v1/betaAppReviewSubmissions'));
  assert.ok(calls.some((c) => c.path === '/v1/betaGroups/g1/relationships/builds'), 'still added to the group');
});

test('a refused submission is decided by Apple\'s state afterwards, not by the error', async () => {
  const at = '/v1/betaAppReviewSubmissions';
  const lostReply = fakeApi({
    external: ['READY_FOR_BETA_SUBMISSION', 'WAITING_FOR_BETA_REVIEW'],
    refuse: { [at]: { status: 422, code: 'ENTITY_UNPROCESSABLE.INVALID_QC_STATE' } },
  });
  assert.deepEqual(await run(lostReply.api), { buildId: 'b9', submitted: false, state: 'WAITING_FOR_BETA_REVIEW' });

  const raced = fakeApi({ inReview: [[], [b8]], refuse: { [at]: { status: 422, code: 'ENTITY_UNPROCESSABLE.ANOTHER_BUILD_IN_REVIEW' } } });
  assert.equal((await run(raced.api)).waitingFor, '8');

  const other = fakeApi({ refuse: { [at]: { status: 422, code: 'ENTITY_UNPROCESSABLE.BETA_CONTRACT_MISSING' } } });
  await assert.rejects(run(other.api), (e) => e.code === 'ENTITY_UNPROCESSABLE.BETA_CONTRACT_MISSING');
});

test('a failed build, a missing group or a build that never gets ready stops with a clear message', async () => {
  await assert.rejects(run(fakeApi({ states: ['INVALID'] }).api), /9.*INVALID/);
  await assert.rejects(run(fakeApi({ groups: [] }).api), /Babam/);
  await assert.rejects(run(fakeApi({ groups: [{ id: 'g0', attributes: { name: 'Babam', isInternalGroup: true } }] }).api), /Babam/);
  let t = 0;
  await assert.rejects(run(fakeApi({ states: [null] }).api, { now: () => (t += 60_000), timeoutMs: 5 * 60_000 }),
    (e) => /9.*dakika/.test(e.message) && e.late === true && e.state === undefined);
  t = 0;
  // Still processing at the deadline: the upload's run may let the follow-up run finish the job.
  await assert.rejects(run(fakeApi({ external: 'PROCESSING' }).api, { now: () => (t += 60_000), timeoutMs: 5 * 60_000 }),
    (e) => /9.*dakika.*PROCESSING/.test(e.message) && e.late === true && e.state === 'PROCESSING');
});

// The follow-up run (testflight-takip.yml), once a day.
const NOW = Date.parse('2026-12-31T00:00:00Z');
const look = (api, extra = {}) => lookAfter({
  api, bundleId: 'com.autovizyon.app', groupName: 'Babam', whatsNew: 'Yeni sürüm',
  sleep: async () => {}, now: () => NOW, log: () => {}, ...extra,
});

test('the follow-up run sends the newest valid build on and reports what reached the father', async () => {
  const { api, calls } = fakeApi({ builds: [
    listed('10', { processingState: 'PROCESSING', external: 'PROCESSING', uploadedDate: '2026-12-30T23:00:00Z' }),
    listed('9', { external: 'READY_FOR_BETA_SUBMISSION', uploadedDate: '2026-12-29T10:00:00Z' }),
    listed('8', { external: 'IN_BETA_TESTING', uploadedDate: '2026-12-20T10:00:00Z' }),
  ] });
  const report = await look(api);
  const list = calls.find((c) => c.path.includes('include=buildBetaDetail'));
  for (const part of ['filter[app]=app1', 'filter[processingState]=PROCESSING,VALID', 'filter[expired]=false', 'sort=-uploadedDate', 'limit=']) {
    assert.ok(list.path.includes(part), part);
  }
  assert.ok(calls.some((c) => c.path.includes('filter[version]=9')), 'distributes the newest processed build');
  assert.ok(!calls.some((c) => c.path.includes('filter[version]=10')), 'not the one still processing');
  assert.equal(report.newest, '9');
  assert.equal(report.result.submitted, true);
  assert.equal(report.released, '8');
  assert.equal(report.days, 10);
});

test('an approved build counts as reaching the father only when Apple releases it to the testers', async () => {
  const byFlag = fakeApi({ external: 'READY_FOR_BETA_TESTING', builds: [listed('9', { external: 'READY_FOR_BETA_TESTING', autoNotify: true })] });
  assert.equal((await look(byFlag.api)).released, '9');

  const held = fakeApi({ external: 'BETA_APPROVED', autoNotify: false, builds: [listed('9', { external: 'BETA_APPROVED', autoNotify: false })] });
  const report = await look(held.api);
  assert.equal(report.released, undefined);
  assert.equal(report.result.notified, true, 'released to the testers by this run');
});

test('while another build is in review the follow-up run waits instead of submitting', async () => {
  const { api, calls } = fakeApi({ inReview: [[b8]] });
  const report = await look(api);
  assert.equal(report.result.waitingFor, '8');
  assert.equal(report.inReview, '8');
  assert.ok(!calls.some((c) => c.path === '/v1/betaAppReviewSubmissions'));
});

test('the follow-up run raises the alarm when the newest build the father has is 46 days or more old', async () => {
  const aged = (uploadedDate) => fakeApi({ external: 'IN_BETA_TESTING', builds: [listed('9', { uploadedDate })] }).api;
  await assert.rejects(look(aged('2026-11-14T00:00:00Z')), /9.*47 gün/);
  await assert.rejects(look(aged('2026-10-29T13:00:00Z')), /9.*62 gün/);
  assert.equal((await look(aged('2026-11-15T06:30:00Z'))).days, 45);
});

test('with nothing released to the father, the follow-up run is green only while a build is on its way', async () => {
  const rejected = listed('9', { external: 'BETA_REJECTED', uploadedDate: '2026-12-20T10:00:00Z' });
  await assert.rejects(look(fakeApi({ external: 'BETA_REJECTED', builds: [rejected] }).api), /yolda.*9.*BETA_REJECTED/);

  await look(fakeApi({ external: 'WAITING_FOR_BETA_REVIEW', builds: [listed('9', { external: 'WAITING_FOR_BETA_REVIEW' })] }).api);
  await look(fakeApi({ external: 'BETA_REJECTED', inReview: [[b8]], builds: [rejected] }).api);
  const fresh = listed('10', { processingState: 'PROCESSING', external: 'PROCESSING', uploadedDate: '2026-12-30T20:00:00Z' });
  await look(fakeApi({ external: 'BETA_REJECTED', builds: [fresh, rejected] }).api);
  const stale = listed('10', { processingState: 'PROCESSING', external: 'PROCESSING', uploadedDate: '2026-12-27T20:00:00Z' });
  await assert.rejects(look(fakeApi({ external: 'BETA_REJECTED', builds: [stale, rejected] }).api), /yolda/);
});

test('a problem with the newest build is only a warning while the father has a recent build', async () => {
  const logs = [];
  const { api } = fakeApi({ external: 'BETA_REJECTED', builds: [
    listed('9', { external: 'BETA_REJECTED', uploadedDate: '2026-12-29T10:00:00Z' }),
    listed('8', { external: 'IN_BETA_TESTING', uploadedDate: '2026-12-20T10:00:00Z' }),
  ] });
  const report = await look(api, { log: (m) => logs.push(m) });
  assert.ok(logs.some((m) => /^::warning::.*BETA_REJECTED/.test(m)), logs.join('\n'));
  assert.equal(report.result, undefined);
  assert.equal(report.released, '8');
});

test('no valid build left at all stops the follow-up run', async () => {
  await assert.rejects(look(fakeApi({ builds: [] }).api), /geçerli derleme yok/);
  const onlyProcessing = [listed('10', { processingState: 'PROCESSING', external: 'PROCESSING' })];
  await assert.rejects(look(fakeApi({ builds: onlyProcessing }).api), /geçerli derleme yok/);
});
