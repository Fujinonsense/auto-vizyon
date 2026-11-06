// What a job cost the shop (outside labour, paint, parts…) and the profit left from it.
// A job keeps costs: [{ cat, label, amount }]; the Google sheet keeps them as one line of text.
import { round2, parseMoney } from './format.js';
import { foldTr } from './search.js';

export const COST_CATS = Object.freeze([
  { key: 'dis-iscilik', label: 'Dış işçilik' },
  { key: 'boya', label: 'Boya' },
  { key: 'parca', label: 'Yedek parça' },
  { key: 'sarf', label: 'Sarf malzeme' },
  { key: 'nakliye', label: 'Çekici / nakliye' },
  { key: 'diger', label: 'Diğer' },
].map((c) => Object.freeze(c)));

// "Diğer" needs to say what the cost was for, in at most this many characters.
export const COST_LABEL_MAX = 40;

const OTHER = 'diger';
const BY_KEY = new Map(COST_CATS.map((c) => [c.key, c]));

// Category names match however they are typed: "DIŞ İŞÇİLİK", "dis iscilik", "Çekici/nakliye".
const nameKey = (s) => foldTr(s).replace(/[^a-z0-9]/g, '');
let byName = null; // built on first use, never while the modules are still loading
function catByName(label) {
  byName ??= new Map(COST_CATS.filter((c) => c.key !== OTHER).map((c) => [nameKey(c.label), c.key]));
  return byName.get(nameKey(label));
}

// Numbers stay as they are; text is read like the job amount ("20.000", "1.250,50 ₺").
function amountOf(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseMoney(v) : null;
  return Number.isFinite(n) ? round2(n) : 0;
}

// ";" and ":" would break the sheet text; whitespace is one space; cut by characters, not bytes.
function cleanLabel(s) {
  const text = String(s ?? '').replace(/[;:]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, COST_LABEL_MAX).join('').trim();
}

export function costLabel(item) {
  const cat = BY_KEY.get(item?.cat);
  if (cat && cat.key !== OTHER) return cat.label;
  return String(item?.label ?? '').trim() || BY_KEY.get(OTHER).label;
}

// Only costs with a positive amount are kept. A "Diğer" cost needs a label, other categories never
// carry one; a "Diğer" label that names a category becomes that category, so the sheet text reads
// back exactly the same.
export function normalizeCosts(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const amount = amountOf(item.amount);
    if (!(amount > 0)) continue;
    let cat = BY_KEY.has(item.cat) ? item.cat : OTHER;
    let label = '';
    if (cat === OTHER) {
      label = cleanLabel(item.label);
      const named = catByName(label);
      if (named) {
        cat = named;
        label = '';
      } else if (!label) {
        continue;
      }
    }
    out.push({ cat, label, amount });
  }
  return out;
}

export function costTotal(costs) {
  return round2(normalizeCosts(costs).reduce((sum, c) => sum + c.amount, 0));
}

// Profit is counted without KDV: the amount before KDV minus what the job cost.
export function profit(job) {
  return round2((Number(job?.net) || 0) - costTotal(job?.costs));
}

// "Dış işçilik: 20000; Boya: 10000; Cam filmi: 1500" (plain numbers, "." for decimals).
export function costsToText(costs) {
  return normalizeCosts(costs).map((c) => `${costLabel(c)}: ${c.amount}`).join('; ');
}

// Back from the sheet: known category names become their category, anything else is "Diğer".
export function costsFromText(text) {
  if (text == null) return [];
  return normalizeCosts(String(text).split(/[;\r\n]+/).map((part) => {
    const at = part.lastIndexOf(':');
    return at < 0 ? null : { cat: OTHER, label: part.slice(0, at), amount: part.slice(at + 1) };
  }));
}
