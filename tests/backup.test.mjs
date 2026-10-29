import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as repo from '../app/js/data/repo.js';
import { clearAll } from '../app/js/data/db.js';
import { exportBackup, restoreBackup } from '../app/js/data/backup.js';

test('backup keeps folders, jobs and safe settings, never the API key', async () => {
  await clearAll();
  const f = await repo.saveFolder({ name: 'Uğurcan Kaya', plate: '34 NMA 887', ruhsat: { sahibi: 'Uğurcan Kaya' } });
  await repo.addPhoto({ folderId: f.id, kind: 'arac', blob: new Blob(['x']), thumb: new Blob(['t']) });
  await repo.saveJob({ folderId: f.id, amount: 5000 });
  await repo.setSetting('apiKey', 'sk-secret');
  await repo.setSetting('vatRate', 18);
  const data = await exportBackup();
  assert.equal(data.app, 'auto-vizyon');
  assert.equal(data.folders.length, 1);
  assert.equal(data.folders[0].coverThumb, undefined);
  assert.equal(data.jobs[0].total, 6000);
  assert.equal(data.settings.apiKey, undefined);
  assert.equal(data.settings.vatRate, 18);
  assert.doesNotThrow(() => JSON.stringify(data));

  await clearAll();
  const r = await restoreBackup(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(r, { folders: 1, jobs: 1 });
  const back = await repo.getFolder(f.id);
  assert.equal(back.ruhsat.sahibi, 'Uğurcan Kaya');
  assert.equal((await repo.jobsForFolder(f.id))[0].total, 6000);
  assert.equal((await repo.getSettings()).vatRate, 18);
});

test('restoreBackup rejects a file that is not an Auto Vizyon backup', async () => {
  await assert.rejects(restoreBackup({ hello: 1 }));
});
