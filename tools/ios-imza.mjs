// Apple signing for the Ad Hoc IPA, without a Mac.
//   node tools/ios-imza.mjs hazirla  → private key + certificate request (upload it to Apple)
//   node tools/ios-imza.mjs yukle    → .cer + .mobileprovision from Apple → GitHub secrets → IPA build
// Everything stays in ~/AutoVizyon-imza (or AV_IMZA_KLASOR); nothing here is committed.
import forge from 'node-forge';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'Fujinonsense/auto-vizyon';
const BUNDLE_ID = 'com.autovizyon.app';
const DIR = process.env.AV_IMZA_KLASOR || join(homedir(), 'AutoVizyon-imza');

const der = (buf) => forge.asn1.fromDer(buf.toString('binary'));
const certOf = (buf) => (buf.toString('latin1').startsWith('-----BEGIN')
  ? forge.pki.certificateFromPem(buf.toString('latin1'))
  : forge.pki.certificateFromAsn1(der(buf)));

// A new 2048-bit key (or the given one) and a certificate request for it.
export function makeKeyAndCsr(keyPem = null) {
  const privateKey = keyPem ? forge.pki.privateKeyFromPem(keyPem) : forge.pki.rsa.generateKeyPair(2048).privateKey;
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  csr.setSubject([{ name: 'commonName', value: 'Auto Vizyon' }, { name: 'countryName', value: 'TR' }]);
  csr.sign(privateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(privateKey), csrPem: forge.pki.certificationRequestToPem(csr) };
}

export function certMatchesKey(certBuf, keyPem) {
  return certOf(certBuf).publicKey.n.equals(forge.pki.privateKeyFromPem(keyPem).n);
}

// The plist inside a .mobileprovision is plain text between its signature bytes.
export function readProfile(buf) {
  const text = buf.toString('latin1');
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</plist>');
  if (start < 0 || end < 0) throw new Error('Bu dosya bir .mobileprovision profili değil');
  const xml = Buffer.from(text.slice(start, end + 8), 'latin1').toString('utf8');
  const value = (key, tag) => (new RegExp(`<key>${key}</key>\\s*<${tag}>([^<]*)</${tag}>`).exec(xml) || [])[1] || '';
  const list = (key) => {
    const m = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(xml);
    return m ? [...m[1].matchAll(/<(?:string|data)>([\s\S]*?)<\/(?:string|data)>/g)].map((x) => x[1].replace(/\s+/g, '')) : [];
  };
  return {
    name: value('Name', 'string'),
    uuid: value('UUID', 'string'),
    team: list('TeamIdentifier')[0] || '',
    appId: value('application-identifier', 'string'),
    devices: list('ProvisionedDevices').length,
    expires: value('ExpirationDate', 'date').slice(0, 10),
    certs: list('DeveloperCertificates'),
  };
}

// 3DES + SHA-1 MAC: the p12 flavour the macOS "security import" on the build Mac always reads.
export function makeP12(keyPem, certBuf, password) {
  const asn1 = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(keyPem), [certOf(certBuf)], password,
    { algorithm: '3des', friendlyName: 'Auto Vizyon' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function gh(args, input) {
  const r = spawnSync('gh', args, { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} olmadı: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout.trim();
}

const newest = (ext) => readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(ext))
  .map((f) => join(DIR, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

function hazirla() {
  mkdirSync(DIR, { recursive: true });
  const keyPath = join(DIR, 'anahtar.pem');
  const csrPath = join(DIR, 'AutoVizyon.certSigningRequest');
  const old = existsSync(keyPath) ? readFileSync(keyPath, 'utf8') : null;
  const { keyPem, csrPem } = makeKeyAndCsr(old);
  if (!old) writeFileSync(keyPath, keyPem, { mode: 0o600 });
  writeFileSync(csrPath, csrPem);
  console.log(`${old ? 'Var olan anahtar kullanıldı' : 'Yeni anahtar yapıldı'}: ${keyPath}
Sertifika isteği: ${csrPath}

Şimdi developer.apple.com → Certificates, IDs & Profiles (docs/IPA.md, 2. adım):
  1. Certificates → + → Apple Distribution → bu istek dosyasını seç → Download. İnen .cer dosyasını bu klasöre koy.
  2. Identifiers → + → App IDs → App → Explicit: ${BUNDLE_ID}, açıklama: Auto Vizyon.
  3. Devices → + → babanın iPhone'u (UDID).
  4. Profiles → + → Ad Hoc → ${BUNDLE_ID} → bu sertifika → babanın iPhone'u → ad: Auto Vizyon Ad Hoc → Download.
     İnen .mobileprovision dosyasını da bu klasöre koy.
  5. node tools/ios-imza.mjs yukle`);
}

function yukle() {
  const keyPath = join(DIR, 'anahtar.pem');
  if (!existsSync(keyPath)) throw new Error(`Önce: node tools/ios-imza.mjs hazirla (${keyPath} yok)`);
  const keyPem = readFileSync(keyPath, 'utf8');
  const cerPath = newest('.cer');
  const profilePath = newest('.mobileprovision');
  if (!cerPath) throw new Error(`Apple'dan indirdiğin .cer dosyasını şu klasöre koy: ${DIR}`);
  if (!profilePath) throw new Error(`Apple'dan indirdiğin .mobileprovision dosyasını şu klasöre koy: ${DIR}`);

  const cert = readFileSync(cerPath);
  if (!certMatchesKey(cert, keyPem)) {
    throw new Error(`${cerPath} bu anahtarla yapılmamış. Apple'a AutoVizyon.certSigningRequest dosyasını yükleyip inen .cer'i koy.`);
  }
  const profileBuf = readFileSync(profilePath);
  const p = readProfile(profileBuf);
  if (!p.appId.endsWith(`.${BUNDLE_ID}`)) throw new Error(`Profil ${p.appId || '?'} için yapılmış; App ID ${BUNDLE_ID} olmalı.`);
  if (!p.certs.includes(cert.toString('base64'))) throw new Error('Profil başka bir sertifikayla yapılmış. Profili düzenle, bu sertifikayı seç, yeniden indir.');
  if (!p.devices) throw new Error('Profilde iPhone yok. Ad Hoc profil seçip babanın iPhone\'unu işaretle.');
  if (p.expires && p.expires < new Date().toISOString().slice(0, 10)) throw new Error(`Profilin süresi ${p.expires} tarihinde dolmuş.`);

  const password = randomBytes(18).toString('hex');
  gh(['secret', 'set', 'IOS_CERT_P12_BASE64', '--repo', REPO], makeP12(keyPem, cert, password).toString('base64'));
  gh(['secret', 'set', 'IOS_CERT_PASSWORD', '--repo', REPO], password);
  gh(['secret', 'set', 'IOS_PROFILE_BASE64', '--repo', REPO], profileBuf.toString('base64'));
  gh(['workflow', 'run', 'ios.yml', '--repo', REPO, '--ref', 'main']);
  console.log(`Profil: ${p.name} · ${p.devices} iPhone · ${p.expires} tarihine kadar geçerli
GitHub'a üç gizli değer yazıldı, imzalı IPA derlemesi başladı (8-12 dakika).
İzlemek için:  gh run watch --repo ${REPO}
İndirmek için: gh run download --repo ${REPO} --dir ipa`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const commands = { hazirla, yukle };
  const run = commands[process.argv[2]];
  try {
    if (!run) throw new Error('Kullanım: node tools/ios-imza.mjs hazirla | yukle');
    run();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
