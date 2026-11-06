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
const { newDraft, readInto, folderToSave } = await import('../app/js/ui/docs.js');
const { mergeAi } = await import('../app/js/lib/merge-ai.js');
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

const toastText = () => dom.document.getElementById('toast')?.textContent ?? '';

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

test('same plate: a new visit keeps the earlier accident report with its AI marks, so reading it again replaces it', async () => {
  const first = newDraft();
  mergeAi(first.folder, 'arac', { plaka: '34 NMA 887', renk: 'Siyah', marka: 'Audi', model: 'A7' }, []);
  mergeAi(first.folder, 'tutanak', { aAdSoyad: 'Uğurcan Kaya', bAdSoyad: 'Mehmet Yılmaz', bAdres: 'Alsancak Mah. İzmir' }, []);
  const v1 = await repo.saveFolder(await folderToSave(first));

  // The next visit in the new-car flow: the plate is typed, the car is found, Kaydet with no report.
  const visit = await openForm(newDraft());
  type(fieldIn(visit, 'Plaka'), '34nma887', { leave: true });
  await settle();
  assert.equal(visit.querySelector('.banner').hidden, false, '"Bu araç daha önce gelmiş"');
  await Promise.all(byText(visit, 'button', 'Kaydet').click());
  await settle();
  const v2 = await repo.getFolder(v1.id);
  assert.equal((await repo.allRecords()).folders.length, 1, 'saved into the same folder');
  assert.equal(v2.tutanak.bAdSoyad, 'Mehmet Yılmaz');
  assert.ok(v2.aiFilled.includes('tutanak.bAdres'), 'the earlier reading is still known as one');

  // Later, from "Bilgileri düzenle", the report is photographed again.
  const draft = newDraft(v2, 'edit');
  const edit = await openForm(draft);
  await read(draft, 'tutanak');
  const [a, b] = edit.querySelectorAll('details[data-kind="tutanak"]');
  assert.equal(fieldIn(a, 'Ad Soyad').value, 'Uğurcan Kaya');
  assert.equal(fieldIn(b, 'Ad Soyad').value, 'Ayşe Kara', 'the new driver B, not the old one');
  const address = fieldIn(b, 'Adres');
  assert.equal(address.value, '', 'the old address is gone');
  assert.ok(address.parentNode.classList.contains('unclear'));
  assert.equal(address.parentNode.querySelector('.hint').textContent, 'Yapay zeka okuyamadı, kontrol et');
  await Promise.all(byText(edit, 'button', 'Kaydet').click());
  await settle();
  const v3 = await repo.getFolder(v1.id);
  assert.equal(v3.tutanak.bAdSoyad, 'Ayşe Kara');
  assert.equal('bAdres' in v3.tutanak, false);
  assert.ok(v3.unclear.includes('tutanak.bAdres'));
});
