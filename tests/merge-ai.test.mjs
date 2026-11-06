import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAi, replaceAi, markManual, getPath, setPath, AI_PATHS } from '../app/js/lib/merge-ai.js';
import { KINDS } from '../app/js/ai/schemas.js';

const fresh = () => ({ name: '', plate: '', ruhsat: {}, ehliyet: {}, kimlik: {}, aiFilled: [], unclear: [] });

test('getPath and setPath reach nested document fields', () => {
  const f = fresh();
  setPath(f, 'ruhsat.sahibi', 'Uğurcan Kaya');
  assert.equal(getPath(f, 'ruhsat.sahibi'), 'Uğurcan Kaya');
  assert.equal(getPath(f, 'kimlik.tc'), undefined);
});

test('fills empty fields and remembers which ones the AI wrote', () => {
  const f = fresh();
  const changed = mergeAi(f, 'arac', { plaka: '34 NMA 887', renk: 'Siyah', marka: 'Audi', model: '' }, []);
  assert.equal(f.plate, '34 NMA 887');
  assert.equal(f.color, 'Siyah');
  assert.deepEqual(changed.sort(), ['brand', 'color', 'plate']);
  assert.deepEqual(f.aiFilled.sort(), ['brand', 'color', 'plate']);
});

test('never overwrites a value typed by hand', () => {
  const f = { ...fresh(), brand: 'Audi' };
  mergeAi(f, 'arac', { plaka: '', renk: '', marka: 'Volkswagen', model: 'Passat' }, []);
  assert.equal(f.brand, 'Audi');
  assert.equal(f.model, 'Passat');
});

test('a later document corrects what the AI wrote earlier', () => {
  const f = fresh();
  mergeAi(f, 'arac', { plaka: '34 NMA 888', renk: '', marka: '', model: '' }, ['plaka']);
  assert.deepEqual(f.unclear, ['plate']);
  mergeAi(f, 'ruhsat', { plaka: '34 NMA 887', saseNo: 'WAUZZZ4G7JN012345' }, []);
  assert.equal(f.plate, '34 NMA 887');
  assert.equal(f.vin, 'WAUZZZ4G7JN012345');
  assert.deepEqual(f.unclear, []);
});

test('customer name comes from ruhsat, then kimlik, then ehliyet', () => {
  const f = fresh();
  mergeAi(f, 'kimlik', { adSoyad: 'Ali Veli', tc: '10000000146' }, []);
  assert.equal(f.name, 'Ali Veli');
  mergeAi(f, 'ruhsat', { sahibiAdSoyad: 'Uğurcan Kaya' }, []);
  assert.equal(f.name, 'Uğurcan Kaya');
  assert.equal(f.kimlik.tc, '10000000146');
  assert.equal(f.ruhsat.sahibi, 'Uğurcan Kaya');
});

test('a name typed by hand is never replaced', () => {
  const f = { ...fresh(), name: 'Mehmet Usta' };
  mergeAi(f, 'ruhsat', { sahibiAdSoyad: 'Uğurcan Kaya' }, []);
  assert.equal(f.name, 'Mehmet Usta');
});

test('every field the AI reads has a place in the folder', () => {
  for (const [kind, k] of Object.entries(KINDS)) {
    assert.deepEqual(Object.keys(AI_PATHS[kind] || {}).sort(), k.fields.map((f) => f.key).sort(), kind);
  }
  assert.deepEqual(Object.values(AI_PATHS.tutanak), KINDS.tutanak.fields.map((f) => `tutanak.${f.key}`));
});

test('kaza tutanağı: fills an empty folder, keeps what was typed by hand, never names the folder', () => {
  const f = fresh();
  assert.equal('tutanak' in f, false, 'a folder from before the accident report');
  const changed = mergeAi(f, 'tutanak', { aAdSoyad: 'Ali Veli', aTel: '0532 418 27 90', bPlaka: '35 KR 7781', bTc: '' }, ['bPlaka']);
  assert.equal(f.tutanak.aAdSoyad, 'Ali Veli');
  assert.equal(f.tutanak.bPlaka, '35 KR 7781');
  assert.equal('bTc' in f.tutanak, false);
  assert.deepEqual(changed.sort(), ['tutanak.aAdSoyad', 'tutanak.aTel', 'tutanak.bPlaka']);
  assert.ok(f.unclear.includes('tutanak.bPlaka'));
  assert.equal(f.name, '', 'which driver is the customer is not known');

  const typed = { ...fresh(), tutanak: { aTel: '0532 000 00 00' } };
  mergeAi(typed, 'tutanak', { aAdSoyad: 'Ali Veli', aTel: '0532 418 27 90' }, []);
  assert.equal(typed.tutanak.aTel, '0532 000 00 00');
  assert.equal(typed.tutanak.aAdSoyad, 'Ali Veli');
  markManual(f, 'tutanak.aAdSoyad');
  mergeAi(f, 'tutanak', { aAdSoyad: 'Başka Biri' }, []);
  assert.equal(f.tutanak.aAdSoyad, 'Ali Veli', 'a field corrected by hand stays');
});

// Two readings of accident reports, as parseResponse gives them (B differs, report 2 misses three fields).
const report1 = {
  aAdSoyad: 'Uğurcan Kaya', aTc: '10000000146', aTel: '05324182790', aPlaka: '34 NMA 887',
  bAdSoyad: 'Mehmet Yılmaz', bTc: '12345678950', bEhliyet: '554433-B', bAlindigiYer: 'Konak', bAdres: 'Alsancak Mah. İzmir',
  bTel: '05320000000', bPlaka: '06 ABC 123',
};
const report2 = {
  aAdSoyad: 'Uğurcan Kaya', aTc: '10000000146', aTel: '05324182790', aPlaka: '34 NMA 887',
  bAdSoyad: 'Ayşe Kara', bTc: '19090909018', bEhliyet: '106408-B', bAlindigiYer: '', bAdres: '', bTel: '', bPlaka: '35 KR 7781',
};

test('kaza tutanağı read again: the new photo replaces the last reading, fields typed by hand stay', () => {
  const f = fresh();
  replaceAi(f, 'tutanak', report1, ['bTc']);
  setPath(f, 'tutanak.aEhliyet', '482190-B'); // typed by hand, as the form does it
  markManual(f, 'tutanak.aEhliyet');
  const changed = replaceAi(f, 'tutanak', report2, ['bAdres']);
  assert.deepEqual(f.tutanak, {
    aEhliyet: '482190-B', aAdSoyad: 'Uğurcan Kaya', aTc: '10000000146', aTel: '05324182790', aPlaka: '34 NMA 887',
    bAdSoyad: 'Ayşe Kara', bTc: '19090909018', bEhliyet: '106408-B', bPlaka: '35 KR 7781',
  });
  assert.equal(f.tutanak.bAdres, undefined, 'nothing kept from the first report');
  assert.deepEqual(f.unclear, ['tutanak.bAdres'], 'the old marks go, the new one is there');
  assert.ok(!f.aiFilled.includes('tutanak.aEhliyet') && !f.aiFilled.includes('tutanak.bAdres'));
  assert.ok(f.aiFilled.includes('tutanak.bAdSoyad'));
  assert.ok(changed.includes('tutanak.bAdSoyad') && changed.includes('tutanak.aAdSoyad'), 'everything read is written again');
});

test('kaza tutanağı: a field left empty and listed as unclear is marked to check until it is typed', () => {
  const f = fresh();
  replaceAi(f, 'tutanak', { ...report2, bAdres: '' }, ['bAdres']);
  assert.equal(getPath(f, 'tutanak.bAdres'), undefined);
  assert.ok(f.unclear.includes('tutanak.bAdres'));
  setPath(f, 'tutanak.bAdres', 'Konak İzmir');
  markManual(f, 'tutanak.bAdres');
  assert.ok(!f.unclear.includes('tutanak.bAdres'));
  replaceAi(f, 'tutanak', { ...report2, bAdres: '' }, ['bAdres']);
  assert.equal(f.tutanak.bAdres, 'Konak İzmir', 'typed by hand: never wiped or marked by a later reading');
  assert.ok(!f.unclear.includes('tutanak.bAdres'));
});

test('kaza tutanağı: a photo with nothing readable still replaces the last reading', () => {
  const f = fresh();
  replaceAi(f, 'tutanak', report1, []);
  const blank = Object.fromEntries(Object.keys(report1).map((k) => [k, '']));
  assert.deepEqual(replaceAi(f, 'tutanak', blank, ['aAdSoyad']), []);
  assert.deepEqual(f.tutanak, {}, 'an empty report, not the old one');
  assert.deepEqual(f.unclear, ['tutanak.aAdSoyad']);
  assert.deepEqual(f.aiFilled, []);
});

test('the other documents still only fill in: an empty field listed as unclear changes nothing', () => {
  const f = { ...fresh(), plate: '34 NMA 887', aiFilled: ['plate'] };
  mergeAi(f, 'ruhsat', { plaka: '', saseNo: '' }, ['plaka', 'saseNo']);
  assert.equal(f.plate, '34 NMA 887');
  assert.deepEqual(f.unclear, []);
});

test('markManual: an edited field stops being AI-filled or unclear', () => {
  const f = fresh();
  mergeAi(f, 'arac', { plaka: '34 NMA 888', renk: 'Siyah', marka: '', model: '' }, ['plaka']);
  markManual(f, 'plate');
  assert.deepEqual(f.aiFilled, ['color']);
  assert.deepEqual(f.unclear, []);
  mergeAi(f, 'ruhsat', { plaka: '34 NMA 887' }, []);
  assert.equal(f.plate, '34 NMA 888');
});
