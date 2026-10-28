import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, squareCrop } from '../app/js/media/image.js';

test('fitWithin: shrinks the long edge to the limit, keeps the ratio', () => {
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(1920, 1080, 1600), { width: 1600, height: 900 });
});

test('fitWithin: never enlarges a small photo', () => {
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
});

test('squareCrop: centered square from the middle of the photo', () => {
  assert.deepEqual(squareCrop(4032, 3024), { sx: 504, sy: 0, side: 3024 });
  assert.deepEqual(squareCrop(1080, 1920), { sx: 0, sy: 420, side: 1080 });
});
