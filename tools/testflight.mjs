// After a build reaches App Store Connect: wait until Apple has processed it, put it in the father's
// external TestFlight group with a "what to test" note, and send it to beta review when it needs it.
// CI: node tools/testflight.mjs <build number>   (env ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8_BASE64; TF_GROUP)
import { createPrivateKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE = 'https://api.appstoreconnect.apple.com';
const READY = 'READY_FOR_BETA_SUBMISSION';
const WHATS_NEW = 'Yeni sürüm. Aracı çek, plaka okunur; klasördeki WhatsApp düğmesi "aracınız hazır" mesajını hazırlar; iş, KDV ve ödeme takibi.';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// App Store Connect wants a short-lived ES256 token signed with the team key (.p8).
export function makeJwt({ keyId, issuerId, p8, now = Math.floor(Date.now() / 1000) }) {
  const head = b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64url({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(p8), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

// api(method, path, body): a new token per request, since waiting for processing outlives one token.
export function ascClient({ getToken, fetchImpl = fetch, base = BASE }) {
  return async (method, path, body) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = ((await res.json().catch(() => ({}))).errors || [])[0] || {};
      const message = `App Store Connect ${method} ${path.split('?')[0]}: ${res.status} ${err.code || ''} ${err.detail || err.title || ''}`;
      throw Object.assign(new Error(message.replace(/\s+/g, ' ').trim()), { status: res.status, code: err.code });
    }
    return res.status === 204 ? null : res.json();
  };
}

const refused = (e) => e.status === 409;

export async function distribute({
  api, bundleId, buildNumber, groupName, whatsNew, locale = 'tr',
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, timeoutMs = 45 * 60_000, pollMs = 60_000, log = console.log,
}) {
  const app = (await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`)).data[0];
  if (!app) throw new Error(`App Store Connect'te ${bundleId} uygulaması yok.`);

  // The upload is accepted before Apple has processed it; the build shows up a few minutes later.
  const start = now();
  let build;
  for (;;) {
    build = (await api('GET', `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(buildNumber)}&limit=1`)).data[0];
    const state = build?.attributes.processingState;
    if (state === 'VALID') break;
    if (state === 'FAILED' || state === 'INVALID') throw new Error(`Derleme ${buildNumber} Apple'da işlenemedi: ${state}`);
    if (now() - start > timeoutMs) {
      throw new Error(`Derleme ${buildNumber} ${Math.round(timeoutMs / 60_000)} dakikada hazır olmadı (${state || 'görünmüyor'}).`);
    }
    log(`Derleme ${buildNumber}: ${state || 'henüz görünmüyor'}, bekleniyor`);
    await sleep(pollMs);
  }

  const groups = (await api('GET', `/v1/betaGroups?filter[app]=${app.id}&filter[name]=${encodeURIComponent(groupName)}`)).data;
  const group = groups.find((g) => g.attributes.name === groupName && !g.attributes.isInternalGroup);
  if (!group) throw new Error(`TestFlight'ta "${groupName}" adlı dış test grubu yok.`);
  try {
    await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
  } catch (e) {
    if (!refused(e)) throw e;
    log(`Derleme ${buildNumber} zaten "${groupName}" grubunda.`);
  }

  // External testers see "What to Test"; Apple wants it before review.
  const notes = (await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations`)).data;
  const mine = notes.find((n) => n.attributes.locale === locale);
  if (!mine) {
    await api('POST', '/v1/betaBuildLocalizations', {
      data: { type: 'betaBuildLocalizations', attributes: { locale, whatsNew }, relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
  } else if (!mine.attributes.whatsNew) {
    await api('PATCH', `/v1/betaBuildLocalizations/${mine.id}`, { data: { type: 'betaBuildLocalizations', id: mine.id, attributes: { whatsNew } } });
  }

  const state = (await api('GET', `/v1/builds/${build.id}/buildBetaDetail`)).data.attributes.externalBuildState;
  if (state !== READY) return { buildId: build.id, submitted: false, state };
  try {
    await api('POST', '/v1/betaAppReviewSubmissions', {
      data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
  } catch (e) {
    if (!refused(e)) throw e;
    return { buildId: build.id, submitted: false, state, warning: e.message };
  }
  return { buildId: build.id, submitted: true, state };
}

async function main() {
  const buildNumber = process.argv[2];
  const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_KEY_P8_BASE64: p8b64, TF_GROUP: groupName = 'Babam' } = process.env;
  if (!buildNumber || !keyId || !issuerId || !p8b64) {
    throw new Error('Kullanım: ASC_KEY_ID, ASC_ISSUER_ID ve ASC_KEY_P8_BASE64 ile node tools/testflight.mjs <derleme no>');
  }
  const p8 = Buffer.from(p8b64, 'base64').toString('utf8');
  const api = ascClient({ getToken: () => makeJwt({ keyId, issuerId, p8 }) });
  const r = await distribute({ api, bundleId: 'com.autovizyon.app', buildNumber, groupName, whatsNew: WHATS_NEW });
  console.log(r.submitted
    ? `Derleme ${buildNumber} "${groupName}" grubuna eklendi ve beta incelemesine gönderildi.`
    : `Derleme ${buildNumber} "${groupName}" grubunda; inceleme durumu: ${r.state}.`);
  if (r.warning) console.log(`::warning::${r.warning}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
