import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openCamera } from '../app/js/media/camera.js';
import { docCameraOptions } from '../app/js/ui/docs.js';

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const BACK_TOO = 'Gerekirse arka yüzünü de çek';

// Just enough DOM for the camera: elements, the page body, canvases and a camera that streams.
class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.style = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.attrs = {};
    this.classList = {
      add: (c) => { if (!this.className.split(' ').includes(c)) this.className = `${this.className} ${c}`.trim(); },
      remove: (c) => { this.className = this.className.split(' ').filter((x) => x && x !== c).join(' '); },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof FakeNode) n.parent = this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  click() { return (this.listeners.click || []).map((fn) => fn()); }
  play() { return Promise.resolve(); }
}

function fakeDom() {
  const dom = { body: new FakeNode('body'), canvases: [], stopped: 0 };
  globalThis.Node = FakeNode;
  globalThis.document = {
    body: dom.body,
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      const el = new FakeNode(tag);
      if (tag === 'template') el.content = { firstChild: new FakeNode('svg') };
      if (tag === 'canvas') {
        el.draws = [];
        el.getContext = () => ({ drawImage: (...args) => el.draws.push(args) });
        el.toBlob = (done, type) => done((el.blob = new Blob(['jpeg'], { type })));
        dom.canvases.push(el);
      }
      return el;
    },
  };
  const stream = { getTracks: () => [{ stop: () => { dom.stopped++; } }] };
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: async () => stream } }, configurable: true, writable: true,
  });
  return dom;
}

const all = (n) => [n, ...n.children.filter((c) => c instanceof FakeNode).flatMap(all)];
const byClass = (root, cls) => all(root).filter((n) => n.className.split(' ').includes(cls));
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete globalThis.Node;
  delete globalThis.document;
  Object.defineProperty(globalThis, 'navigator', realNavigator);
});

test('document camera: the accident report gets the upright page guide and a whole-page hint', () => {
  assert.deepEqual(docCameraOptions('tutanak'), {
    title: 'Kaza tutanağı fotoğrafı', hint: 'Tutanağın tamamını çerçeveye alın', multi: true, doneText: 'Oku', frame: 'page',
  });
});

test('document camera: ruhsat, ehliyet and kimlik keep their guides and hint', () => {
  assert.deepEqual(docCameraOptions('ruhsat'), { title: 'Ruhsat fotoğrafı', hint: BACK_TOO, multi: true, doneText: 'Oku', frame: 'doc' });
  assert.deepEqual(docCameraOptions('ehliyet'), { title: 'Ehliyet fotoğrafı', hint: BACK_TOO, multi: true, doneText: 'Oku', frame: 'card' });
  assert.deepEqual(docCameraOptions('kimlik'), { title: 'Kimlik fotoğrafı', hint: BACK_TOO, multi: true, doneText: 'Oku', frame: 'card' });
});

test('the page guide is an upright A4 that fits the view, drawn like the other guides', () => {
  const css = readFileSync(new URL('../app/css/app.css', import.meta.url), 'utf8');
  const rule = (sel) => {
    const body = css.match(new RegExp(`^${sel.replaceAll('.', '\\.')} \\{([^}]*)\\}`, 'm'))?.[1];
    assert.ok(body, `${sel} is in app.css`);
    return Object.fromEntries(body.split(';').map((d) => d.split(':').map((x) => x.trim())).filter(([k]) => k));
  };
  const page = rule('.cam-frame.page');
  const [w, hgt = 1] = page['aspect-ratio'].split('/').map(Number);
  assert.ok(Math.abs(w / hgt - 210 / 297) < 0.001, `A4 upright, got ${page['aspect-ratio']}`);
  assert.ok(parseFloat(page.height) <= 90 && page.height.endsWith('%'), 'sized by the view height, so the whole page stays in view');
  assert.ok(parseFloat(page['max-width']) <= 84 && page['max-width'].endsWith('%'), 'never wider than the other guides');
  assert.deepEqual(Object.keys(page).filter((k) => /^(border|box-shadow|outline|background)/.test(k)), [], 'stroke, corners and shade come from .cam-frame');
  assert.equal(rule('.cam-frame.doc')['aspect-ratio'], '1.42');
  assert.equal(rule('.cam-frame.card')['aspect-ratio'], '1.586');
});

test('camera: the guide asked for is drawn over the preview, none for the car', async () => {
  const dom = fakeDom();
  for (const frame of ['page', 'doc', 'card', undefined]) {
    const open = openCamera({ title: 'Fotoğraf', frame });
    const overlay = dom.body.children.at(-1);
    assert.deepEqual(byClass(overlay, 'cam-frame').map((n) => n.className), frame ? [`cam-frame ${frame}`] : []);
    byClass(overlay, 'cam-round')[0].click();
    assert.equal(await open, null);
    assert.equal(dom.body.children.length, 0, 'closed camera leaves the page');
  }
});

test('camera: a shot is the whole camera picture, never cut to the guide, so the whole report is kept', async () => {
  const dom = fakeDom();
  const open = openCamera(docCameraOptions('tutanak'));
  const overlay = dom.body.children.at(-1);
  await tick();
  const [video] = byClass(overlay, 'cam-video');
  Object.assign(video, { videoWidth: 1440, videoHeight: 1920 });
  await Promise.all(byClass(overlay, 'cam-shutter')[0].click());
  const [canvas] = dom.canvases;
  assert.deepEqual([canvas.width, canvas.height], [1440, 1920]);
  assert.deepEqual(canvas.draws, [[video, 0, 0]], 'drawn whole at its own size, no part picked out');
  byClass(overlay, 'gold')[0].click();
  const res = await open;
  assert.deepEqual(res, { photos: [canvas.blob], skipped: false });
  assert.equal(dom.stopped, 1, 'the camera is turned off');
});
