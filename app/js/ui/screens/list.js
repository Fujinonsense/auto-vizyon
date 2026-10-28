import { listFolders, onChange } from '../../data/repo.js';
import { filterSummaries } from '../../lib/search.js';
import { folderTitle, formatPhone, formatMoney } from '../../lib/format.js';
import { h, icon } from '../dom.js';
import { emptyState, thumb, urlScope, statusBadge } from '../parts.js';
import { setTopbar, setTab } from '../chrome.js';
import { go } from '../router.js';

const FILTERS = [['tum', 'Tümü'], ['borc', 'Borçlu'], ['sigorta', 'Sigorta'], ['buay', 'Bu ay']];
const state = { query: '', filter: 'tum' }; // kept while the app is open

function row({ folder, jobs, cover }, scope) {
  const last = jobs[0];
  const path = `/klasor/${folder.id}`;
  return h('a', { class: 'frow', href: `#${path}`, onclick: (e) => { e.preventDefault(); go(path); } },
    thumb(cover, scope),
    h('div', { class: 'grow' },
      h('div', { class: 'ftitle' }, folderTitle(folder)),
      folder.phone && h('div', { class: 'muted small' }, formatPhone(folder.phone)),
      last && h('div', { class: 'fmeta' }, h('span', { class: 'money' }, formatMoney(last.total)), statusBadge(last))));
}

export async function listScreen(params, ctx) {
  setTopbar();
  setTab('list');
  const scope = urlScope();
  let all = [];

  const results = h('div');
  const input = h('input', {
    class: 'input', type: 'search', placeholder: 'İsim, plaka, telefon, şase', 'aria-label': 'Klasörlerde ara',
    value: state.query, enterkeyhint: 'search', autocomplete: 'off',
    oninput: () => { state.query = input.value; draw(); },
  });
  const chips = h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
    class: `chip${state.filter === key ? ' on' : ''}`, type: 'button', 'aria-pressed': String(state.filter === key),
    onclick: (e) => {
      state.filter = key;
      chips.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('on', c === e.currentTarget);
        c.setAttribute('aria-pressed', String(c === e.currentTarget));
      });
      draw();
    },
  }, label)));
  const tools = h('div', { class: 'stack' }, h('div', { class: 'search' }, icon('search', 22), input), chips);

  function draw() {
    scope.revokeAll();
    tools.hidden = !all.length;
    if (!all.length) {
      results.className = '';
      results.replaceChildren(emptyState({
        title: 'İlk aracı çek',
        text: 'Aracın fotoğrafını çekince plaka okunur, müşterinin klasörü açılır.',
        action: h('button', { class: 'btn primary', type: 'button', onclick: () => go('/yeni') }, icon('camera'), 'Yeni araç'),
      }));
      return;
    }
    const shown = filterSummaries(all, state, new Date());
    results.className = shown.length ? 'list card' : '';
    results.replaceChildren(...(shown.length
      ? shown.map((s) => row(s, scope))
      : [h('p', { class: 'muted', style: { padding: '24px 4px' } }, 'Bu aramayla eşleşen klasör yok.')]));
  }

  async function load() {
    all = await listFolders();
    draw();
  }

  ctx.onLeave(onChange(load));
  ctx.onLeave(() => scope.revokeAll());
  await load();
  return h('div', { class: 'stack' }, tools, results);
}
