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
