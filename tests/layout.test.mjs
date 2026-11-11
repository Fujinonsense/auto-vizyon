// What keeps the screens usable on a small iPhone: rows that wrap, 48px tap targets, readable contrast.
// Real layout is checked in a browser; these keep the rules that give it from slipping.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, settle } from './helpers/fake-dom.mjs';

const css = readFileSync(new URL('../app/css/app.css', import.meta.url), 'utf8');
const declarations = (body) => Object.fromEntries(body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')
  .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]).filter(([k, v]) => k && v));
// The declarations of a rule written once at the top level of app.css, by its exact selector.
function rule(selector) {
  const body = css.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1];
  assert.ok(body, `${selector} is in app.css`);
  return declarations(body);
}
const light = declarations(/^:root \{([^}]*)\}/m.exec(css)[1]);
const dark = declarations(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(css)[1]);
const px = (v) => parseFloat(v);

// WCAG 2 contrast ratio of two #rrggbb colours.
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the folder list filters wrap onto a second row, so "Faturasız" is never off screen, and are 48px tall', async () => {
  assert.equal(rule('.chips.wrap')['flex-wrap'], 'wrap');
  assert.ok(px(rule('.chips.wrap.filters .chip')['min-height']) >= 48);
  assert.ok(px(rule('.chips.wrap.filters .chip')['font-size']) >= 15, 'no smaller than the other filter-like chips');

  const dom = installDom();
  try {
    const repo = await import('../app/js/data/repo.js');
    const { listScreen } = await import('../app/js/ui/screens/list.js');
    await repo.saveFolder({ name: 'Ali Veli', plate: '34 NMA 887' });
    const screen = await listScreen({}, { leave: [], onLeave(fn) { this.leave.push(fn); } });
    await settle();
    const row = screen.querySelector('.chips');
    assert.deepEqual(row.className.split(' '), ['chips', 'wrap', 'filters']);
    assert.deepEqual(row.querySelectorAll('.chip').map((c) => c.textContent), ['Tümü', 'Borçlu', 'Sigorta', 'Bu ay', 'Faturasız']);
  } finally {
    dom.uninstall();
  }
});

test('"Belge ekle" buttons and the cost category chips are at least 48px tall', () => {
  assert.ok(px(rule('.add-docs .btn')['min-height']) >= 48);
  assert.ok(px(rule('.chips.wrap.cost-cats .chip')['min-height']) >= 48);
  assert.ok(px(rule('.cost-box > .btn.small')['min-height']) >= 48, '"Masraf ekle"');
});

test('"Fatura kesilmedi" reads at AA contrast in the light theme; the dark theme and every other warn use stay as they were', () => {
  assert.equal(rule('.badge.inv').color, 'var(--warn-ink)');
  assert.equal(rule('.badge.inv').background, 'var(--warn-soft)');
  assert.ok(contrast(light['--warn-ink'], light['--warn-soft']) >= 4.5, `light ${contrast(light['--warn-ink'], light['--warn-soft']).toFixed(2)}`);
  assert.ok(contrast(light['--warn-ink'], light['--surface']) >= 4.5, 'also on white');
  assert.equal(dark['--warn-ink'], dark['--warn'], 'dark keeps its colour');
  assert.deepEqual([light['--warn'], dark['--warn']], ['#a86a00', '#f2b648']);
  assert.equal(css.match(/var\(--warn-ink\)/g).length, 1, 'only the badge');
  assert.equal(rule('.field .hint').color, 'var(--warn)');
  assert.equal(rule('.doc-row.err .grow > span').color, 'var(--warn)');
});

test('next to a section title that keeps its line ("Ruhsat"), the copy button wraps its own words neatly', () => {
  const btn = rule('.section-head .btn');
  assert.equal(btn['white-space'], 'normal');
  assert.equal(btn['text-align'], 'center');
  assert.ok(Number(btn['line-height']) <= 1.25, 'two lines fit the 48px button');
  assert.ok(px(btn['min-height']) >= 48, 'a 48px tap target');
  // At 320 px the label wraps: the icon keeps its size and the two lines sit right next to it.
  assert.equal(rule('.section-head .btn svg').flex, 'none');
  assert.equal(narrow(359)['.section-head .btn > span']?.width, 'min-content');
});

// The rules of an @media (max-width: N px) block of app.css, by selector.
function narrow(maxWidth) {
  const at = css.indexOf(`@media (max-width: ${maxWidth}px) {`);
  assert.ok(at >= 0, `@media (max-width: ${maxWidth}px) is in app.css`);
  let depth = 0;
  let end = css.indexOf('{', at);
  for (let i = end; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = css.slice(css.indexOf('{', at) + 1, end);
  return Object.fromEntries([...body.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => [sel.replace(/\/\*[\s\S]*?\*\//g, '').trim(), declarations(decl)]));
}

test('below 375 px the camera bar keeps to the screen after the first shot; wider screens keep their bar', () => {
  const small = narrow(374);
  assert.equal(small['.cam-bar']['grid-template-columns'], 'minmax(0, 1fr) auto minmax(0, 1fr)', 'a side never widens the bar');
  assert.equal(small['.cam-side']['white-space'], 'normal', 'a label that does not fit wraps in its own half');
  assert.equal(small['.cam-side svg'].flex, 'none');
  // 320 px: "Galeri" (icon, gap, word) and "Oku (1)" with its arrow at their tightest, the shutter in between.
  const pad = px(small['.cam-bar']['padding-left']) + px(small['.cam-bar']['padding-right']);
  const side = (content) => 2 * px(small['.cam-side'].padding.split(' ')[1]) + content;
  assert.ok(pad + 2 * px(small['.cam-bar'].gap) + 80 + side(22 + 4 + 46) + side(55 + 4 + 20) <= 320);
  // Unchanged above it.
  assert.equal(rule('.cam-bar')['grid-template-columns'], '1fr auto 1fr');
  assert.equal(rule('.cam-bar').padding, '14px 16px 18px');
  assert.equal(rule('.cam-side')['white-space'], 'nowrap');
  assert.equal(rule('.cam-side').padding, '0 18px');
  assert.ok(px(rule('.cam-side')['min-height']) >= 48 && px(rule('.cam-shutter').width) === 80, 'tap targets stay big');
});

// Classes app.css styles on their own anywhere (".card {", ".empty {"): app-wide rules a modifier must not hit by accident.
const standalone = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
  .flatMap(([, list]) => list.split(',').map((s) => /^\.([\w-]+)$/.exec(s.trim())?.[1])).filter(Boolean));

test('the empty car photo button of a new folder wears no class an app-wide rule styles, so it fits a 320 px screen', async () => {
  assert.ok(standalone.has('empty') && standalone.has('card'), 'the app-wide rules are seen');
  const dom = installDom();
  try {
    const { newDraft } = await import('../app/js/ui/docs.js');
    const { folderForm } = await import('../app/js/ui/screens/folder-edit.js');
    const ctx = { leave: [], onLeave(fn) { this.leave.push(fn); } };
    const form = folderForm(newDraft(), ctx);
    await settle();
    const btn = form.querySelector('button.photo-main');
    assert.equal(btn.textContent, 'Aracın fotoğrafını çek');
    // The empty-state block's 40px padding made the form grid wider than the screen at 320 px.
    assert.deepEqual(btn.className.split(' ').filter((c) => c !== 'photo-main' && standalone.has(c)), []);
    ctx.leave.forEach((fn) => fn());
  } finally {
    dom.uninstall();
  }
});

test('the cost kind chips come up under the top bar (and the notch) when Kaydet points at them', () => {
  const margin = rule('.cost-cats')['scroll-margin-top'];
  assert.match(margin, /env\(safe-area-inset-top\)/);
  assert.ok(px(/(\d+)px/.exec(margin)[1]) >= 64, 'below the 64px top bar');
});

test('photo picker uses an inner scroller, bottom safe area, theme tokens and 48px targets', () => {
  assert.equal(rule('.photo-picker-sheet')['overflow'], 'hidden');
  assert.equal(rule('.photo-picker-groups')['overflow-y'], 'auto');
  assert.match(rule('.photo-picker-footer').padding, /env\(safe-area-inset-bottom\)/);
  assert.ok(px(rule('.photo-choice')['min-height']) >= 48);
  assert.ok(px(rule('.photo-choice')['min-width']) >= 48);
  assert.ok(px(rule('.photo-picker-footer .btn')['min-height']) >= 48);
  assert.match(rule('.photo-choice[aria-pressed="true"]').outline, /var\(--gold-ink\)/);
  for (const theme of [light, dark]) assert.ok(contrast(theme['--gold-ink'], theme['--surface']) >= 3);
  assert.equal(px(rule('body').font), 17);
});
