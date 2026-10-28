import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, monthStats } from '../app/js/lib/stats.js';

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

test('monthStats: no jobs gives zeros', () => {
  assert.deepEqual(monthStats([], new Date(2026, 9, 20)), { count: 0, total: 0, unpaid: 0 });
});
