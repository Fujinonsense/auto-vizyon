// Small DOM toolkit: element builder, icons, toast, bottom sheets, copy rows.
import { ICONS } from './icons.js';

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden']);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function icon(name, size = 24) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return tpl.content.firstChild;
}

let toastTimer;
export function toast(text, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), type === 'err' ? 4000 : 2200);
}

export function sheet(content, { title = '', onClose } = {}) {
  const onKey = (e) => e.key === 'Escape' && close();
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => e.target === wrap && close() },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-head' },
        h('h2', {}, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Kapat', onclick: () => close() }, icon('x', 26))),
      content));
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    onClose?.();
  }
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => wrap.classList.add('open'));
  return { el: wrap, close };
}

export function confirmSheet({ title, message = '', okText = 'Tamam', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const s = sheet(
      h('div', { class: 'stack' },
        message && h('p', { class: 'muted' }, message),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => s.close() }, 'Vazgeç'),
          h('button', {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            type: 'button',
            onclick: () => { answer = true; s.close(); },
          }, okText))),
      { title, onClose: () => resolve(answer) },
    );
  });
}

export function spinner(size = 20) {
  const s = icon('loader-2', size);
  s.classList.add('spin');
  return s;
}

// Segmented control: options [[value, label]], calls onChange(value).
export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' }, options.map(([v, label]) => h('button', {
    type: 'button',
    class: v === value ? 'on' : '',
    'aria-pressed': String(v === value),
    onclick: () => {
      el.querySelectorAll('button').forEach((b, i) => {
        const on = options[i][0] === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      onChange(v);
    },
  }, label)));
  return el;
}

export function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'switch' }, h('span', {}, label), input, h('span', { class: 'knob', 'aria-hidden': 'true' }));
}

export async function copyText(text, label = '') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label ? `${label} kopyalandı` : 'Kopyalandı');
}

// One value with its copy button on the left (for pasting into insurance forms).
export function copyRow(label, value, { unclear = false } = {}) {
  const text = String(value ?? '').trim();
  return h('div', { class: `copyrow${unclear && text ? ' unclear' : ''}` },
    text
      ? h('button', { class: 'copy', type: 'button', 'aria-label': `${label} kopyala`, onclick: () => copyText(text, label) }, icon('copy', 22))
      : h('span'),
    h('div', {},
      h('div', { class: 'lbl' }, label),
      h('div', { class: 'val' }, text || '—')));
}
