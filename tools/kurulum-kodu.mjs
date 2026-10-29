// The "AV1-…" setup code for the dad's phone, made on the son's computer. Nothing is sent anywhere.
// Usage: node tools/kurulum-kodu.mjs
// The Google address and key come from ~/AutoVizyon-imza/google.txt when it is there, so only the
// Anthropic key is asked; on Windows the code also lands on the clipboard, ready for WhatsApp.
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeSetup } from '../app/js/lib/setupcode.js';

export function readGoogleFile(text) {
  return {
    scriptUrl: (/https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.exec(text) || [''])[0],
    token: (/^[0-9a-f]{32}$/m.exec(text) || [''])[0],
  };
}

async function main() {
  const file = join(process.env.AV_IMZA_KLASOR || join(homedir(), 'AutoVizyon-imza'), 'google.txt');
  const saved = existsSync(file) ? readGoogleFile(readFileSync(file, 'utf8')) : readGoogleFile('');
  const rl = createInterface({ input: stdin });
  const lines = rl[Symbol.asyncIterator](); // buffered, so pasted or piped answers are not lost
  const ask = async (question) => {
    stdout.write(question);
    return ((await lines.next()).value || '').trim();
  };
  const apiKey = await ask('Anthropic API anahtarı (sk-ant-…): ');
  const scriptUrl = saved.scriptUrl || await ask('Google web uygulaması adresi (https://script.google.com/…/exec): ');
  const token = saved.token || await ask('Google anahtarı (kurulum günlüğündeki): ');
  rl.close();

  const code = encodeSetup({ apiKey, scriptUrl, token });
  if (saved.scriptUrl && saved.token) console.log(`Google adresi ve anahtarı ${file} dosyasından alındı.`);
  const copied = process.platform === 'win32' && spawnSync('clip', { input: code }).status === 0;
  console.log(`\nKurulum kodu${copied ? ' (panoya da kopyalandı)' : ''}. Babana WhatsApp'tan gönder; uygulamada Ayarlar → Yapıştır:\n\n${code}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
