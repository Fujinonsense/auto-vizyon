import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldTr, matchesQuery, filterSummaries } from '../app/js/lib/search.js';

const ugur = {
  folder: {
    id: 'a', name: 'Uğurcan Kaya', phone: '05324182790', plate: '34 NMA 887', brand: 'Audi', model: 'A7',
    color: 'Siyah', vin: 'WAUZZZ4G7JN012345', createdAt: new Date(2026, 8, 1).getTime(),
  },
  jobs: [{ id: 'j1', date: '2026-10-05', paid: true, payer: 'musteri', insurer: '', claimNo: '' }],
};
const ayse = {
  folder: { id: 'b', name: 'Ayşe Işık', phone: '05053776420', plate: '35 KR 7781', createdAt: new Date(2026, 7, 1).getTime() },
  jobs: [{ id: 'j2', date: '2026-09-12', paid: false, payer: 'sigorta', insurer: 'Anadolu Sigorta', claimNo: 'HSR-2026-4411' }],
};
const ids = (list) => list.map((s) => s.folder.id);

test('foldTr lowercases and strips Turkish letters', () => {
  assert.equal(foldTr('Uğurcan IŞIK İzmir Çeşme Ödül'), 'ugurcan isik izmir cesme odul');
});

test('plate typed without spaces matches', () => {
  assert.ok(matchesQuery(ugur, '34nma'));
  assert.ok(matchesQuery(ugur, '34 nma 887'));
});

test('name typed without Turkish letters matches', () => {
  assert.ok(matchesQuery(ugur, 'ugurcan'));
  assert.ok(matchesQuery(ayse, 'ayse isik'));
});

test('part of the phone number matches', () => {
  assert.ok(matchesQuery(ugur, '4182790'));
  assert.ok(matchesQuery(ugur, '0532 418'));
});

test('part of the VIN matches', () => {
  assert.ok(matchesQuery(ugur, 'jn0123'));
});

test('insurer and claim number match', () => {
  assert.ok(matchesQuery(ayse, 'anadolu'));
  assert.ok(matchesQuery(ayse, 'hsr-2026'));
});

test('unrelated query does not match, empty query matches all', () => {
  assert.ok(!matchesQuery(ugur, 'renault'));
  assert.ok(matchesQuery(ugur, '  '));
});

test('filters: borçlu, sigorta, bu ay, with query', () => {
  const now = new Date(2026, 9, 20);
  assert.deepEqual(ids(filterSummaries([ugur, ayse], { filter: 'borc' }, now)), ['b']);
  assert.deepEqual(ids(filterSummaries([ugur, ayse], { filter: 'sigorta' }, now)), ['b']);
  assert.deepEqual(ids(filterSummaries([ugur, ayse], { filter: 'buay' }, now)), ['a']);
  assert.deepEqual(ids(filterSummaries([ugur, ayse], { filter: 'tum', query: 'kaya' }, now)), ['a']);
  assert.deepEqual(ids(filterSummaries([ugur, ayse], {}, now)), ['a', 'b']);
});
