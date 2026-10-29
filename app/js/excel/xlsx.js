// Excel file out (all or one month) and Excel file in (SheetJS, loaded on first use).
import { JOB_COLUMNS, FOLDER_COLUMNS, jobToRow, folderToRow, rowToJob, rowToFolder, headerKey, isoToSerial } from './columns.js';
import { monthlySummary } from '../lib/stats.js';
import { formatMonth } from '../lib/format.js';
import { getFolder, saveFolder, saveJob, findFolderByPlate } from '../data/repo.js';
import { shareFiles } from '../native.js';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONEY = '#,##0.00 "₺"';
let lib = null;
const loadXlsx = async () => (lib ??= await import('../../vendor/xlsx.mjs'));


function sheet(XLSX, columns, rows) {
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => r[c.header] ?? ''))]);
  ws['!cols'] = columns.map((c) => ({ wch: c.width }));
  columns.forEach((c, ci) => {
    for (let r = 1; r <= rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
      if (!cell) continue;
      if (c.type === 'money') cell.z = MONEY;
      if (c.type === 'date' && cell.v) {
        const serial = isoToSerial(cell.v);
        if (serial) Object.assign(cell, { t: 'n', v: serial, z: 'dd.mm.yyyy' });
      }
    }
  });
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}

export async function buildWorkbook({ folders, jobs, month = '' }) {
  const XLSX = await loadXlsx();
  const picked = (month ? jobs.filter((j) => (j.date || '').startsWith(month)) : jobs)
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const byId = new Map(folders.map((f) => [f.id, f]));
  const usedFolders = month ? folders.filter((f) => picked.some((j) => j.folderId === f.id)) : folders;
  const summary = monthlySummary(picked).map((s) => ({
    Ay: formatMonth(s.month), 'İş Sayısı': s.count, 'KDV Hariç': s.net, KDV: s.vat, Toplam: s.total, 'Tahsil Edilen': s.paid, Bekleyen: s.unpaid,
  }));
  const summaryCols = ['Ay', 'İş Sayısı', 'KDV Hariç', 'KDV', 'Toplam', 'Tahsil Edilen', 'Bekleyen']
    .map((h, i) => ({ header: h, type: i > 1 ? 'money' : 'text', width: i ? 15 : 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, JOB_COLUMNS, picked.map((j) => jobToRow(j, byId.get(j.folderId) || {}))), 'İşler');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, FOLDER_COLUMNS, usedFolders.map(folderToRow)), 'Müşteriler');
  XLSX.utils.book_append_sheet(wb, sheet(XLSX, summaryCols, summary), 'Özet');
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })], { type: MIME });
}

const hasContent = (o) => Object.values(o).some((v) => v !== '' && v != null && !(typeof v === 'object' && !Object.keys(v).length));

export async function readWorkbook(blob) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const rowsOf = (name) => {
    const found = wb.SheetNames.find((n) => headerKey(n) === headerKey(name));
    return found ? XLSX.utils.sheet_to_json(wb.Sheets[found], { defval: '', raw: true }) : null;
  };
  const folderRows = rowsOf('Müşteriler') || [];
  // A file without our sheet names: read its first sheet as jobs.
  const jobRows = rowsOf('İşler') || (folderRows.length ? [] : XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true }));
  return {
    folders: folderRows.map(rowToFolder).filter(hasContent),
    jobs: jobRows.map(rowToJob).filter(hasContent),
  };
}

const DOC_KEYS = ['ruhsat', 'ehliyet', 'kimlik'];

// Rows matched by their id, then by plate; everything else is created. Changes are queued for Google.
export async function importRecords({ folders = [], jobs = [] }) {
  const touched = new Set();
  const realId = new Map();
  for (const row of folders) {
    const existing = (row.id && (await getFolder(row.id))) || (row.plate && (await findFolderByPlate(row.plate))) || null;
    const merged = { ...row };
    for (const k of DOC_KEYS) if (row[k]) merged[k] = { ...existing?.[k], ...row[k] };
    const saved = await saveFolder({ ...merged, id: existing?.id || row.id });
    if (row.id) realId.set(row.id, saved.id);
    touched.add(saved.id);
  }
  for (const row of jobs) {
    const { plate, name, phone, ...fields } = row;
    let folderId = fields.folderId && (realId.get(fields.folderId) || (await getFolder(fields.folderId))?.id);
    if (!folderId && plate) folderId = (await findFolderByPlate(plate))?.id;
    if (!folderId) folderId = (await saveFolder({ name: name || '', phone: phone || '', plate: plate || '' })).id;
    touched.add(folderId);
    await saveJob({ ...fields, folderId });
  }
  return { folders: touched.size, jobs: jobs.length };
}

// iPhone: the share sheet (Dosyalar'a kaydet, WhatsApp, Mail); elsewhere a normal download.
export const shareOrDownload = (blob, filename) => shareFiles([{ name: filename, blob }], filename);
