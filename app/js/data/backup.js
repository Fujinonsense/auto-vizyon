// Data-only backup file (photos live in Google Drive). Keys and links are never written to it.
import { all } from './db.js';
import { getSettings, setSetting, applyRemote } from './repo.js';

const PRIVATE = new Set(['apiKey', 'token', 'scriptUrl', 'lastPull']);

export async function exportBackup() {
  const [folders, jobs, settings] = await Promise.all([all('folders'), all('jobs'), getSettings()]);
  return {
    app: 'auto-vizyon',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: folders.map(({ coverThumb, coverPhotoId, ...f }) => f),
    jobs,
    settings: Object.fromEntries(Object.entries(settings).filter(([k]) => !PRIVATE.has(k))),
  };
}

export async function restoreBackup(data) {
  if (data?.app !== 'auto-vizyon' || !Array.isArray(data.folders) || !Array.isArray(data.jobs)) {
    throw new Error('Bu dosya bir Auto Vizyon yedeği değil');
  }
  await applyRemote({ folders: data.folders, jobs: data.jobs });
  for (const [key, value] of Object.entries(data.settings || {})) {
    if (!PRIVATE.has(key)) await setSetting(key, value);
  }
  return { folders: data.folders.length, jobs: data.jobs.length };
}
