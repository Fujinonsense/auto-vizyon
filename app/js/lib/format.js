// Display and parsing helpers for Turkish money, dates, phones and names.

const intFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// "5.000 ₺", "5.000,50 ₺" (tr-TR's own currency style puts ₺ first, the shop writes it after).
export function formatMoney(n) {
  const v = round2(n);
  return `${Number.isInteger(v) ? intFmt.format(v) : decFmt.format(v)} ₺`;
}

// Accepts "5000", "5.000", "5.000,50 ₺", "5,000.50", "2.500 TL". A lone separator
// followed by exactly three digits is a thousands separator (no one charges 5,000 kuruş).
export function parseMoney(input) {
  if (input == null) return null;
  let s = String(input).replace(/₺|TL|tl|\s/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const parts = s.split(lastDot >= 0 ? '.' : ',');
    s = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
}

export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function normalizePhone(s) {
  let d = String(s ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('90')) d = d.slice(2);
  if (d.length === 10) d = '0' + d;
  return d;
}

export function formatPhone(s) {
  const d = normalizePhone(s);
  if (d.length !== 11) return d;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
}

export function waNumber(s) {
  const d = normalizePhone(s);
  return d.length === 11 ? '90' + d.slice(1) : d;
}

const KEEP_UPPER = new Set(['BMW', 'VW', 'MG', 'DS', 'GMC', 'BYD', 'MAN', 'DAF', 'JAC', 'TVS']);

// Only ALL-CAPS text (as printed on documents) is recased; anything typed in mixed case is kept.
function recase(text, locale, keepUpper) {
  if (!text || text !== text.toLocaleUpperCase(locale)) return text;
  return text.split(/(\s+|-)/).map((tok) => {
    if (!tok.trim() || tok === '-') return tok;
    if (/\d/.test(tok) || (keepUpper && KEEP_UPPER.has(tok))) return tok;
    const lower = tok.toLocaleLowerCase(locale);
    return lower.charAt(0).toLocaleUpperCase(locale) + lower.slice(1);
  }).join('');
}

// Turkish words: names, colors ("KIRMIZI" -> "Kırmızı").
export function trTitle(s) {
  return recase(String(s ?? '').trim(), 'tr', false);
}

// Brands and models are Latin names ("FIAT" -> "Fiat", not "Fıat").
export function latinTitle(s) {
  return recase(String(s ?? '').trim().replace(/İ/g, 'I'), 'en', true);
}

// "Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)"
export function folderTitle(f = {}) {
  const name = (f.name || '').trim();
  const vehicle = [f.color, f.brand, f.model].map((x) => (x || '').trim()).filter(Boolean).join(' ');
  const plate = (f.plate || '').trim();
  let title = [name, vehicle].filter(Boolean).join(' - ');
  if (plate) title = title ? `${title} (${plate})` : plate;
  return title || 'İsimsiz kayıt';
}
