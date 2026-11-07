import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasWorld } from './helpers/gas-fake.mjs';
import * as repo from '../app/js/data/repo.js';
import { clearAll, put } from '../app/js/data/db.js';
import { syncNow, syncStatus, STUCK_MESSAGE } from '../app/js/sync/google.js';

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
  assert.equal(rowOf(j.id)[jh.indexOf('Maliyet')], 20000);
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

// The sheet turns down the ops refuse() picks, the way Code.gs answers one op that threw (Drive full,
// a script error on one row); the rest go through the real Code.gs. Returns every op that arrived.
function refuseOps(w, refuse) {
  const real = w.context.runOp_;
  const arrived = [];
  w.context.runOp_ = (op) => {
    arrived.push(op);
    return refuse(op) ? { ok: false, error: 'Drive depolama alanı dolu' } : real(op);
  };
  return arrived;
}

// Time passes: every write waiting for its next try is due.
async function waitIsOver() {
  for (const e of await repo.readOutbox()) if (e.tries) await put('outbox', { ...e, retryAt: 0 });
}

const idsIn = (w, name, header) => {
  const data = w.sheets.get(name)?.data || [[]];
  return data.slice(1).map((r) => r[data[0].indexOf(header)]);
};
const jobRow = (w, id) => {
  const data = w.sheets.get('İşler').data;
  const row = data.find((r) => r[data[0].indexOf('Kayıt No')] === id);
  return Object.fromEntries(data[0].map((h, i) => [h, row?.[i]]));
};
const editJobCell = (w, id, header, value) => {
  const sheet = w.sheets.get('İşler');
  const at = sheet.data.findIndex((r) => r[sheet.data[0].indexOf('Kayıt No')] === id);
  sheet.data[at][sheet.data[0].indexOf(header)] = value;
  w.context.onEdit({ range: sheet.getRange(at + 1, sheet.data[0].indexOf(header) + 1) });
};
const tick = () => new Promise((r) => setTimeout(r, 5));

test('a write the sheet turns down stays queued, waits longer each time and never holds up other writes', async () => {
  const w = await connected();
  let full = true;
  const arrived = refuseOps(w, (op) => full && op.op === 'upsertJob');
  const jobOps = () => arrived.filter((op) => op.op === 'upsertJob').length;
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887' });
  const j = await repo.saveJob({ folderId: f.id, amount: 5000, date: '2026-11-07' });
  const before = Date.now();
  await syncNow();
  assert.equal(syncStatus.state, 'ok', 'one failure is no warning yet');
  assert.deepEqual(idsIn(w, 'Müşteriler', 'Klasör No'), [f.id]);
  assert.deepEqual(idsIn(w, 'İşler', 'Kayıt No'), []);
  let [entry, ...more] = await repo.readOutbox();
  assert.equal(more.length, 0);
  assert.equal(entry.kind, 'job');
  assert.equal(entry.tries, 1);
  assert.match(entry.error, /Drive/);
  assert.ok(entry.retryAt >= before + 30_000 && entry.retryAt <= Date.now() + 30_000, 'tried again in 30 seconds');

  // While the job waits, other changes go; the job is not sent again before its time.
  const g = await repo.saveFolder({ name: 'Ayşe Demir' });
  await syncNow();
  assert.equal(jobOps(), 1);
  assert.deepEqual(idsIn(w, 'Müşteriler', 'Klasör No'), [f.id, g.id]);

  await waitIsOver();
  await syncNow();
  [entry] = await repo.readOutbox();
  assert.equal(entry.tries, 2);
  const left = entry.retryAt - Date.now();
  assert.ok(left > 50_000 && left <= 60_000, `then in a minute (${left} ms)`);
  assert.equal(syncStatus.state, 'ok');

  // The third failure shows the warning.
  await waitIsOver();
  await syncNow();
  assert.equal(jobOps(), 3);
  assert.equal(syncStatus.state, 'error');
  assert.equal(syncStatus.error, STUCK_MESSAGE);
  assert.match(syncStatus.error, /Google tablosuna yazılamadı.*Drive/);

  // Room again: the job goes on its next try, and the warning clears.
  full = false;
  await syncNow();
  assert.equal(jobOps(), 3, 'still waiting');
  await waitIsOver();
  await syncNow();
  assert.equal(jobOps(), 4);
  assert.deepEqual(idsIn(w, 'İşler', 'Kayıt No'), [j.id]);
  assert.equal(jobRow(w, j.id)['Toplam (KDV Dahil)'], 6000);
  assert.equal((await repo.readOutbox()).length, 0);
  assert.equal(syncStatus.state, 'ok', syncStatus.error);
});

test('"Şimdi eşitle" tries the waiting writes again at once', async () => {
  const w = await connected();
  let full = true;
  refuseOps(w, (op) => full && op.op === 'upsertFolder');
  const f = await repo.saveFolder({ name: 'A' });
  await syncNow();
  full = false;
  await syncNow();
  assert.equal((await repo.readOutbox()).length, 1, 'an automatic sync waits');
  await syncNow({ retryNow: true });
  assert.equal((await repo.readOutbox()).length, 0);
  assert.deepEqual(idsIn(w, 'Müşteriler', 'Klasör No'), [f.id]);
});

test('a failing record keeps one queue entry and sends its newest version; a save that gets through takes the old failure with it', async () => {
  const w = await connected();
  let full = true;
  const arrived = refuseOps(w, (op) => full && op.op === 'upsertJob');
  const jobOps = () => arrived.filter((op) => op.op === 'upsertJob');
  const f = await repo.saveFolder({ name: 'A' });
  const j = await repo.saveJob({ folderId: f.id, amount: 1000, date: '2026-11-07' });
  await syncNow();
  await repo.saveJob({ id: j.id, amount: 2000 });
  await repo.saveJob({ id: j.id, amount: 3000 });
  await syncNow();
  // A new save is tried at once, as the newest version, and the failures stay one entry.
  assert.equal(jobOps().length, 2);
  assert.equal(jobOps()[1].row['Toplam (KDV Dahil)'], 3600);
  const box = await repo.readOutbox();
  assert.equal(box.length, 1);
  assert.equal(box[0].tries, 2);

  full = false;
  await repo.saveJob({ id: j.id, amount: 4000 });
  await syncNow();
  assert.equal(jobOps().length, 3);
  assert.equal(jobRow(w, j.id)['Toplam (KDV Dahil)'], 4800);
  assert.equal((await repo.readOutbox()).length, 0, 'the waiting entry went with the newer save');

  // Changed in the sheet afterwards: nothing old is sent over it, the phone follows.
  await tick();
  editJobCell(w, j.id, 'Ödeme', 'Ödendi');
  await syncNow({ retryNow: true });
  assert.equal(jobOps().length, 3);
  assert.equal((await repo.getJob(j.id)).paid, true);
  assert.equal(jobRow(w, j.id)['Ödeme'], 'Ödendi');
});

test('a change made in the sheet after a failed save was tried is newer: it reaches the phone and the save is dropped', async () => {
  const w = await connected();
  let full = false;
  const arrived = refuseOps(w, (op) => full && op.op === 'upsertJob');
  const f = await repo.saveFolder({ name: 'A' });
  const j = await repo.saveJob({ folderId: f.id, amount: 1000, date: '2026-11-07' });
  await syncNow();
  full = true;
  await repo.saveJob({ id: j.id, amount: 2000 });
  await syncNow();
  await tick();
  editJobCell(w, j.id, 'Ödeme', 'Ödendi');
  full = false;
  await syncNow({ retryNow: true });
  assert.equal(arrived.filter((op) => op.op === 'upsertJob').length, 2, 'the failed save is not written over the newer row');
  const back = await repo.getJob(j.id);
  assert.equal(back.paid, true);
  assert.equal(back.total, 1200, 'the row as the sheet has it');
  assert.equal(jobRow(w, j.id)['Ödeme'], 'Ödendi');
  assert.equal((await repo.readOutbox()).length, 0);
  assert.equal(syncStatus.state, 'ok', syncStatus.error);
});

test('a change made in the sheet before a failed save was tried is older: the retry writes the phone\'s version', async () => {
  const w = await connected();
  let full = false;
  refuseOps(w, (op) => full && op.op === 'upsertJob');
  const f = await repo.saveFolder({ name: 'A' });
  const j = await repo.saveJob({ folderId: f.id, amount: 1000, date: '2026-11-07' });
  await syncNow();
  await tick();
  editJobCell(w, j.id, 'Not', 'elle yazıldı');
  await tick();
  full = true;
  await repo.saveJob({ id: j.id, amount: 2000, note: 'telefondan' });
  await syncNow();
  assert.equal((await repo.getJob(j.id)).note, 'telefondan', 'the waiting save keeps the phone\'s copy');
  full = false;
  await syncNow({ retryNow: true });
  assert.equal(jobRow(w, j.id)['Toplam (KDV Dahil)'], 2400);
  assert.equal(jobRow(w, j.id)['Not'], 'telefondan');
  assert.equal((await repo.readOutbox()).length, 0);
});

test('a photo Drive turned down goes once there is room again, and only once', async () => {
  const w = await connected();
  // A full Drive refuses new files, the way the real one throws from createFile.
  const proto = Object.getPrototypeOf(w.drive.roots[0]);
  const createFile = proto.createFile;
  proto.createFile = function (blob) {
    if (this.drive.full) throw new Error('Drive depolama alanı dolu');
    return createFile.call(this, blob);
  };
  try {
    w.drive.full = true;
    const f = await repo.saveFolder({ name: 'A', plate: '34 NMA 887' });
    const p = await repo.addPhoto({ folderId: f.id, kind: 'once', blob: new Blob(['jpg'], { type: 'image/jpeg' }), thumb: new Blob(['t']) });
    await syncNow();
    assert.deepEqual(idsIn(w, 'Müşteriler', 'Klasör No'), [f.id], 'the folder row is not held up');
    const files = () => w.drive.roots[0].folders.flatMap((d) => d.files);
    assert.equal(files().length, 0);
    assert.equal((await repo.getPhoto(p.id)).driveFileId, null);
    const [entry] = await repo.readOutbox();
    assert.equal(entry.kind, 'photo');
    assert.equal(entry.tries, 1);
    assert.match(entry.error, /Drive/);

    w.drive.full = false;
    await syncNow({ retryNow: true });
    await syncNow({ retryNow: true });
    assert.equal(w.drive.roots[0].folders.length, 1);
    assert.equal(files().length, 1);
    assert.equal((await repo.getPhoto(p.id)).driveFileId, files()[0].id);
    assert.equal((await repo.readOutbox()).length, 0);
  } finally {
    proto.createFile = createFile;
  }
});

test('a failing record deleted on the phone leaves the queue; a folder deletion still on its way keeps its jobs off the phone', async () => {
  const w = await connected();
  let refuse = (op) => op.op === 'upsertJob';
  refuseOps(w, (op) => refuse(op));
  const f = await repo.saveFolder({ name: 'A' });
  const j = await repo.saveJob({ folderId: f.id, amount: 1000, date: '2026-11-07' });
  for (let i = 0; i < 3; i++) {
    await waitIsOver();
    await syncNow();
  }
  assert.equal(syncStatus.error, STUCK_MESSAGE);
  await repo.deleteJob(j.id);
  await syncNow();
  assert.equal(syncStatus.state, 'ok', syncStatus.error);
  assert.equal((await repo.readOutbox()).length, 0);

  refuse = () => false;
  const k = await repo.saveJob({ folderId: f.id, amount: 500, date: '2026-11-07' });
  await syncNow();
  refuse = (op) => op.op === 'deleteFolder';
  await repo.deleteFolder(f.id);
  await syncNow();
  await tick();
  editJobCell(w, k.id, 'Not', 'elle');
  await syncNow({ retryNow: true });
  assert.equal(await repo.getJob(k.id), undefined, 'not brought back without its folder');
  assert.equal((await repo.readOutbox()).length, 1);

  refuse = () => false;
  await syncNow({ retryNow: true });
  assert.deepEqual(idsIn(w, 'Müşteriler', 'Klasör No'), []);
  assert.deepEqual(idsIn(w, 'İşler', 'Kayıt No'), []);
  assert.equal((await repo.readOutbox()).length, 0);
  assert.equal(await repo.getJob(k.id), undefined);
});
