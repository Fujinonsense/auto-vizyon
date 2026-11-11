import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { headerKey, JOB_COLUMNS, FOLDER_COLUMNS, jobToRow, folderToRow, rowToJob, rowToFolder, toIsoDate } from '../app/js/excel/columns.js';
import { buildWorkbook, readWorkbook, importRecords } from '../app/js/excel/xlsx.js';
import { monthlySummary } from '../app/js/lib/stats.js';
import { normalizePhone } from '../app/js/lib/format.js';
import { mergeRemote } from '../app/js/sync/merge.js';
import * as repo from '../app/js/data/repo.js';
import { clearAll } from '../app/js/data/db.js';
import * as XLSX from '../app/vendor/xlsx.mjs';

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

test('column lists start with what a person reads first; new columns come after the ids', () => {
  assert.equal(JOB_COLUMNS[0].header, 'Tarih');
  assert.equal(JOB_COLUMNS.at(-1).header, 'Fatura');
  assert.deepEqual(JOB_COLUMNS.slice(-6).map((c) => c.header), ['Güncellendi', 'Kayıt No', 'Klasör No', 'Maliyet', 'Maliyet Kalemleri', 'Fatura']);
  assert.equal(FOLDER_COLUMNS[0].header, 'Ad Soyad');
  assert.equal(FOLDER_COLUMNS.at(-1).header, 'Klasör No');
  assert.ok(FOLDER_COLUMNS.every((c) => !c.header.startsWith('Tutanak')));
});

test('no two headers of a sheet read as the same column', () => {
  for (const cols of [JOB_COLUMNS, FOLDER_COLUMNS]) {
    const keys = cols.map((c) => headerKey(c.header));
    assert.equal(new Set(keys).size, keys.length);
  }
});

const costs = [{ cat: 'dis-iscilik', label: '', amount: 20000 }, { cat: 'diger', label: 'Cam filmi', amount: 10000 }];
test('job row: costs and the invoice flag go out as Maliyet, Maliyet Kalemleri, Fatura and come back', () => {
  const row = jobToRow({ ...job, costs, invoiced: true }, folder);
  assert.equal(row['Maliyet'], 30000);
  assert.equal(row['Maliyet Kalemleri'], 'Dış işçilik: 20000; Cam filmi: 10000');
  assert.equal(row['Fatura'], 'Kesildi');
  const back = rowToJob(row);
  assert.deepEqual(back.costs, costs);
  assert.equal(back.invoiced, true);
  assert.equal('Maliyet' in back, false);
  assert.equal(back.amount, 5000, 'the cost total never becomes the job amount');
});

test('job row: a job without costs (or saved before they existed) writes 0, "" and Kesilmedi', () => {
  for (const j of [job, { ...job, costs: [], invoiced: false }]) {
    const row = jobToRow(j, folder);
    assert.equal(row['Maliyet'], 0);
    assert.equal(row['Maliyet Kalemleri'], '');
    assert.equal(row['Fatura'], 'Kesilmedi');
    const back = rowToJob(row);
    assert.deepEqual(back.costs, []);
    assert.equal(back.invoiced, false);
  }
});

test('rowToJob: empty Maliyet Kalemleri and Fatura cells mean no costs and not invoiced; missing columns mean nothing', () => {
  const j = rowToJob({ 'Kayıt No': 'j1', 'Maliyet': 500, 'Maliyet Kalemleri': '', 'Fatura': '' });
  assert.deepEqual(j.costs, []);
  assert.equal(j.invoiced, false);
  const old = rowToJob({ 'Kayıt No': 'j1', 'Tutar (KDV Hariç)': 100 });
  assert.equal('costs' in old, false);
  assert.equal('invoiced' in old, false);
});

test('rowToJob: an empty cost items or Fatura cell is an answer only under the exact header the Google script writes', () => {
  // The live sheet's headers were typed by hand; the deployed script writes only under the exact ones.
  const typo = rowToJob({ 'Kayıt No': 'j1', 'Maliyet kalemleri': '', 'Fatura ': '' });
  assert.equal('costs' in typo, false, 'nothing was ever written there');
  assert.equal('invoiced' in typo, false);
  const typed = rowToJob({ 'Kayıt No': 'j1', 'Maliyet kalemleri': 'Boya: 700', 'Fatura ': 'Kesildi' });
  assert.deepEqual(typed.costs, [{ cat: 'boya', label: '', amount: 700 }], 'something typed there is still read');
  assert.equal(typed.invoiced, true);

  // The pull of such a row leaves the phone's costs and invoice flag alone.
  const local = { ...job, costs: [{ cat: 'boya', label: '', amount: 700 }], invoiced: true };
  const row = jobToRow(local, folder);
  delete row['Maliyet Kalemleri'];
  delete row['Fatura'];
  Object.assign(row, { 'Maliyet kalemleri': '', 'Fatura ': '' });
  const pulled = mergeRemote({ folders: new Map(), jobs: new Map([[local.id, local]]) }, { folders: [], jobs: [{ ...rowToJob(row), remoteStamp: 9 }] }, new Set());
  assert.deepEqual(pulled.jobs, []);
});

test('rowToJob: a cost items cell typed by hand that reads as no items leaves the phone\'s costs alone', () => {
  for (const cell of ['Boya 500', '500', 1500, 'boya', ' ; ']) {
    assert.equal('costs' in rowToJob({ 'Kayıt No': 'j1', 'Maliyet Kalemleri': cell }), false, String(cell));
  }
  const local = { ...job, costs: [{ cat: 'boya', label: '', amount: 700 }], invoiced: false };
  const row = { ...jobToRow(local, folder), 'Maliyet Kalemleri': 'Boya 500' };
  const pulled = mergeRemote({ folders: new Map(), jobs: new Map([[local.id, local]]) }, { folders: [], jobs: [{ ...rowToJob(row), remoteStamp: 9 }] }, new Set());
  assert.deepEqual(pulled.jobs, [], 'the phone keeps its costs');
  // An empty cell under the exact header is still "no costs", and items that read replace them.
  assert.deepEqual(rowToJob({ 'Maliyet Kalemleri': '' }).costs, []);
  assert.deepEqual(rowToJob({ 'Maliyet Kalemleri': '  ' }).costs, []);
  assert.deepEqual(rowToJob({ 'Maliyet Kalemleri': 'Boya 500; Cam filmi: 1500' }).costs, [{ cat: 'diger', label: 'Cam filmi', amount: 1500 }]);
});

test('rowToJob: Fatura and Ödeme take the same yes typed by hand, so a hand edit cannot turn a yes into no', () => {
  for (const yes of ['Kesildi', 'KESİLDİ', 'Evet', 'evet', 'E', 'X', 'x', '1', 'var', 'Var', 'true', 1, true]) {
    assert.equal(rowToJob({ Fatura: yes }).invoiced, true, String(yes));
  }
  for (const yes of ['Ödendi', 'Evet', 'X', '1', 'var', 1, true]) assert.equal(rowToJob({ 'Ödeme': yes }).paid, true, String(yes));
  for (const no of ['Kesilmedi', 'Hayır', 'yok', '0', 0, false, 'bilmiyorum']) assert.equal(rowToJob({ Fatura: no }).invoiced, false, String(no));
  const local = { ...job, costs: [], invoiced: true };
  const row = { ...jobToRow(local, folder), Fatura: 'Evet' };
  const pulled = mergeRemote({ folders: new Map(), jobs: new Map([[local.id, local]]) }, { folders: [], jobs: [{ ...rowToJob(row), remoteStamp: 9 }] }, new Set());
  assert.deepEqual(pulled.jobs, [], 'still invoiced on the phone');
});

test('rowToJob: Fatura typed by hand in any case', () => {
  assert.equal(rowToJob({ FATURA: 'KESİLDİ' }).invoiced, true);
  assert.equal(rowToJob({ fatura: ' kesildi ' }).invoiced, true);
  assert.equal(rowToJob({ Fatura: true }).invoiced, true);
  assert.equal(rowToJob({ Fatura: 'Kesilmedi' }).invoiced, false);
  assert.equal(rowToJob({ Fatura: 'bilmiyorum' }).invoiced, false);
  assert.deepEqual(rowToJob({ 'maliyet kalemleri': 'boya: 1.500' }).costs, [{ cat: 'boya', label: '', amount: 1500 }]);
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
  assert.deepEqual(rows[0], { month: '2026-10', count: 2, net: 7000, vat: 1400, total: 8400, paid: 6000, unpaid: 2400, cost: 0, profit: 7000 });
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

test('the app-built workbook shows Maliyet as money and reads costs, invoice flag back', async () => {
  const blob = await buildWorkbook({ folders: [folder], jobs: [{ ...job, costs, invoiced: true }] });
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellNF: true });
  const ws = wb.Sheets['İşler'];
  const cellOf = (header) => ws[XLSX.utils.encode_cell({ r: 1, c: JOB_COLUMNS.findIndex((c) => c.header === header) })];
  assert.equal(cellOf('Maliyet').v, 30000);
  assert.equal(cellOf('Maliyet').z, '#,##0.00 "₺"');
  assert.equal(cellOf('Maliyet').z, cellOf('Toplam (KDV Dahil)').z, 'same money format as the other money columns');
  assert.equal(cellOf('Fatura').v, 'Kesildi');
  const { folders, jobs } = await readWorkbook(blob);
  assert.deepEqual(jobs[0].costs, costs);
  assert.equal(jobs[0].invoiced, true);
  assert.equal('tutanak' in folders[0], false);
});

test('readWorkbook: a row with nothing the app knows is not a job, even when the new columns are there', async () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Tarih', 'Yapılan İş', 'Maliyet Kalemleri', 'Fatura', 'Renk Kodu'],
    ['29.10.2026', 'Kapı', 'Boya: 500', 'Kesildi', ''],
    ['', '', '', '', 'LY9B'],
    ['', '', '', '', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'İşler');
  const { jobs } = await readWorkbook(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })]));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].description, 'Kapı');
  assert.deepEqual(jobs[0].costs, [{ cat: 'boya', label: '', amount: 500 }]);
  assert.equal(jobs[0].invoiced, true);
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

test('all 14 retired sheet columns are ignored without a false remote change', () => {
  const extra = Object.fromEntries(['A', 'B'].flatMap((d) => ['Ad Soyad', 'TC', 'Ehliyet', 'Alındığı Yer', 'Adres', 'Telefon', 'Plaka'].map((k) => [`Tutanak ${d} ${k}`, 'old value'])));
  assert.equal(Object.keys(extra).length, 14);
  const mine = { ...folder, tutanak: { aAdSoyad: 'Legacy' }, aiFilled: ['tutanak.aAdSoyad'], unclear: ['tutanak.bTc'] };
  const row = folderToRow(mine);
  assert.ok(Object.keys(row).every((h) => !h.startsWith('Tutanak')));
  const pulled = rowToFolder({ ...row, ...extra });
  assert.equal('tutanak' in pulled, false);
  assert.deepEqual(mergeRemote({ folders: new Map([[mine.id, mine]]), jobs: new Map() }, { folders: [{ ...pulled, remoteStamp: 999 }], jobs: [] }, new Set()), { folders: [], jobs: [] });
});
