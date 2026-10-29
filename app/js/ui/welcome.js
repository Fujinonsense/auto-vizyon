// First-launch welcome for the dad. Shown once; Ayarlar can show it again.
import { h, icon } from './dom.js';

const KEY = 'avWelcomeSeen';

export function showWelcome() {
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // private mode: the welcome simply shows again next time
    }
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  const el = h('div', { class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hoş geldin' },
    h('img', { class: 'welcome-bg', src: 'img/welcome.webp', alt: '' }),
    h('div', { class: 'welcome-body' },
      h('img', { class: 'welcome-logo', src: 'img/lockup-dark.png', alt: 'Auto Vizyon Boyasız Hasar Onarım' }),
      h('div', { class: 'welcome-copy' },
        h('h1', {}, 'Hoş geldin ustam'),
        h('p', {}, 'Aracın fotoğrafını çek, plakayı ve belgeleri yapay zeka okusun. Müşteriler, işler ve kazanç artık tek yerde.'),
        h('button', { class: 'btn primary block', type: 'button', onclick: close }, 'Başlayalım', icon('chevron-right', 22)))));
  document.body.append(el);
}

export function maybeShowWelcome() {
  let seen = false;
  try {
    seen = !!localStorage.getItem(KEY);
  } catch {
    seen = false;
  }
  if (!seen) showWelcome();
}
