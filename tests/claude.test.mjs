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

const TUTANAK_KEYS = ['AdSoyad', 'Tc', 'Ehliyet', 'AlindigiYer', 'Adres', 'Tel', 'Plaka'];

test('kaza tutanağı: the two drivers and their plates, nothing else', () => {
  const k = KINDS.tutanak;
  assert.equal(k.label, 'Kaza tutanağı');
  assert.deepEqual(k.fields.map((f) => f.key), [...TUTANAK_KEYS.map((x) => `a${x}`), ...TUTANAK_KEYS.map((x) => `b${x}`)]);
  assert.deepEqual([...k.schema.required].sort(), [...k.fields.map((f) => f.key), 'belirsiz'].sort());
  for (const words of ['Sürücü Bilgileri', 'Araç Bilgileri', '106408-B', 'belirsiz', 'kroki', 'imza']) assert.ok(k.prompt.includes(words), words);
  assert.deepEqual(buildRequest('tutanak', [img]).output_config.format.schema, k.schema);
});

test('parseResponse (tutanak): TC, plate and name cleaned like the other documents, unreadable left empty', () => {
  const r = parseResponse('tutanak', reply({
    aAdSoyad: 'UĞURCAN KAYA', aTc: '100 000 001 46', aEhliyet: '482190-B', aAlindigiYer: 'Kadıköy', aAdres: 'Moda Cad. No 12',
    aTel: '0532 418 27 90', aPlaka: '34nma887',
    bAdSoyad: 'IŞIL İNCE', bTc: '12345678901', bEhliyet: '106408-B', bAlindigiYer: '', bAdres: '', bTel: '', bPlaka: '35 kr 77810',
    belirsiz: ['bAdres', 'bTel', 'bilinmeyen'],
  }));
  assert.equal(r.fields.aTc, '10000000146');
  assert.equal(r.fields.aPlaka, '34 NMA 887');
  assert.equal(r.fields.aAdSoyad, 'Uğurcan Kaya');
  assert.equal(r.fields.bAdSoyad, 'Işıl İnce');
  assert.equal(r.fields.aTel, '0532 418 27 90');
  assert.equal(r.fields.aEhliyet, '482190-B');
  assert.equal(r.fields.bAdres, '');
  assert.equal(r.fields.bTel, '');
  assert.ok(r.unclear.includes('bTc'), 'a TC that fails the checksum is flagged');
  assert.ok(r.unclear.includes('bPlaka'), 'an impossible plate is flagged');
  assert.ok(!r.unclear.includes('aTc') && !r.unclear.includes('aPlaka'));
  assert.ok(r.unclear.includes('bAdres') && r.unclear.includes('bTel'));
  assert.ok(!r.unclear.includes('bilinmeyen'));
  assert.deepEqual(Object.keys(r.fields), KINDS.tutanak.fields.map((f) => f.key));
});

test('the sample answers (no API key) cover every document and read cleanly', async () => {
  const { mockClient } = await import('../app/js/ai/mock.js');
  await Promise.all(Object.keys(KINDS).map(async (kind) => {
    const r = parseResponse(kind, await mockClient.beta.messages.create(buildRequest(kind, [img])));
    assert.ok(Object.values(r.fields).filter(Boolean).length >= 4, kind);
  }));
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
