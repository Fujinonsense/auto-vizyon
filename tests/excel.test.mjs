import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { headerKey, JOB_COLUMNS, FOLDER_COLUMNS, jobToRow, folderToRow, rowToJob, rowToFolder, toIsoDate } from '../app/js/excel/columns.js';
import { buildWorkbook, readWorkbook, importRecords } from '../app/js/excel/xlsx.js';
import { monthlySummary } from '../app/js/lib/stats.js';
import * as repo from '../app/js/data/repo.js';
import { clearAll } from '../app/js/data/db.js';

const folder = {
  id: 'f1', name: 'Uğurcan Kaya', phone: '05324182790', plate: '34 NMA 887', brand: 'Audi', model: 'A7', color: 'Siyah',
  modelYear: '2019', vin: 'WAUZZZ4G7JN012345', engineNo: 'CDU 104522', modelFull: 'A7 SPORTBACK',
  ruhsat: { sahibi: 'Uğurcan Kaya', tcVkn: '10000000146', belgeSeriNo: 'FA 482913', tescilTarihi: '14.06.2021', tipi: '4G' },
  ehliyet: { adSoyad: '', tc: '', ehliyetNo: '', sinif: '' }, kimlik: {}, note: '', driveUrl: '', updatedAt: 1,
};
const job = {
  id: 'j1', folderId: 'f1', date: '2026-10-29', description: 'Sağ arka kapı', parts: ['Sağ arka kapı', 'Tavan'],
  amount: 5000, vatMode: 'haric', vatRate: 20, net: 5000, vat: 1000, total: 6000, paid: false, payer: 'sigorta',
  insurer: 'Anadolu Sigorta', claimNo: 'HSR-1', note: '', updatedAt: 1,
};

beforeEach(async () => {
  await clearAll();
});

test('headerKey: case, Turkish letters, spaces and brackets do not matter', () => {
  assert.equal(headerKey('KDV ORANI'), headerKey('kdv oranı'));
  assert.equal(headerKey('Tutar (KDV Hariç)'), 'tutarkdvharic');
});

test('column lists start with what a person reads first and end with the ids', () => {
  assert.equal(JOB_COLUMNS[0].header, 'Tarih');
  assert.equal(JOB_COLUMNS.at(-1).header, 'Klasör No');
  assert.equal(FOLDER_COLUMNS[0].header, 'Ad Soyad');
  assert.equal(FOLDER_COLUMNS.at(-1).header, 'Klasör No');
});

test('job row round trip keeps money, KDV, payment and links', () => {
  const back = rowToJob(jobToRow(job, folder));
  assert.equal(back.id, 'j1');
  assert.equal(back.folderId, 'f1');
  assert.equal(back.date, '2026-10-29');
  assert.equal(back.amount, 5000);
  assert.equal(back.vatMode, 'haric');
  assert.equal(back.vatRate, 20);
  assert.equal(back.paid, false);
  assert.equal(back.payer, 'sigorta');
  assert.equal(back.insurer, 'Anadolu Sigorta');
  assert.deepEqual(back.parts, ['Sağ arka kapı', 'Tavan']);
  assert.equal(back.plate, '34 NMA 887');
});

test('folder row round trip keeps documents', () => {
  const back = rowToFolder(folderToRow(folder));
  assert.equal(back.id, 'f1');
  assert.equal(back.phone, '05324182790');
  assert.equal(back.vin, 'WAUZZZ4G7JN012345');
  assert.equal(back.ruhsat.tcVkn, '10000000146');
  assert.equal(back.ruhsat.tipi, '4G');
});

test('rowToJob reads values typed by hand in Excel', () => {
  const j = rowToJob({ 'TARIH': '29.10.2026', 'tutar (kdv hariç)': '5.000,50 ₺', 'Ödeme': 'ödendi', 'Ödeyen': 'SİGORTA', 'Renk Kodu': 'x' });
  assert.equal(j.date, '2026-10-29');
  assert.equal(j.amount, 5000.5);
  assert.equal(j.paid, true);
  assert.equal(j.payer, 'sigorta');
  assert.equal(j.id, undefined);
  assert.equal('Renk Kodu' in j, false);
});

test('toIsoDate understands Excel serial numbers, dates and Turkish text', () => {
  assert.equal(toIsoDate(46324), '2026-10-29');
  assert.equal(toIsoDate(new Date(Date.UTC(2026, 9, 29))), '2026-10-29');
  assert.equal(toIsoDate('2026-10-29'), '2026-10-29');
  assert.equal(toIsoDate('3.9.2026'), '2026-09-03');
  assert.equal(toIsoDate(''), '');
});

test('monthlySummary: newest month first, paid and unpaid split', () => {
  const rows = monthlySummary([
    { date: '2026-10-05', net: 5000, vat: 1000, total: 6000, paid: true },
    { date: '2026-10-18', net: 2000, vat: 400, total: 2400, paid: false },
    { date: '2026-09-30', net: 3000, vat: 600, total: 3600, paid: false },
  ]);
  assert.deepEqual(rows[0], { month: '2026-10', count: 2, net: 7000, vat: 1400, total: 8400, paid: 6000, unpaid: 2400 });
  assert.equal(rows[1].month, '2026-09');
});

test('workbook built for Excel reads back into the same jobs and folders', async () => {
  const blob = await buildWorkbook({ folders: [folder], jobs: [job] });
  assert.ok(blob.size > 1000);
  const { folders, jobs } = await readWorkbook(blob);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].total, 6000);
  assert.equal(jobs[0].date, '2026-10-29');
  assert.equal(folders[0].name, 'Uğurcan Kaya');
  assert.equal(folders[0].ruhsat.belgeSeriNo, 'FA 482913');
});

test('importRecords: updates by id, matches by plate, creates the rest', async () => {
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887' });
  const j = await repo.saveJob({ folderId: f.id, amount: 1000 });
  const result = await importRecords({
    folders: [{ id: f.id, name: 'Uğurcan Kaya', phone: '05324182790' }, { name: 'Ayşe Kara', plate: '35 KR 7781' }],
    jobs: [
      { id: j.id, folderId: f.id, amount: 2000, vatMode: 'haric', vatRate: 20 },
      { plate: '35kr7781', amount: 3000, vatMode: 'haric', vatRate: 20, date: '2026-10-01' },
      { plate: '06 BHK 412', name: 'Mehmet Yıldız', amount: 500, vatMode: 'haric', vatRate: 20, date: '2026-10-02' },
    ],
  });
  assert.deepEqual(result, { folders: 3, jobs: 3 });
  assert.equal((await repo.getFolder(f.id)).phone, '05324182790');
  assert.equal((await repo.jobsForFolder(f.id))[0].total, 2400);
  const ayse = await repo.findFolderByPlate('35 KR 7781');
  assert.equal((await repo.jobsForFolder(ayse.id))[0].total, 3600);
  const mehmet = await repo.findFolderByPlate('06BHK412');
  assert.equal(mehmet.name, 'Mehmet Yıldız');
});
