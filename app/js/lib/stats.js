import { round2 } from './format.js';

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const sum = (values) => round2(values.reduce((a, b) => a + (Number(b) || 0), 0));

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
