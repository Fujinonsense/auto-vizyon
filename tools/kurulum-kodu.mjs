// The "AV1-…" setup code for the dad's phone, made on the son's computer. Nothing is sent anywhere.
// Usage: node tools/kurulum-kodu.mjs
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { encodeSetup } from '../app/js/lib/setupcode.js';

const rl = createInterface({ input: stdin });
const lines = rl[Symbol.asyncIterator](); // buffered, so pasted or piped answers are not lost
const ask = async (question) => {
  stdout.write(question);
  return ((await lines.next()).value || '').trim();
};
const apiKey = await ask('Anthropic API anahtarı (sk-ant-…): ');
const scriptUrl = await ask('Google web uygulaması adresi (https://script.google.com/…/exec): ');
const token = await ask('Google anahtarı (kurulum günlüğündeki): ');
rl.close();

console.log(`\nKurulum kodu. Babana WhatsApp'tan gönder; uygulamada Ayarlar → Yapıştır:\n\n${encodeSetup({ apiKey, scriptUrl, token })}\n`);
