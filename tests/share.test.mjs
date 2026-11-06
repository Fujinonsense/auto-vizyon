import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderSections, sectionCopyText, folderCopyText, readyMessage, waLink, telLink } from '../app/js/lib/share.js';
import { DEFAULT_SETTINGS } from '../app/js/data/repo.js';

const folder = {
  name: 'Uğurcan Kaya', phone: '05324182790', plate: '34 NMA 887', brand: 'Audi', model: 'A7', color: 'Siyah',
  modelYear: '2019', vin: 'WAUZZZ4G7JN012345', engineNo: '', modelFull: '',
  ruhsat: { sahibi: 'Uğurcan Kaya', tcVkn: '10000000146' }, ehliyet: {}, kimlik: {},
};

test('folderSections: the five copy groups with formatted values and paths', () => {
  const s = folderSections(folder);
  assert.deepEqual(s.map((x) => x.title), ['Müşteri', 'Araç', 'Ruhsat', 'Ehliyet', 'Kimlik']);
  assert.deepEqual(s[0].rows, [
    { label: 'Ad soyad', value: 'Uğurcan Kaya', path: 'name' },
    { label: 'Telefon', value: '0532 418 27 90', path: 'phone' },
  ]);
  assert.equal(s[1].rows.find((r) => r.path === 'vin').value, 'WAUZZZ4G7JN012345');
  assert.equal(s[2].rows.find((r) => r.path === 'ruhsat.tcVkn').label, 'TC / Vergi no');
});

test('folderSections: the accident report sections appear only once they have something', () => {
  assert.equal(folderSections({ ...folder, tutanak: {} }).length, 5);
  assert.equal(folderSections({ ...folder, tutanak: { aAdSoyad: ' ', bTel: '' } }).length, 5);
  const onlyA = folderSections({ ...folder, tutanak: { aAdSoyad: 'Ali Veli' } });
  assert.deepEqual(onlyA.map((s) => s.kind), ['musteri', 'arac', 'ruhsat', 'ehliyet', 'kimlik', 'tutanakA']);
  const both = folderSections({ ...folder, tutanak: { aAdSoyad: 'Ali Veli', bTel: '0505 377 64 20' } });
  assert.deepEqual(both.slice(5).map((s) => s.title), ['Tutanak A', 'Tutanak B']);
});

test('accident report B: rows in the agreed order, copy text without the empty ones', () => {
  const tutanak = {
    bPlaka: '35 KR 7781', bAdSoyad: 'Ayşe Kara', bTc: '19090909018', bEhliyet: '106408-B', bTel: '0505 377 64 20',
    bAdres: 'Alsancak Mah. 1453 Sok. İzmir', bAlindigiYer: 'Konak',
  };
  const b = folderSections({ ...folder, tutanak }).find((s) => s.kind === 'tutanakB');
  assert.deepEqual(b.rows.map((r) => [r.label, r.path]), [
    ['Plaka', 'tutanak.bPlaka'], ['Ad Soyad', 'tutanak.bAdSoyad'], ['T.C. Kimlik No', 'tutanak.bTc'], ['Ehliyet', 'tutanak.bEhliyet'],
    ['Telefon', 'tutanak.bTel'], ['Adres', 'tutanak.bAdres'], ['Alındığı yer', 'tutanak.bAlindigiYer'],
  ]);
  assert.equal(sectionCopyText(b.rows), [
    'Plaka: 35 KR 7781', 'Ad Soyad: Ayşe Kara', 'T.C. Kimlik No: 19090909018', 'Ehliyet: 106408-B',
    'Telefon: 0505 377 64 20', 'Adres: Alsancak Mah. 1453 Sok. İzmir', 'Alındığı yer: Konak',
  ].join('\n'));
  const partial = folderSections({ ...folder, tutanak: { bPlaka: '35 KR 7781', bTel: '0505 377 64 20' } }).find((s) => s.kind === 'tutanakB');
  assert.equal(sectionCopyText(partial.rows), 'Plaka: 35 KR 7781\nTelefon: 0505 377 64 20');
  assert.ok(folderCopyText({ ...folder, tutanak }).endsWith('\n\nPlaka: 35 KR 7781\nAd Soyad: Ayşe Kara\nT.C. Kimlik No: 19090909018\nEhliyet: 106408-B\nTelefon: 0505 377 64 20\nAdres: Alsancak Mah. 1453 Sok. İzmir\nAlındığı yer: Konak'));
});

test('accident report phones are shown and copied like the customer phone', () => {
  const s = folderSections({ ...folder, tutanak: { aTel: '05053776420', bTel: '5053776420' } });
  const tel = (kind) => s.find((x) => x.kind === kind).rows.find((r) => r.label === 'Telefon');
  assert.deepEqual(tel('tutanakA'), { label: 'Telefon', value: '0505 377 64 20', path: 'tutanak.aTel' });
  assert.equal(tel('tutanakB').value, '0505 377 64 20', 'a number the sheet stripped of its 0 too');
  assert.equal(sectionCopyText(s.find((x) => x.kind === 'tutanakA').rows), 'Telefon: 0505 377 64 20');
});

test('sectionCopyText: "Label: value" lines, empty values left out', () => {
  assert.equal(
    sectionCopyText([{ label: 'Plaka', value: '34 NMA 887' }, { label: 'Şase no', value: '' }, { label: 'Model yılı', value: '2019' }]),
    'Plaka: 34 NMA 887\nModel yılı: 2019',
  );
});

test('folderCopyText: every section that has something, separated by a blank line', () => {
  const text = folderCopyText(folder);
  assert.ok(text.startsWith('Ad soyad: Uğurcan Kaya\nTelefon: 0532 418 27 90\n\nPlaka: 34 NMA 887'));
  assert.ok(text.includes('\n\nRuhsat sahibi: Uğurcan Kaya\nTC / Vergi no: 10000000146'));
  assert.ok(!text.includes('Ehliyet'));
});

test('readyMessage: the default greets by first name with Bey or Hanım', () => {
  const t = DEFAULT_SETTINGS.waTemplate;
  assert.equal(readyMessage({ ...folder, hitap: 'Bey' }, t), 'Merhaba Uğurcan Bey, aracınız hazır, teslim alabilirsiniz.');
  assert.equal(readyMessage({ name: 'Yiğit Emre Örsyürek', hitap: 'Hanım' }, t), 'Merhaba Yiğit Emre Hanım, aracınız hazır, teslim alabilirsiniz.');
  assert.equal(readyMessage({ name: 'Kaya', hitap: 'Bey' }, t), 'Merhaba Kaya Bey, aracınız hazır, teslim alabilirsiniz.');
});

test('readyMessage: a name read off a document in capitals is written the Turkish way', () => {
  const t = DEFAULT_SETTINGS.waTemplate;
  assert.equal(readyMessage({ name: 'UĞURCAN KAYA', hitap: 'Bey' }, t), 'Merhaba Uğurcan Bey, aracınız hazır, teslim alabilirsiniz.');
  assert.equal(readyMessage({ name: 'IŞIL İNCE', hitap: 'Hanım' }, t), 'Merhaba Işıl Hanım, aracınız hazır, teslim alabilirsiniz.');
});

test('readyMessage: no stray spaces when Bey/Hanım or the name is missing', () => {
  const t = DEFAULT_SETTINGS.waTemplate;
  assert.equal(readyMessage(folder, t), 'Merhaba Uğurcan, aracınız hazır, teslim alabilirsiniz.');
  assert.equal(readyMessage({ name: '', hitap: 'Bey' }, t), 'Merhaba, aracınız hazır, teslim alabilirsiniz.');
});

test('readyMessage: an own template can use the full name and the plate', () => {
  assert.equal(readyMessage(folder, '{adsoyad}, {plaka} plakalı aracınız hazır.'), 'Uğurcan Kaya, 34 NMA 887 plakalı aracınız hazır.');
});

test('waLink: Turkish mobile number and the ready message', () => {
  assert.equal(
    waLink({ ...folder, hitap: 'Bey' }, DEFAULT_SETTINGS.waTemplate),
    `https://wa.me/905324182790?text=${encodeURIComponent('Merhaba Uğurcan Bey, aracınız hazır, teslim alabilirsiniz.')}`,
  );
  assert.equal(waLink({ ...folder, phone: '' }, 'x'), '');
});

test('telLink: dialable number or nothing', () => {
  assert.equal(telLink('0532 418 27 90'), 'tel:05324182790');
  assert.equal(telLink(''), '');
});
