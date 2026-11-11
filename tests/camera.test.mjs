import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openCamera } from '../app/js/media/camera.js';
import { docCameraOptions } from '../app/js/ui/docs.js';

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const BACK_TOO = 'Gerekirse arka yüzünü de çek';
const DOC_KINDS = ['ruhsat', 'ehliyet', 'kimlik'];

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

test('document camera: ruhsat, ehliyet and kimlik keep their guides and hint', () => {
  assert.deepEqual(docCameraOptions('ruhsat'), { title: 'Ruhsat fotoğrafı', hint: BACK_TOO, multi: true, doneText: 'Oku', frame: 'doc' });
  assert.deepEqual(docCameraOptions('ehliyet'), { title: 'Ehliyet fotoğrafı', hint: BACK_TOO, multi: true, doneText: 'Oku', frame: 'card' });
  assert.deepEqual(docCameraOptions('kimlik'), { title: 'Kimlik fotoğrafı', hint: BACK_TOO, multi: true, doneText: 'Oku', frame: 'card' });
});

test('camera: the guide asked for is drawn over the preview, none for the car', async () => {
  const dom = fakeDom();
  for (const frame of ['doc', 'card', undefined]) {
    const open = openCamera({ title: 'Fotoğraf', frame });
    const overlay = dom.body.children.at(-1);
    assert.deepEqual(byClass(overlay, 'cam-frame').map((n) => n.className), frame ? [`cam-frame cam-frame-${frame}`] : []);
    byClass(overlay, 'cam-round')[0].click();
    assert.equal(await open, null);
    assert.equal(dom.body.children.length, 0, 'closed camera leaves the page');
  }
});

// The classes the guide frame wears when the app opens the camera for each document.
async function frameClasses(dom) {
  const out = {};
  for (const kind of DOC_KINDS) {
    const open = openCamera(docCameraOptions(kind));
    const overlay = dom.body.children.at(-1);
    const frames = byClass(overlay, 'cam-frame');
    assert.equal(frames.length, 1, `${kind}: one guide`);
    out[kind] = frames[0].className.split(' ').filter(Boolean);
    byClass(overlay, 'cam-round')[0].click();
    await open;
  }
  return out;
}

// "card" on the ehliyet / kimlik guide also matched the app-wide .card rule, which filled the guide with
// the page colour (white, dark in the dark theme) so the licence could not be seen through it.
test('ruhsat, ehliyet and kimlik: every class on the guide frame is the camera\'s own (cam-frame…)', async () => {
  const worn = await frameClasses(fakeDom());
  for (const kind of DOC_KINDS) {
    assert.ok(worn[kind].length >= 2, `${kind}: the guide and its shape`);
    assert.deepEqual(worn[kind].filter((c) => !c.startsWith('cam-frame')), [], `${kind}: "${worn[kind].join(' ')}"`);
  }
});

test('guide CSS: see-through inside, the shapes only set the aspect ratio, and no app-wide rule styles a class the guide wears', async () => {
  const css = readFileSync(new URL('../app/css/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => {
    const body = css.match(new RegExp(`^${sel.replaceAll('.', '\\.')} \\{([^}]*)\\}`, 'm'))?.[1];
    assert.ok(body, `${sel} is in app.css`);
    return Object.fromEntries(body.split(';').map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]).filter(([k, v]) => k && v));
  };
  assert.equal(rule('.cam-frame').background, 'transparent');
  // Stroke, corners and the dimming shade come from .cam-frame alone, so both guides are drawn alike.
  assert.deepEqual(rule('.cam-frame-doc'), { 'aspect-ratio': '1.42' });
  assert.deepEqual(rule('.cam-frame-card'), { 'aspect-ratio': '1.586' });

  // Every selector in app.css (inside @media too) with the classes of the element it styles: its last compound.
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap(([, list]) => list.split(';').at(-1).split(',').map((s) => s.trim()).filter(Boolean))
    .map((s) => ({ s, classes: (s.split(/[\s>+~]+/).at(-1).match(/\.[\w-]+/g) || []).map((c) => c.slice(1)) }));
  assert.ok(selectors.some(({ s }) => s === '.card'), 'the app-wide card rule is seen');
  const worn = new Set(Object.values(await frameClasses(fakeDom())).flat());
  for (const c of worn) {
    const foreign = selectors.filter(({ s, classes }) => classes.includes(c) && !s.startsWith('.cam')).map(({ s }) => s);
    assert.deepEqual(foreign, [], `.${c} is styled outside the camera`);
  }
});

test('camera: a shot is the whole camera picture, never cut to the guide, so the whole document is kept', async () => {
  const dom = fakeDom();
  const open = openCamera(docCameraOptions('ruhsat'));
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
