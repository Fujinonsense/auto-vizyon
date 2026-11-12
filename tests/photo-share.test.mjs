import 'fake-indexeddb/auto';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, byText, settle } from './helpers/fake-dom.mjs';
let dom, picker;
const leave = [];
// The folder's three ways to send photos, in button order. Each picks photos, then opens the phone's share menu.
const targets = {
  whatsapp: { label: 'WhatsApp', icon: 'brand-whatsapp', title: "WhatsApp'ta paylaş", hint: "Paylaş'a basınca açılan menüden WhatsApp'ı seç." },
  mail: { label: 'Mail', icon: 'mail', title: 'Mail ile gönder', hint: "Paylaş'a basınca açılan menüden Mail'i seç." },
  gmail: { label: 'Gmail', icon: 'brand-gmail', title: 'Gmail ile gönder', hint: "Paylaş'a basınca açılan menüden Gmail'i seç." },
};
const photo = (id, kind) => ({ id, kind, blob: new Blob([id]), thumb: new Blob(['thumb ' + id]) });
const photos = [photo('doc', 'tutanak'), photo('after', 'sonra'), photo('car', 'arac'), photo('before', 'once'), photo('licence', 'ehliyet')];
const folder = { id: 'f1', name: 'Ali Veli', plate: '34 ABC 123' };
const primary = () => picker.el.querySelector('.photo-picker-footer .primary');
const choices = () => picker.el.querySelectorAll('.photo-choice');
const open = async (share = async () => true, options = {}) => {
  const { openPhotoShare } = await import('../app/js/ui/photo-share.js');
  picker = openPhotoShare(photos, folder, { share, ...options }); return picker;
};
// The picker's first two lines: what to tap here, then which app to pick in the share menu.
const lines = (root) => root.querySelector('.photo-picker').children.slice(0, 2);
const photoSection = (view) => byText(view, 'h3', 'Fotoğraflar').parentNode.parentNode;
const byLabel = (root, label) => root.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === label) ?? null;
const folderScreen = async (withPhotos = true) => {
  const repo = await import('../app/js/data/repo.js');
  await (await import('../app/js/data/db.js')).clearAll();
  const { folderView } = await import('../app/js/ui/screens/folder-view.js');
  const f = await repo.saveFolder(folder);
  if (withPhotos) await repo.addPhoto({ folderId: f.id, ...photos[0] });
  return folderView({ id: f.id }, { onLeave(fn) { leave.push(fn); } });
};
beforeEach(() => { mock.method(console, 'warn', () => {}); dom = installDom(); mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { picker?.close(); picker = null; leave.splice(0).forEach((fn) => fn()); mock.timers.reset(); mock.restoreAll(); dom.uninstall(); });

test('SHARE_TARGETS defines WhatsApp, Mail and Gmail in order with exact picker copy', async () => {
  const { SHARE_TARGETS } = await import('../app/js/ui/photo-share.js');
  assert.deepEqual(Object.keys(SHARE_TARGETS ?? {}), ['whatsapp', 'mail', 'gmail']);
  assert.deepEqual(SHARE_TARGETS, targets);
});

test('picker opens empty with gallery groups and legacy photos under Belgeler; toggles name group, position and state', async () => {
  await open();
  assert.equal(picker.el.querySelector('h2').textContent, "WhatsApp'ta paylaş");
  assert.ok(picker.el.textContent.includes('Göndereceğin fotoğraflara dokun.'));
  assert.deepEqual(lines(picker.el).map((p) => p.textContent), ['Göndereceğin fotoğraflara dokun.', targets.whatsapp.hint], 'no target: the WhatsApp hint');
  assert.equal(primary().disabled, true); assert.equal(primary().textContent, 'Fotoğraf seç');
  assert.deepEqual(picker.el.querySelectorAll('.pgroup').map((e) => e.querySelector('span').textContent), ['Araç', 'Hasar öncesi', 'Hasar sonrası', 'Belgeler']);
  const docs = picker.el.querySelectorAll('.pgroup').at(-1);
  assert.equal(docs.querySelectorAll('.photo-choice').length, 2);
  assert.ok(choices().every((b) => b.getAttribute('aria-pressed') === 'false'));
});

test('toggle and select-all controls update count, aria-pressed and accessible state', async () => {
  await open();
  const [car, before] = choices();
  assert.equal(car.getAttribute('aria-pressed'), 'false');
  assert.match(car.getAttribute('aria-label'), /Araç.*1.*seçilmedi/);
  car.click(); before.click();
  assert.equal(primary().textContent, 'Paylaş (2)'); assert.equal(primary().disabled, false);
  assert.equal(car.getAttribute('aria-pressed'), 'true'); assert.match(car.getAttribute('aria-label'), /seçildi/);
  assert.equal(car.querySelector('.photo-check').hidden, false);
  byText(picker.el, 'button', 'Tümünü seç').click();
  assert.equal(primary().textContent, 'Paylaş (5)'); assert.ok(choices().every((b) => b.getAttribute('aria-pressed') === 'true'));
  byText(picker.el, 'button', 'Seçimi kaldır').click();
  assert.equal(primary().disabled, true); assert.ok(choices().every((b) => b.getAttribute('aria-pressed') === 'false'));
});

test('shares exactly selected photos in gallery order, preparing is disabled; completion closes and revokes URLs', async () => {
  const revoked = []; const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => { revoked.push(u); revoke(u); };
  try {
    let finish; const calls = [];
    await open((selected, f) => { calls.push({ selected, f }); return new Promise((r) => { finish = r; }); });
    const urls = picker.el.querySelectorAll('img').map((i) => i.getAttribute('src'));
    choices()[3].click(); choices()[0].click(); choices()[2].click();
    const action = primary().click();
    assert.equal(primary().disabled, true); assert.equal(primary().textContent, 'Hazırlanıyor…');
    assert.deepEqual(calls[0].selected.map((p) => p.id), ['car', 'after', 'doc']); assert.equal(calls[0].f, folder);
    finish(true); await Promise.all(action);
    assert.equal(picker.el.classList.contains('open'), false);
    assert.deepEqual(revoked.sort(), urls.sort());
    mock.timers.tick(220); assert.equal(document.querySelector('.sheet-wrap'), null);
  } finally { URL.revokeObjectURL = revoke; }
});

test('cancelled share keeps the sheet and selection; error shows toast and allows retry', async () => {
  let response = false;
  await open(async () => { if (response === 'error') throw new Error('failure'); return response; });
  await settle(); choices()[1].click();
  await Promise.all(primary().click());
  assert.ok(picker.el.classList.contains('open')); assert.equal(primary().textContent, 'Paylaş (1)');
  assert.equal(choices()[1].getAttribute('aria-pressed'), 'true');
  response = 'error'; await Promise.all(primary().click());
  assert.equal(document.getElementById('toast').textContent, 'Paylaşılamadı. Tekrar dene.');
  assert.ok(picker.el.classList.contains('open')); assert.equal(primary().disabled, false);
  response = true; await Promise.all(primary().click()); assert.equal(picker.el.classList.contains('open'), false);
});

test('from Paylaş until the share settles the picker stays open (X, outside, Escape, Vazgeç); then it closes as usual', async () => {
  const keys = new Set();
  document.addEventListener = (type, fn) => { if (type === 'keydown') keys.add(fn); };
  document.removeEventListener = (type, fn) => { if (type === 'keydown') keys.delete(fn); };
  let settleShare;
  await open(() => new Promise((resolve, reject) => { settleShare = { resolve, reject }; }));
  await settle();
  const cancel = () => byText(picker.el, 'button', 'Vazgeç');
  const isOpen = () => picker.el.classList.contains('open');
  const tryEveryClose = () => {
    picker.el.querySelector('.sheet-head .icon-btn').click();
    picker.el.click();
    [...keys].forEach((fn) => fn({ key: 'Escape' }));
    cancel().click();
  };
  choices()[0].click(); choices()[4].click();

  // Cancelled in the share sheet: the picker and the selection stay.
  let action = primary().click();
  assert.equal(cancel().disabled, true, 'Vazgeç is off while preparing');
  tryEveryClose(); mock.timers.tick(220);
  assert.ok(isOpen()); assert.ok(document.querySelector('.sheet-wrap'));
  assert.equal(primary().textContent, 'Hazırlanıyor…');
  settleShare.resolve(false); await Promise.all(action);
  assert.ok(isOpen()); assert.equal(cancel().disabled, false); assert.equal(primary().textContent, 'Paylaş (2)');
  assert.deepEqual(choices().map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'true']);

  // A failed share: still open, the toast says so.
  action = primary().click();
  tryEveryClose(); mock.timers.tick(220);
  assert.ok(isOpen());
  settleShare.reject(new Error('disk full')); await Promise.all(action);
  assert.ok(isOpen()); assert.equal(document.getElementById('toast').textContent, 'Paylaşılamadı. Tekrar dene.');

  // Shared: now it closes, and the ordinary close paths work again on a fresh picker.
  action = primary().click();
  tryEveryClose(); mock.timers.tick(220);
  assert.ok(isOpen());
  settleShare.resolve(true); await Promise.all(action);
  assert.equal(isOpen(), false);
  await open(); await settle();
  [...keys].forEach((fn) => fn({ key: 'Escape' }));
  assert.equal(isOpen(), false, 'Escape closes an idle picker');
});

test('folder with gallery photos shows "Fotoğrafları gönder" and exactly three share buttons, WhatsApp, Mail, Gmail; without photos none', async () => {
  let section = photoSection(await folderScreen(false));
  assert.equal(byText(section, '.muted.small', 'Fotoğrafları gönder'), null);
  for (const { label, title } of Object.values(targets)) {
    assert.equal(byText(section, 'button', label), null);
    assert.equal(byLabel(section, title), null);
  }
  leave.splice(0).forEach((fn) => fn());

  section = photoSection(await folderScreen());
  const head = section.querySelector('.section-head');
  assert.deepEqual(head.children.map((el) => el.tagName), ['H3'], 'the head keeps only its title');
  // Directly under the head: the caption, then the row of buttons.
  const block = section.children[1];
  assert.equal(block.className, 'photo-send');
  const [caption, row] = block.children;
  assert.equal(block.children.length, 2);
  assert.equal(caption.textContent, 'Fotoğrafları gönder');
  assert.ok(caption.classList.contains('muted') && caption.classList.contains('small'));
  assert.ok(row.classList.contains('btn-row'));
  const buttons = block.querySelectorAll('button');
  assert.ok(buttons.every((b) => b.parentNode === row));
  assert.deepEqual(buttons.map((b) => b.textContent), ['WhatsApp', 'Mail', 'Gmail']);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), ["WhatsApp'ta paylaş", 'Mail ile gönder', 'Gmail ile gönder']);
  // icon() draws an empty svg for a name it does not know: each button must carry its target's real icon.
  const { icon } = await import('../app/js/ui/dom.js');
  const { ICONS } = await import('../app/js/ui/icons.js');
  Object.values(targets).forEach((t, i) => {
    const b = buttons[i];
    assert.equal(b.getAttribute('type'), 'button');
    assert.ok(b.classList.contains('btn') && b.classList.contains('small'));
    assert.deepEqual(b.children.map((el) => el.tagName), ['SVG', 'SPAN']);
    assert.ok(ICONS[t.icon], `${t.icon} is a known icon`);
    assert.equal(b.children[0].markup, icon(t.icon, 18).markup, `${t.label} shows ${t.icon} at 18 px`);
    assert.equal(b.children[1].textContent, t.label);
  });
});

for (const target of Object.values(targets)) {
  test(`${target.label} button of the folder opens the picker titled "${target.title}", its hint under the tap line`, async () => {
    const section = photoSection(await folderScreen());
    byLabel(section, target.title)?.click();
    const wrap = document.querySelector('.sheet-wrap');
    assert.ok(wrap, `${target.label} opens the picker`);
    try {
      assert.equal(wrap.querySelector('h2').textContent, target.title);
      assert.equal(wrap.querySelector('.sheet').getAttribute('aria-label'), target.title);
      const [tap, hint] = lines(wrap);
      assert.equal(tap.textContent, 'Göndereceğin fotoğraflara dokun.');
      assert.equal(hint.tagName, 'P');
      assert.ok(hint.classList.contains('muted'));
      assert.equal(hint.textContent, target.hint);
      assert.equal(wrap.querySelectorAll('.photo-choice').length, 1, "the folder's gallery");
    } finally { byText(wrap, 'button', 'Vazgeç').click(); }
  });
}

test('without a known target the picker is the WhatsApp one', async () => {
  for (const target of [undefined, null, 'unknown', '', 'Mail', 'toString', '__proto__']) {
    await open(undefined, { target });
    assert.equal(picker.el.querySelector('h2').textContent, targets.whatsapp.title, String(target));
    assert.equal(lines(picker.el)[1].textContent, targets.whatsapp.hint, String(target));
    picker.close(); mock.timers.tick(220);
  }
});

for (const target of ['mail', 'gmail']) {
  test(`${targets[target].label} picker shares selected photos in gallery order and the folder`, async () => {
    const calls = [];
    await open(async (selected, f) => { calls.push({ selected, f }); return true; }, { target });
    assert.equal(picker.el.querySelector('h2').textContent, targets[target].title);
    choices()[4].click(); choices()[2].click(); choices()[0].click();
    assert.equal(primary().textContent, 'Paylaş (3)');
    await Promise.all(primary().click());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].selected, [photos[2], photos[1], photos[4]]);
    assert.equal(calls[0].f, folder);
    assert.equal(picker.el.classList.contains('open'), false);
  });

  test(`${targets[target].label} picker keeps its title and selection when the share menu is dismissed, and shares on the next try`, async () => {
    let response = false;
    const calls = [];
    await open(async (selected) => { calls.push(selected); return response; }, { target });
    await settle(); choices()[1].click();
    await Promise.all(primary().click());
    assert.ok(picker.el.classList.contains('open'));
    assert.equal(picker.el.querySelector('h2').textContent, targets[target].title);
    assert.equal(primary().textContent, 'Paylaş (1)');
    assert.equal(choices()[1].getAttribute('aria-pressed'), 'true');
    response = true; await Promise.all(primary().click());
    assert.equal(calls.length, 2);
    assert.equal(picker.el.classList.contains('open'), false);
  });
}

test('every share target icon has markup in ICONS and is listed in build-assets ICON_NAMES', async () => {
  const { SHARE_TARGETS } = await import('../app/js/ui/photo-share.js');
  const { ICONS } = await import('../app/js/ui/icons.js');
  const build = readFileSync(new URL('../tools/build-assets.mjs', import.meta.url), 'utf8');
  const names = [...build.match(/const ICON_NAMES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const used = Object.values(SHARE_TARGETS ?? {}).map((t) => t.icon);
  assert.deepEqual(used, ['brand-whatsapp', 'mail', 'brand-gmail']);
  for (const name of used) {
    assert.match(ICONS[name] ?? '', /<(?:path|circle|rect|line|polyline|polygon|ellipse)\b/, `${name} has icon markup`);
    assert.ok(names.includes(name), `${name} is in ICON_NAMES`);
  }
});

// app.css without comments; a rule's declarations by its exact selector, at the top level or inside an @media block.
const css = readFileSync(new URL('../app/css/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function cssRule(selector, media) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scopes = media ? [...css.matchAll(new RegExp(`^@media ${esc(media)} \\{([\\s\\S]*?)^\\}`, 'gm'))].map((m) => m[1]) : [css];
  for (const scope of scopes) {
    const body = scope.match(new RegExp(`^${media ? '\\s+' : ''}${esc(selector)} \\{([^}]*)\\}`, 'm'))?.[1];
    if (body) {
      return Object.fromEntries(body.split(';').map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]).filter(([k, v]) => k && v));
    }
  }
  assert.fail(`${selector} is in app.css${media ? ` inside @media ${media}` : ''}`);
}

// A check of the rules as written in app.css, with letter widths measured on a desktop font. It is not a rendering.
test('the stylesheet gives the three share buttons one row of equal thirds, 8 px apart, 48 px tall, with room for "WhatsApp" at 320 px', () => {
  const px = parseFloat;
  const side = (padding) => px(padding.split(' ')[1] ?? padding);
  const row = cssRule('.btn-row');
  assert.deepEqual([row.display, row['grid-template-columns'], row.gap], ['grid', 'repeat(auto-fit, minmax(0, 1fr))', '8px']);
  const btn = cssRule('.photo-send .btn');
  // Beside its word, a third of the card has no room for the icon (the browser squeezes it to nothing): it sits above.
  assert.equal(btn['flex-direction'], 'column');
  assert.ok(px(btn['min-height']) >= 48, 'as tall as the other buttons of the folder');
  // A third of the card at 320 px: the screen's and the card's side padding and border, two gaps; then the button's own.
  const third = (320 - 2 * side(cssRule('main#screen').padding) - 2 * px(cssRule('.card').border) - 2 * side(cssRule('.section').padding) - 2 * px(row.gap)) / 3;
  const room = third - 2 * px(cssRule('.btn').border) - 2 * side(btn.padding);
  // "WhatsApp" at 15 px semibold is 70.5 px in Segoe UI and 73.6 px in Arial Bold (measured in Chrome).
  assert.equal(btn['font-size'] ?? cssRule('.btn.small')['font-size'], '15px');
  assert.ok(room >= 74, `${room.toFixed(1)} px for "WhatsApp"`);
  // Below 360 px a pill's round ends would cut into the word: the corners round like the app's other buttons.
  assert.equal(cssRule('.photo-send .btn', '(max-width: 359px)')['border-radius'], 'var(--radius)');
});
