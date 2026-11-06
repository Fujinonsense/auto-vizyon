import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, folderToSave } from '../app/js/ui/docs.js';
import { clearAll } from '../app/js/data/db.js';

beforeEach(async () => {
  await clearAll();
});

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
