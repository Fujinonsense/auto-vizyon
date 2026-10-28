// Folder search: forgiving about Turkish letters, spacing and partial numbers.
import { monthKey } from './stats.js';

export function foldTr(s) {
  return String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function haystack({ folder, jobs = [] }) {
  const f = folder;
  const parts = [
    f.name, f.phone, f.plate, f.brand, f.model, f.modelFull, f.color, f.modelYear, f.vin,
    f.ruhsat?.sahibi, ...jobs.flatMap((j) => [j.insurer, j.claimNo, j.description]),
  ];
  const text = foldTr(parts.filter(Boolean).join(' '));
  return { text, compact: text.replace(/[^a-z0-9]/g, '') };
}

// Every word of the query must appear, either as typed or with spaces/dashes ignored.
export function matchesQuery(summary, query) {
  const words = foldTr(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const { text, compact } = haystack(summary);
  return words.every((w) => {
    const bare = w.replace(/[^a-z0-9]/g, '');
    return text.includes(w) || (bare && compact.includes(bare));
  });
}

const FILTERS = {
  tum: () => true,
  borc: (s) => s.jobs.some((j) => !j.paid),
  sigorta: (s) => s.jobs.some((j) => j.payer === 'sigorta'),
  buay: (s, month) =>
    s.jobs.some((j) => (j.date || '').startsWith(month)) || monthKey(new Date(s.folder.createdAt || 0)) === month,
};

export function filterSummaries(list, { query = '', filter = 'tum' } = {}, now = new Date()) {
  const keep = FILTERS[filter] || FILTERS.tum;
  const month = monthKey(now);
  return list.filter((s) => keep(s, month) && matchesQuery(s, query));
}
