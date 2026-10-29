import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { makeKeyAndCsr, readProfile, certMatchesKey, makeP12, apiKeyId, checkSigning } from '../tools/ios-imza.mjs';

const { keyPem, csrPem } = makeKeyAndCsr();

// What Apple sends back for the CSR: a DER certificate for the same public key.
function appleCert(publicKey, cn = 'Apple Distribution: Test (ABCDE12345)') {
  const signer = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  cert.setSubject([{ name: 'commonName', value: cn }]);
  cert.setIssuer([{ name: 'commonName', value: 'Apple Worldwide Developer Relations Certification Authority' }]);
  cert.sign(signer.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
}

// A .mobileprovision is a signed envelope around a plist; the plist sits in it as plain text.
// An Ad Hoc profile lists its iPhones; an App Store profile has no device list at all.
function profileFile(certDer, devices = ['00008110-001A2B3C4D5E6F70'], expires = '2027-10-29') {
  const deviceList = devices.length
    ? `<key>ProvisionedDevices</key>\n  <array>${devices.map((d) => `<string>${d}</string>`).join('')}</array>`
    : '';
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>DeveloperCertificates</key>
  <array><data>${certDer.toString('base64')}</data></array>
  <key>Entitlements</key>
  <dict>
    <key>application-identifier</key><string>ABCDE12345.com.autovizyon.app</string>
    <key>get-task-allow</key><false/>
  </dict>
  <key>ExpirationDate</key><date>${expires}T08:00:00Z</date>
  <key>Name</key><string>Auto Vizyon Ad Hoc</string>
  ${deviceList}
  <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
  <key>UUID</key><string>11111111-2222-3333-4444-555555555555</string>
</dict>
</plist>`;
  return Buffer.concat([Buffer.from([0x30, 0x82, 0x2a, 0x10, 0x06, 0x09]), Buffer.from(plist), Buffer.from([0xa0, 0x82, 0x0d])]);
}

test('the key and the certificate request go together and name the app', () => {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  assert.ok(csr.verify());
  assert.equal(csr.subject.getField('CN').value, 'Auto Vizyon');
  const key = forge.pki.privateKeyFromPem(keyPem);
  assert.equal(key.n.toString(16), csr.publicKey.n.toString(16));
  assert.equal(key.n.bitLength(), 2048);
});

test('a certificate is recognised as made for this key, another one is not', () => {
  const key = forge.pki.privateKeyFromPem(keyPem);
  const mine = appleCert(forge.pki.setRsaPublicKey(key.n, key.e));
  const other = appleCert(forge.pki.rsa.generateKeyPair(1024).publicKey);
  assert.equal(certMatchesKey(mine, keyPem), true);
  assert.equal(certMatchesKey(other, keyPem), false);
});

test('the profile tells which app, which iPhones, until when, and with which certificate', () => {
  const key = forge.pki.privateKeyFromPem(keyPem);
  const cert = appleCert(forge.pki.setRsaPublicKey(key.n, key.e));
  const p = readProfile(profileFile(cert));
  assert.deepEqual({ ...p, certs: p.certs.length }, {
    name: 'Auto Vizyon Ad Hoc', uuid: '11111111-2222-3333-4444-555555555555', team: 'ABCDE12345',
    appId: 'ABCDE12345.com.autovizyon.app', devices: 1, expires: '2027-10-29', certs: 1,
  });
  assert.equal(p.certs[0], cert.toString('base64'));
});

test('the p12 opens with its password and holds the key and the certificate', () => {
  const key = forge.pki.privateKeyFromPem(keyPem);
  const cert = appleCert(forge.pki.setRsaPublicKey(key.n, key.e));
  const p12 = makeP12(keyPem, cert, 'sifre-123');
  const parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString('binary')), 'sifre-123');
  const keys = parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
  const certs = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  assert.equal(keys.length, 1);
  assert.equal(certs.length, 1);
  assert.equal(keys[0].key.n.toString(16), key.n.toString(16));
  assert.throws(() => forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString('binary')), 'yanlış'));
});

test('the API key id comes from the file name App Store Connect gives the key', () => {
  assert.equal(apiKeyId('C:\\Users\\a\\AutoVizyon-imza\\AuthKey_7XXXR656M7.p8'), '7XXXR656M7');
  assert.equal(apiKeyId('/home/a/AuthKey_ABCDE12345.p8'), 'ABCDE12345');
  assert.equal(apiKeyId('anahtar.p8'), '');
  assert.equal(apiKeyId(undefined), '');
});

// The files TestFlight signing needs: our key, its certificate, an App Store profile, an API key.
function signingFiles(overrides = {}) {
  const key = forge.pki.privateKeyFromPem(keyPem);
  const cert = appleCert(forge.pki.setRsaPublicKey(key.n, key.e));
  return {
    keyPem, cert,
    profileBuf: profileFile(cert, []),
    apiKeyFile: 'C:\\imza\\AuthKey_7XXXR656M7.p8',
    issuerId: '4d38139a-0f10-4bd2-a642-ecccd912f02b',
    today: '2026-10-29',
    ...overrides,
  };
}

test('an App Store profile, its certificate and an API key are ready for TestFlight', () => {
  const { profile, keyId } = checkSigning(signingFiles());
  assert.equal(keyId, '7XXXR656M7');
  assert.equal(profile.appId, 'ABCDE12345.com.autovizyon.app');
  assert.equal(profile.devices, 0);
});

test('an Ad Hoc profile is refused, because TestFlight needs an App Store profile', () => {
  const files = signingFiles();
  assert.throws(() => checkSigning({ ...files, profileBuf: profileFile(files.cert) }), /App Store profil/);
});

test('a certificate made for another key, or left out of the profile, is refused', () => {
  const files = signingFiles();
  const stranger = appleCert(forge.pki.rsa.generateKeyPair(1024).publicKey);
  assert.throws(() => checkSigning({ ...files, cert: stranger }), /bu anahtarla yapılmamış/);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const twin = appleCert(forge.pki.setRsaPublicKey(key.n, key.e), 'Apple Distribution: Twin (ABCDE12345)');
  assert.throws(() => checkSigning({ ...files, cert: twin }), /başka bir sertifikayla/);
});

test('an expired profile, a renamed API key file or a wrong issuer ID is refused', () => {
  const files = signingFiles();
  assert.throws(() => checkSigning({ ...files, profileBuf: profileFile(files.cert, [], '2026-10-01') }), /süresi 2026-10-01/);
  assert.throws(() => checkSigning({ ...files, apiKeyFile: 'C:\\imza\\anahtar.p8' }), /AuthKey_/);
  assert.throws(() => checkSigning({ ...files, issuerId: '' }), /Issuer ID/);
  assert.throws(() => checkSigning({ ...files, issuerId: 'abc' }), /Issuer ID/);
});
