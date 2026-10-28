// Top bar and tab bar shared by every screen.
import { h, icon } from './dom.js';
import { go, back as goBack } from './router.js';

// The sync status lives in one node that moves with the home top bar.
export const syncSlot = h('span', { id: 'sync-slot' });

// Home: the bar floats transparent over the hero and turns solid on scroll (setTopbarSolid).
export function setTopbar({ title = '', back = '/', actions = [] } = {}) {
  const bar = document.getElementById('topbar');
  document.body.classList.toggle('home', !title);
  bar.classList.remove('solid');
  if (!title) {
    bar.replaceChildren(
      h('img', { class: 'wm', src: 'img/wordmark-dark.png', alt: 'Auto Vizyon' }),
      h('span', { class: 'spacer' }),
      syncSlot,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ayarlar', onclick: () => go('/ayarlar') }, icon('settings', 26)),
    );
    return;
  }
  bar.replaceChildren(
    h('button', { class: 'icon-btn back', type: 'button', 'aria-label': 'Geri', onclick: () => goBack(back) }, icon('chevron-left', 30)),
    h('span', { class: 'title' }, title),
    ...actions,
  );
}

export function setTopbarSolid(solid) {
  document.getElementById('topbar').classList.toggle('solid', solid);
}

export function buildTabbar() {
  document.getElementById('tabbar').replaceChildren(
    h('a', { href: '#/', 'data-tab': 'list' }, icon('folders', 26), h('span', {}, 'Klasörler')),
    h('a', { href: '#/yeni', class: 'shutter', 'data-tab': 'new' },
      h('span', { class: 'shutter-btn' }, icon('camera', 32)),
      h('span', {}, 'Yeni araç')),
    h('a', { href: '#/kazanc', 'data-tab': 'earn' }, icon('chart-bar', 26), h('span', {}, 'Kazanç')),
  );
}

export function setTab(name) {
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
}
