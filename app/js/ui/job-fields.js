// The job part of a form: work done, damaged parts, amount with KDV, who pays.
import { h, seg, toggle } from './dom.js';
import { computeVat } from '../lib/vat.js';
import { parseMoney, formatMoney } from '../lib/format.js';

export const PARTS = [
  'Dolu hasarı', 'Kaput', 'Tavan', 'Bagaj', 'Sol ön çamurluk', 'Sağ ön çamurluk', 'Sol ön kapı', 'Sağ ön kapı',
  'Sol arka kapı', 'Sağ arka kapı', 'Sol arka çamurluk', 'Sağ arka çamurluk', 'Sol marşpiyel', 'Sağ marşpiyel', 'Tampon',
];

const INSURERS = [
  'Allianz Sigorta', 'Anadolu Sigorta', 'Axa Sigorta', 'HDI Sigorta', 'Mapfre Sigorta', 'Sompo Sigorta',
  'Türkiye Sigorta', 'Quick Sigorta', 'Ray Sigorta', 'Neova Sigorta', 'Unico Sigorta', 'Doğa Sigorta',
  'Bereket Sigorta', 'Hepiyi Sigorta', 'Ankara Sigorta', 'Koru Sigorta',
];

const amountText = (n) => (n ? String(n).replace('.', ',') : '');

export function jobFields(job = {}, { vatRate = 20, vatMode = 'haric' } = {}) {
  const state = {
    description: '', parts: [], amount: 0, vatMode, vatRate, payer: 'musteri', insurer: '', claimNo: '', paid: false,
    ...job,
  };
  state.parts = [...(state.parts || [])];

  const desc = h('textarea', {
    rows: 2, placeholder: 'Sağ arka kapıda 3 göçük', value: state.description,
    oninput: () => { state.description = desc.value; },
  });
  const parts = h('div', { class: 'chips wrap' }, PARTS.map((p) => h('button', {
    type: 'button', class: `chip${state.parts.includes(p) ? ' on' : ''}`, 'aria-pressed': String(state.parts.includes(p)),
    onclick: (e) => {
      const on = !state.parts.includes(p);
      state.parts = on ? [...state.parts, p] : state.parts.filter((x) => x !== p);
      e.currentTarget.classList.toggle('on', on);
      e.currentTarget.setAttribute('aria-pressed', String(on));
    },
  }, p)));

  const calc = h('div', { class: 'calc' });
  const cell = (label, value, strong) => h('div', { class: strong ? 'strong' : '' }, h('span', {}, label), h('b', { class: 'money' }, formatMoney(value)));
  function recalc() {
    const r = computeVat({ amount: state.amount, mode: state.vatMode, rate: state.vatRate });
    calc.replaceChildren(cell('KDV hariç', r.net), cell(`KDV %${state.vatRate}`, r.vat), cell('Toplam', r.total, true));
  }
  const amount = h('input', {
    class: 'input amount', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Tutar', value: amountText(state.amount),
    oninput: () => { state.amount = parseMoney(amount.value) ?? 0; recalc(); },
  });

  const insurer = h('input', {
    class: 'input', list: 'av-insurers', placeholder: 'Sigorta şirketi', value: state.insurer, autocapitalize: 'words',
    oninput: () => { state.insurer = insurer.value; },
  });
  const claim = h('input', {
    class: 'input', placeholder: 'Hasar dosya no', value: state.claimNo, autocapitalize: 'characters',
    oninput: () => { state.claimNo = claim.value; },
  });
  const insBox = h('div', { class: 'stack', hidden: state.payer !== 'sigorta' },
    insurer, claim, h('datalist', { id: 'av-insurers' }, INSURERS.map((n) => h('option', { value: n }))));

  recalc();
  const el = h('div', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Yapılan iş'), desc),
    parts,
    h('div', { class: 'field' }, h('span', {}, 'Tutar'),
      h('div', { class: 'amount-row' }, h('div', { class: 'amount-wrap' }, amount, h('span', { 'aria-hidden': 'true' }, '₺')),
        seg([['haric', 'KDV hariç'], ['dahil', 'KDV dahil']], state.vatMode, (v) => { state.vatMode = v; recalc(); }))),
    calc,
    h('div', { class: 'field' }, h('span', {}, 'Ödeyen'),
      seg([['musteri', 'Müşteri'], ['sigorta', 'Sigorta']], state.payer, (v) => { state.payer = v; insBox.hidden = v !== 'sigorta'; })),
    insBox,
    toggle('Ödendi', state.paid, (v) => { state.paid = v; }));
  return { el, read: () => ({ ...state, parts: [...state.parts] }) };
}
