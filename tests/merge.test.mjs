import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRemote } from '../app/js/sync/merge.js';

const localJob = { id: 'j1', folderId: 'f1', date: '2026-10-29', description: 'Kapı', parts: [], amount: 6000, vatMode: 'dahil', vatRate: 20, net: 5000, vat: 1000, total: 6000, paid: false, payer: 'musteri', insurer: '', claimNo: '', note: '', updatedAt: 5 };
const remoteJob = { id: 'j1', folderId: 'f1', date: '2026-10-29', description: 'Kapı', parts: [], amount: 5000, vatMode: 'haric', vatRate: 20, net: 5000, vat: 1000, total: 6000, paid: false, payer: 'musteri', remoteStamp: 99, plate: '34 NMA 887', name: 'Uğurcan Kaya' };
const local = (jobs = [localJob], folders = [{ id: 'f1', name: 'Uğurcan Kaya', plate: '34 NMA 887', ruhsat: { sahibi: 'Uğurcan Kaya', tcVkn: '1' } }]) => ({
  jobs: new Map(jobs.map((j) => [j.id, j])),
  folders: new Map(folders.map((f) => [f.id, f])),
});

test('a remote row identical to the phone copy is skipped (keeps the KDV dahil entry)', () => {
  assert.deepEqual(mergeRemote(local(), { folders: [], jobs: [remoteJob] }, new Set()), { folders: [], jobs: [] });
});

test('a remote change is applied, stamped, and loses the folder columns', () => {
  const r = mergeRemote(local(), { folders: [], jobs: [{ ...remoteJob, paid: true }] }, new Set());
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].paid, true);
  assert.equal(r.jobs[0].updatedAt, 99);
  assert.equal('plate' in r.jobs[0], false);
  assert.equal('name' in r.jobs[0], false);
  assert.equal('remoteStamp' in r.jobs[0], false);
});

test('rows the phone has not sent yet win over the sheet', () => {
  const r = mergeRemote(local(), { folders: [], jobs: [{ ...remoteJob, paid: true }] }, new Set(['j1']));
  assert.equal(r.jobs.length, 0);
});

test('unknown rows are added; rows without an id are ignored', () => {
  const r = mergeRemote(local([]), { folders: [], jobs: [{ ...remoteJob, id: 'j9' }, { ...remoteJob, id: undefined }] }, new Set());
  assert.deepEqual(r.jobs.map((j) => j.id), ['j9']);
});

test('folder documents merge field by field', () => {
  const r = mergeRemote(local(), { folders: [{ id: 'f1', name: 'Uğurcan Kaya', ruhsat: { tcVkn: '10000000146' }, remoteStamp: 7 }], jobs: [] }, new Set());
  assert.equal(r.folders.length, 1);
  assert.deepEqual(r.folders[0].ruhsat, { sahibi: 'Uğurcan Kaya', tcVkn: '10000000146' });
  assert.equal(r.folders[0].updatedAt, 7);
});

test('a remote change of only the invoice flag is applied', () => {
  const mine = { ...localJob, costs: [], invoiced: false };
  const r = mergeRemote(local([mine]), { folders: [], jobs: [{ ...remoteJob, costs: [], invoiced: true }] }, new Set());
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].invoiced, true);
  assert.equal(r.jobs[0].updatedAt, 99);
});

test('equal costs from the sheet (a new array) are skipped; changed costs are applied', () => {
  const costs = () => [{ cat: 'boya', label: '', amount: 10000 }, { cat: 'diger', label: 'Cam filmi', amount: 1500 }];
  const mine = { ...localJob, costs: costs(), invoiced: true };
  assert.deepEqual(mergeRemote(local([mine]), { folders: [], jobs: [{ ...remoteJob, costs: costs(), invoiced: true }] }, new Set()), { folders: [], jobs: [] });
  const r = mergeRemote(local([mine]), { folders: [], jobs: [{ ...remoteJob, costs: [{ cat: 'boya', label: '', amount: 12000 }], invoiced: true }] }, new Set());
  assert.equal(r.jobs.length, 1);
  assert.deepEqual(r.jobs[0].costs, [{ cat: 'boya', label: '', amount: 12000 }]);
});

test('a job saved before costs existed is not rewritten by a row that says "no costs, not invoiced"', () => {
  assert.equal('costs' in localJob || 'invoiced' in localJob, false);
  assert.deepEqual(mergeRemote(local(), { folders: [], jobs: [{ ...remoteJob, costs: [], invoiced: false }] }, new Set()), { folders: [], jobs: [] });
  const r = mergeRemote(local(), { folders: [], jobs: [{ ...remoteJob, costs: [], invoiced: true }] }, new Set());
  assert.equal(r.jobs.length, 1);
});

test('a sheet without the new columns never touches costs or the invoice flag', () => {
  const mine = { ...localJob, costs: [{ cat: 'boya', label: '', amount: 10000 }], invoiced: true };
  assert.deepEqual(mergeRemote(local([mine]), { folders: [], jobs: [remoteJob] }, new Set()), { folders: [], jobs: [] });
  const r = mergeRemote(local([mine]), { folders: [], jobs: [{ ...remoteJob, paid: true }] }, new Set());
  assert.equal('costs' in r.jobs[0] || 'invoiced' in r.jobs[0], false);
});

test('accident report fields merge one by one, like the other documents', () => {
  const folders = [{ id: 'f1', name: 'Uğurcan Kaya', tutanak: { aTel: '0532 418 27 90' } }];
  const r = mergeRemote(local([localJob], folders), { folders: [{ id: 'f1', name: 'Uğurcan Kaya', tutanak: { aAdSoyad: 'Ali Veli' }, remoteStamp: 8 }], jobs: [] }, new Set());
  assert.equal(r.folders.length, 1);
  assert.deepEqual(r.folders[0].tutanak, { aTel: '0532 418 27 90', aAdSoyad: 'Ali Veli' });
  const saved = [{ ...folders[0], tutanak: r.folders[0].tutanak }];
  const again = mergeRemote(local([localJob], saved), { folders: [{ id: 'f1', name: 'Uğurcan Kaya', tutanak: { aAdSoyad: 'Ali Veli' }, remoteStamp: 9 }], jobs: [] }, new Set());
  assert.equal(again.folders.length, 0, 'the same report again changes nothing');
});
