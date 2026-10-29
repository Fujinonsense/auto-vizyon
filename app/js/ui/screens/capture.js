// New car: car photo (plate read in the background) → damage photos → customer screen.
import { findFolderByPlate } from '../../data/repo.js';
import { h, icon, spinner, toast } from '../dom.js';
import { plateChip } from '../parts.js';
import { setTopbar, setTab } from '../chrome.js';
import { back } from '../router.js';
import { openCamera } from '../../media/camera.js';
import { prepareImage } from '../../media/image.js';
import { newDraft, readInto } from '../docs.js';
import { folderForm } from './folder-edit.js';

const SHORT = {
  'no-key': 'Yapay zeka anahtarı yok, plakayı sonra yazarsın',
  offline: 'İnternet yok, plakayı sonra yazarsın',
};

// Live chip in the damage camera: reading → plate (and whether the car came before).
function plateStatus(draft, api) {
  draft.notify = async () => {
    const st = draft.reads.arac;
    if (!st) return api.setStatus(null);
    if (st.state === 'reading') return api.setStatus(h('span', { class: 'cam-chip' }, spinner(18), 'Plaka okunuyor…'));
    if (st.state === 'error') {
      return api.setStatus(h('span', { class: 'cam-chip warn' }, icon('alert-triangle', 18), SHORT[st.code] || 'Plaka okunamadı, sonra yazarsın'));
    }
    const plate = draft.folder.plate;
    if (!plate) return api.setStatus(h('span', { class: 'cam-chip warn' }, 'Plaka görünmedi, sonra yazarsın'));
    const ex = await findFolderByPlate(plate);
    api.setStatus(h('span', { class: 'cam-chip ok' }, ex ? `Kayıtlı: ${ex.name || 'eski müşteri'}` : 'Plaka okundu', plateChip(plate)));
  };
  draft.notify();
}

export function captureScreen(params, ctx) {
  setTopbar({ title: 'Yeni araç' });
  setTab('new');
  const draft = newDraft();
  const stage = h('div', { class: 'stage' }, spinner(28));
  let left = false;
  ctx.onLeave(() => { left = true; });

  run().catch((e) => {
    console.error(e);
    toast('Bir sorun çıktı, tekrar dene', 'err');
    if (!left) back('/');
  });

  async function run() {
    const car = await openCamera({ title: 'Aracın fotoğrafı', hint: 'Plaka görünecek şekilde çek', skipText: 'Fotoğrafsız' });
    if (!car) return back('/');
    if (car.photos.length) {
      const p = await prepareImage(car.photos[0]);
      draft.photos.push({ kind: 'arac', ...p });
      readInto(draft, 'arac', [p.blob]);
    }
    const damage = await openCamera({
      title: 'Hasar fotoğrafları',
      hint: 'Göçüğün öncesini çek',
      multi: true,
      skipText: 'Geç',
      doneText: 'Devam',
      onOpen: (api) => plateStatus(draft, api),
    });
    for (const b of damage?.photos || []) draft.photos.push({ kind: 'once', ...(await prepareImage(b)) });
    if (!left) stage.replaceWith(folderForm(draft, ctx));
  }

  return stage;
}
