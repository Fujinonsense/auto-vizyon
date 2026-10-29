import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { shareFiles } from '../app/js/native.js';

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

// The iPhone app's bridge: Capacitor.nativePromise(plugin, method, options).
function fakeBridge({ cancel = false } = {}) {
  const calls = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (plugin, method, options) => {
      calls.push({ plugin, method, options });
      if (plugin === 'Filesystem') return { uri: `file:///cache/${options.path}` };
      if (cancel) throw new Error('Share canceled');
      return { activityType: 'com.apple.UIKit.activity.SaveToCameraRoll' };
    },
  };
  return calls;
}

function fakeNavigator(nav) {
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
}

afterEach(() => {
  delete globalThis.Capacitor;
  delete globalThis.document;
  Object.defineProperty(globalThis, 'navigator', realNavigator);
});

test('in the iPhone app, files are written to the cache and shared by their file URLs', async () => {
  const calls = fakeBridge();
  await shareFiles([
    { name: '34NMA887-1.jpg', blob: new Blob(['jpg']) },
    { name: '34NMA887-2.jpg', blob: new Blob(['jp2']) },
  ], 'Uğurcan Kaya');
  assert.deepEqual(calls, [
    { plugin: 'Filesystem', method: 'writeFile', options: { path: '34NMA887-1.jpg', data: btoa('jpg'), directory: 'CACHE' } },
    { plugin: 'Filesystem', method: 'writeFile', options: { path: '34NMA887-2.jpg', data: btoa('jp2'), directory: 'CACHE' } },
    { plugin: 'Share', method: 'share', options: { title: 'Uğurcan Kaya', files: ['file:///cache/34NMA887-1.jpg', 'file:///cache/34NMA887-2.jpg'] } },
  ]);
});

test('in the iPhone app, a large file survives the base64 round trip', async () => {
  const calls = fakeBridge();
  const bytes = Uint8Array.from({ length: 200000 }, (_, i) => (i * 7) % 256);
  await shareFiles([{ name: 'AutoVizyon.xlsx', blob: new Blob([bytes]) }], 'AutoVizyon.xlsx');
  assert.deepEqual(new Uint8Array(Buffer.from(calls[0].options.data, 'base64')), bytes);
});

test('in the iPhone app, closing the share sheet is not an error', async () => {
  fakeBridge({ cancel: true });
  await shareFiles([{ name: 'a.json', blob: new Blob(['{}']) }], 'a.json');
});

test('in a browser that can share files, the Web Share API gets them', async () => {
  let shared = null;
  fakeNavigator({ canShare: ({ files }) => files.length > 0, share: async (data) => { shared = data; } });
  await shareFiles([{ name: 'a.xlsx', blob: new Blob(['x'], { type: 'text/plain' }) }], 'Excel');
  assert.equal(shared.title, 'Excel');
  assert.equal(shared.files[0].name, 'a.xlsx');
  assert.equal(shared.files[0].type, 'text/plain');
});

test('in a browser without file sharing, each file is downloaded', async () => {
  fakeNavigator({});
  const clicked = [];
  globalThis.document = { createElement: () => ({ click() { clicked.push(this.download); } }) };
  await shareFiles([{ name: 'a.jpg', blob: new Blob(['1']) }, { name: 'b.jpg', blob: new Blob(['2']) }], 'Fotoğraflar');
  assert.deepEqual(clicked, ['a.jpg', 'b.jpg']);
});
