import { listFolders, onChange } from '../../data/repo.js';
import { filterSummaries } from '../../lib/search.js';
import { monthStats } from '../../lib/stats.js';
import { folderTitle, formatPhone, formatMoney } from '../../lib/format.js';
import { h, icon } from '../dom.js';
import { emptyState, thumb, urlScope, statusBadge } from '../parts.js';
import { setTopbar, setTopbarSolid, setTab } from '../chrome.js';
import { go } from '../router.js';

const FILTERS = [['tum', 'Tümü'], ['borc', 'Borçlu'], ['sigorta', 'Sigorta'], ['buay', 'Bu ay']];
const state = { query: '', filter: 'tum' }; // kept while the app is open
let heroPlayed = false; // the light sweep runs once per app launch

function row({ folder, jobs, cover }, scope) {
  const last = jobs[0];
  const path = `/klasor/${folder.id}`;
  return h('a', { class: 'frow', href: `#${path}`, onclick: (e) => { e.preventDefault(); go(path); } },
    thumb(cover, scope),
    h('div', { class: 'grow' },
      h('div', { class: 'ftitle' }, folderTitle(folder)),
      folder.phone && h('div', { class: 'fphone' }, icon('phone', 15), formatPhone(folder.phone)),
      last && h('div', { class: 'fmeta' }, h('span', { class: 'money' }, formatMoney(last.total)), statusBadge(last))),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chevron-right', 20)));
}

function stat(value, label, onclick) {
  return h(onclick ? 'button' : 'div', { class: 'stat', type: onclick && 'button', onclick }, h('b', {}, value), h('span', {}, label));
}

export async function listScreen(params, ctx) {
  setTopbar();
  setTab('list');
  const scope = urlScope();
  let all = [];

  const results = h('div');
  const stats = h('div', { class: 'hero-stats' });
  const play = !heroPlayed;
  heroPlayed = true;
  const hero = h('section', { class: `hero${play ? ' play' : ''}` },
    h('img', { class: 'hero-bg', src: 'img/hero.webp', alt: '', fetchpriority: 'high' }),
    h('span', { class: 'hero-sweep', 'aria-hidden': 'true' }),
    h('img', { class: 'hero-logo', src: 'img/lockup-dark.png', alt: 'Auto Vizyon Boyasız Hasar Onarım' }),
    stats);

  const input = h('input', {
    class: 'input', type: 'search', placeholder: 'İsim, plaka, telefon, şase', 'aria-label': 'Klasörlerde ara',
    value: state.query, enterkeyhint: 'search', autocomplete: 'off',
    oninput: () => { state.query = input.value; draw(); },
  });
  const chips = h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
    class: 'chip', type: 'button', 'data-key': key, onclick: () => setFilter(key),
  }, label)));
  const tools = h('div', { class: 'stack' }, h('div', { class: 'search' }, icon('search', 22), input), chips);

  function setFilter(key) {
    state.filter = key;
    chips.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('on', c.dataset.key === key);
      c.setAttribute('aria-pressed', String(c.dataset.key === key));
    });
    draw();
  }

  function draw() {
    scope.revokeAll();
    tools.hidden = !all.length;
    const s = monthStats(all.flatMap((x) => x.jobs));
    stats.replaceChildren(...(all.length ? [
      stat(String(s.count), 'bu ay iş'),
      stat(formatMoney(s.total), 'bu ay ciro'),
      stat(formatMoney(s.unpaid), 'alacak', () => setFilter('borc')),
    ] : []));
    if (!all.length) {
      results.className = '';
      results.replaceChildren(emptyState({
        art: 'car',
        title: 'İlk aracı çek',
        text: 'Aracın fotoğrafını çekince plaka okunur, müşterinin klasörü açılır.',
        action: h('button', { class: 'btn primary', type: 'button', onclick: () => go('/yeni') }, icon('camera'), 'Yeni araç'),
      }));
      return;
    }
    const shown = filterSummaries(all, state, new Date());
    results.className = shown.length ? 'list card' : '';
    results.replaceChildren(...(shown.length
      ? shown.map((x) => row(x, scope))
      : [h('p', { class: 'muted', style: { padding: '24px 4px' } }, 'Bu aramayla eşleşen klasör yok.')]));
  }

  async function load() {
    all = await listFolders();
    draw();
  }

  const onScroll = () => setTopbarSolid(window.scrollY > hero.offsetHeight - 90);
  window.addEventListener('scroll', onScroll, { passive: true });
  ctx.onLeave(() => window.removeEventListener('scroll', onScroll));
  ctx.onLeave(onChange(load));
  ctx.onLeave(() => scope.revokeAll());
  setFilter(state.filter);
  await load();
  requestAnimationFrame(onScroll);
  return h('div', { class: 'stack' }, hero, tools, results);
}
