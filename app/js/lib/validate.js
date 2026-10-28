// Turkish plate, VIN (şase) and TC kimlik checks.

function clean(s) {
  return String(s ?? '').replace(/[İı]/g, 'I').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const PLATE_RE = /^(\d{2})([A-Z]{1,3})(\d{2,5})$/;
const DIGITS_FOR_LETTERS = { 1: [4, 5], 2: [3, 4], 3: [2, 3] };

// "34 nma 887" -> "34NMA887": used to find the same car however it was typed.
export function plateKey(s) {
  return clean(s);
}

export function normalizePlate(s) {
  const m = PLATE_RE.exec(clean(s));
  return m ? `${m[1]} ${m[2]} ${m[3]}` : String(s ?? '').trim().toUpperCase();
}

export function isValidPlate(s) {
  const m = PLATE_RE.exec(clean(s));
  if (!m) return false;
  const city = Number(m[1]);
  return city >= 1 && city <= 81 && DIGITS_FOR_LETTERS[m[2].length].includes(m[3].length);
}

export function normalizeVin(s) {
  return clean(s);
}

export function isValidVin(s) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(s));
}

export function isValidTc(s) {
  const t = String(s ?? '').replace(/\D/g, '');
  if (!/^[1-9]\d{10}$/.test(t)) return false;
  const d = [...t].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d10 === d[9] && d11 === d[10];
}
