// After a build reaches App Store Connect: wait until Apple has processed it, give it a "what to test"
// note and make sure it reaches the father. He is an internal tester: an internal group with automatic
// distribution gets every processed build, with no beta review. If an external group named TF_GROUP
// exists, the build goes to that group as before and to beta review when it needs it.
// Anything that keeps the build from reaching him fails the run, so GitHub sends an email.
// CI: node tools/testflight.mjs <build number>   after an upload (ios.yml)
//     node tools/testflight.mjs --takip           once a day (testflight-takip.yml)
//     env ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8_BASE64; TF_GROUP
import { createPrivateKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE = 'https://api.appstoreconnect.apple.com';
const READY = 'READY_FOR_BETA_SUBMISSION';
const TESTING = 'IN_BETA_TESTING';
// External states before Apple's verdict, and after approval but before the testers have the build.
const BEFORE_APPROVAL = new Set([READY, 'WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW']);
const APPROVED = new Set(['BETA_APPROVED', 'READY_FOR_BETA_TESTING']);
// External states in which the build is in review, approved, or already with the testers.
const ON_ITS_WAY = new Set(['WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', ...APPROVED, TESTING]);
// Internal states that turn into IN_BETA_TESTING without anyone's help: Apple is still processing the
// build, checking its export compliance papers, or about to hand it to the automatic group. The rest
// (MISSING_EXPORT_COMPLIANCE, PROCESSING_EXCEPTION, EXPIRED) never reach the testers by themselves.
const INTERNAL_ON_ITS_WAY = new Set(['PROCESSING', 'IN_EXPORT_COMPLIANCE_REVIEW', 'READY_FOR_BETA_TESTING']);
const RETRY_WAITS = [10_000, 30_000, 60_000, 120_000];
const DAY = 86_400_000;
// A TestFlight build stops opening 90 days after upload. Alarm well before that, and before GitHub
// would switch the schedules off after 60 days without a commit.
const MAX_AGE_DAYS = 45;
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
// Reads are retried through rate limits, Apple outages, spurious 401s and dropped connections. Writes
// are retried only after 401 and 429, which Apple sends before doing anything; any other failed write
// may have landed before its reply was lost.
export function ascClient({ getToken, fetchImpl = fetch, base = BASE, sleep = wait }) {
  return async (method, path, body) => {
    for (let attempt = 0; ; attempt++) {
      const more = attempt < RETRY_WAITS.length;
      let res;
      try {
        res = await fetchImpl(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (!more || method !== 'GET') throw e;
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      if (res.ok) return res.status === 204 ? null : res.json();
      const unread = res.status === 401 || res.status === 429;
      if (more && (unread || (method === 'GET' && res.status >= 500))) {
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

// The app's test groups, and among them the external group with the given name, if there is one.
async function findGroups(api, appId, groupName) {
  const all = (await api('GET', `/v1/betaGroups?filter[app]=${appId}&limit=200`)).data;
  return { all, external: all.find((g) => g.attributes.name === groupName && !g.attributes.isInternalGroup) };
}

// Names of the internal groups that get every build by themselves (automatic distribution) and have
// at least one tester: the people an internal build reaches without anyone adding it by hand.
async function internalAudience(api, groups) {
  const names = [];
  for (const g of groups.filter((x) => x.attributes.isInternalGroup && x.attributes.hasAccessToAllBuilds === true)) {
    if ((await api('GET', `/v1/betaGroups/${g.id}/relationships/betaTesters?limit=1`)).data.length) names.push(g.attributes.name);
  }
  return names;
}

// "What to Test" in the build's language: written once, an empty one filled in, a written one kept.
async function writeNotes(api, buildId, locale, whatsNew) {
  const notes = async () => (await api('GET', `/v1/builds/${buildId}/betaBuildLocalizations`)).data;
  const mine = (await notes()).find((n) => n.attributes.locale === locale);
  if (!mine) {
    try {
      await api('POST', '/v1/betaBuildLocalizations', {
        data: { type: 'betaBuildLocalizations', attributes: { locale, whatsNew }, relationships: { build: { data: { type: 'builds', id: buildId } } } },
      });
    } catch (e) {
      // The upload's own run and the follow-up run can reach the same build together.
      if (!(await notes()).some((n) => n.attributes.locale === locale)) throw e;
    }
  } else if (!mine.attributes.whatsNew) {
    await api('PATCH', `/v1/betaBuildLocalizations/${mine.id}`, { data: { type: 'betaBuildLocalizations', id: mine.id, attributes: { whatsNew } } });
  }
}

export async function distribute({
  api, bundleId, buildNumber, groupName, whatsNew, locale = 'tr',
  sleep = wait, now = Date.now, timeoutMs = 90 * 60_000, pollMs = 60_000, log = console.log,
}) {
  const app = await findApp(api, bundleId);
  const deadline = now() + timeoutMs;
  const giveUpIfLate = (state) => {
    if (now() > deadline) {
      const message = `Derleme ${buildNumber} ${Math.round(timeoutMs / 60_000)} dakikada hazır olmadı (${state || 'görünmüyor'}).`;
      throw Object.assign(new Error(message), { late: true, state });
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

  const betaDetail = async () => (await api('GET', `/v1/builds/${build.id}/buildBetaDetail`)).data;
  const { all: groups, external: group } = await findGroups(api, app.id, groupName);
  if (!group) {
    // No external group: the father is an internal tester. Apple hands the build to the internal group
    // with automatic distribution by itself, with no beta review; this run writes the note and checks
    // that the build gets there.
    await writeNotes(api, build.id, locale, whatsNew);
    const audience = await internalAudience(api, groups);
    if (!audience.length) {
      throw new Error(`Derleme ${buildNumber} testçilere gidemez: TestFlight'ta "${groupName}" adlı dış grup yok, otomatik dağıtımı açık ve `
        + 'içinde testçi olan dahili grup da yok. App Store Connect → TestFlight → Internal Testing\'de grubun Automatic Distribution\'ını aç, babanı gruba ekle.');
    }
    let inside;
    while (INTERNAL_ON_ITS_WAY.has((inside = (await betaDetail()).attributes.internalBuildState))) {
      giveUpIfLate(inside);
      log(`Derleme ${buildNumber}: dahili test için hazırlanıyor (${inside}), bekleniyor`);
      await sleep(pollMs);
    }
    if (inside !== TESTING) {
      throw new Error(`Derleme ${buildNumber} dahili testçilere gidemez, TestFlight durumu: ${inside}. App Store Connect → TestFlight'ta derlemeye bak.`);
    }
    return { buildId: build.id, submitted: false, state: inside, internal: true, groups: audience };
  }

  // External testing has its own processing step, which can finish after the build's.
  let detail;
  while ((detail = await betaDetail()).attributes.externalBuildState === 'PROCESSING') {
    giveUpIfLate('PROCESSING');
    log(`Derleme ${buildNumber}: dış test için hazırlanıyor, bekleniyor`);
    await sleep(pollMs);
  }
  const state = detail.attributes.externalBuildState;
  const released = detail.attributes.autoNotifyEnabled === true;
  if (state !== READY && !ON_ITS_WAY.has(state)) {
    throw new Error(`Derleme ${buildNumber} "${groupName}" grubuna gidemez, TestFlight durumu: ${state}. App Store Connect → TestFlight'ta derlemeye bak.`);
  }
  // Approval and delivery are separate: without this flag an approved build waits for someone to
  // press "Notify Testers", and the father never gets it.
  if (BEFORE_APPROVAL.has(state) && !released) {
    await api('PATCH', `/v1/buildBetaDetails/${detail.id}`, { data: { type: 'buildBetaDetails', id: detail.id, attributes: { autoNotifyEnabled: true } } });
    log(`Derleme ${buildNumber}: testçilere otomatik bildirim açıldı.`);
  }

  // Adding a build that is already in the group succeeds, so any refusal here is a real one.
  await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });

  // External testers see "What to Test"; Apple wants it before review.
  await writeNotes(api, build.id, locale, whatsNew);

  // Approved before the flag was on: hand it to the testers now.
  if (APPROVED.has(state) && !released) {
    try {
      await api('POST', '/v1/buildBetaNotifications', {
        data: { type: 'buildBetaNotifications', relationships: { build: { data: { type: 'builds', id: build.id } } } },
      });
    } catch (e) {
      if ((await betaDetail()).attributes.externalBuildState !== TESTING) throw e;
      return { buildId: build.id, submitted: false, state: TESTING };
    }
    return { buildId: build.id, submitted: false, state, notified: true };
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
    const after = (await betaDetail()).attributes.externalBuildState;
    if (ON_ITS_WAY.has(after)) return { buildId: build.id, submitted: false, state: after };
    const other = await inReview(api, app.id);
    if (other) return waitFor(other);
    throw e;
  }
  return { buildId: build.id, submitted: true, state };
}

// The follow-up run: the newest valid build gets its note and goes on to the father. With the external
// group it is added there and, once nothing else is in review, sent to beta review; without it, it is
// checked against the internal group's automatic distribution. Problems with that build are only
// warnings here (the upload's own run reports them loudly). It fails, so GitHub emails, when the newest
// build he can install is getting old, or when none is installable and none is on its way.
export async function lookAfter({ api, bundleId, groupName, whatsNew, now = Date.now, log = console.log, ...rest }) {
  const app = await findApp(api, bundleId);
  const list = await api('GET', `/v1/builds?filter[app]=${app.id}&filter[processingState]=PROCESSING,VALID&filter[expired]=false`
    + '&sort=-uploadedDate&limit=100&include=buildBetaDetail');
  const details = new Map((list.included || []).filter((i) => i.type === 'buildBetaDetails').map((d) => [d.id, d.attributes]));
  const builds = list.data.map((b) => ({
    version: b.attributes.version,
    uploaded: Date.parse(b.attributes.uploadedDate),
    processing: b.attributes.processingState === 'PROCESSING',
    beta: details.get(b.relationships?.buildBetaDetail?.data?.id) || details.get(b.id) || {},
  }));
  const newest = builds.find((b) => !b.processing);
  if (!newest) throw new Error('TestFlight\'ta geçerli derleme yok. Actions → iPhone TestFlight → Run workflow ile yeni derleme yap.');
  // Without the external group the father is an internal tester: what counts is the internal state.
  const internal = !(await findGroups(api, app.id, groupName)).external;
  const report = {
    newest: newest.version,
    internal,
    recent: builds.slice(0, 5).map((b) => (internal
      ? `${b.version} ${b.beta.internalBuildState || '?'}`
      : `${b.version} ${b.beta.externalBuildState || '?'}${b.beta.autoNotifyEnabled ? ' (otomatik bildirim)' : ''}`)),
  };

  try {
    report.result = await distribute({
      api, bundleId, buildNumber: newest.version, groupName, whatsNew, now, log, timeoutMs: 10 * 60_000, ...rest,
    });
  } catch (e) {
    report.problem = e.message;
    log(`::warning::${e.message}`);
  }
  // Internal testing has no review to wait for.
  if (!internal) report.inReview = (await inReview(api, app.id))?.attributes.version;

  // What he can install. Internal: builds Apple has handed to the internal group, the newest one too
  // when it got there during this run. External: builds handed to the testers, or approved with the
  // release flag on.
  const released = internal
    ? (report.result?.internal ? newest : builds.find((b) => b.beta.internalBuildState === TESTING))
    : builds.find((b) => b.beta.externalBuildState === TESTING
      || (APPROVED.has(b.beta.externalBuildState) && b.beta.autoNotifyEnabled === true));
  if (released) {
    const days = Math.floor((now() - released.uploaded) / DAY);
    if (days > MAX_AGE_DAYS) {
      throw new Error(`Babanın kurabildiği en yeni derleme (${released.version}) ${days} gün önce yüklendi; TestFlight derlemesi 90. günde açılmaz. `
        + `${report.problem ? `En yeni derleme: ${report.problem}` : 'Actions\'taki kırmızı iPhone TestFlight çalışmalarına bak.'}`);
    }
    return { ...report, released: released.version, days };
  }
  // Nothing he can install: fine only while a build is on its way to him. Internally that is also a
  // processed build of the last day that Apple has not handed to the group yet.
  const uploading = builds.some((b) => now() - b.uploaded < DAY
    && (b.processing || (internal && INTERNAL_ON_ITS_WAY.has(b.beta.internalBuildState))));
  if (report.result || report.inReview || uploading) return report;
  throw new Error(`Babanın kurabileceği derleme yok ve yolda da yok. ${report.problem || `En yeni derleme: ${newest.version}.`} `
    + (internal ? 'App Store Connect → TestFlight\'ta derlemenin dahili test durumuna bak.' : 'App Store Connect → TestFlight\'ta Apple\'ın notuna bak.'));
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
    if (r.internal) {
      console.log(`Derleme ${n} dahili gruptaki testçilere açık (${r.groups.map((g) => `"${g}"`).join(', ')}); dahili testte Apple incelemesi yok.`);
    } else if (r.waitingFor) {
      console.log(`::notice::Derleme ${n} "${groupName}" grubunda. Apple başka bir derlemeyi (${r.waitingFor}) inceliyor; `
        + 'o bitince TestFlight takip işi bunu incelemeye gönderir.');
    } else if (r.notified) {
      console.log(`Derleme ${n} "${groupName}" grubundaki testçilere açıldı.`);
    } else {
      console.log(r.submitted
        ? `Derleme ${n} "${groupName}" grubuna eklendi ve beta incelemesine gönderildi.`
        : `Derleme ${n} "${groupName}" grubunda; inceleme durumu: ${r.state}.`);
    }
  };

  if (arg === '--takip') {
    const r = await lookAfter({ api, bundleId: 'com.autovizyon.app', groupName, whatsNew: WHATS_NEW });
    console.log(`Son derlemeler: ${r.recent.join(', ')}`);
    if (r.result) say(r.result, r.newest);
    console.log((r.internal ? '' : `İncelemede: ${r.inReview ? `derleme ${r.inReview}` : 'yok'}. `)
      + (r.released ? `Babana ulaşan en yeni derleme ${r.released}, ${r.days} günlük.` : 'Babana ulaşan derleme henüz yok.'));
    return;
  }
  try {
    say(await distribute({ api, bundleId: 'com.autovizyon.app', buildNumber: arg, groupName, whatsNew: WHATS_NEW }), arg);
  } catch (e) {
    // Uploaded and visible, only slow: the follow-up run sends it on once Apple is done with it.
    if (!(e.late && e.state)) throw e;
    console.log(`::warning::${e.message} Apple işlemeyi bitirince TestFlight takip işi derlemenin testçilere ulaşmasına bakar.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
