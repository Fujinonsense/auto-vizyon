// Shared by the new-car flow and the edit screen: document photos and AI reads into a draft.
import { getSettings, getFolder } from '../data/repo.js';
import { readDocument } from '../ai/claude.js';
import { KINDS } from '../ai/schemas.js';
import { mergeAi, replaceAi } from '../lib/merge-ai.js';
import { cleanPhone } from '../lib/format.js';
import { normalizePlate } from '../lib/validate.js';
import { openCamera } from '../media/camera.js';
import { prepareImage } from '../media/image.js';

// The camera guide: the ruhsat gets the wide one, the accident report (an upright A4 page) the page one,
// licences and ID cards the card-sized one.
const FRAMES = new Map([['ruhsat', 'doc'], ['tutanak', 'page']]);
// Both drivers' boxes are only in the photo when the whole report is; the others may need their back too.
const HINTS = new Map([['tutanak', 'Tutanağın tamamını çerçeveye al']]);
// The accident report is one reading of one accident: a new photo replaces the last reading. The other
// documents fill in and correct what was read before.
const REPLACED = new Set(['tutanak']);
const REPORT = 'tutanak.';

// draft.folder is edited in place; draft.notify(kind) is called whenever a read starts or ends.
// No empty tutanak here on purpose: an accident belongs to one visit, so a new visit of a car that came
// before starts without the old report (it is never copied) yet only replaces it once one is read or typed.
export function newDraft(folder = {}, mode = 'new') {
  return {
    mode,
    folder: { ruhsat: {}, ehliyet: {}, kimlik: {}, aiFilled: [], unclear: [], ...structuredClone(folder) },
    photos: [],
    reads: {},
    pending: new Set(),
    notify: null,
    targetId: mode === 'edit' ? folder.id : null,
  };
}

export function readInto(draft, kind, blobs) {
  draft.reads[kind] = { state: 'reading', blobs };
  draft.notify?.(kind);
  const p = (async () => {
    try {
      const s = await getSettings();
      const r = await readDocument(kind, blobs, { apiKey: s.apiKey });
      const changed = (REPLACED.has(kind) ? replaceAi : mergeAi)(draft.folder, kind, r.fields, r.unclear);
      draft.reads[kind] = { state: 'done', count: Object.values(r.fields).filter(Boolean).length, changed, blobs };
    } catch (e) {
      draft.reads[kind] = { state: 'error', code: e.code, message: e.message, blobs };
    }
    draft.pending.delete(p);
    draft.notify?.(kind);
  })();
  draft.pending.add(p);
  return p;
}

// What the form saves: name and plate cleaned, the customer's and the accident report's two phones as
// digits with the leading 0 when each is one number and as typed when not (see cleanPhone), into the
// draft's own folder or a new one. The draft on screen stays as typed.
export async function folderToSave(draft) {
  const f = draft.folder;
  const data = { ...f, name: (f.name || '').trim(), phone: cleanPhone(f.phone), plate: f.plate ? normalizePlate(f.plate) : '' };
  if (f.tutanak) {
    data.tutanak = { ...f.tutanak };
    for (const key of ['aTel', 'bTel']) if (data.tutanak[key]) data.tutanak[key] = cleanPhone(data.tutanak[key]);
  }
  if (!draft.targetId) {
    delete data.id;
    return data;
  }
  data.id = draft.targetId;
  // A new visit saved into the folder of a car that came before: when it read or typed no accident report
  // of its own (a field typed and erased again is none), the folder keeps the one it has (a report is
  // never copied into a new folder), and the report keeps its AI marks with it, so a report read later
  // replaces it. Marks of the visit's own empty reading go: they belong to no report.
  const ownReport = Object.values(f.tutanak || {}).some((v) => String(v ?? '').trim() !== '');
  if (draft.mode !== 'new' || ownReport) return data;
  delete data.tutanak;
  const earlier = await getFolder(draft.targetId);
  const merged = (mine, theirs) => [...new Set([
    ...(mine || []).filter((p) => !p.startsWith(REPORT)), ...(theirs || []).filter((p) => p.startsWith(REPORT))])];
  data.aiFilled = merged(data.aiFilled, earlier?.aiFilled);
  data.unclear = merged(data.unclear, earlier?.unclear);
  return data;
}

// Front side first; "Oku" after one or two shots (some documents need the back too).
export function docCameraOptions(kind) {
  return {
    title: `${KINDS[kind].label} fotoğrafı`,
    hint: HINTS.get(kind) || 'Gerekirse arka yüzünü de çek',
    multi: true,
    doneText: 'Oku',
    frame: FRAMES.get(kind) || 'card',
  };
}

export async function captureDocPhotos(kind) {
  const res = await openCamera(docCameraOptions(kind));
  if (!res?.photos.length) return null;
  return Promise.all(res.photos.map(prepareImage));
}
