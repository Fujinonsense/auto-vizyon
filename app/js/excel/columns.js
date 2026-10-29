// One column list for the Excel file and the Google sheet. Reading back is forgiving:
// headers match without case or Turkish letters, empty cells never wipe data.
import { foldTr } from '../lib/search.js';
import { formatPhone, normalizePhone, parseMoney } from '../lib/format.js';
import { normalizePlate } from '../lib/validate.js';
import { getPath, setPath } from '../lib/merge-ai.js';
import { computeVat } from '../lib/vat.js';

export const headerKey = (h) => foldTr(h).replace(/[^a-z0-9]/g, '');

const col = (header, key, type = 'text', width = 16, from = 'job') => ({ header, key, type, width, from });

export const JOB_COLUMNS = [
  col('Tarih', 'date', 'date', 12),
  col('Müşteri', 'name', 'text', 22, 'folder'),
  col('Telefon', 'phone', 'phone', 16, 'folder'),
  col('Plaka', 'plate', 'plate', 12, 'folder'),
  col('Araç', 'vehicle', 'vehicle', 22, 'folder'),
  col('Model Yılı', 'modelYear', 'text', 10, 'folder'),
  col('Şase No', 'vin', 'text', 20, 'folder'),
  col('Yapılan İş', 'description', 'text', 28),
  col('Parçalar', 'parts', 'list', 28),
  col('Tutar (KDV Hariç)', 'net', 'money', 16),
  col('KDV Oranı', 'vatRate', 'number', 10),
  col('KDV', 'vat', 'money', 12),
  col('Toplam (KDV Dahil)', 'total', 'money', 17),
  col('Ödeme', 'paid', 'paid', 11),
  col('Ödeyen', 'payer', 'payer', 10),
  col('Sigorta Şirketi', 'insurer', 'text', 18),
  col('Dosya No', 'claimNo', 'text', 16),
  col('Not', 'note', 'text', 24),
  col('Güncellendi', 'updatedAt', 'stamp', 17),
  col('Kayıt No', 'id', 'id', 38),
  col('Klasör No', 'folderId', 'id', 38),
];

export const FOLDER_COLUMNS = [
  ['Ad Soyad', 'name'], ['Telefon', 'phone', 'phone'], ['Plaka', 'plate', 'plate'], ['Marka', 'brand'], ['Model', 'model'],
  ['Renk', 'color'], ['Model Yılı', 'modelYear'], ['Şase No', 'vin'], ['Motor No', 'engineNo'], ['Ticari Adı', 'modelFull'],
  ['Ruhsat Sahibi', 'ruhsat.sahibi'], ['Ruhsat TC/VKN', 'ruhsat.tcVkn'], ['Belge Seri No', 'ruhsat.belgeSeriNo'],
  ['Tescil Tarihi', 'ruhsat.tescilTarihi'], ['Ruhsat Tipi', 'ruhsat.tipi'],
  ['Ehliyet Ad Soyad', 'ehliyet.adSoyad'], ['Ehliyet TC', 'ehliyet.tc'], ['Ehliyet No', 'ehliyet.ehliyetNo'],
  ['Ehliyet Sınıfı', 'ehliyet.sinif'], ['Ehliyet Veriliş', 'ehliyet.verilisTarihi'], ['Ehliyet Doğum Tarihi', 'ehliyet.dogumTarihi'],
  ['Kimlik Ad Soyad', 'kimlik.adSoyad'], ['Kimlik TC', 'kimlik.tc'], ['Kimlik Doğum Tarihi', 'kimlik.dogumTarihi'],
  ['Kimlik Seri No', 'kimlik.seriNo'], ['Kimlik Geçerlilik', 'kimlik.gecerlilik'],
  ['Drive Klasörü', 'driveUrl', 'link', 30], ['Not', 'note'], ['Güncellendi', 'updatedAt', 'stamp', 17], ['Klasör No', 'id', 'id', 38],
].map(([header, key, type = 'text', width = 16]) => col(header, key, type, width, 'folder'));

const pad = (n) => String(n).padStart(2, '0');
const EXCEL_EPOCH_DAYS = 25569; // 1899-12-30 → 1970-01-01

// Excel serial number, Date, "2026-10-29", "29.10.2026" or "29/10/2026" → "2026-10-29"
export function toIsoDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') v = new Date(Math.round((v - EXCEL_EPOCH_DAYS) * 86400000));
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : '';
}

export function isoToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + EXCEL_EPOCH_DAYS : null;
}

function stamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toCell(c, value, folder) {
  switch (c.type) {
    case 'phone': return formatPhone(value);
    case 'vehicle': return [folder.color, folder.brand, folder.model].filter(Boolean).join(' ');
    case 'list': return (value || []).join(', ');
    case 'paid': return value ? 'Ödendi' : 'Ödenmedi';
    case 'payer': return value === 'sigorta' ? 'Sigorta' : 'Müşteri';
    case 'stamp': return stamp(value);
    case 'money':
    case 'number': return Number(value) || 0;
    default: return value ?? '';
  }
}

export function jobToRow(job, folder = {}) {
  return Object.fromEntries(JOB_COLUMNS.map((c) => [c.header, toCell(c, c.from === 'folder' ? folder[c.key] : job[c.key], folder)]));
}

export function folderToRow(folder) {
  return Object.fromEntries(FOLDER_COLUMNS.map((c) => [c.header, toCell(c, getPath(folder, c.key), folder)]));
}

// Only cells with something in them come back; unknown columns are ignored.
function present(row) {
  const out = new Map();
  for (const [k, v] of Object.entries(row)) {
    if (v === '' || v == null) continue;
    out.set(headerKey(k), v);
  }
  return out;
}

const text = (v) => String(v).trim();

export function rowToJob(row) {
  const cells = present(row);
  const job = {};
  for (const c of JOB_COLUMNS) {
    if (!cells.has(headerKey(c.header))) continue;
    const v = cells.get(headerKey(c.header));
    if (c.from === 'folder') {
      if (c.key === 'name') job.name = text(v);
      if (c.key === 'phone') job.phone = normalizePhone(v);
      if (c.key === 'plate') job.plate = normalizePlate(v);
      continue;
    }
    switch (c.type) {
      case 'date': job.date = toIsoDate(v); break;
      case 'list': job.parts = text(v).split(',').map((p) => p.trim()).filter(Boolean); break;
      case 'money':
        if (c.key === 'net') {
          job.amount = typeof v === 'number' ? v : parseMoney(text(v)) ?? 0;
          job.vatMode = 'haric';
        }
        break;
      case 'number': job[c.key] = typeof v === 'number' ? v : parseMoney(text(v).replace('%', '')) ?? 0; break;
      case 'paid': job.paid = v === true || v === 1 || /^(odendi|evet|e|x|1|true)$/.test(foldTr(text(v))); break;
      case 'payer': job.payer = foldTr(text(v)).includes('sigorta') ? 'sigorta' : 'musteri'; break;
      case 'stamp': break;
      default: job[c.key] = text(v);
    }
  }
  if (job.amount != null) Object.assign(job, computeVat({ amount: job.amount, mode: 'haric', rate: job.vatRate ?? 20 }));
  return job;
}

export function rowToFolder(row) {
  const cells = present(row);
  const folder = {};
  for (const c of FOLDER_COLUMNS) {
    if (!cells.has(headerKey(c.header)) || c.type === 'stamp') continue;
    const v = text(cells.get(headerKey(c.header)));
    setPath(folder, c.key, c.type === 'phone' ? normalizePhone(v) : c.type === 'plate' ? normalizePlate(v) : v);
  }
  return folder;
}
