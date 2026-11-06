import 'fake-indexeddb/auto';
import { test, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, folderToSave, readInto } from '../app/js/ui/docs.js';
import { mergeAi } from '../app/js/lib/merge-ai.js';
import * as repo from '../app/js/data/repo.js';
import { clearAll } from '../app/js/data/db.js';
import { settle } from './helpers/fake-dom.mjs';
import '../app/js/ai/mock.js'; // loaded before a read asks for it

// The sample answers instead of Claude, as in the app without an API key.
globalThis.localStorage = { getItem: (key) => (key === 'avMockAI' ? '1' : null) };
after(() => { delete globalThis.localStorage; });

beforeEach(async () => {
  await clearAll();
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => mock.timers.reset());

// A photo read by the sample answers (they come after 900 ms). The accident report's sample: driver B is
// Ayşe Kara, 35 KR 7781, her address could not be read.
async function read(draft, kind) {
  const done = readInto(draft, kind, [new Blob(['x'], { type: 'image/jpeg' })]);
  for (let i = 0; i < 20 && draft.reads[kind].state === 'reading'; i++) {
    await settle();
    mock.timers.tick(1000);
  }
  await done;
  assert.equal(draft.reads[kind].state, 'done', draft.reads[kind].message);
}

const car = { plaka: '34 NMA 887', renk: 'Siyah', marka: 'Audi', model: 'A7' };
const report1 = {
  aAdSoyad: 'Uğurcan Kaya', aTc: '10000000146', aTel: '05324182790', aPlaka: '34 NMA 887',
  bAdSoyad: 'Mehmet Yılmaz', bTc: '12345678950', bAlindigiYer: 'Bornova', bAdres: 'Alsancak Mah. İzmir', bTel: '05320000000', bPlaka: '06 ABC 123',
};
// The first visit: the car and its accident report read by the AI, saved as a new folder.
async function firstVisit() {
  const d = newDraft();
  mergeAi(d.folder, 'arac', car, []);
  mergeAi(d.folder, 'tutanak', report1, ['bTc']); // a first reading: nothing to replace
  return repo.saveFolder(await folderToSave(d));
}
// A later visit of the same car in the new-car flow; checkExisting found the folder (or "Ayrı klasör aç").
function nextVisit(targetId) {
  const d = newDraft();
  mergeAi(d.folder, 'arac', car, []);
  d.targetId = targetId;
  return d;
}
const tutanakMarks = (list) => (list || []).filter((p) => p.startsWith('tutanak.')).sort();

test('folderToSave: name, phone and plate cleaned, the accident report phones saved like the customer phone', async () => {
  const d = newDraft({
    name: '  Ali Veli ', phone: '0532 418 27 90', plate: '34nma887',
    tutanak: { aAdSoyad: 'Ali Veli', aTel: '0505 377 64 20', bTel: '+90 505 377 64 20', bAdres: '' },
  });
  const data = await folderToSave(d);
  assert.equal(data.name, 'Ali Veli');
  assert.equal(data.phone, '05324182790');
  assert.equal(data.plate, '34 NMA 887');
  assert.deepEqual(data.tutanak, { aAdSoyad: 'Ali Veli', aTel: '05053776420', bTel: '05053776420', bAdres: '' });
  assert.equal('id' in data, false, 'a new folder');
  assert.equal(d.folder.tutanak.aTel, '0505 377 64 20', 'the draft on screen is left as typed');
});

test('folderToSave: a draft without an accident report saves none (the folder keeps its own)', async () => {
  const data = await folderToSave(newDraft({ name: 'Ali Veli' }));
  assert.equal('tutanak' in data, false);
  assert.equal(data.plate, '');
});

test('folderToSave: an edit goes back into its own folder', async () => {
  const d = newDraft({ id: 'f1', name: 'Ali Veli', tutanak: { bTel: '5053776420' } }, 'edit');
  const data = await folderToSave(d);
  assert.equal(data.id, 'f1');
  assert.equal(data.tutanak.bTel, '05053776420');
});

test('a same-plate save followed by a second accident report read replaces the drivers', async () => {
  const v1 = await firstVisit();
  const v2 = await repo.saveFolder(await folderToSave(nextVisit(v1.id)));
  assert.equal(v2.id, v1.id);
  assert.equal(v2.tutanak.bAdSoyad, 'Mehmet Yılmaz', 'the folder keeps its report');
  assert.deepEqual(tutanakMarks(v2.aiFilled), tutanakMarks(v1.aiFilled), 'with the AI marks it had');
  assert.deepEqual(tutanakMarks(v2.unclear), ['tutanak.bTc']);

  // Later the report is photographed again from "Bilgileri düzenle".
  const edit = newDraft(await repo.getFolder(v1.id), 'edit');
  await read(edit, 'tutanak');
  assert.ok(edit.reads.tutanak.changed.includes('tutanak.bAdSoyad'));
  const v3 = await repo.saveFolder(await folderToSave(edit));
  assert.equal(v3.tutanak.bAdSoyad, 'Ayşe Kara');
  assert.equal(v3.tutanak.bPlaka, '35 KR 7781');
  assert.equal(v3.tutanak.bTel, '05053776420');
  assert.equal(v3.tutanak.bAlindigiYer, 'Konak');
  assert.equal('bAdres' in v3.tutanak, false, 'nothing kept from the earlier report');
  assert.ok(v3.unclear.includes('tutanak.bAdres'), 'the address the AI could not read is marked to check');
  assert.ok(!v3.unclear.includes('tutanak.bTc'));
});

test('a new folder for the same car ("Ayrı klasör aç") never gets the earlier report or its marks', async () => {
  const v1 = await firstVisit();
  const v2 = await repo.saveFolder(await folderToSave(nextVisit(null)));
  assert.notEqual(v2.id, v1.id);
  assert.deepEqual(v2.tutanak, {});
  assert.deepEqual(tutanakMarks(v2.aiFilled), []);
  assert.deepEqual(tutanakMarks(v2.unclear), []);
});

test('a same-plate visit that reads its own accident report replaces the earlier one', async () => {
  const v1 = await firstVisit();
  const d = nextVisit(v1.id);
  await read(d, 'tutanak');
  const v2 = await repo.saveFolder(await folderToSave(d));
  assert.equal(v2.id, v1.id);
  assert.equal(v2.tutanak.bAdSoyad, 'Ayşe Kara');
  assert.equal('bAdres' in v2.tutanak, false);
  assert.deepEqual(tutanakMarks(v2.unclear), ['tutanak.bAdres']);
  assert.ok(!tutanakMarks(v2.aiFilled).includes('tutanak.bAdres'));
});

test('the other documents read again still only fill in and correct', async () => {
  const d = newDraft({ name: 'Uğurcan Kaya', ruhsat: { sahibi: 'Uğurcan Kaya', tescilTarihi: '01.01.2020' } }, 'edit');
  await read(d, 'ruhsat');
  assert.equal(d.folder.ruhsat.tescilTarihi, '01.01.2020', 'typed by hand, kept');
  assert.equal(d.folder.ruhsat.belgeSeriNo, 'FA 482913');
});
