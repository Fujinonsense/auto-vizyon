import 'fake-indexeddb/auto';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, byText, settle } from './helpers/fake-dom.mjs';
let dom, picker;
const photo = (id, kind) => ({ id, kind, blob: new Blob([id]), thumb: new Blob(['thumb ' + id]) });
const photos = [photo('doc', 'tutanak'), photo('after', 'sonra'), photo('car', 'arac'), photo('before', 'once'), photo('licence', 'ehliyet')];
const folder = { id: 'f1', name: 'Ali Veli', plate: '34 ABC 123' };
const primary = () => picker.el.querySelector('.photo-picker-footer .primary');
const choices = () => picker.el.querySelectorAll('.photo-choice');
const open = async (share = async () => true) => {
  const { openPhotoShare } = await import('../app/js/ui/photo-share.js');
  picker = openPhotoShare(photos, folder, { share }); return picker;
};
beforeEach(() => { mock.method(console, 'warn', () => {}); dom = installDom(); mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { picker?.close(); picker = null; mock.timers.reset(); mock.restoreAll(); dom.uninstall(); });

test('picker opens empty with gallery groups and legacy photos under Belgeler; toggles name group, position and state', async () => {
  await open();
  assert.equal(picker.el.querySelector('h2').textContent, "WhatsApp'ta paylaş");
  assert.ok(picker.el.textContent.includes('Göndereceğin fotoğraflara dokun.'));
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

test('folder shows WhatsApp photo action only with gallery photos and the same wrapped label', async () => {
  const repo = await import('../app/js/data/repo.js');
  await (await import('../app/js/data/db.js')).clearAll();
  const { folderView } = await import('../app/js/ui/screens/folder-view.js');
  const f = await repo.saveFolder(folder); const leave = [];
  let view = await folderView({ id: f.id }, { onLeave(fn) { leave.push(fn); } });
  assert.equal(byText(view, 'button', "WhatsApp'ta paylaş"), null);
  await repo.addPhoto({ folderId: f.id, ...photos[0] });
  view = await folderView({ id: f.id }, { onLeave(fn) { leave.push(fn); } });
  const btn = byText(view, 'button', "WhatsApp'ta paylaş");
  assert.ok(btn.classList.contains('ghost')); assert.equal(btn.querySelector('span').textContent, "WhatsApp'ta paylaş");
  btn.click(); assert.ok(document.querySelector('.photo-picker'));
  byText(document.querySelector('.photo-picker'), 'button', 'Vazgeç').click(); leave.forEach((fn) => fn());
});
