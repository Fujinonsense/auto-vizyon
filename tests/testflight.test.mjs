import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { makeJwt, ascClient, distribute } from '../tools/testflight.mjs';

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

test('the client retries reads through Apple outages and dropped connections, but never repeats a write', async () => {
  const replies = { GET: [503, 'drop', 429, 200], POST: [503, 201] };
  const fetchImpl = async (url, init) => {
    const next = replies[init.method].shift();
    if (next === 'drop') throw new TypeError('fetch failed');
    if (next < 300) return { ok: true, status: next, json: async () => ({ data: [] }) };
    return { ok: false, status: next, json: async () => ({ errors: [{ code: 'UNEXPECTED_ERROR' }] }) };
  };
  const waits = [];
  const api = ascClient({ getToken: () => 't', fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await api('GET', '/v1/builds?x'), { data: [] });
  assert.equal(waits.length, 3);
  assert.ok(waits.every((ms) => ms >= 5_000), `waits ${waits}`);
  await assert.rejects(api('POST', '/v1/betaAppReviewSubmissions', { data: {} }), (e) => e.status === 503);
  assert.equal(waits.length, 3, 'the write was not retried');
});

test('a read that keeps failing gives up after a few minutes with Apple\'s error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ errors: [{ code: 'UNEXPECTED_ERROR' }] }) });
  let waited = 0;
  const api = ascClient({ getToken: () => 't', fetchImpl, sleep: async (ms) => { waited += ms; } });
  await assert.rejects(api('GET', '/v1/apps'), (e) => e.status === 500 && /UNEXPECTED_ERROR/.test(e.message));
  assert.ok(waited >= 60_000 && waited <= 10 * 60_000, `waited ${waited} ms`);
});

// A pretend App Store Connect: answers by route, remembers every call. `external` may be a list,
// one entry per read of the build's beta state; `refuse` makes a path fail with Apple's status and code.
function fakeApi({ states = ['VALID'], external = 'READY_FOR_BETA_SUBMISSION', localizations = [], groups = [{ id: 'g1', attributes: { name: 'Babam', isInternalGroup: false } }], refuse = {} } = {}) {
  const calls = [];
  const externals = [].concat(external);
  let poll = 0;
  let reads = 0;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    const no = refuse[path];
    if (no) throw Object.assign(new Error(`refused ${no.code}`), { status: no.status, code: no.code });
    if (path.startsWith('/v1/apps?')) return { data: [{ id: 'app1' }] };
    if (path.startsWith('/v1/builds?')) {
      const state = states[Math.min(poll++, states.length - 1)];
      return { data: state ? [{ id: 'b9', attributes: { version: '9', processingState: state } }] : [] };
    }
    if (path.startsWith('/v1/betaGroups?')) return { data: groups };
    if (path === '/v1/builds/b9/betaBuildLocalizations') return { data: localizations };
    if (path === '/v1/builds/b9/buildBetaDetail') {
      return { data: { id: 'd9', attributes: { externalBuildState: externals[Math.min(reads++, externals.length - 1)] } } };
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
  const polls = calls.filter((c) => c.path.startsWith('/v1/builds?'));
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
  const submit = calls.find((c) => c.path === '/v1/betaAppReviewSubmissions');
  assert.deepEqual(submit.body, { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: 'b9' } } } } });
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
    const { api, calls } = fakeApi({ external: state });
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

test('Apple refusing to add the build to the group stops the run', async () => {
  const { api, calls } = fakeApi({ refuse: { '/v1/betaGroups/g1/relationships/builds': { status: 409, code: 'ENTITY_ERROR.RELATIONSHIP.INVALID' } } });
  await assert.rejects(run(api), (e) => e.status === 409);
  assert.ok(!calls.some((c) => c.path === '/v1/betaAppReviewSubmissions'));
});

test('a refused submission passes only when Apple then shows the build in review', async () => {
  const at = '/v1/betaAppReviewSubmissions';
  const lostReply = fakeApi({
    external: ['READY_FOR_BETA_SUBMISSION', 'WAITING_FOR_BETA_REVIEW'],
    refuse: { [at]: { status: 422, code: 'ENTITY_UNPROCESSABLE.INVALID_QC_STATE' } },
  });
  assert.deepEqual(await run(lostReply.api), { buildId: 'b9', submitted: false, state: 'WAITING_FOR_BETA_REVIEW' });

  const blocked = fakeApi({ refuse: { [at]: { status: 422, code: 'ENTITY_UNPROCESSABLE.ANOTHER_BUILD_IN_REVIEW' } } });
  await assert.rejects(run(blocked.api), /9.*önceki bir derlemeyi/);

  const other = fakeApi({ refuse: { [at]: { status: 422, code: 'ENTITY_UNPROCESSABLE.BETA_CONTRACT_MISSING' } } });
  await assert.rejects(run(other.api), (e) => e.code === 'ENTITY_UNPROCESSABLE.BETA_CONTRACT_MISSING');
});

test('a failed build, a missing group or a build that never gets ready stops with a clear message', async () => {
  await assert.rejects(run(fakeApi({ states: ['INVALID'] }).api), /9.*INVALID/);
  await assert.rejects(run(fakeApi({ groups: [] }).api), /Babam/);
  await assert.rejects(run(fakeApi({ groups: [{ id: 'g0', attributes: { name: 'Babam', isInternalGroup: true } }] }).api), /Babam/);
  let t = 0;
  await assert.rejects(run(fakeApi({ states: [null] }).api, { now: () => (t += 60_000), timeoutMs: 5 * 60_000 }), /9.*dakika/);
  t = 0;
  await assert.rejects(run(fakeApi({ external: 'PROCESSING' }).api, { now: () => (t += 60_000), timeoutMs: 5 * 60_000 }), /9.*dakika.*PROCESSING/);
});
