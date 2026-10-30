// Shared by the new-car flow and the edit screen: document photos and AI reads into a draft.
import { getSettings } from '../data/repo.js';
import { readDocument } from '../ai/claude.js';
import { KINDS } from '../ai/schemas.js';
import { mergeAi } from '../lib/merge-ai.js';
import { openCamera } from '../media/camera.js';
import { prepareImage } from '../media/image.js';

// draft.folder is edited in place; draft.notify(kind) is called whenever a read starts or ends.
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
      const changed = mergeAi(draft.folder, kind, r.fields, r.unclear);
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

// Front side first; "Oku" after one or two shots (some documents need the back too).
export async function captureDocPhotos(kind) {
  const res = await openCamera({
    title: `${KINDS[kind].label} fotoğrafı`,
    hint: 'Gerekirse arka yüzünü de çek',
    multi: true,
    doneText: 'Oku',
    frame: kind === 'ruhsat' ? 'doc' : 'card',
  });
  if (!res?.photos.length) return null;
  return Promise.all(res.photos.map(prepareImage));
}
