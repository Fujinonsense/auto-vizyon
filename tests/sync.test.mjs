import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasWorld } from './helpers/gas-fake.mjs';
import * as repo from '../app/js/data/repo.js';
import { clearAll } from '../app/js/data/db.js';
import { syncNow, syncStatus } from '../app/js/sync/google.js';

const URL_ = 'https://script.google.com/macros/s/FAKE/exec';

async function connected() {
  const w = gasWorld();
  const token = w.context.kurulum();
  globalThis.fetch = w.fetch;
  await clearAll();
  await repo.setSetting('scriptUrl', URL_);
  await repo.setSetting('token', token);
  return w;
}

test('phone and Google stay in step: push, photo to Drive, sheet edit comes back, delete', async () => {
  const w = await connected();
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887', color: 'Siyah', brand: 'Audi', model: 'A7', phone: '05324182790' });
  const j = await repo.saveJob({ folderId: f.id, amount: 5000, date: '2026-10-29' });
  const p = await repo.addPhoto({ folderId: f.id, kind: 'once', blob: new Blob(['jpg'], { type: 'image/jpeg' }), thumb: new Blob(['t']) });

  await syncNow();
  assert.equal(syncStatus.state, 'ok', syncStatus.error);
  assert.equal((await repo.peekOutbox(10)).length, 0);
  const jobs = w.sheets.get('İşler').data;
  const jh = jobs[0];
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1][jh.indexOf('Toplam (KDV Dahil)')], 6000);
  assert.equal(jobs[1][jh.indexOf('Müşteri')], 'Uğurcan Kaya');
  const driveFolder = w.drive.roots[0].folders[0];
  assert.equal(driveFolder.name, 'Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)');
  assert.equal(driveFolder.files.length, 1);
  assert.ok((await repo.getPhoto(p.id)).driveFileId);
  assert.ok((await repo.getFolder(f.id)).driveUrl.startsWith('https://drive.google.com/'));

  jobs[1][jh.indexOf('Ödeme')] = 'Ödendi';
  w.context.onEdit({ range: w.sheets.get('İşler').getRange(2, jh.indexOf('Ödeme') + 1) });
  await syncNow();
  assert.equal((await repo.jobsForFolder(f.id))[0].paid, true);
  assert.equal((await repo.peekOutbox(10)).length, 0);

  await repo.deleteJob(j.id);
  await syncNow();
  assert.equal(w.sheets.get('İşler').data.length, 1);
});

test('costs, the invoice flag and the accident report reach the sheet and come back without rewriting the phone', async () => {
  const w = await connected();
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887', tutanak: { aAdSoyad: 'Ali Veli', bPlaka: '35 KR 7781' } });
  const j = await repo.saveJob({
    folderId: f.id, amount: 30000, date: '2026-11-06', invoiced: true,
    costs: [{ cat: 'dis-iscilik', label: '', amount: 20000 }, { cat: 'diger', label: 'Cam filmi', amount: 1500 }],
  });
  const old = await repo.saveJob({ folderId: f.id, amount: 1000, date: '2026-11-01' });

  await syncNow();
  assert.equal(syncStatus.state, 'ok', syncStatus.error);
  const sheet = w.sheets.get('İşler');
  const jh = sheet.data[0];
  const rowOf = (id) => sheet.data.find((r) => r[jh.indexOf('Kayıt No')] === id);
  assert.equal(rowOf(j.id)[jh.indexOf('Maliyet')], 21500);
  assert.equal(rowOf(j.id)[jh.indexOf('Maliyet Kalemleri')], 'Dış işçilik: 20000; Cam filmi: 1500');
  assert.equal(rowOf(j.id)[jh.indexOf('Fatura')], 'Kesildi');
  assert.equal(rowOf(old.id)[jh.indexOf('Maliyet Kalemleri')], '');
  assert.equal(rowOf(old.id)[jh.indexOf('Fatura')], 'Kesilmedi');
  const fs = w.sheets.get('Müşteriler').data;
  assert.equal(fs[1][fs[0].indexOf('Tutanak A Ad Soyad')], 'Ali Veli');
  assert.equal(fs[1][fs[0].indexOf('Tutanak B Plaka')], '35 KR 7781');

  // The pull right after the push reads the same rows back: nothing on the phone is rewritten.
  assert.equal((await repo.getJob(j.id)).updatedAt, j.updatedAt);
  assert.equal((await repo.getJob(old.id)).updatedAt, old.updatedAt);
  assert.equal((await repo.getFolder(f.id)).updatedAt, f.updatedAt);

  // Changed by hand in the sheet: the phone follows.
  rowOf(j.id)[jh.indexOf('Fatura')] = 'Kesilmedi';
  rowOf(j.id)[jh.indexOf('Maliyet Kalemleri')] = 'Dış işçilik: 20000';
  w.context.onEdit({ range: sheet.getRange(2, jh.indexOf('Maliyet Kalemleri') + 1, sheet.data.length - 1, 2) });
  await syncNow();
  const back = await repo.getJob(j.id);
  assert.equal(back.invoiced, false);
  assert.deepEqual(back.costs, [{ cat: 'dis-iscilik', label: '', amount: 20000 }]);
  assert.equal((await repo.peekOutbox(10)).length, 0);
});

test('a wrong token is an error and the changes wait for the next try', async () => {
  await connected();
  await repo.setSetting('token', 'wrong');
  await repo.saveFolder({ name: 'A' });
  await syncNow();
  assert.equal(syncStatus.state, 'error');
  assert.match(syncStatus.error, /anahtar/i);
  assert.equal((await repo.peekOutbox(10)).length, 1);
});

test('without Google settings sync stays off', async () => {
  await connected();
  await repo.setSetting('scriptUrl', '');
  await syncNow();
  assert.equal(syncStatus.state, 'off');
});

test('an unreachable or wrong Google address gives a Turkish hint, not "Failed to fetch"', async () => {
  await connected();
  await repo.saveFolder({ name: 'A' });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await syncNow();
  assert.equal(syncStatus.state, 'error');
  assert.match(syncStatus.error, /ulaşılamadı/);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await syncNow();
  assert.match(syncStatus.error, /Herkes/);
  assert.equal((await repo.peekOutbox(10)).length, 1);
});
