import 'fake-indexeddb/auto';
import { test, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type, byText, settle } from './helpers/fake-dom.mjs';

// The screens build their parts when they load, so the page has to be there first.
const dom = installDom();
const repo = await import('../app/js/data/repo.js');
const { clearAll } = await import('../app/js/data/db.js');
const { route } = await import('../app/js/ui/router.js');
const { h } = await import('../app/js/ui/dom.js');
const { newDraft, readInto } = await import('../app/js/ui/docs.js');
const { editScreen, folderForm } = await import('../app/js/ui/screens/folder-edit.js');
await import('../app/js/ai/mock.js'); // loaded before a read asks for it

// Where a saved form goes next.
route('/klasor/:id', () => h('div', { class: 'folder-screen' }));
// The sample answers instead of Claude, as in the app without an API key.
globalThis.localStorage = { getItem: (key) => (key === 'avMockAI' ? '1' : null) };

after(() => {
  delete globalThis.localStorage;
  dom.uninstall();
});
beforeEach(async () => {
  await clearAll();
  mock.timers.enable({ apis: ['setTimeout'] }); // toasts and sheets wait seconds before they go
});
afterEach(() => mock.timers.reset());

const ctx = () => ({ leave: [], onLeave(fn) { this.leave.push(fn); } });
const fieldIn = (root, label) => root.querySelectorAll('label.field').find((l) => l.querySelector('span').textContent === label).querySelector('input');

async function openEdit(folder) {
  const form = await editScreen({ id: folder.id }, ctx());
  dom.document.getElementById('screen').replaceChildren(form);
  await settle();
  return form;
}

async function openForm(draft) {
  const form = folderForm(draft, ctx());
  dom.document.getElementById('screen').replaceChildren(form);
  await settle();
  return form;
}

// A photo read by the sample answers (they come after 900 ms).
async function read(draft, kind) {
  const done = readInto(draft, kind, [new Blob(['x'], { type: 'image/jpeg' })]);
  for (let i = 0; i < 20 && draft.reads[kind].state === 'reading'; i++) {
    await settle();
    mock.timers.tick(1000);
  }
  await done;
  assert.equal(draft.reads[kind].state, 'done', draft.reads[kind].message);
}

test('folder form: the accident report phones are shown, cleaned and saved like the customer phone', async () => {
  const f = await repo.saveFolder({ name: 'Ali Veli', plate: '34 NMA 887', phone: '05324182790', tutanak: { aAdSoyad: 'Ali Veli', aTel: '05053776420' } });
  const form = await openEdit(f);
  const [a, b] = form.querySelectorAll('details[data-kind="tutanak"]');
  assert.equal(fieldIn(a, 'Telefon').value, '0505 377 64 20', 'shown spaced, like the customer phone');
  const bTel = fieldIn(b, 'Telefon');
  type(bTel, '+90 532 418 27 90', { leave: true });
  assert.equal(bTel.value, '0532 418 27 90', 'cleaned when leaving the field');
  await Promise.all(byText(form, 'button', 'Kaydet').click());
  await settle();
  const saved = await repo.getFolder(f.id);
  assert.deepEqual(saved.tutanak, { aAdSoyad: 'Ali Veli', aTel: '05053776420', bTel: '05324182790' });
  assert.equal(saved.phone, '05324182790');
});

test('folder form: phones read off an accident report are shown spaced and saved as digits', async () => {
  const f = await repo.saveFolder({ name: 'Ali Veli', plate: '34 NMA 887' });
  const draft = newDraft(await repo.getFolder(f.id), 'edit');
  const form = await openForm(draft);
  await read(draft, 'tutanak');
  const [a, b] = form.querySelectorAll('details[data-kind="tutanak"]');
  assert.equal(fieldIn(a, 'Telefon').value, '0532 418 27 90');
  assert.equal(fieldIn(b, 'Telefon').value, '0505 377 64 20');
  await Promise.all(byText(form, 'button', 'Kaydet').click());
  await settle();
  const saved = await repo.getFolder(f.id);
  assert.equal(saved.tutanak.aTel, '05324182790');
  assert.equal(saved.tutanak.bTel, '05053776420');
});
