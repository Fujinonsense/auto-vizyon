// Keeps the phone and the Google sheet (plus Drive photos) in step through google/Code.gs.
// Push the outbox first, then pull rows changed in the sheet.
import {
  getSettings, setSetting, peekOutbox, ackOutbox, outboxIds, getFolder, getJob, getPhoto, applyRemote,
  markPhotoUploaded, setFolderDrive, allRecords, onChange,
} from '../data/repo.js';
import { jobToRow, folderToRow, rowToJob, rowToFolder } from '../excel/columns.js';
import { folderTitle } from '../lib/format.js';
import { blobToBase64 } from '../media/image.js';
import { mergeRemote } from './merge.js';

export const syncStatus = { state: 'off', lastSync: 0, error: '' };
const listeners = new Set();

export function onSyncStatus(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setStatus(state, error = '') {
  Object.assign(syncStatus, { state, error });
  if (state === 'ok') syncStatus.lastSync = Date.now();
  listeners.forEach((cb) => cb(syncStatus));
}

// text/plain keeps the request "simple" so the browser sends no CORS preflight to Apps Script.
async function call({ scriptUrl, token }, body) {
  let res;
  try {
    res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, ...body }),
    });
  } catch {
    throw new Error('Google adresine ulaşılamadı. İnterneti ve adresi kontrol et.');
  }
  if (!res.ok) throw new Error(`Google cevap vermedi (${res.status})`);
  let data;
  try {
    data = await res.json();
  } catch {
    // Google answers with a sign-in page when the deployment isn't open to "Herkes".
    throw new Error('Google adresi yanlış ya da dağıtımda erişim "Herkes" seçilmemiş.');
  }
  if (!data.ok) throw new Error(data.error === 'token' ? 'Google anahtarı yanlış' : `Google hatası: ${data.error}`);
  return data;
}

async function toOp(entry) {
  switch (entry.kind) {
    case 'folder': {
      const f = await getFolder(entry.id);
      return f && { op: 'upsertFolder', title: folderTitle(f), row: folderToRow(f) };
    }
    case 'job': {
      const j = await getJob(entry.id);
      return j && { op: 'upsertJob', row: jobToRow(j, (await getFolder(j.folderId)) || {}) };
    }
    case 'photo': {
      const p = await getPhoto(entry.id);
      const f = p && !p.driveFileId && (await getFolder(p.folderId));
      return f && { op: 'photo', folderId: f.id, title: folderTitle(f), kind: p.kind, photoId: p.id, base64: await blobToBase64(p.blob) };
    }
    case 'delFolder': return { op: 'deleteFolder', id: entry.id };
    case 'delJob': return { op: 'deleteJob', id: entry.id };
    default: return null;
  }
}

// At most one photo per request (Apps Script request size); repeated saves of one record go once.
async function push(settings) {
  for (;;) {
    const batch = await peekOutbox(25);
    if (!batch.length) return;
    const ops = [];
    const seqs = [];
    const seen = new Set();
    for (const entry of batch) {
      seqs.push(entry.seq);
      const key = `${entry.kind}:${entry.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const op = await toOp(entry);
      if (op) ops.push(op);
      if (op?.op === 'photo') break;
    }
    if (ops.length) {
      const res = await call(settings, { ops });
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const r = res.results?.[i] || {};
        if (!r.ok) console.warn('Google kaydı atladı', op.op, r.error);
        if (op.op === 'photo' && r.driveFileId) await markPhotoUploaded(op.photoId, r.driveFileId);
        if (r.driveUrl) await setFolderDrive(op.folderId || op.row?.['Klasör No'], r.driveUrl);
      }
    }
    await ackOutbox(seqs);
  }
}

async function pull(settings) {
  const data = await call(settings, { action: 'pull', since: settings.lastPull || 0 });
  const remote = {
    folders: data.folders.map((r) => ({ ...rowToFolder(r), remoteStamp: r['Güncellendi'] })),
    jobs: data.jobs.map((r) => ({ ...rowToJob(r), remoteStamp: r['Güncellendi'] })),
  };
  const { folders, jobs } = await allRecords();
  const local = { folders: new Map(folders.map((f) => [f.id, f])), jobs: new Map(jobs.map((j) => [j.id, j])) };
  await applyRemote(mergeRemote(local, remote, await outboxIds()));
  // A minute of overlap: rows stamped while this pull was running are read again next time.
  await setSetting('lastPull', Math.max(0, data.serverTime - 60000));
}

let running = null;

export function syncNow() {
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run() {
  const settings = await getSettings();
  if (!settings.scriptUrl || !settings.token) return setStatus('off');
  if (globalThis.navigator?.onLine === false) return setStatus('pending', 'İnternet yok');
  setStatus('syncing');
  try {
    await push(settings);
    await pull(settings);
    setStatus('ok');
  } catch (e) {
    setStatus('error', e.message || 'Eşitlenemedi');
  }
}

export async function testConnection(scriptUrl, token) {
  return (await call({ scriptUrl, token }, { action: 'ping' })).sheetUrl;
}

export function startAutoSync() {
  let timer = null;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 3000);
  };
  onChange((c) => {
    if (c.type === 'remote') return;
    if (c.type === 'settings' && c.key !== 'scriptUrl' && c.key !== 'token') return;
    soon();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow();
}
