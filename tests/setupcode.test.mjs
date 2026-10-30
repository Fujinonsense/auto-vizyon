import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSetup, decodeSetup } from '../app/js/lib/setupcode.js';

const setup = { apiKey: 'sk-ant-api03-abc_DEF-123', scriptUrl: 'https://script.google.com/macros/s/AKfyc/exec', token: 'tök3n' };

test('setup code round trip', () => {
  const code = encodeSetup(setup);
  assert.ok(code.startsWith('AV1-'));
  assert.match(code, /^AV1-[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSetup(code), setup);
});

test('spaces and line breaks added by WhatsApp copy are ignored', () => {
  const code = encodeSetup(setup);
  assert.deepEqual(decodeSetup(`  ${code.slice(0, 12)}\n${code.slice(12)} `), setup);
});

test('garbage is rejected', () => {
  assert.throws(() => decodeSetup('merhaba'));
  assert.throws(() => decodeSetup('AV1-!!!'));
  assert.throws(() => decodeSetup('AV1-' + Buffer.from('"just a string"').toString('base64url')));
});

test('only known settings come back', () => {
  const back = decodeSetup(encodeSetup({ apiKey: 'k', vatRate: 99, evil: 'x' }));
  assert.deepEqual(back, { apiKey: 'k' });
});

test('a model inside a code cannot change the model, and the code still works', () => {
  const code = 'AV1-' + Buffer.from(JSON.stringify({ ...setup, model: 'claude-haiku-5-5' })).toString('base64url');
  assert.deepEqual(decodeSetup(code), setup);
});
