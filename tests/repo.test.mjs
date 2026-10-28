import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as repo from '../app/js/data/repo.js';
import { clearAll } from '../app/js/data/db.js';

const img = (s) => new Blob([s], { type: 'image/jpeg' });
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  await clearAll();
});

test('saveFolder assigns id, timestamps and plateKey', async () => {
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887' });
  assert.ok(f.id);
  assert.equal(f.plateKey, '34NMA887');
  assert.ok(f.createdAt > 0 && f.updatedAt >= f.createdAt);
  const back = await repo.getFolder(f.id);
  assert.equal(back.name, 'Uğurcan Kaya');
  assert.deepEqual(back.ruhsat, {});
});

test('saving an existing folder keeps createdAt and updates fields', async () => {
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887' });
  await tick();
  const g = await repo.saveFolder({ id: f.id, phone: '05324182790' });
  assert.equal(g.createdAt, f.createdAt);
  assert.ok(g.updatedAt > f.updatedAt);
  assert.equal(g.name, 'Uğurcan Kaya');
  assert.equal(g.phone, '05324182790');
});

test('findFolderByPlate ignores spacing and case', async () => {
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887' });
  assert.equal((await repo.findFolderByPlate('34nma887')).id, f.id);
  assert.equal(await repo.findFolderByPlate('06 BHK 412'), null);
  assert.equal(await repo.findFolderByPlate(''), null);
});

test('saveJob computes KDV with default settings', async () => {
  const f = await repo.saveFolder({ name: 'A' });
  const j = await repo.saveJob({ folderId: f.id, amount: 5000 });
  assert.equal(j.vatMode, 'haric');
  assert.equal(j.vatRate, 20);
  assert.deepEqual([j.net, j.vat, j.total], [5000, 1000, 6000]);
  const k = await repo.saveJob({ id: j.id, vatMode: 'dahil' });
  assert.deepEqual([k.net, k.vat, k.total], [4166.67, 833.33, 5000]);
});

test('saveJob without folderId is rejected', async () => {
  await assert.rejects(() => repo.saveJob({ amount: 100 }));
});

test('listFolders: newest activity first, cover is the first car photo, documents never become cover', async () => {
  const a = await repo.saveFolder({ name: 'A' });
  await tick();
  const b = await repo.saveFolder({ name: 'B' });
  await repo.addPhoto({ folderId: a.id, kind: 'ruhsat', blob: img('r'), thumb: img('rt') });
  assert.equal((await repo.getFolder(a.id)).coverPhotoId, null);
  const car = await repo.addPhoto({ folderId: a.id, kind: 'arac', blob: img('c'), thumb: img('ct') });
  await tick();
  await repo.saveJob({ folderId: a.id, amount: 100 });
  const list = await repo.listFolders();
  assert.deepEqual(list.map((s) => s.folder.name), ['A', 'B']);
  assert.equal(list[0].folder.coverPhotoId, car.id);
  assert.ok(list[0].cover);
  assert.equal(list[0].jobs.length, 1);
  assert.equal(list[1].cover, null);
  assert.ok(b.id);
});

test('deleteFolder removes its jobs and photos', async () => {
  const f = await repo.saveFolder({ name: 'A' });
  await repo.saveJob({ folderId: f.id, amount: 100 });
  await repo.addPhoto({ folderId: f.id, kind: 'arac', blob: img('c'), thumb: img('t') });
  await repo.deleteFolder(f.id);
  assert.equal(await repo.getFolder(f.id), undefined);
  assert.equal((await repo.jobsForFolder(f.id)).length, 0);
  assert.equal((await repo.listPhotos(f.id)).length, 0);
});

test('outbox records every change in order and ackOutbox clears them', async () => {
  const f = await repo.saveFolder({ name: 'A' });
  const j = await repo.saveJob({ folderId: f.id, amount: 1 });
  const p = await repo.addPhoto({ folderId: f.id, kind: 'once', blob: img('o'), thumb: img('t') });
  await repo.deleteJob(j.id);
  const box = await repo.peekOutbox(10);
  assert.deepEqual(box.map((e) => [e.kind, e.id]), [['folder', f.id], ['job', j.id], ['photo', p.id], ['delJob', j.id]]);
  await repo.ackOutbox(box.slice(0, 2).map((e) => e.seq));
  assert.deepEqual((await repo.peekOutbox(10)).map((e) => e.kind), ['photo', 'delJob']);
  assert.deepEqual([...(await repo.outboxIds())].sort(), [j.id, p.id].sort());
});

test('applyRemote writes without queueing and keeps the local cover', async () => {
  const f = await repo.saveFolder({ name: 'A', plate: '34 NMA 887' });
  await repo.addPhoto({ folderId: f.id, kind: 'arac', blob: img('c'), thumb: img('t') });
  await repo.ackOutbox((await repo.peekOutbox(10)).map((e) => e.seq));
  await repo.applyRemote({
    folders: [{ id: f.id, name: 'A B', plate: '34 nma 887', updatedAt: 123 }],
    jobs: [{ id: 'j1', folderId: f.id, amount: 10, net: 10, vat: 2, total: 12, updatedAt: 123 }],
  });
  assert.equal((await repo.peekOutbox(10)).length, 0);
  const g = await repo.getFolder(f.id);
  assert.equal(g.name, 'A B');
  assert.equal(g.plateKey, '34NMA887');
  assert.ok(g.coverPhotoId);
  assert.equal((await repo.jobsForFolder(f.id))[0].total, 12);
});

test('settings have defaults and can be changed', async () => {
  const s = await repo.getSettings();
  assert.equal(s.model, 'claude-opus-5-5');
  assert.equal(s.vatRate, 20);
  await repo.setSetting('vatRate', 10);
  assert.equal((await repo.getSettings()).vatRate, 10);
});
