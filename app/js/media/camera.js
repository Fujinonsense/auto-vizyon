// Full-screen in-app camera. Resolves {photos: Blob[], skipped} or null when closed.
// frame: 'car' (no guide), 'doc' (ruhsat), 'card' (ehliyet / kimlik).
import { h, icon } from '../ui/dom.js';

export function openCamera({ title, hint = '', multi = false, skipText = '', doneText = 'Devam', frame = 'car', onOpen } = {}) {
  return new Promise((resolve) => {
    const photos = [];
    const urls = [];
    let stream = null;
    let done = false;

    const video = h('video', { class: 'cam-video', autoplay: true, playsinline: true, muted: true, 'aria-hidden': 'true' });
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    const fallback = h('div', { class: 'cam-fallback', hidden: true },
      icon('camera', 40),
      h('p', {}, 'Kamera burada açılamadı. Telefonun kendi kamerasıyla çekebilirsin.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => nativeInput.click() }, icon('camera'), 'Fotoğraf çek'));
    const status = h('div', { class: 'cam-status', 'aria-live': 'polite' });
    const strip = h('div', { class: 'cam-strip' });
    const flash = h('div', { class: 'cam-flash' });
    const galleryInput = h('input', { type: 'file', accept: 'image/*', multiple: multi, hidden: true, onchange: () => takeFiles(galleryInput) });
    const nativeInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: () => takeFiles(nativeInput) });
    const right = h('div', { class: 'cam-right' });

    const overlay = h('div', { class: 'cam', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'cam-top' },
        h('button', { class: 'cam-round', type: 'button', 'aria-label': 'Kapat', onclick: () => finish(null) }, icon('x', 26)),
        h('div', { class: 'cam-title' }, h('b', {}, title), hint && h('span', {}, hint))),
      h('div', { class: 'cam-view' }, video, frame !== 'car' && h('div', { class: `cam-frame ${frame}` }), fallback, flash),
      status,
      multi ? strip : null,
      h('div', { class: 'cam-bar' },
        h('button', { class: 'cam-side', type: 'button', onclick: () => galleryInput.click() }, icon('photo', 22), 'Galeri'),
        h('button', { class: 'cam-shutter', type: 'button', 'aria-label': 'Fotoğraf çek', onclick: shoot }),
        right),
      galleryInput,
      nativeInput);

    function renderRight() {
      if (multi && photos.length) {
        right.replaceChildren(h('button', { class: 'cam-side gold', type: 'button', onclick: () => finish({ photos: [...photos], skipped: false }) },
          `${doneText} (${photos.length})`, icon('chevron-right', 20)));
      } else if (skipText) {
        right.replaceChildren(h('button', { class: 'cam-side', type: 'button', onclick: () => finish({ photos: [], skipped: true }) }, skipText));
      } else {
        right.replaceChildren();
      }
    }

    function renderStrip() {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      strip.replaceChildren(...photos.map((p, i) => {
        const u = URL.createObjectURL(p);
        urls.push(u);
        return h('div', { class: 'cam-shot' },
          h('img', { src: u, alt: `${i + 1}. fotoğraf` }),
          h('button', { type: 'button', 'aria-label': `${i + 1}. fotoğrafı sil`, onclick: () => { photos.splice(i, 1); renderStrip(); renderRight(); } }, icon('x', 16)));
      }));
    }

    function add(blobs) {
      if (!blobs.length) return;
      if (!multi) return finish({ photos: blobs.slice(0, 1), skipped: false });
      photos.push(...blobs);
      renderStrip();
      renderRight();
      strip.scrollLeft = strip.scrollWidth;
    }

    function takeFiles(input) {
      add([...input.files]);
      input.value = '';
    }

    async function shoot() {
      if (!stream || !video.videoWidth) return nativeInput.click();
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      if (blob) add([blob]);
    }

    function finish(result) {
      if (done) return;
      done = true;
      stream?.getTracks().forEach((t) => t.stop());
      urls.forEach((u) => URL.revokeObjectURL(u));
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    const onKey = (e) => e.key === 'Escape' && finish(null);
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    renderRight();
    onOpen?.({ setStatus: (node) => status.replaceChildren(node || '') });

    navigator.mediaDevices?.getUserMedia?.({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    }).then((s) => {
      if (done) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      video.srcObject = s;
      video.play().catch(() => {});
    }).catch(() => {
      fallback.hidden = false;
    }) ?? (fallback.hidden = false);
  });
}
