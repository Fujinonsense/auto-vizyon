import 'fake-indexeddb/auto';
import { test, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type, byText, settle } from './helpers/fake-dom.mjs';
import { useSampleAi, readSample as read } from './helpers/sample-ai.mjs';

// The screens build their parts when they load, so the page has to be there first.
const dom = installDom();
const repo = await import('../app/js/data/repo.js');
const { clearAll } = await import('../app/js/data/db.js');
const { route } = await import('../app/js/ui/router.js');
const { h } = await import('../app/js/ui/dom.js');
const { newDraft, folderToSave } = await import('../app/js/ui/docs.js');
const { getPath } = await import('../app/js/lib/merge-ai.js');
const { editScreen, folderForm } = await import('../app/js/ui/screens/folder-edit.js');

// Where a saved form goes next.
route('/klasor/:id', () => h('div', { class: 'folder-screen' }));
const sampleAiOff = useSampleAi();

after(() => {
  sampleAiOff();
  dom.uninstall();
});
beforeEach(async () => {
  await clearAll();
  mock.timers.enable({ apis: ['setTimeout'] }); // toasts and sheets wait seconds before they go
});
afterEach(() => mock.timers.reset());

const ctx = () => ({ leave: [], onLeave(fn) { this.leave.push(fn); } });
const toastText = () => dom.document.getElementById('toast')?.textContent ?? '';
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

test('new car: Kaydet with a half-typed cost saves nothing and says why; once fixed the job keeps it', async () => {
  const form = await openForm(newDraft());
  type(fieldIn(form, 'Ad soyad'), 'Ali Veli', { leave: true });
  const box = form.querySelector('.cost-box');
  byText(box, 'button', 'Masraf ekle').click();
  type(box.querySelector('.cost-form input.amount'), '2500');
  await Promise.all(byText(form, 'button', 'Kaydet').click());
  await settle();
  assert.deepEqual((await repo.allRecords()).folders, [], 'nothing saved, not even the folder');
  assert.equal(toastText(), 'Masrafın türünü seç');
  assert.equal(box.querySelector('.cost-hint').textContent, 'Masrafın türünü seç');
  assert.equal(dom.document.activeElement, box.querySelector('.cost-cats .chip'));

  box.querySelector('.chip[data-key="nakliye"]').click();
  await Promise.all(byText(form, 'button', 'Kaydet').click());
  await settle();
  const { folders, jobs } = await repo.allRecords();
  assert.equal(folders.length, 1);
  assert.deepEqual(jobs.map((j) => j.costs), [[{ cat: 'nakliye', label: '', amount: 2500 }]]);
  assert.equal(toastText(), 'Kaydedildi');
});

test('new car without a job: saves as before, no job made up', async () => {
  const form = await openForm(newDraft());
  type(fieldIn(form, 'Ad soyad'), 'Ali Veli', { leave: true });
  byText(form.querySelector('.cost-box'), 'button', 'Masraf ekle').click(); // opened and left empty
  await Promise.all(byText(form, 'button', 'Kaydet').click());
  await settle();
  const { folders, jobs } = await repo.allRecords();
  assert.deepEqual([folders.length, jobs.length], [1, 0]);
});


test('legacy folder renders and saves without accident report sections or warnings; its photo stays under Belgeler', async () => {
  const legacy = { tutanak: { aAdSoyad: 'Secret driver', aTel: '0505 377 64 20' }, aiFilled: ['tutanak.aAdSoyad'], unclear: ['tutanak.bTc'] };
  const f = await repo.saveFolder({ name: 'Ali Veli', plate: '34 NMA 887', ...legacy });
  await repo.addPhoto({ folderId: f.id, kind: 'tutanak', blob: new Blob(['photo']), thumb: new Blob(['thumb']) });
  const { folderView } = await import('../app/js/ui/screens/folder-view.js');
  const context = ctx();
  const view = await folderView({ id: f.id }, context);
  assert.ok(!/Tutanak|tutanak|Secret driver|kontrol et/.test(view.textContent));
  assert.equal(view.querySelector('.copyrow.unclear'), null);
  const docs = view.querySelectorAll('.pgroup').find((g) => g.querySelector('span').textContent === 'Belgeler');
  assert.equal(docs.querySelectorAll('.pthumb').length, 1);
  context.leave.forEach((fn) => fn());
  const form = await editScreen({ id: f.id, kind: 'tutanak' }, ctx());
  dom.document.getElementById('screen').replaceChildren(form);
  assert.equal(form.querySelectorAll('details[data-kind="tutanak"]').length, 0);
  assert.ok(!/Tutanak|tutanak|Secret driver|kontrol et/.test(form.textContent));
  assert.equal(form.querySelector('.field.unclear'), null);
  await Promise.all(byText(form, 'button', 'Kaydet').click());
  const saved = await repo.getFolder(f.id);
  for (const key of Object.keys(legacy)) assert.deepEqual(saved[key], legacy[key]);
  const { folderToRow } = await import('../app/js/excel/columns.js');
  assert.ok(Object.keys(folderToRow(saved)).every((h) => !h.startsWith('Tutanak')));
});
