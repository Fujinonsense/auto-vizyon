// Select gallery photos before opening the phone's share sheet.
import { h, icon, sheet, toast } from './dom.js';
import { urlScope } from './parts.js';
import { sharePhotos } from './photo-viewer.js';

// Legacy tutanak photos stay under Belgeler; this kind can no longer be created.
export const PHOTO_GROUPS = [['Araç', ['arac']], ['Hasar öncesi', ['once']], ['Hasar sonrası', ['sonra']], ['Belgeler', ['ruhsat', 'ehliyet', 'kimlik', 'tutanak']]];

export function openPhotoShare(photos, folder, { share = sharePhotos } = {}) {
  const groups = PHOTO_GROUPS.map(([label, kinds]) => [label, photos.filter((p) => kinds.includes(p.kind))]).filter(([, ps]) => ps.length);
  const gallery = groups.flatMap(([, ps]) => ps);
  const selected = new Set();
  const scope = urlScope();
  const toggles = [];
  let busy = false;
  let closed = false;

  const all = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
    if (selected.size === gallery.length) selected.clear();
    else gallery.forEach((p) => selected.add(p));
    paint();
  } }, 'Tümünü seç');
  const primary = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: confirm }, 'Fotoğraf seç');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => !busy && s.close() }, 'Vazgeç');
  const content = h('div', { class: 'photo-picker' },
    h('p', { class: 'muted' }, 'Göndereceğin fotoğraflara dokun.'),
    all,
    h('div', { class: 'photo-picker-groups' }, groups.map(([label, ps]) => h('div', { class: 'pgroup' },
      h('span', { class: 'muted small' }, label),
      h('div', { class: 'pgrid' }, ps.map((photo, i) => {
        const check = h('span', { class: 'photo-check', hidden: true, 'aria-hidden': 'true' }, icon('check', 20));
        const button = h('button', { class: 'pthumb photo-choice', type: 'button', onclick: () => {
          if (selected.has(photo)) selected.delete(photo);
          else selected.add(photo);
          paint();
        } }, h('img', { src: scope.url(photo.thumb || photo.blob), alt: '' }), check);
        toggles.push({ button, check, photo, label: label + ', ' + (i + 1) + '. fotoğraf' });
        return button;
      }))))),
    h('div', { class: 'btn-row photo-picker-footer' }, cancel, primary));

  // From Paylaş until the share call settles the picker cannot be closed: the photos are still being written
  // and the phone's share sheet is about to open over it.
  const s = sheet(content, { title: "WhatsApp'ta paylaş", canClose: () => !busy, onClose: () => { closed = true; scope.revokeAll(); } });
  s.el.querySelector('.sheet').classList.add('photo-picker-sheet');

  function paint() {
    for (const { button, check, photo, label } of toggles) {
      const on = selected.has(photo);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', label + (on ? ', seçildi' : ', seçilmedi'));
      button.disabled = busy;
      check.hidden = !on;
    }
    all.textContent = selected.size === gallery.length && gallery.length ? 'Seçimi kaldır' : 'Tümünü seç';
    all.disabled = busy;
    cancel.disabled = busy;
    primary.disabled = busy || !selected.size;
    primary.textContent = busy ? 'Hazırlanıyor…' : selected.size ? 'Paylaş (' + selected.size + ')' : 'Fotoğraf seç';
  }

  async function confirm() {
    if (busy || !selected.size) return;
    busy = true;
    paint();
    try {
      const completed = await share(gallery.filter((p) => selected.has(p)), folder);
      if (completed) s.close();
    } catch (e) {
      console.warn(e);
      if (!closed) toast('Paylaşılamadı. Tekrar dene.', 'err');
    } finally {
      busy = false;
      if (!closed) paint();
    }
  }

  paint();
  return s;
}
