// Keeps the phone and the Google sheet (plus Drive photos) in step through google/Code.gs.
// Push the outbox first, then pull rows changed in the sheet, then retry writes the sheet turned down.
import {
  getSettings, setSetting, readOutbox, ackOutbox, settleOutbox, getFolder, getJob, getPhoto, applyRemote,
  markPhotoUploaded, setFolderDrive, allRecords, onChange,
} from '../data/repo.js';
import { jobToRow, folderToRow, rowToJob, rowToFolder } from '../excel/columns.js';
import { folderTitle } from '../lib/format.js';
import { blobToBase64 } from '../media/image.js';
import { mergeRemote } from './merge.js';

export const syncStatus = { state: 'off', lastSync: 0, error: '' };

// A write the sheet turns down (Drive full, a script error on one row) stays queued and is tried
// again after 30 seconds, then twice as long each time, at most an hour apart. After a few failures
// the sync status says so, in place of "Google ile eşit".
const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
const STUCK_AFTER = 3;
export const STUCK_MESSAGE = 'Bazı değişiklikler Google tablosuna yazılamadı. Google Drive\'da yer kalmamış olabilir, kontrol et.';
const retryDelay = (tries) => Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (tries - 1));
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

// The op that sends a queued record as the phone holds it now, with the record's version (updatedAt);
// null when nothing is left to send (deleted on the phone, photo already in Drive). Queue entries
// only name the record, so a retry never sends anything older than the latest save.
async function toOp(entry) {
  switch (entry.kind) {
    case 'folder': {
      const f = await getFolder(entry.id);
      return f && { op: { op: 'upsertFolder', title: folderTitle(f), row: folderToRow(f) }, version: f.updatedAt };
    }
    case 'job': {
      const j = await getJob(entry.id);
      return j && { op: { op: 'upsertJob', row: jobToRow(j, (await getFolder(j.folderId)) || {}) }, version: j.updatedAt };
    }
    case 'photo': {
      const p = await getPhoto(entry.id);
      const f = p && !p.driveFileId && (await getFolder(p.folderId));
      return f && { op: { op: 'photo', folderId: f.id, title: folderTitle(f), kind: p.kind, photoId: p.id, base64: await blobToBase64(p.blob) } };
    }
    case 'delFolder': return { op: { op: 'deleteFolder', id: entry.id } };
    case 'delJob': return { op: { op: 'deleteJob', id: entry.id } };
    default: return null;
  }
}

// Whether a queued record still has something to send, without reading a photo's bytes.
async function stillQueued(entry) {
  switch (entry.kind) {
    case 'folder': return Boolean(await getFolder(entry.id));
    case 'job': return Boolean(await getJob(entry.id));
    case 'photo': {
      const p = await getPhoto(entry.id);
      return Boolean(p && !p.driveFileId && (await getFolder(p.folderId)));
    }
    default: return entry.kind === 'delFolder' || entry.kind === 'delJob';
  }
}

// Queue entries per record, oldest first. A record whose write failed keeps one entry, its oldest,
// with the try count; saves after that add entries of their own.
function byRecord(box) {
  const groups = new Map();
  for (const e of box) {
    const key = `${e.kind}:${e.id}`;
    if (groups.has(key)) groups.get(key).push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

// Sends queued records, one op per record and at most one photo per request (Apps Script request
// size). The first pass sends records with a save that has not been tried; the retry pass (after the
// pull) sends records whose earlier tries the sheet turned down, once their wait is over, or all of
// them when everything is due. A record that fails is not tried again in the same sync (failed).
async function push(settings, { retry, failed, everythingDue = false }) {
  for (;;) {
    const now = Date.now();
    const work = [];
    for (const [key, entries] of byRecord(await readOutbox())) {
      const untried = entries.some((e) => !e.tries);
      if (failed.has(key) || (retry ? untried : !untried)) continue;
      // Waiting for its next try, unless the record is gone: then the entry just goes.
      if (retry && !everythingDue && entries.every((e) => e.retryAt > now) && (await stillQueued(entries[0]))) continue;
      work.push({ key, entries });
    }
    const ops = [];
    const sent = [];
    const gone = [];
    for (const w of work) {
      if (ops.length >= 25) break;
      const built = await toOp(w.entries[w.entries.length - 1]);
      if (!built) {
        gone.push(...w.entries.map((e) => e.seq));
        continue;
      }
      ops.push(built.op);
      sent.push({ ...w, version: built.version });
      if (built.op.op === 'photo') break;
    }
    await ackOutbox(gone);
    if (!ops.length) {
      if (gone.length) continue;
      return;
    }

    const res = await call(settings, { ops });
    const done = [];
    const kept = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const { key, entries, version } = sent[i];
      const r = res.results?.[i] || {};
      if (r.ok) {
        // Every entry read before the op was built is in it, the ones still waiting for a retry too.
        done.push(...entries.map((e) => e.seq));
        if (op.op === 'photo' && r.driveFileId) await markPhotoUploaded(op.photoId, r.driveFileId);
      } else {
        console.warn('Google kaydı yazamadı, sonra yeniden denenecek', op.op, r.error);
        failed.add(key);
        const [first, ...rest] = entries;
        const tries = (first.tries || 0) + 1;
        kept.push({
          ...first,
          tries,
          retryAt: Date.now() + retryDelay(tries),
          error: String(r.error || 'cevap yok'),
          // The sheet's clock when this version of the record was first tried: a change made in
          // the sheet after it is newer than the phone's (see pull).
          sentAt: first.tries && first.version === version ? first.sentAt : res.serverTime || Date.now(),
          version,
        });
        done.push(...rest.map((e) => e.seq));
      }
      if (r.driveUrl) await setFolderDrive(op.folderId || op.row?.['Klasör No'], r.driveUrl);
    }
    await settleOutbox(done, kept);
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
  const box = await readOutbox();
  const queued = new Map();
  for (const e of box) queued.set(e.id, [...(queued.get(e.id) || []), e]);
  // Rows the phone has not sent yet win, except a save the sheet turned down and that is only
  // waiting for its retry: a change made in the sheet after that save was tried is newer, so the
  // sheet's row comes to the phone and the waiting save goes.
  const newer = new Set([...remote.folders, ...remote.jobs]
    .filter((r) => queued.get(r.id)?.every((e) => e.tries && (e.kind === 'folder' || e.kind === 'job') && r.remoteStamp > e.sentAt))
    .map((r) => r.id));
  const pending = new Set([...queued.keys()].filter((id) => !newer.has(id)));
  await applyRemote(mergeRemote(local, remote, pending));
  await ackOutbox(box.filter((e) => newer.has(e.id)).map((e) => e.seq));
  // A minute of overlap: rows stamped while this pull was running are read again next time.
  await setSetting('lastPull', Math.max(0, data.serverTime - 60000));
}

let running = null;
let retryAllNext = false;

// retryNow: also retry the writes that are still waiting for their next try (the "Şimdi eşitle"
// button, after Drive space was freed); a sync already running does that in its retry pass.
export function syncNow({ retryNow = false } = {}) {
  if (retryNow) retryAllNext = true;
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run() {
  const settings = await getSettings();
  if (!settings.scriptUrl || !settings.token) return setStatus('off');
  if (globalThis.navigator?.onLine === false) return setStatus('pending', 'İnternet yok');
  setStatus('syncing');
  try {
    const failed = new Set();
    await push(settings, { retry: false, failed });
    await pull(settings);
    const everythingDue = retryAllNext;
    retryAllNext = false;
    await push(settings, { retry: true, failed, everythingDue });
    const stuck = (await readOutbox()).some((e) => e.tries >= STUCK_AFTER);
    setStatus(stuck ? 'error' : 'ok', stuck ? STUCK_MESSAGE : '');
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
    timer = setTimeout(() => syncNow(), 3000);
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
