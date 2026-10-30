import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseResponse, readDocument, testKey, AiError } from '../app/js/ai/claude.js';
import { KINDS } from '../app/js/ai/schemas.js';

const img = { base64: 'AAAA', mediaType: 'image/jpeg' };
const reply = (obj) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
});
const jpeg = () => new Blob(['x'], { type: 'image/jpeg' });
const failing = (status, message = '') => {
  const create = async () => { const e = new Error(message); e.status = status; throw e; };
  return { messages: { create }, beta: { messages: { create } } };
};
const code = (c) => (e) => e instanceof AiError && e.code === c;

test('every request: Opus 5.5, server-side fallbacks, low effort, json schema, images before the text', () => {
  const r = buildRequest('ruhsat', [img, img]);
  assert.equal(r.model, 'claude-opus-5-5');
  assert.deepEqual(r.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(r.fallbacks, 'default');
  assert.equal(r.output_config.effort, 'low');
  assert.equal(r.output_config.format.type, 'json_schema');
  assert.deepEqual(r.output_config.format.schema, KINDS.ruhsat.schema);
  const blocks = r.messages[0].content;
  assert.deepEqual(blocks.map((b) => b.type), ['image', 'image', 'text']);
  assert.deepEqual(blocks[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
});

test('every schema requires all its fields plus belirsiz and allows nothing else', () => {
  for (const [kind, k] of Object.entries(KINDS)) {
    assert.equal(k.schema.additionalProperties, false, kind);
    assert.deepEqual([...k.schema.required].sort(), [...k.fields.map((f) => f.key), 'belirsiz'].sort(), kind);
  }
});

test('parseResponse: normalizes plate and casing, flags a bad VIN and a bad TC', () => {
  const r = parseResponse('ruhsat', reply({
    plaka: '34nma887', marka: 'AUDI', model: 'A7', ticariAdi: 'A7 SPORTBACK 3.0 TDI', tipi: '4G', modelYili: '2019',
    renk: 'SİYAH', saseNo: 'WAUZZZ4G7JN01234O', motorNo: 'CDU123', sahibiAdSoyad: 'UĞURCAN KAYA',
    tcVkn: '12345678901', belgeSeriNo: 'AB 123456', tescilTarihi: '12.03.2021', belirsiz: [],
  }));
  assert.equal(r.fields.plaka, '34 NMA 887');
  assert.equal(r.fields.marka, 'Audi');
  assert.equal(r.fields.renk, 'Siyah');
  assert.equal(r.fields.sahibiAdSoyad, 'Uğurcan Kaya');
  assert.equal(r.fields.ticariAdi, 'A7 SPORTBACK 3.0 TDI');
  assert.ok(r.unclear.includes('saseNo'));
  assert.ok(r.unclear.includes('tcVkn'));
  assert.ok(!r.unclear.includes('plaka'));
});

test('parseResponse: a valid tax number (10 digits) is not flagged, a bad year is', () => {
  const r = parseResponse('ruhsat', reply({
    plaka: '06 BHK 412', marka: 'Fiat', model: 'Egea', ticariAdi: '', tipi: '', modelYili: '1899', renk: 'Beyaz',
    saseNo: '', motorNo: '', sahibiAdSoyad: 'Kaya Oto Ltd', tcVkn: '1234567890', belgeSeriNo: '', tescilTarihi: '', belirsiz: [],
  }));
  assert.ok(!r.unclear.includes('tcVkn'));
  assert.ok(r.unclear.includes('modelYili'));
});

test("parseResponse: keeps the model's own uncertainty list", () => {
  const r = parseResponse('arac', reply({ plaka: '', renk: 'Beyaz', marka: 'Fiat', model: 'Egea', belirsiz: ['plaka'] }));
  assert.deepEqual(r.unclear, ['plaka']);
});

test('parseResponse: refusal and non-JSON become AiErrors', () => {
  assert.throws(() => parseResponse('kimlik', { stop_reason: 'refusal', content: [] }), code('refusal'));
  assert.throws(() => parseResponse('arac', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Üzgünüm' }] }), code('parse'));
});

test('readDocument: no key is refused before any request', async () => {
  await assert.rejects(readDocument('arac', [jpeg()], { apiKey: '' }), code('no-key'));
});

test('readDocument: offline phone is refused before any request', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
  Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
  after(() => {
    if (had) Object.defineProperty(globalThis.navigator, 'onLine', had);
    else delete globalThis.navigator.onLine;
  });
  await assert.rejects(readDocument('arac', [jpeg()], { client: failing(500) }), code('offline'));
  if (had) Object.defineProperty(globalThis.navigator, 'onLine', had);
  else delete globalThis.navigator.onLine;
});

test('readDocument: always Opus 5.5 through beta create, even if an old setting asks for another model', async () => {
  const calls = [];
  const client = {
    beta: { messages: { create: async (req) => { calls.push(req); return reply({ plaka: '06bhk412', renk: 'BEYAZ', marka: 'FIAT', model: 'EGEA', belirsiz: [] }); } } },
    messages: { create: async () => { throw new Error('wrong endpoint'); } },
  };
  const r = await readDocument('arac', [jpeg()], { client, model: 'claude-haiku-5-5' });
  assert.deepEqual(r.fields, { plaka: '06 BHK 412', renk: 'Beyaz', marka: 'Fiat', model: 'Egea' });
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.equal(calls[0].messages[0].content[0].source.data, 'eA==');
});

test('readDocument: HTTP failures map to codes the screen can explain', async () => {
  const opts = (client) => ({ client });
  await assert.rejects(readDocument('arac', [jpeg()], opts(failing(401))), code('auth'));
  await assert.rejects(readDocument('arac', [jpeg()], opts(failing(429))), code('rate'));
  await assert.rejects(readDocument('arac', [jpeg()], opts(failing(400, 'Your credit balance is too low'))), code('credit'));
  await assert.rejects(readDocument('arac', [jpeg()], opts(failing(undefined, 'fetch failed'))), code('offline'));
  await assert.rejects(readDocument('arac', [jpeg()], opts(failing(500))), code('api'));
});

test('testKey: checks the key with a tiny message (the models endpoint is not reachable from browsers)', async () => {
  const calls = [];
  const client = {
    messages: { create: async (req) => { calls.push(req); return { stop_reason: 'end_turn', content: [] }; } },
    models: { retrieve: async () => { throw new Error('not reachable from a browser'); } },
  };
  assert.equal(await testKey('sk-test', { client }), true);
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.ok(calls[0].max_tokens <= 64);
  await assert.rejects(testKey('sk-test', { client: failing(401) }), code('auth'));
});
