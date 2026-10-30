// Reads plates and documents with Claude, straight from the phone (official SDK, browser build).
import { SYSTEM, KINDS } from './schemas.js';
import { normalizePlate, isValidPlate, normalizeVin, isValidVin, isValidTc } from '../lib/validate.js';
import { trTitle, latinTitle } from '../lib/format.js';
import { blobToBase64 } from '../media/image.js';

// Always this model: the app offers no cheaper one to choose by mistake.
const MODEL = 'claude-opus-5-5';

export const MESSAGES = {
  'no-key': "Yapay zeka anahtarı girilmemiş. Ayarlar'dan ekleyebilirsin.",
  offline: 'İnternet yok. Bilgileri elle yaz ya da sonra "Tekrar oku"ya bas.',
  refusal: 'Yapay zeka bu fotoğrafı okumadı. Bilgileri elle yaz.',
  parse: 'Fotoğraf okunamadı. Daha yakından ve net bir fotoğraf çek.',
  auth: "Yapay zeka anahtarı geçersiz. Ayarlar'dan kontrol et.",
  rate: 'Çok sık okuma yapıldı. Biraz sonra tekrar dene.',
  credit: 'Anthropic hesabındaki kredi bitti. Kredi yüklenince tekrar dene.',
  api: 'Yapay zekaya şu an ulaşılamadı. Biraz sonra tekrar dene.',
};

export class AiError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.api);
    this.code = code;
  }
}

export function buildRequest(kind, images) {
  return {
    model: MODEL,
    // If a safety check declines, the API retries on a fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: KINDS[kind].schema } },
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
        { type: 'text', text: KINDS[kind].prompt },
      ],
    }],
  };
}

const LATIN = ['marka', 'model'];
const NAMES = ['adSoyad', 'sahibiAdSoyad', 'renk'];

function normalize(kind, data) {
  const unclear = new Set(Array.isArray(data.belirsiz) ? data.belirsiz : []);
  const fields = Object.fromEntries(KINDS[kind].fields.map(({ key }) => [key, String(data[key] ?? '').trim()]));
  const flag = (key, ok) => { if (fields[key] && !ok) unclear.add(key); };

  if (fields.plaka) {
    fields.plaka = normalizePlate(fields.plaka);
    flag('plaka', isValidPlate(fields.plaka));
  }
  if (fields.saseNo) {
    fields.saseNo = normalizeVin(fields.saseNo);
    flag('saseNo', isValidVin(fields.saseNo));
  }
  if (fields.tc) {
    fields.tc = fields.tc.replace(/\D/g, '');
    flag('tc', isValidTc(fields.tc));
  }
  if (fields.tcVkn) {
    fields.tcVkn = fields.tcVkn.replace(/\D/g, '');
    flag('tcVkn', fields.tcVkn.length === 10 || isValidTc(fields.tcVkn));
  }
  if (fields.modelYili) {
    const year = Number(fields.modelYili.replace(/\D/g, '').slice(0, 4));
    fields.modelYili = year ? String(year) : '';
    flag('modelYili', year >= 1950 && year <= new Date().getFullYear() + 1);
  }
  LATIN.forEach((k) => { if (fields[k]) fields[k] = latinTitle(fields[k]); });
  NAMES.forEach((k) => { if (fields[k]) fields[k] = trTitle(fields[k]); });
  return { fields, unclear: [...unclear].filter((k) => k in fields) };
}

export function parseResponse(kind, response) {
  if (response?.stop_reason === 'refusal') throw new AiError('refusal');
  const text = [...(response?.content || [])].reverse().find((b) => b.type === 'text')?.text;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError('parse');
  }
  if (!data || typeof data !== 'object') throw new AiError('parse');
  return normalize(kind, data);
}

// SDK errors carry the HTTP status; a missing status means the request never got an answer.
function toAiError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) return new AiError('auth');
  if (status === 429 || status === 529) return new AiError('rate');
  if (status === 400 && /credit/i.test(err.message || '')) return new AiError('credit');
  if (!status) return new AiError('offline');
  return new AiError('api');
}

async function createClient(apiKey) {
  if (globalThis.localStorage?.getItem('avMockAI') === '1') return (await import('./mock.js')).mockClient;
  const { default: Anthropic } = await import('../../vendor/anthropic.js');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 90_000 });
}

export async function readDocument(kind, blobs, { apiKey = '', client } = {}) {
  const mock = globalThis.localStorage?.getItem('avMockAI') === '1';
  if (!client && !apiKey && !mock) throw new AiError('no-key');
  if (globalThis.navigator?.onLine === false) throw new AiError('offline');
  const images = await Promise.all(blobs.map(async (b) => ({ base64: await blobToBase64(b), mediaType: b.type || 'image/jpeg' })));
  const api = client || (await createClient(apiKey));
  let response;
  try {
    response = await api.beta.messages.create(buildRequest(kind, images));
  } catch (err) {
    throw toAiError(err);
  }
  return parseResponse(kind, response);
}

// Settings "Test": one tiny message (fractions of a cent). The models endpoint would be free
// but browsers can't reach it (no CORS), so it can't be used from the phone.
export async function testKey(apiKey, { client } = {}) {
  if (!apiKey && !client) throw new AiError('no-key');
  try {
    const api = client || (await createClient(apiKey));
    await api.messages.create({ model: MODEL, max_tokens: 32, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Merhaba' }] });
    return true;
  } catch (err) {
    throw toAiError(err);
  }
}
