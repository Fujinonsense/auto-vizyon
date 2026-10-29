// Full-screen photo viewer: swipe, share (WhatsApp, insurance), make cover, delete.
import { deletePhoto, setCover } from '../data/repo.js';
import { folderTitle } from '../lib/format.js';
import { h, icon, toast, confirmSheet } from './dom.js';

export const KIND_LABEL = {
  arac: 'Araç', once: 'Hasar öncesi', sonra: 'Hasar sonrası', ruhsat: 'Ruhsat', ehliyet: 'Ehliyet', kimlik: 'Kimlik',
};

const fileName = (folder, i) => `${(folder?.plate || 'arac').replace(/\s/g, '')}-${i + 1}.jpg`;

// Shares through the phone's share sheet; falls back to downloading where files can't be shared.
export async function sharePhotos(photos, folder) {
  const files = photos.map((p, i) => new File([p.blob], fileName(folder, i), { type: 'image/jpeg' }));
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: folder ? folderTitle(folder) : 'Auto Vizyon' });
    } catch {
      // closed by the user
    }
    return;
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    h('a', { href: url, download: f.name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export function openPhotoViewer(photos, index, { folder } = {}) {
  const list = [...photos];
  const urls = new Map();
  let i = index;
  let startX = null;

  const img = h('img', { class: 'pv-img', alt: '' });
  const title = h('b');
  const counter = h('span');

  function show() {
    const p = list[i];
    if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob));
    img.src = urls.get(p.id);
    img.alt = KIND_LABEL[p.kind] || 'Fotoğraf';
    title.textContent = KIND_LABEL[p.kind] || 'Fotoğraf';
    counter.textContent = `${i + 1} / ${list.length}`;
  }
  const step = (d) => {
    i = (i + d + list.length) % list.length;
    show();
  };

  function close() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };

  async function remove() {
    const ok = await confirmSheet({ title: 'Fotoğraf silinsin mi?', message: "Telefondan silinir. Google Drive'daki yedeği kalır.", okText: 'Sil', danger: true });
    if (!ok) return;
    await deletePhoto(list[i].id);
    list.splice(i, 1);
    toast('Fotoğraf silindi');
    if (!list.length) return close();
    i = Math.min(i, list.length - 1);
    show();
  }

  const overlay = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fotoğraf' },
    h('div', { class: 'pv-top' },
      h('button', { class: 'cam-round', type: 'button', 'aria-label': 'Kapat', onclick: close }, icon('x', 26)),
      h('div', { class: 'pv-title' }, title, counter)),
    h('div', {
      class: 'pv-stage',
      ontouchstart: (e) => { startX = e.touches[0].clientX; },
      ontouchend: (e) => {
        if (startX == null) return;
        const dx = e.changedTouches[0].clientX - startX;
        startX = null;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
      },
    },
    img,
    list.length > 1 && h('button', { class: 'pv-nav prev', type: 'button', 'aria-label': 'Önceki', onclick: () => step(-1) }, icon('chevron-left', 28)),
    list.length > 1 && h('button', { class: 'pv-nav next', type: 'button', 'aria-label': 'Sonraki', onclick: () => step(1) }, icon('chevron-right', 28))),
    h('div', { class: 'pv-bar' },
      h('button', { class: 'cam-side', type: 'button', onclick: () => sharePhotos([list[i]], folder) }, icon('share', 22), 'Paylaş'),
      folder && h('button', {
        class: 'cam-side', type: 'button',
        onclick: async () => { await setCover(folder.id, list[i].id); toast('Kapak fotoğrafı yapıldı'); },
      }, icon('star', 22), 'Kapak'),
      h('button', { class: 'cam-side', type: 'button', onclick: remove }, icon('trash', 22), 'Sil')));

  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  show();
}
