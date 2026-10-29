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
  assert.equal(seen[0].url, 'https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=x');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer t1');
  assert.equal(seen[1].init.headers.Authorization, 'Bearer t2');
  assert.equal(seen[1].init.headers['Content-Type'], 'application/json');
  assert.equal(seen[1].init.body, JSON.stringify({ data: {} }));
});

// A pretend App Store Connect: answers by route, remembers every call.
function fakeApi({ states = ['VALID'], external = 'READY_FOR_BETA_SUBMISSION', localizations = [], groups = [{ id: 'g1', attributes: { name: 'Babam', isInternalGroup: false } }], refuse = {} } = {}) {
  const calls = [];
  let poll = 0;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (refuse[path]) throw Object.assign(new Error(refuse[path]), { status: 409 });
    if (path.startsWith('/v1/apps?')) return { data: [{ id: 'app1' }] };
    if (path.startsWith('/v1/builds?')) {
      const state = states[Math.min(poll++, states.length - 1)];
      return { data: state ? [{ id: 'b9', attributes: { version: '9', processingState: state } }] : [] };
    }
    if (path.startsWith('/v1/betaGroups?')) return { data: groups };
    if (path === '/v1/builds/b9/betaBuildLocalizations') return { data: localizations };
    if (path === '/v1/builds/b9/buildBetaDetail') return { data: { id: 'd9', attributes: { externalBuildState: external } } };
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
  assert.equal(calls.filter((c) => c.path.startsWith('/v1/builds?')).length, 3);
  assert.ok(calls[0].path.includes('filter[bundleId]=com.autovizyon.app'));
  assert.ok(calls[1].path.includes('filter[app]=app1') && calls[1].path.includes('filter[version]=9'));
  const add = calls.find((c) => c.path === '/v1/betaGroups/g1/relationships/builds');
  assert.deepEqual(add.body, { data: [{ type: 'builds', id: 'b9' }] });
  const notes = calls.find((c) => c.path === '/v1/betaBuildLocalizations');
  assert.deepEqual(notes.body, {
    data: { type: 'betaBuildLocalizations', attributes: { locale: 'tr', whatsNew: 'Yeni sürüm' }, relationships: { build: { data: { type: 'builds', id: 'b9' } } } },
  });
  const submit = calls.find((c) => c.path === '/v1/betaAppReviewSubmissions');
  assert.deepEqual(submit.body, { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: 'b9' } } } } });
});

test('a build already waiting for or past review is not sent again, and its notes are kept', async () => {
  for (const state of ['WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'BETA_APPROVED', 'IN_BETA_TESTING']) {
    const { api, calls } = fakeApi({ external: state, localizations: [{ id: 'l1', attributes: { locale: 'tr', whatsNew: 'Eski not' } }] });
    const result = await run(api);
    assert.deepEqual(result, { buildId: 'b9', submitted: false, state });
    assert.ok(!calls.some((c) => c.path === '/v1/betaAppReviewSubmissions'), state);
    assert.ok(!calls.some((c) => c.path.startsWith('/v1/betaBuildLocalizations')), state);
  }
});

test('an empty note in the build\'s language is filled in place', async () => {
  const { api, calls } = fakeApi({ localizations: [{ id: 'l1', attributes: { locale: 'tr', whatsNew: '' } }] });
  await run(api);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/v1/betaBuildLocalizations/l1');
  assert.deepEqual(patch.body, { data: { type: 'betaBuildLocalizations', id: 'l1', attributes: { whatsNew: 'Yeni sürüm' } } });
});

test('Apple refusing a duplicate add or a second review is a warning, not a stop', async () => {
  const { api } = fakeApi({ refuse: {
    '/v1/betaGroups/g1/relationships/builds': 'already in group',
    '/v1/betaAppReviewSubmissions': 'another build is in review',
  } });
  const result = await run(api);
  assert.equal(result.submitted, false);
  assert.match(result.warning, /another build is in review/);
});

test('a failed build, a missing group or a build that never shows up stops with a clear message', async () => {
  await assert.rejects(run(fakeApi({ states: ['INVALID'] }).api), /9.*INVALID/);
  await assert.rejects(run(fakeApi({ groups: [] }).api), /Babam/);
  await assert.rejects(run(fakeApi({ groups: [{ id: 'g0', attributes: { name: 'Babam', isInternalGroup: true } }] }).api), /Babam/);
  let t = 0;
  await assert.rejects(run(fakeApi({ states: [null] }).api, { now: () => (t += 60_000), timeoutMs: 5 * 60_000 }), /9.*dakika/);
});
