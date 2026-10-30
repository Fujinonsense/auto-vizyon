// One pasteable code with what the dad's phone needs. Built on the son's computer
// (kurulum.html), sent over WhatsApp, pasted in Ayarlar.
const PREFIX = 'AV1-';
const KEYS = ['apiKey', 'scriptUrl', 'token'];

function toBase64Url(text) {
  let binary = '';
  new TextEncoder().encode(text).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

const pick = (obj) => Object.fromEntries(KEYS.filter((k) => typeof obj[k] === 'string' && obj[k]).map((k) => [k, obj[k]]));

export function encodeSetup(setup) {
  return PREFIX + toBase64Url(JSON.stringify(pick(setup)));
}

export function decodeSetup(code) {
  const s = String(code ?? '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) throw new Error('Kurulum kodu "AV1-" ile başlamalı');
  let data;
  try {
    data = JSON.parse(fromBase64Url(s.slice(PREFIX.length)));
  } catch {
    throw new Error('Kurulum kodu bozuk, tekrar kopyala');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Kurulum kodu bozuk, tekrar kopyala');
  return pick(data);
}
