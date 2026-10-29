// Folders (customer + car), jobs, photos and settings. Every user change is queued in the
// outbox for Google sync; changes that came from Google (applyRemote) are not.
import { get, put, all, byIndex, keysByIndex, write } from './db.js';
import { newId } from '../lib/uuid.js';
import { plateKey } from '../lib/validate.js';
import { computeVat } from '../lib/vat.js';
import { todayIso } from '../lib/format.js';

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  vatRate: 20,
  vatMode: 'haric',
  scriptUrl: '',
  token: '',
  waTemplate: 'Merhaba {ad}, {plaka} plakalı aracınızın işlemi tamamlandı. Auto Vizyon Boyasız Hasar Onarım',
  lastPull: 0,
};

const COVER_KINDS = new Set(['arac', 'once', 'sonra']);
const listeners = new Set();

export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(change) {
  for (const cb of listeners) {
    try {
      cb(change);
    } catch (e) {
      console.error(e);
    }
  }
}

const queued = (kind, id) => ({ kind, id, at: Date.now() });
const nextStamp = (prev) => Math.max(Date.now(), (prev?.updatedAt || 0) + 1);

export async function saveFolder(partial) {
  const prev = partial.id ? await get('folders', partial.id) : undefined;
  const folder = {
    name: '', phone: '', plate: '', brand: '', model: '', modelFull: '', color: '', modelYear: '',
    vin: '', engineNo: '', note: '', ruhsat: {}, ehliyet: {}, kimlik: {}, unclear: [],
    ...prev,
    ...partial,
    id: partial.id || newId(),
    // Cover and Drive link are managed by addPhoto/setCover and sync, never by a form save.
    coverPhotoId: prev?.coverPhotoId ?? null,
    coverThumb: prev?.coverThumb ?? null,
    driveUrl: prev?.driveUrl ?? '',
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: nextStamp(prev),
  };
  folder.plateKey = plateKey(folder.plate);
  await write(['folders', 'outbox'], (s) => {
    s.folders.put(folder);
    s.outbox.add(queued('folder', folder.id));
  });
  emit({ type: 'folder', id: folder.id });
  return folder;
}

export const getFolder = (id) => get('folders', id);

function sortJobs(js) {
  return js.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

// Summary rows for the list screen, most recently active first.
export async function listFolders() {
  const [folders, jobs] = await Promise.all([all('folders'), all('jobs')]);
  const byFolder = new Map();
  for (const j of jobs) {
    if (!byFolder.has(j.folderId)) byFolder.set(j.folderId, []);
    byFolder.get(j.folderId).push(j);
  }
  return folders
    .map((folder) => {
      const js = sortJobs(byFolder.get(folder.id) || []);
      const last = Math.max(folder.updatedAt || 0, ...js.map((j) => j.updatedAt || 0));
      return { folder, jobs: js, cover: folder.coverThumb || null, last };
    })
    .sort((a, b) => b.last - a.last);
}

export async function findFolderByPlate(plate) {
  const key = plateKey(plate);
  if (!key) return null;
  const matches = (await all('folders')).filter((f) => f.plateKey === key);
  return matches.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

export async function deleteFolder(id) {
  const [jobKeys, photoKeys] = await Promise.all([
    keysByIndex('jobs', 'folderId', id),
    keysByIndex('photos', 'folderId', id),
  ]);
  await write(['folders', 'jobs', 'photos', 'outbox'], (s) => {
    s.folders.delete(id);
    jobKeys.forEach((k) => s.jobs.delete(k));
    photoKeys.forEach((k) => s.photos.delete(k));
    s.outbox.add(queued('delFolder', id));
  });
  emit({ type: 'folder', id, deleted: true });
}

export async function saveJob(partial) {
  const prev = partial.id ? await get('jobs', partial.id) : undefined;
  const folderId = partial.folderId || prev?.folderId;
  if (!folderId) throw new Error('İş bir klasöre bağlı olmalı');
  const defaults = prev ? {} : await getSettings();
  const job = {
    date: todayIso(), description: '', parts: [], amount: 0,
    vatMode: defaults.vatMode, vatRate: defaults.vatRate,
    paid: false, payer: 'musteri', insurer: '', claimNo: '', note: '',
    ...prev,
    ...partial,
    id: partial.id || newId(),
    folderId,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: nextStamp(prev),
  };
  Object.assign(job, computeVat({ amount: job.amount, mode: job.vatMode, rate: job.vatRate }));
  await write(['jobs', 'outbox'], (s) => {
    s.jobs.put(job);
    s.outbox.add(queued('job', job.id));
  });
  emit({ type: 'job', id: job.id, folderId });
  return job;
}

export async function deleteJob(id) {
  const job = await get('jobs', id);
  await write(['jobs', 'outbox'], (s) => {
    s.jobs.delete(id);
    s.outbox.add(queued('delJob', id));
  });
  emit({ type: 'job', id, folderId: job?.folderId, deleted: true });
}

export const getJob = (id) => get('jobs', id);

export async function allRecords() {
  const [folders, jobs] = await Promise.all([all('folders'), all('jobs')]);
  return { folders, jobs };
}

// Sync bookkeeping: never queued, never bumps updatedAt.
export async function markPhotoUploaded(id, driveFileId) {
  await write(['photos'], (s) => {
    s.photos.get(id).onsuccess = (e) => {
      const p = e.target.result;
      if (p) s.photos.put({ ...p, driveFileId });
    };
  });
}

export async function setFolderDrive(id, driveUrl) {
  if (!id || !driveUrl) return;
  await write(['folders'], (s) => {
    s.folders.get(id).onsuccess = (e) => {
      const f = e.target.result;
      if (f && f.driveUrl !== driveUrl) s.folders.put({ ...f, driveUrl });
    };
  });
  emit({ type: 'remote' });
}

export async function jobsForFolder(folderId) {
  return sortJobs(await byIndex('jobs', 'folderId', folderId));
}

// The first car / damage photo becomes the cover; documents never do.
export async function addPhoto({ folderId, kind, blob, thumb, jobId = null }) {
  const photo = { id: newId(), folderId, jobId, kind, blob, thumb, createdAt: Date.now(), driveFileId: null };
  await write(['photos', 'folders', 'outbox'], (s) => {
    s.photos.put(photo);
    s.outbox.add(queued('photo', photo.id));
    s.folders.get(folderId).onsuccess = (e) => {
      const folder = e.target.result;
      if (folder && !folder.coverPhotoId && COVER_KINDS.has(kind)) {
        s.folders.put({ ...folder, coverPhotoId: photo.id, coverThumb: thumb });
      }
    };
  });
  emit({ type: 'photo', id: photo.id, folderId });
  return photo;
}

export async function listPhotos(folderId) {
  return (await byIndex('photos', 'folderId', folderId)).sort((a, b) => a.createdAt - b.createdAt);
}

export const getPhoto = (id) => get('photos', id);

// Removes the photo from the phone only; a copy already in Drive stays there.
export async function deletePhoto(id) {
  const photo = await get('photos', id);
  if (!photo) return;
  const next = (await listPhotos(photo.folderId)).find((p) => p.id !== id && COVER_KINDS.has(p.kind));
  await write(['photos', 'folders'], (s) => {
    s.photos.delete(id);
    s.folders.get(photo.folderId).onsuccess = (e) => {
      const folder = e.target.result;
      if (folder && folder.coverPhotoId === id) {
        s.folders.put({ ...folder, coverPhotoId: next?.id ?? null, coverThumb: next?.thumb ?? null });
      }
    };
  });
  emit({ type: 'photo', id, folderId: photo.folderId, deleted: true });
}

export async function setCover(folderId, photoId) {
  const photo = await get('photos', photoId);
  if (!photo) return;
  await write(['folders'], (s) => {
    s.folders.get(folderId).onsuccess = (e) => {
      const folder = e.target.result;
      if (folder) s.folders.put({ ...folder, coverPhotoId: photo.id, coverThumb: photo.thumb });
    };
  });
  emit({ type: 'folder', id: folderId });
}

export async function getSettings() {
  const rows = await all('settings');
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export async function setSetting(key, value) {
  await put('settings', { key, value });
  emit({ type: 'settings', key });
}

export const peekOutbox = (limit = 50) => all('outbox', limit);

export async function ackOutbox(seqs) {
  if (!seqs.length) return;
  await write(['outbox'], (s) => seqs.forEach((seq) => s.outbox.delete(seq)));
}

export async function outboxIds() {
  return new Set((await all('outbox')).map((e) => e.id));
}

// Rows that came from the Google sheet: written as-is, never queued back, local-only
// fields (cover, document objects) kept.
export async function applyRemote({ folders = [], jobs = [] }) {
  if (!folders.length && !jobs.length) return;
  await write(['folders', 'jobs'], (s) => {
    for (const f of folders) {
      s.folders.get(f.id).onsuccess = (e) => {
        const merged = {
          ruhsat: {}, ehliyet: {}, kimlik: {}, unclear: [], coverPhotoId: null, coverThumb: null,
          ...e.target.result,
          ...f,
        };
        merged.plateKey = plateKey(merged.plate);
        s.folders.put(merged);
      };
    }
    for (const j of jobs) {
      s.jobs.get(j.id).onsuccess = (e) => s.jobs.put({ parts: [], ...e.target.result, ...j });
    }
  });
  emit({ type: 'remote' });
}
