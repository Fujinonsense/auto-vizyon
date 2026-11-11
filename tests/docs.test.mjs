import 'fake-indexeddb/auto';
import { test, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, folderToSave } from '../app/js/ui/docs.js';
import { clearAll } from '../app/js/data/db.js';
import { useSampleAi, readSample as read } from './helpers/sample-ai.mjs';

after(useSampleAi());
beforeEach(async () => { await clearAll(); mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => mock.timers.reset());

test('folderToSave cleans customer name, phone and plate without changing legacy fields or marks', async () => {
  const legacy = { tutanak: { aTel: '0505 377 64 20' }, aiFilled: ['tutanak.aTel'], unclear: ['tutanak.bTc'] };
  const d = newDraft({ id: 'f1', name: ' Ali Veli ', phone: '+90 532 418 27 90', plate: '34nma887', ...legacy }, 'edit');
  const data = await folderToSave(d);
  assert.equal(data.id, 'f1');
  assert.equal(data.name, 'Ali Veli');
  assert.equal(data.phone, '05324182790');
  assert.equal(data.plate, '34 NMA 887');
  for (const key of Object.keys(legacy)) assert.deepEqual(data[key], legacy[key]);
  assert.equal(d.folder.phone, '+90 532 418 27 90');
});

test('new folder has no accident report and no id', async () => {
  const data = await folderToSave(newDraft({ name: 'Ali Veli' }));
  assert.equal('tutanak' in data, false);
  assert.equal('id' in data, false);
});

test('the remaining documents read again still only fill in and correct', async () => {
  const d = newDraft({ name: 'Uğurcan Kaya', ruhsat: { sahibi: 'Uğurcan Kaya', tescilTarihi: '01.01.2020' } }, 'edit');
  await read(d, 'ruhsat');
  assert.equal(d.folder.ruhsat.tescilTarihi, '01.01.2020');
  assert.equal(d.folder.ruhsat.belgeSeriNo, 'FA 482913');
});
