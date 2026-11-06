import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, monthStats, monthlySummary } from '../app/js/lib/stats.js';

test('monthKey: YYYY-MM in local time', () => {
  assert.equal(monthKey(new Date(2026, 9, 20)), '2026-10');
  assert.equal(monthKey(new Date(2026, 0, 1)), '2026-01');
});

test('monthStats: jobs and money this month, unpaid across all months', () => {
  const jobs = [
    { date: '2026-10-05', total: 6000, paid: true },
    { date: '2026-10-18', total: 2400, paid: false },
    { date: '2026-09-30', total: 3600, paid: false },
  ];
  assert.deepEqual(monthStats(jobs, new Date(2026, 9, 20)), { count: 2, total: 8400, unpaid: 6000 });
});

test('monthlySummary: cost and profit without KDV per month', () => {
  const rows = monthlySummary([
    { date: '2026-10-05', net: 30000, vat: 6000, total: 36000, paid: true, costs: [{ cat: 'dis-iscilik', label: '', amount: 20000 }] },
    { date: '2026-10-18', net: 10000, vat: 2000, total: 12000, paid: false },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost, 20000);
  assert.equal(rows[0].profit, 20000);
});

test('monthlySummary: costs bigger than the work give a negative profit, never NaN', () => {
  const [m] = monthlySummary([
    { date: '2026-09-30', net: 1000, vat: 200, total: 1200, paid: false, costs: [{ cat: 'boya', label: '', amount: 5000 }] },
    { date: '2026-09-02', costs: [{ cat: 'parca', label: '', amount: 250.5 }] },
  ]);
  assert.equal(m.cost, 5250.5);
  assert.equal(m.profit, -4250.5);
  assert.equal(m.net, 1000);
});

test('monthStats: no jobs gives zeros', () => {
  assert.deepEqual(monthStats([], new Date(2026, 9, 20)), { count: 0, total: 0, unpaid: 0 });
});
