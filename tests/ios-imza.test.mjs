import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { makeKeyAndCsr, readProfile, certMatchesKey, makeP12 } from '../tools/ios-imza.mjs';

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
function profileFile(certDer) {
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
  <key>ExpirationDate</key><date>2027-10-29T08:00:00Z</date>
  <key>Name</key><string>Auto Vizyon Ad Hoc</string>
  <key>ProvisionedDevices</key>
  <array><string>00008110-001A2B3C4D5E6F70</string></array>
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
