// After a build reaches App Store Connect: wait until Apple has processed it, put it in the father's
// external TestFlight group with a "what to test" note, and send it to beta review when it needs it.
// Anything that keeps the build from reaching him fails the run, so GitHub sends an email.
// CI: node tools/testflight.mjs <build number>   after an upload (ios.yml)
//     node tools/testflight.mjs --takip           every few hours (testflight-takip.yml)
//     env ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8_BASE64; TF_GROUP
import { createPrivateKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE = 'https://api.appstoreconnect.apple.com';
const READY = 'READY_FOR_BETA_SUBMISSION';
// External states in which the build is in review, approved, or already with the testers.
const ON_ITS_WAY = new Set(['WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'BETA_APPROVED', 'READY_FOR_BETA_TESTING', 'IN_BETA_TESTING']);
const RETRY_WAITS = [10_000, 30_000, 60_000, 120_000];
// A TestFlight build stops opening 90 days after upload; this leaves a month to act.
const MAX_AGE_DAYS = 60;
const WHATS_NEW = 'Yeni sürüm. Aracı çek, plaka okunur; klasördeki WhatsApp düğmesi "aracınız hazır" mesajını hazırlar; iş, KDV ve ödeme takibi.';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// App Store Connect wants a short-lived ES256 token signed with the team key (.p8).
export function makeJwt({ keyId, issuerId, p8, now = Math.floor(Date.now() / 1000) }) {
  const head = b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64url({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(p8), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

// api(method, path, body): a new token per request, since waiting for processing outlives one token.
// Reads are retried through rate limits, Apple outages, spurious 401s and dropped connections; writes
// never are, because a write may have landed before its reply was lost.
export function ascClient({ getToken, fetchImpl = fetch, base = BASE, sleep = wait }) {
  return async (method, path, body) => {
    for (let attempt = 0; ; attempt++) {
      const retry = method === 'GET' && attempt < RETRY_WAITS.length;
      let res;
      try {
        res = await fetchImpl(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (!retry) throw e;
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      if (res.ok) return res.status === 204 ? null : res.json();
      if (retry && (res.status === 401 || res.status === 429 || res.status >= 500)) {
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      const err = ((await res.json().catch(() => ({}))).errors || [])[0] || {};
      const message = `App Store Connect ${method} ${path.split('?')[0]}: ${res.status} ${err.code || ''} ${err.detail || err.title || ''}`;
      throw Object.assign(new Error(message.replace(/\s+/g, ' ').trim()), { status: res.status, code: err.code });
    }
  };
}

async function findApp(api, bundleId) {
  const app = (await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`)).data[0];
  if (!app) throw new Error(`App Store Connect'te ${bundleId} uygulaması yok.`);
  return app;
}

// Apple reviews one build of a version at a time, and every build here is version 1.0.
const inReview = async (api, appId) => (await api('GET', `/v1/builds?filter[app]=${appId}`
  + '&filter[betaAppReviewSubmission.betaReviewState]=WAITING_FOR_REVIEW,IN_REVIEW&filter[expired]=false&limit=1')).data[0];

export async function distribute({
  api, bundleId, buildNumber, groupName, whatsNew, locale = 'tr',
  sleep = wait, now = Date.now, timeoutMs = 90 * 60_000, pollMs = 60_000, log = console.log,
}) {
  const app = await findApp(api, bundleId);
  const deadline = now() + timeoutMs;
  const giveUpIfLate = (state) => {
    if (now() > deadline) {
      throw new Error(`Derleme ${buildNumber} ${Math.round(timeoutMs / 60_000)} dakikada hazır olmadı (${state || 'görünmüyor'}).`);
    }
  };

  // The upload is accepted before Apple has processed it; the build shows up a few minutes later.
  let build;
  for (;;) {
    build = (await api('GET', `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(buildNumber)}`
      + '&filter[processingState]=PROCESSING,FAILED,INVALID,VALID&sort=-uploadedDate&limit=1')).data[0];
    const state = build?.attributes.processingState;
    if (state === 'VALID') break;
    if (state === 'FAILED' || state === 'INVALID') throw new Error(`Derleme ${buildNumber} Apple'da işlenemedi: ${state}`);
    giveUpIfLate(state);
    log(`Derleme ${buildNumber}: ${state || 'henüz görünmüyor'}, bekleniyor`);
    await sleep(pollMs);
  }

  // External testing has its own processing step, which can finish after the build's.
  const betaState = async () => (await api('GET', `/v1/builds/${build.id}/buildBetaDetail`)).data.attributes.externalBuildState;
  let state;
  while ((state = await betaState()) === 'PROCESSING') {
    giveUpIfLate(state);
    log(`Derleme ${buildNumber}: dış test için hazırlanıyor, bekleniyor`);
    await sleep(pollMs);
  }
  if (state !== READY && !ON_ITS_WAY.has(state)) {
    throw new Error(`Derleme ${buildNumber} "${groupName}" grubuna gidemez, TestFlight durumu: ${state}. App Store Connect → TestFlight'ta derlemeye bak.`);
  }

  const groups = (await api('GET', `/v1/betaGroups?filter[app]=${app.id}&filter[name]=${encodeURIComponent(groupName)}`)).data;
  const group = groups.find((g) => g.attributes.name === groupName && !g.attributes.isInternalGroup);
  if (!group) throw new Error(`TestFlight'ta "${groupName}" adlı dış test grubu yok.`);
  // Adding a build that is already in the group succeeds, so any refusal here is a real one.
  await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });

  // External testers see "What to Test"; Apple wants it before review.
  const notes = async () => (await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations`)).data;
  const mine = (await notes()).find((n) => n.attributes.locale === locale);
  if (!mine) {
    try {
      await api('POST', '/v1/betaBuildLocalizations', {
        data: { type: 'betaBuildLocalizations', attributes: { locale, whatsNew }, relationships: { build: { data: { type: 'builds', id: build.id } } } },
      });
    } catch (e) {
      // The upload's own run and the follow-up run can reach the same build together.
      if (!(await notes()).some((n) => n.attributes.locale === locale)) throw e;
    }
  } else if (!mine.attributes.whatsNew) {
    await api('PATCH', `/v1/betaBuildLocalizations/${mine.id}`, { data: { type: 'betaBuildLocalizations', id: mine.id, attributes: { whatsNew } } });
  }

  if (state !== READY) return { buildId: build.id, submitted: false, state };
  // A later follow-up run submits this build once the other one is through.
  const waitFor = (other) => ({ buildId: build.id, submitted: false, state, waitingFor: other.attributes.version });
  const blocking = await inReview(api, app.id);
  if (blocking) return waitFor(blocking);
  try {
    await api('POST', '/v1/betaAppReviewSubmissions', {
      data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
  } catch (e) {
    // Apple's state decides: the submission may have landed before the error, or another build
    // may have gone to review a moment ago.
    const after = await betaState();
    if (ON_ITS_WAY.has(after)) return { buildId: build.id, submitted: false, state: after };
    const other = await inReview(api, app.id);
    if (other) return waitFor(other);
    throw e;
  }
  return { buildId: build.id, submitted: true, state };
}

// The follow-up run: the newest valid build goes to the father's group and, once nothing else is in
// review, to beta review. Problems with that build are only warnings here (the upload's own run
// reports them loudly); the alarm is the age of the newest build he can install.
export async function lookAfter({ api, bundleId, groupName, whatsNew, now = Date.now, log = console.log, ...rest }) {
  const app = await findApp(api, bundleId);
  const newest = (await api('GET', `/v1/builds?filter[app]=${app.id}&filter[processingState]=VALID&filter[expired]=false`
    + '&sort=-uploadedDate&limit=1')).data[0];
  if (!newest) throw new Error('TestFlight\'ta geçerli derleme yok. Actions → iPhone TestFlight → Run workflow ile yeni derleme yap.');
  const report = { newest: newest.attributes.version };

  try {
    report.result = await distribute({
      api, bundleId, buildNumber: newest.attributes.version, groupName, whatsNew, now, log, timeoutMs: 10 * 60_000, ...rest,
    });
  } catch (e) {
    log(`::warning::${e.message}`);
  }
  report.inReview = (await inReview(api, app.id))?.attributes.version;

  const approved = (await api('GET', `/v1/builds?filter[app]=${app.id}&filter[betaAppReviewSubmission.betaReviewState]=APPROVED`
    + '&sort=-uploadedDate&limit=1')).data[0];
  if (!approved) return report; // the first build is still in its first review
  const days = Math.floor((now() - Date.parse(approved.attributes.uploadedDate)) / 86_400_000);
  if (approved.attributes.expired || days > MAX_AGE_DAYS) {
    throw new Error(`Babanın kurabildiği en yeni derleme (${approved.attributes.version}) ${days} gün önce yüklendi`
      + `${approved.attributes.expired ? ' ve süresi doldu' : ''}; TestFlight derlemesi 90. günde açılmaz. `
      + 'Actions\'ta kırmızı iPhone TestFlight çalışmalarına bak.');
  }
  return { ...report, approved: approved.attributes.version, days };
}

async function main() {
  const arg = process.argv[2];
  const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_KEY_P8_BASE64: p8b64, TF_GROUP: groupName = 'Babam' } = process.env;
  if (!arg || !keyId || !issuerId || !p8b64) {
    throw new Error('Kullanım: ASC_KEY_ID, ASC_ISSUER_ID ve ASC_KEY_P8_BASE64 ile node tools/testflight.mjs <derleme no> | --takip');
  }
  const p8 = Buffer.from(p8b64, 'base64').toString('utf8');
  const api = ascClient({ getToken: () => makeJwt({ keyId, issuerId, p8 }) });
  const say = (r, n) => {
    if (r.waitingFor) {
      console.log(`::notice::Derleme ${n} "${groupName}" grubunda. Apple başka bir derlemeyi (${r.waitingFor}) inceliyor; `
        + 'o bitince TestFlight takip işi bunu incelemeye gönderir.');
    } else {
      console.log(r.submitted
        ? `Derleme ${n} "${groupName}" grubuna eklendi ve beta incelemesine gönderildi.`
        : `Derleme ${n} "${groupName}" grubunda; inceleme durumu: ${r.state}.`);
    }
  };

  if (arg === '--takip') {
    const r = await lookAfter({ api, bundleId: 'com.autovizyon.app', groupName, whatsNew: WHATS_NEW });
    if (r.result) say(r.result, r.newest);
    console.log(`İncelemede: ${r.inReview ? `derleme ${r.inReview}` : 'yok'}. `
      + (r.approved ? `Babanın kurabildiği en yeni derleme ${r.approved}, ${r.days} günlük.` : 'Henüz onaylanmış derleme yok.'));
    return;
  }
  say(await distribute({ api, bundleId: 'com.autovizyon.app', buildNumber: arg, groupName, whatsNew: WHATS_NEW }), arg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
