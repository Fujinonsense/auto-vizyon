import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAi, markManual, getPath, setPath } from '../app/js/lib/merge-ai.js';

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

test('markManual: an edited field stops being AI-filled or unclear', () => {
  const f = fresh();
  mergeAi(f, 'arac', { plaka: '34 NMA 888', renk: 'Siyah', marka: '', model: '' }, ['plaka']);
  markManual(f, 'plate');
  assert.deepEqual(f.aiFilled, ['color']);
  assert.deepEqual(f.unclear, []);
  mergeAi(f, 'ruhsat', { plaka: '34 NMA 887' }, []);
  assert.equal(f.plate, '34 NMA 888');
});
