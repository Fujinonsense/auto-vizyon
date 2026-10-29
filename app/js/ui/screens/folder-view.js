// One customer's folder: call / WhatsApp, jobs, every field with its copy button, photos.
import { getFolder, jobsForFolder, listPhotos, onChange, deleteFolder, addPhoto, getSettings } from '../../data/repo.js';
import { folderSections, sectionCopyText, folderCopyText, waLink, telLink } from '../../lib/share.js';
import { formatMoney, formatDate, formatPhone } from '../../lib/format.js';
import { h, icon, toast, confirmSheet, copyRow, copyText } from '../dom.js';
import { plateChip, urlScope, statusBadge } from '../parts.js';
import { setTopbar, setTab } from '../chrome.js';
import { go } from '../router.js';
import { openJobSheet } from '../job-edit.js';
import { openPhotoViewer, sharePhotos } from '../photo-viewer.js';
import { openCamera } from '../../media/camera.js';
import { prepareImage } from '../../media/image.js';

const COVER_KINDS = ['arac', 'once', 'sonra'];
const GROUPS = [['Araç', ['arac']], ['Hasar öncesi', ['once']], ['Hasar sonrası', ['sonra']], ['Belgeler', ['ruhsat', 'ehliyet', 'kimlik']]];

function quick(label, ic, attrs) {
  return h(attrs.href ? 'a' : 'button', { class: 'qa-btn', type: attrs.href ? null : 'button', ...attrs }, icon(ic, 26), h('span', {}, label));
}

export async function folderView({ id }, ctx) {
  setTab('list');
  const scope = urlScope();
  const root = h('div', { class: 'stack fview' });
  ctx.onLeave(() => scope.revokeAll());

  async function addPhotos(kind, jobs) {
    const r = await openCamera({ title: kind === 'sonra' ? 'Hasar sonrası' : 'Hasar öncesi', hint: 'İstediğin kadar çek', multi: true, doneText: 'Ekle' });
    if (!r?.photos.length) return;
    for (const b of r.photos) {
      const p = await prepareImage(b);
      await addPhoto({ folderId: id, kind, blob: p.blob, thumb: p.thumb, jobId: jobs[0]?.id || null });
    }
    toast(`${r.photos.length} fotoğraf eklendi`);
  }

  async function render() {
    const folder = await getFolder(id);
    if (!folder) return go('/', { replace: true });
    const [jobs, photos, settings] = await Promise.all([jobsForFolder(id), listPhotos(id), getSettings()]);
    scope.revokeAll();
    setTopbar({
      title: folder.name || folder.plate || 'Klasör',
      back: '/',
      actions: [h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Bilgileri düzenle', onclick: () => go(`/klasor/${id}/duzenle`) }, icon('pencil', 24))],
    });

    // Header: cover, name, vehicle, plate, quick actions
    const gallery = GROUPS.flatMap(([, kinds]) => photos.filter((p) => kinds.includes(p.kind)));
    const cover = photos.find((p) => p.id === folder.coverPhotoId) || photos.find((p) => COVER_KINDS.includes(p.kind));
    const vehicle = [[folder.color, folder.brand, folder.model].filter(Boolean).join(' '), folder.modelYear].filter(Boolean).join(', ');
    const tel = telLink(folder.phone);
    const wa = waLink(folder, settings.waTemplate);
    const noPhone = () => toast('Telefon numarası yok, önce düzenleyip ekle', 'err');
    const head = h('section', { class: 'card fhead' },
      cover
        ? h('button', { class: 'fcover', type: 'button', 'aria-label': 'Fotoğrafı büyüt', onclick: () => openPhotoViewer(gallery, gallery.indexOf(cover), { folder }) },
          h('img', { src: scope.url(cover.blob), alt: 'Aracın fotoğrafı' }))
        : h('div', { class: 'fcover empty' }, icon('car', 44)),
      h('div', { class: 'fhead-body' },
        h('h1', {}, folder.name || 'İsimsiz müşteri'),
        vehicle && h('p', { class: 'muted' }, vehicle),
        folder.plate && plateChip(folder.plate, { big: true }),
        folder.phone && h('p', { class: 'fphone-big' }, icon('phone', 18), formatPhone(folder.phone))),
      h('div', { class: 'qa' },
        quick('Ara', 'phone', tel ? { href: tel } : { onclick: noPhone }),
        quick('WhatsApp', 'brand-whatsapp', wa ? { href: wa, target: '_blank', rel: 'noopener' } : { onclick: noPhone }),
        quick('Hepsini kopyala', 'copy', { onclick: () => copyText(folderCopyText(folder), 'Bütün bilgiler') })));

    // Jobs
    const unpaid = jobs.filter((j) => !j.paid).reduce((a, j) => a + j.total, 0);
    const jobsSec = h('section', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h3', {}, 'İşler'),
        h('button', { class: 'btn small', type: 'button', onclick: () => openJobSheet(id) }, icon('plus', 20), 'Yeni iş')),
      jobs.length
        ? jobs.map((j) => h('button', { class: 'jobrow', type: 'button', onclick: () => openJobSheet(id, j) },
          h('div', { class: 'grow' },
            h('b', {}, j.description || j.parts.join(', ') || 'Onarım'),
            h('span', {}, [formatDate(j.date), j.payer === 'sigorta' && (j.insurer || 'Sigorta'), j.claimNo].filter(Boolean).join(', '))),
          h('div', { class: 'jobamt' }, h('b', { class: 'money' }, formatMoney(j.total)), statusBadge(j))))
        : h('p', { class: 'muted small' }, 'Henüz iş yok. Fiyat verince "Yeni iş" ile ekle.'),
      unpaid > 0 && h('p', { class: 'due-line' }, 'Ödenmemiş: ', h('b', { class: 'money' }, formatMoney(unpaid))));

    // Info with copy buttons
    const sections = folderSections(folder);
    const missing = sections.filter((s) => ['ruhsat', 'ehliyet', 'kimlik'].includes(s.kind) && !s.rows.some((r) => r.value));
    const infoSecs = sections.filter((s) => s.rows.some((r) => r.value)).map((s) => h('section', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h3', {}, s.title),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => copyText(sectionCopyText(s.rows), `${s.title} bilgileri`) }, icon('copy', 18), 'Tümünü kopyala')),
      s.rows.filter((r) => r.value).map((r) => copyRow(r.label, r.value, { unclear: (folder.unclear || []).includes(r.path) }))));
    const addDocs = missing.length && h('div', { class: 'add-docs' },
      h('span', { class: 'muted small' }, 'Belge ekle'),
      h('div', { class: 'btn-row' }, missing.map((s) => h('button', { class: 'btn small', type: 'button', onclick: () => go(`/klasor/${id}/belge/${s.kind}`) },
        h('img', { class: 'btn-art', src: `img/ic-${s.kind}.webp`, alt: '' }), s.title))));

    // Photos
    const photoSec = h('section', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h3', {}, 'Fotoğraflar'),
        photos.length > 0 && h('button', { class: 'btn small ghost', type: 'button', onclick: () => sharePhotos(gallery, folder) }, icon('share', 18), 'Hepsini paylaş')),
      GROUPS.map(([label, kinds]) => {
        const ps = photos.filter((p) => kinds.includes(p.kind));
        return ps.length > 0 && h('div', { class: 'pgroup' }, h('span', { class: 'muted small' }, label),
          h('div', { class: 'pgrid' }, ps.map((p) => h('button', { class: 'pthumb', type: 'button', onclick: () => openPhotoViewer(gallery, gallery.indexOf(p), { folder }) },
            h('img', { src: scope.url(p.thumb), alt: label })))));
      }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => addPhotos('once', jobs) }, icon('camera-plus', 20), 'Öncesi'),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => addPhotos('sonra', jobs) }, icon('camera-plus', 20), 'Sonrası')),
      folder.driveUrl && h('a', { class: 'btn small ghost', href: folder.driveUrl, target: '_blank', rel: 'noopener', style: { marginTop: '8px' } },
        icon('cloud-check', 18), "Google Drive'daki yedeği aç"));

    const del = h('button', {
      class: 'btn danger ghost block', type: 'button',
      onclick: async () => {
        const ok = await confirmSheet({
          title: 'Klasör silinsin mi?',
          message: "İşler ve fotoğraflar telefondan silinir. Google Drive'daki fotoğraf yedekleri kalır.",
          okText: 'Klasörü sil',
          danger: true,
        });
        if (!ok) return;
        await deleteFolder(id);
        toast('Klasör silindi');
        go('/', { replace: true });
      },
    }, icon('trash', 20), 'Klasörü sil');

    root.replaceChildren(head, jobsSec, ...infoSecs, addDocs || '', photoSec, del);
  }

  ctx.onLeave(onChange((c) => { if (c.type !== 'settings') render(); }));
  await render();
  return root;
}
