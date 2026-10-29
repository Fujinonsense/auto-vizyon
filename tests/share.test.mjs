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
