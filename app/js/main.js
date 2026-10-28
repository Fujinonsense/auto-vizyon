import { route, startRouter, go } from './ui/router.js';
import { buildTabbar, setTopbar, setTab } from './ui/chrome.js';
import { h, icon } from './ui/dom.js';
import { emptyState } from './ui/parts.js';

buildTabbar();

route('/', () => {
  setTopbar();
  setTab('list');
  return emptyState({
    title: 'İlk aracı çek',
    text: 'Aracın fotoğrafını çekince plaka okunur, müşterinin klasörü açılır.',
    action: h('button', { class: 'btn primary', type: 'button', onclick: () => go('/yeni') }, icon('camera'), 'Yeni araç'),
  });
});

startRouter();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
navigator.storage?.persist?.();
