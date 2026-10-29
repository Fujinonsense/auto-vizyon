// Shop-specific UI parts: the plate, thumbnails, empty states.
import { h, icon } from './dom.js';

export function plateChip(plate, { big = false } = {}) {
  return h('span', { class: `plate${big ? ' big' : ''}`, 'aria-label': `Plaka ${plate}` },
    h('span', { class: 'tr', 'aria-hidden': 'true' }, 'TR'),
    h('span', { class: 'num' }, plate));
}

export function statusBadge(job) {
  if (job.paid) return h('span', { class: 'badge ok' }, 'Ödendi');
  if (job.payer === 'sigorta') return h('span', { class: 'badge ins' }, 'Sigortada');
  return h('span', { class: 'badge due' }, 'Borç');
}

// Object URLs for photo blobs, revoked together when the screen is left.
export function urlScope() {
  const urls = [];
  return {
    url(blob) {
      const u = URL.createObjectURL(blob);
      urls.push(u);
      return u;
    },
    revokeAll() {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    },
  };
}

export function thumb(blob, scope, alt = '') {
  return blob
    ? h('img', { class: 'thumb', src: scope.url(blob), alt, loading: 'lazy' })
    : h('span', { class: 'thumb', 'aria-hidden': 'true' }, icon('car', 28));
}

// A PDR light board: reflection lines bending around a dent.
export function reflectionBoard() {
  const W = 240;
  const H = 120;
  const cx = 128;
  const cy = 60;
  const r = 30;
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const y = 10 + i * 14.3;
    const d = y - cy;
    const pts = [];
    for (let x = 0; x <= W; x += 4) {
      const k = Math.exp(-((x - cx) ** 2 + d * d) / (2 * r * r));
      pts.push(`${x},${(y + Math.sign(d || 1) * 12 * k).toFixed(1)}`);
    }
    lines.push(`<polyline points="${pts.join(' ')}" stroke="${i === 3 ? 'var(--gold)' : 'currentColor'}"/>`);
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="board" viewBox="0 0 ${W} ${H}" fill="none" stroke-width="4" stroke-linecap="round" aria-hidden="true" style="color:var(--line)">${lines.join('')}</svg>`;
  return tpl.content.firstChild;
}

// art: one of the Higgsfield icons (img/ic-<art>.webp); without it, the PDR light board.
export function emptyState({ title, text, action, art }) {
  return h('div', { class: 'empty' },
    art ? h('img', { class: 'empty-art', src: `img/ic-${art}.webp`, alt: '' }) : reflectionBoard(),
    h('h2', {}, title), text && h('p', {}, text), action);
}
