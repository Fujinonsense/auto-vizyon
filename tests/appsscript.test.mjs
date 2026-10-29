import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasWorld } from './helpers/gas-fake.mjs';
import { JOB_COLUMNS, FOLDER_COLUMNS } from '../app/js/excel/columns.js';

const post = (w, body) => JSON.parse(w.context.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const jobRow = (over = {}) => ({
  Tarih: '2026-10-29', Müşteri: 'Uğurcan Kaya', Plaka: '34 NMA 887', 'Tutar (KDV Hariç)': 5000, 'KDV Oranı': 20, KDV: 1000,
  'Toplam (KDV Dahil)': 6000, Ödeme: 'Ödenmedi', Ödeyen: 'Müşteri', 'Kayıt No': 'j1', 'Klasör No': 'f1', ...over,
});

function ready() {
  const w = gasWorld();
  const token = w.context.kurulum();
  return { w, token };
}

test('Code.gs headers are exactly the app column lists', () => {
  const { w } = ready();
  assert.deepEqual([...w.context.JOB_HEADERS], JOB_COLUMNS.map((c) => c.header));
  assert.deepEqual([...w.context.FOLDER_HEADERS], FOLDER_COLUMNS.map((c) => c.header));
});

test('kurulum creates the sheets with headers and a token', () => {
  const { w, token } = ready();
  assert.ok(token.length >= 20);
  assert.deepEqual(w.sheets.get('İşler').data[0], JOB_COLUMNS.map((c) => c.header));
  assert.ok(w.sheets.get('Müşteriler'));
  assert.ok(w.sheets.get('Özet'));
  assert.equal(w.context.kurulum(), token);
});

test('a wrong token is refused', () => {
  const { w } = ready();
  assert.equal(post(w, { token: 'nope', ops: [] }).ok, false);
  assert.equal(JSON.parse(w.context.doGet({ parameter: { token: 'nope', action: 'ping' } }).getContent()).ok, false);
});

test('upsertJob inserts once, then updates the same row', () => {
  const { w, token } = ready();
  post(w, { token, ops: [{ op: 'upsertJob', row: jobRow() }] });
  post(w, { token, ops: [{ op: 'upsertJob', row: jobRow({ Ödeme: 'Ödendi' }) }] });
  const sheet = w.sheets.get('İşler').data;
  assert.equal(sheet.length, 2);
  const h = sheet[0];
  assert.equal(sheet[1][h.indexOf('Ödeme')], 'Ödendi');
  assert.ok(sheet[1][h.indexOf('Tarih')] instanceof Date);
  assert.ok(sheet[1][h.indexOf('Güncellendi')] instanceof Date);
});

test('pull returns rows changed after "since", with plain dates and millisecond stamps', () => {
  const { w, token } = ready();
  const before = Date.now() - 1000;
  post(w, { token, ops: [{ op: 'upsertJob', row: jobRow() }] });
  const res = post(w, { token, action: 'pull', since: before });
  assert.equal(res.jobs.length, 1);
  assert.equal(res.jobs[0].Tarih, '2026-10-29');
  assert.equal(typeof res.jobs[0]['Güncellendi'], 'number');
  assert.equal(post(w, { token, action: 'pull', since: Date.now() + 60000 }).jobs.length, 0);
});

test('onEdit stamps the row and recomputes KDV and total when the amount changes', () => {
  const { w, token } = ready();
  post(w, { token, ops: [{ op: 'upsertJob', row: jobRow() }] });
  const sheet = w.sheets.get('İşler');
  const h = sheet.data[0];
  sheet.data[1][h.indexOf('Güncellendi')] = new Date(0);
  sheet.data[1][h.indexOf('Tutar (KDV Hariç)')] = 2500;
  w.context.onEdit({ range: sheet.getRange(2, h.indexOf('Tutar (KDV Hariç)') + 1) });
  assert.equal(sheet.data[1][h.indexOf('KDV')], 500);
  assert.equal(sheet.data[1][h.indexOf('Toplam (KDV Dahil)')], 3000);
  assert.ok(sheet.data[1][h.indexOf('Güncellendi')].getTime() > 0);
});

test('photos go into one Drive folder per customer, named after the folder title', () => {
  const { w, token } = ready();
  post(w, { token, ops: [{ op: 'upsertFolder', title: 'Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)', row: { 'Ad Soyad': 'Uğurcan Kaya', 'Klasör No': 'f1' } }] });
  const photo = (id) => ({ op: 'photo', folderId: 'f1', title: 'Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)', kind: 'once', photoId: id, base64: Buffer.from('jpg').toString('base64') });
  const r1 = post(w, { token, ops: [photo('p1')] }).results[0];
  const r2 = post(w, { token, ops: [photo('p2')] }).results[0];
  assert.ok(r1.driveFileId && r2.driveFileId);
  assert.equal(r1.driveUrl, r2.driveUrl);
  const root = w.drive.roots.find((f) => f.name === 'Auto Vizyon');
  assert.equal(root.folders.length, 1);
  assert.equal(root.folders[0].name, 'Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)');
  assert.equal(root.folders[0].files.length, 2);
  const fs = w.sheets.get('Müşteriler').data;
  assert.equal(fs[1][fs[0].indexOf('Drive Klasörü')], r1.driveUrl);
});

test('deleteFolder removes the folder row and its jobs', () => {
  const { w, token } = ready();
  post(w, { token, ops: [
    { op: 'upsertFolder', title: 'A', row: { 'Ad Soyad': 'A', 'Klasör No': 'f1' } },
    { op: 'upsertJob', row: jobRow() },
    { op: 'upsertJob', row: jobRow({ 'Kayıt No': 'j2' }) },
    { op: 'upsertJob', row: jobRow({ 'Kayıt No': 'j3', 'Klasör No': 'f2' }) },
  ] });
  post(w, { token, ops: [{ op: 'deleteFolder', id: 'f1' }] });
  assert.equal(w.sheets.get('Müşteriler').data.length, 1);
  const jobs = w.sheets.get('İşler').data;
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1][jobs[0].indexOf('Kayıt No')], 'j3');
});

test('csv for the computer Excel: header line and plain numbers', () => {
  const { w, token } = ready();
  post(w, { token, ops: [{ op: 'upsertJob', row: jobRow({ 'Tutar (KDV Hariç)': 5000.5 }) }] });
  const out = w.context.doGet({ parameter: { token, action: 'csv', sheet: 'isler' } });
  assert.equal(out.mime, 'csv');
  const [head, line] = out.getContent().split('\r\n');
  assert.ok(head.startsWith('"Tarih","Müşteri"'));
  assert.ok(line.startsWith('"2026-10-29","Uğurcan Kaya"'));
  assert.ok(line.includes(',5000.5,'));
});
