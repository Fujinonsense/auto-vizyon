import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGoogleFile } from '../tools/kurulum-kodu.mjs';

test('the Google address and key are read from google.txt in the signing folder', () => {
  const text = [
    'Google web uygulaması adresi:',
    'https://script.google.com/macros/s/AKfycbz-Abc_123/exec',
    'Google anahtarı:',
    '0123456789abcdef0123456789abcdef',
    'Hesap: dukkan@example.com',
    '',
  ].join('\n');
  assert.deepEqual(readGoogleFile(text), {
    scriptUrl: 'https://script.google.com/macros/s/AKfycbz-Abc_123/exec',
    token: '0123456789abcdef0123456789abcdef',
  });
});

test('without them nothing is taken, so the questions are asked as before', () => {
  assert.deepEqual(readGoogleFile('boş dosya'), { scriptUrl: '', token: '' });
  assert.deepEqual(readGoogleFile('https://script.google.com/macros/s/x/exec 0123456789abcdef0123456789abcdef'), {
    scriptUrl: 'https://script.google.com/macros/s/x/exec',
    token: '',
  });
});
