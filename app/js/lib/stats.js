import { round2 } from './format.js';

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const sum = (values) => round2(values.reduce((a, b) => a + (Number(b) || 0), 0));

// Kazanç screen and the Excel "Özet" sheet: one row per month, newest first.
export function monthlySummary(jobs) {
  const months = new Map();
  for (const j of jobs) {
    const month = (j.date || '').slice(0, 7);
    if (!month) continue;
    const r = months.get(month) || { month, count: 0, net: [], vat: [], total: [], paid: [], unpaid: [] };
    r.count += 1;
    r.net.push(j.net);
    r.vat.push(j.vat);
    r.total.push(j.total);
    (j.paid ? r.paid : r.unpaid).push(j.total);
    months.set(month, r);
  }
  return [...months.values()]
    .map((r) => ({ month: r.month, count: r.count, net: sum(r.net), vat: sum(r.vat), total: sum(r.total), paid: sum(r.paid), unpaid: sum(r.unpaid) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

// Home screen summary: jobs and money this month, and everything still unpaid.
export function monthStats(jobs, now = new Date()) {
  const month = monthKey(now);
  const inMonth = jobs.filter((j) => (j.date || '').startsWith(month));
  return {
    count: inMonth.length,
    total: sum(inMonth.map((j) => j.total)),
    unpaid: sum(jobs.filter((j) => !j.paid).map((j) => j.total)),
  };
}
