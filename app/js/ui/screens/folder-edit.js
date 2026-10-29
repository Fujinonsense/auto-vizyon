// Customer screen: used at the end of the new-car flow and to edit a saved folder.
import { getFolder, saveFolder, saveJob, addPhoto, getSettings, findFolderByPlate } from '../../data/repo.js';
import { KINDS } from '../../ai/schemas.js';
import { markManual, getPath, setPath } from '../../lib/merge-ai.js';
import { normalizePlate, normalizeVin } from '../../lib/validate.js';
import { normalizePhone, formatPhone, folderTitle } from '../../lib/format.js';
import { h, icon, toast, confirmSheet, spinner } from '../dom.js';
import { urlScope } from '../parts.js';
import { setTopbar } from '../chrome.js';
import { go, back } from '../router.js';
import { newDraft, readInto, captureDocPhotos } from '../docs.js';
import { jobFields } from '../job-fields.js';
import { openCamera } from '../../media/camera.js';
import { prepareImage } from '../../media/image.js';

const DOCS = [['ruhsat', 'file-text'], ['ehliyet', 'license'], ['kimlik', 'id']];
const COPY_FROM_EXISTING = ['name', 'phone', 'brand', 'model', 'modelFull', 'color', 'modelYear', 'vin', 'engineNo', 'ruhsat', 'ehliyet', 'kimlik'];

export function folderForm(draft, ctx, { autoDoc } = {}) {
  const f = draft.folder;
  const scope = urlScope();
  const fields = new Map();
  let dirty = draft.mode === 'new';
  let saving = false;

  document.body.classList.add('form-mode');
  ctx.onLeave(() => {
    document.body.classList.remove('form-mode');
    scope.revokeAll();
    draft.notify = null;
  });

  async function leave() {
    if (dirty && !(await confirmSheet({
      title: 'Kaydetmeden çıkılsın mı?',
      message: 'Çektiğin fotoğraflar ve yazdıkların silinecek.',
      okText: 'Kaydetmeden çık',
      danger: true,
    }))) return;
    dirty = false;
    back(draft.targetId && draft.mode === 'edit' ? `/klasor/${draft.targetId}` : '/');
  }
  setTopbar({ title: draft.mode === 'new' ? 'Yeni araç' : 'Bilgileri düzenle', back: leave });

  // ---------- fields ----------
  function paint(path, flash = false) {
    const x = fields.get(path);
    if (!x) return;
    const v = getPath(f, path) || '';
    if (document.activeElement !== x.input && x.input.value !== v) x.input.value = v;
    const unclear = !!v && (f.unclear || []).includes(path);
    x.wrap.classList.toggle('ai', !!v && (f.aiFilled || []).includes(path));
    x.wrap.classList.toggle('unclear', unclear);
    x.hint.textContent = unclear ? 'Yapay zeka emin değil, kontrol et' : '';
    if (flash) {
      x.wrap.classList.remove('flash');
      void x.wrap.offsetWidth;
      x.wrap.classList.add('flash');
    }
  }

  function field(label, path, { type = 'text', inputmode, placeholder = '', caps = 'words', clean } = {}) {
    const input = h('input', {
      type, inputmode, placeholder, autocomplete: 'off', autocapitalize: caps, value: getPath(f, path) || '',
      oninput: () => { setPath(f, path, input.value); markManual(f, path); paint(path); dirty = true; },
      onblur: () => {
        if (!clean || !input.value) return;
        const v = clean(input.value);
        setPath(f, path, v);
        input.value = v;
        if (path === 'plate') checkExisting();
      },
    });
    const hint = h('small', { class: 'hint' });
    const wrap = h('label', { class: 'field' }, h('span', {}, label), input, hint);
    fields.set(path, { wrap, input, hint });
    paint(path);
    return wrap;
  }

  const sec = (title, ...children) => h('section', { class: 'card section form-sec' }, h('div', { class: 'section-head' }, h('h3', {}, title)), ...children);
  const fold = (kind, title, children) => h('details', { class: 'card section form-sec', 'data-kind': kind, open: hasData(kind) },
    h('summary', { class: 'section-head' }, h('h3', {}, title), icon('chevron-down', 22)), h('div', { class: 'stack' }, children));
  const hasData = (kind) => Object.values(f[kind] || {}).some(Boolean);

  // ---------- photos (new car only) ----------
  const photoHead = h('div', { class: 'photo-head' });
  function renderPhotos() {
    const car = draft.photos.find((p) => p.kind === 'arac');
    const damage = draft.photos.filter((p) => p.kind === 'once');
    photoHead.replaceChildren(
      car
        ? h('img', { class: 'photo-main', src: scope.url(car.blob), alt: 'Aracın fotoğrafı' })
        : h('button', { class: 'photo-main empty', type: 'button', onclick: addCarPhoto }, icon('camera-plus', 34), 'Aracın fotoğrafını çek'),
      h('div', { class: 'photo-strip' },
        damage.map((p, i) => h('img', { src: scope.url(p.thumb), alt: `Hasar fotoğrafı ${i + 1}` })),
        h('button', { class: 'photo-add', type: 'button', onclick: addDamage }, icon('plus', 22), h('span', {}, 'Hasar'))));
  }
  async function addCarPhoto() {
    const r = await openCamera({ title: 'Aracın fotoğrafı', hint: 'Plaka görünecek şekilde çek' });
    if (!r?.photos.length) return;
    const p = await prepareImage(r.photos[0]);
    draft.photos = draft.photos.filter((x) => x.kind !== 'arac').concat({ kind: 'arac', ...p });
    renderPhotos();
    readInto(draft, 'arac', [p.blob]);
  }
  async function addDamage() {
    const r = await openCamera({ title: 'Hasar fotoğrafları', hint: 'Göçüğün öncesini çek', multi: true, doneText: 'Ekle' });
    if (!r?.photos.length) return;
    for (const b of r.photos) draft.photos.push({ kind: 'once', ...(await prepareImage(b)) });
    renderPhotos();
  }

  // ---------- documents ----------
  const docList = h('div', { class: 'doc-list' });
  function renderDocs() {
    docList.replaceChildren(...DOCS.map(([kind, ic]) => {
      const st = draft.reads[kind];
      const shot = draft.photos.some((p) => p.kind === kind);
      let sub = 'Fotoğrafını çek, yapay zeka okusun';
      let state = '';
      let action = h('button', { class: 'btn small', type: 'button', onclick: () => addDoc(kind) }, icon('camera', 20), 'Çek');
      if (st?.state === 'reading') {
        sub = 'Okunuyor…';
        state = 'busy';
        action = null;
      } else if (st?.state === 'error') {
        sub = st.message;
        state = 'err';
        action = h('button', { class: 'btn small', type: 'button', onclick: () => readInto(draft, kind, st.blobs) }, icon('refresh', 20), 'Tekrar oku');
      } else if (st?.state === 'done') {
        sub = `${st.count} bilgi okundu`;
        state = 'done';
        action = h('button', { class: 'btn small ghost', type: 'button', onclick: () => addDoc(kind) }, 'Yeniden çek');
      } else if (shot) {
        sub = 'Fotoğraf eklendi';
        state = 'done';
      }
      return h('div', { class: `doc-row ${state}` },
        h('span', { class: 'doc-ic' }, state === 'busy' ? spinner(24) : icon(state === 'done' ? 'circle-check' : state === 'err' ? 'alert-triangle' : ic, 24)),
        h('div', { class: 'grow' }, h('b', {}, KINDS[kind].label), h('span', {}, sub)),
        action);
    }));
  }
  async function addDoc(kind) {
    const shots = await captureDocPhotos(kind);
    if (!shots) return;
    draft.photos = draft.photos.filter((p) => p.kind !== kind).concat(shots.map((s) => ({ kind, ...s })));
    dirty = true;
    readInto(draft, kind, shots.map((s) => s.blob));
  }

  // ---------- same plate seen before ----------
  const banner = h('div', { class: 'banner', hidden: true });
  async function checkExisting() {
    if (draft.mode !== 'new' || draft.ignoreExisting || !f.plate) return;
    const ex = await findFolderByPlate(f.plate);
    if (!ex) {
      draft.targetId = null;
      banner.hidden = true;
      return;
    }
    draft.targetId = ex.id;
    for (const key of COPY_FROM_EXISTING) {
      const cur = f[key];
      const empty = cur == null || cur === '' || (typeof cur === 'object' && !Object.values(cur).some(Boolean));
      if (empty && ex[key]) f[key] = structuredClone(ex[key]);
    }
    [...fields.keys()].forEach((p) => paint(p));
    banner.replaceChildren(
      icon('folders', 24),
      h('div', { class: 'grow' }, h('b', {}, 'Bu araç daha önce gelmiş'), h('span', {}, `Yeni iş "${folderTitle(ex)}" klasörüne eklenecek.`)),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => { draft.ignoreExisting = true; draft.targetId = null; banner.hidden = true; } }, 'Ayrı klasör aç'));
    banner.hidden = false;
  }

  // ---------- AI status ----------
  const status = h('div', { class: 'ai-status', 'aria-live': 'polite' });
  function onRead(kind) {
    const st = draft.reads[kind];
    if (st?.state === 'done') {
      st.changed.forEach((p) => paint(p, true));
      [...fields.keys()].forEach((p) => paint(p));
      form.querySelectorAll('details[data-kind]').forEach((d) => { if (hasData(d.dataset.kind)) d.open = true; });
      if (st.changed.includes('plate')) checkExisting();
    }
    const busy = Object.values(draft.reads).some((r) => r.state === 'reading');
    status.replaceChildren(...(busy ? [spinner(18), 'Yapay zeka okuyor, sen devam edebilirsin'] : []));
    renderDocs();
  }
  draft.notify = onRead;

  // ---------- job (new car only) ----------
  let job = null;

  const saveBtn = h('button', { class: 'btn primary block', type: 'button', onclick: save }, icon('check'), 'Kaydet');
  async function save() {
    if (saving) return;
    if (!(f.name || '').trim() && !(f.plate || '').trim()) {
      toast('Ad soyad ya da plaka yaz', 'err');
      fields.get('name').input.focus();
      return;
    }
    saving = true;
    if (draft.pending.size) {
      saveBtn.replaceChildren(spinner(), 'Okuma bitiyor');
      await Promise.allSettled([...draft.pending]);
    }
    saveBtn.replaceChildren(spinner(), 'Kaydediliyor');
    try {
      const data = { ...f, name: (f.name || '').trim(), phone: normalizePhone(f.phone), plate: f.plate ? normalizePlate(f.plate) : '' };
      if (draft.targetId) data.id = draft.targetId;
      else delete data.id;
      const folder = await saveFolder(data);
      let saved = null;
      const j = job?.read();
      if (j && (j.amount || j.description || j.parts.length)) saved = await saveJob({ ...j, folderId: folder.id });
      for (const p of draft.photos) await addPhoto({ folderId: folder.id, kind: p.kind, blob: p.blob, thumb: p.thumb, jobId: saved?.id || null });
      dirty = false;
      toast('Kaydedildi');
      go(`/klasor/${folder.id}`, { replace: true });
    } catch (e) {
      console.error(e);
      toast('Kaydedilemedi, tekrar dene', 'err');
      saving = false;
      saveBtn.replaceChildren(icon('check'), 'Kaydet');
    }
  }

  // ---------- layout ----------
  const form = h('div', { class: 'stack form' },
    draft.mode === 'new' && photoHead,
    status,
    banner,
    sec('Müşteri',
      field('Ad soyad', 'name', { placeholder: 'Müşterinin adı soyadı' }),
      field('Telefon', 'phone', { type: 'tel', inputmode: 'tel', placeholder: '05xx xxx xx xx', caps: 'off', clean: formatPhone })),
    sec('Belgeler', h('p', { class: 'muted small' }, 'Sadece lazım olanı çek. Okunan bilgiler aşağıya kendiliğinden yazılır.'), docList),
    sec('Araç',
      field('Plaka', 'plate', { placeholder: '34 ABC 123', caps: 'characters', clean: normalizePlate }),
      h('div', { class: 'grid2' }, field('Renk', 'color', { placeholder: 'Siyah' }), field('Model yılı', 'modelYear', { inputmode: 'numeric', placeholder: '2019' })),
      h('div', { class: 'grid2' }, field('Marka', 'brand', { placeholder: 'Audi' }), field('Model', 'model', { placeholder: 'A7' })),
      field('Şase no', 'vin', { caps: 'characters', placeholder: '17 karakter', clean: normalizeVin }),
      field('Motor no', 'engineNo', { caps: 'characters' })),
    fold('ruhsat', 'Ruhsat bilgileri', [
      field('Ruhsat sahibi', 'ruhsat.sahibi'),
      field('TC / Vergi no', 'ruhsat.tcVkn', { inputmode: 'numeric', caps: 'off' }),
      h('div', { class: 'grid2' }, field('Belge seri no', 'ruhsat.belgeSeriNo', { caps: 'characters' }), field('Tescil tarihi', 'ruhsat.tescilTarihi', { inputmode: 'numeric' })),
      field('Ticari adı', 'modelFull', { caps: 'characters' }),
      field('Tipi', 'ruhsat.tipi', { caps: 'characters' })]),
    fold('ehliyet', 'Ehliyet bilgileri', [
      field('Ad soyad', 'ehliyet.adSoyad'),
      field('TC kimlik no', 'ehliyet.tc', { inputmode: 'numeric', caps: 'off' }),
      h('div', { class: 'grid2' }, field('Ehliyet no', 'ehliyet.ehliyetNo', { caps: 'characters' }), field('Sınıf', 'ehliyet.sinif', { caps: 'characters' })),
      h('div', { class: 'grid2' }, field('Veriliş tarihi', 'ehliyet.verilisTarihi', { inputmode: 'numeric' }), field('Doğum tarihi', 'ehliyet.dogumTarihi', { inputmode: 'numeric' }))]),
    fold('kimlik', 'Kimlik bilgileri', [
      field('Ad soyad', 'kimlik.adSoyad'),
      field('TC kimlik no', 'kimlik.tc', { inputmode: 'numeric', caps: 'off' }),
      h('div', { class: 'grid2' }, field('Doğum tarihi', 'kimlik.dogumTarihi', { inputmode: 'numeric' }), field('Seri no', 'kimlik.seriNo', { caps: 'characters' })),
      field('Son geçerlilik', 'kimlik.gecerlilik', { inputmode: 'numeric' })]));

  if (draft.mode === 'new') {
    getSettings().then((s) => {
      job = jobFields({}, { vatRate: s.vatRate, vatMode: s.vatMode });
      form.append(sec('İş ve tutar', h('p', { class: 'muted small' }, 'Fiyat belli değilse boş bırak, sonra eklersin.'), job.el));
    });
    renderPhotos();
  }
  form.append(h('div', { class: 'actionbar' }, saveBtn));
  renderDocs();
  onRead('');
  if (f.plate) checkExisting();
  if (autoDoc) setTimeout(() => addDoc(autoDoc), 0);
  return form;
}

export async function editScreen({ id, kind }, ctx) {
  const folder = await getFolder(id);
  if (!folder) {
    go('/', { replace: true });
    return h('div');
  }
  return folderForm(newDraft(folder, 'edit'), ctx, { autoDoc: KINDS[kind] ? kind : null });
}
