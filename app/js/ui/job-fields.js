// The job part of a form: work done, damaged parts, amount with KDV, who pays, invoice, costs.
import { h, icon, seg, toggle } from './dom.js';
import { computeVat } from '../lib/vat.js';
import { parseMoney, formatMoney } from '../lib/format.js';
import { COST_CATS, COST_LABEL_MAX, costLabel, normalizeCosts, costTotal, profit } from '../lib/costs.js';

export const PARTS = [
  'Dolu hasarı', 'Kaput', 'Tavan', 'Bagaj', 'Sol ön çamurluk', 'Sağ ön çamurluk', 'Sol ön kapı', 'Sağ ön kapı',
  'Sol arka kapı', 'Sağ arka kapı', 'Sol arka çamurluk', 'Sağ arka çamurluk', 'Sol marşpiyel', 'Sağ marşpiyel', 'Tampon',
];

const INSURERS = [
  'Allianz Sigorta', 'Anadolu Sigorta', 'Axa Sigorta', 'HDI Sigorta', 'Mapfre Sigorta', 'Sompo Sigorta',
  'Türkiye Sigorta', 'Quick Sigorta', 'Ray Sigorta', 'Neova Sigorta', 'Unico Sigorta', 'Doğa Sigorta',
  'Bereket Sigorta', 'Hepiyi Sigorta', 'Ankara Sigorta', 'Koru Sigorta',
];

const OTHER = 'diger';
const amountText = (n) => (n ? String(n).replace('.', ',') : '');
const onEnter = (fn) => (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  fn();
};

export function jobFields(job = {}, { vatRate = 20, vatMode = 'haric' } = {}) {
  const state = {
    description: '', parts: [], amount: 0, vatMode, vatRate, payer: 'musteri', insurer: '', claimNo: '', paid: false,
    ...job,
  };
  state.parts = [...(state.parts || [])];
  state.costs = normalizeCosts(state.costs);
  state.invoiced = state.invoiced === true;

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
  const cell = (label, value, cls = '') => h('div', { class: cls }, h('span', {}, label), h('b', { class: 'money' }, formatMoney(value)));
  const vat = () => computeVat({ amount: state.amount, mode: state.vatMode, rate: state.vatRate });
  function recalc() {
    const r = vat();
    calc.replaceChildren(cell('KDV hariç', r.net), cell(`KDV %${state.vatRate}`, r.vat), cell('Toplam', r.total, 'strong'));
    renderCostSum();
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

  // ---------- costs: the list, its total and profit, and "Masraf ekle" with a small form ----------
  const costList = h('div', { class: 'cost-list' });
  const costSum = h('div', { class: 'calc two' });
  function renderCostSum() {
    costSum.hidden = !state.costs.length;
    if (costSum.hidden) {
      costSum.replaceChildren();
      return;
    }
    const left = profit({ net: vat().net, costs: state.costs });
    costSum.replaceChildren(cell('Toplam maliyet', costTotal(state.costs)), cell('Kâr (KDV hariç)', left, left < 0 ? 'due' : ''));
  }
  function renderCosts() {
    costList.hidden = !state.costs.length;
    costList.replaceChildren(...state.costs.map((c, i) => h('div', { class: 'cost-row' },
      h('span', { class: 'grow' }, costLabel(c)),
      h('b', { class: 'money' }, formatMoney(c.amount)),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Kaldır',
        onclick: () => { state.costs = state.costs.filter((_, k) => k !== i); renderCosts(); },
      }, icon('x', 22)))));
    renderCostSum();
  }

  let pickedCat = '';
  const catChips = h('div', { class: 'chips wrap cost-cats' }, COST_CATS.map((c) => h('button', {
    type: 'button', class: 'chip', 'data-key': c.key, 'aria-pressed': 'false', onclick: () => pickCat(c.key),
  }, c.label)));
  const whatFor = h('input', {
    class: 'input', type: 'text', maxlength: COST_LABEL_MAX, placeholder: 'Cam filmi', autocomplete: 'off',
    autocapitalize: 'sentences', enterkeyhint: 'next',
    oninput: refreshAdd, onkeydown: onEnter(() => costAmount.focus()),
  });
  const whatForField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Ne için?'), whatFor);
  // Typed like the job amount: "20.000", "1.250,50".
  const costAmount = h('input', {
    class: 'input amount', inputmode: 'decimal', placeholder: '0', autocomplete: 'off', enterkeyhint: 'done',
    oninput: refreshAdd, onkeydown: onEnter(addCost),
  });
  const addBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: addCost }, icon('check'), 'Ekle');
  // Why Kaydet did not go through: what is missing in the form.
  const costHint = h('p', { class: 'cost-hint', hidden: true });
  const costForm = h('div', { class: 'cost-form', hidden: true },
    catChips,
    costHint,
    whatForField,
    h('label', { class: 'field' }, h('span', {}, 'Tutar'),
      h('div', { class: 'amount-wrap' }, costAmount, h('span', { 'aria-hidden': 'true' }, '₺'))),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => setForm(false) }, 'Vazgeç'), addBtn));
  const openBtn = h('button', { class: 'btn small', type: 'button', onclick: () => setForm(true) }, icon('plus', 20), 'Masraf ekle');

  // The item the open form describes, cleaned the same way a saved one is (or nothing yet).
  function pending() {
    if (costForm.hidden) return [];
    const label = pickedCat === OTHER ? whatFor.value : '';
    return normalizeCosts([{ cat: pickedCat, label, amount: parseMoney(costAmount.value) ?? 0 }]);
  }
  // Something typed into the open form that would not make a cost: what is missing first, and where to
  // fix it. Nothing typed (a category alone is nothing typed) is never a problem.
  function draftProblem() {
    if (costForm.hidden || pending().length) return null;
    const other = pickedCat === OTHER;
    if (!costAmount.value.trim() && !(other && whatFor.value.trim())) return null;
    if (!pickedCat) return { text: 'Masrafın türünü seç', at: catChips.querySelector('.chip') };
    if (other && !normalizeCosts([{ cat: OTHER, label: whatFor.value, amount: 1 }]).length) {
      return { text: 'Masrafın ne için olduğunu yaz', at: whatFor };
    }
    return { text: 'Masrafın tutarını yaz', at: costAmount };
  }
  function showProblem(problem) {
    costHint.textContent = problem?.text || '';
    costHint.hidden = !problem;
  }
  function refreshAdd() {
    addBtn.disabled = pending().length !== 1;
    if (!costHint.hidden) showProblem(draftProblem());
  }
  function pickCat(key) {
    pickedCat = key;
    catChips.querySelectorAll('.chip').forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    whatForField.hidden = key !== OTHER;
    refreshAdd();
    const next = !whatForField.hidden && !whatFor.value.trim() ? whatFor : !costAmount.value.trim() ? costAmount : null;
    next?.focus();
  }
  function setForm(open) {
    pickedCat = '';
    whatFor.value = '';
    costAmount.value = '';
    whatForField.hidden = true;
    catChips.querySelectorAll('.chip').forEach((b) => {
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    });
    addBtn.disabled = true;
    showProblem(null);
    costForm.hidden = !open;
    openBtn.hidden = open;
  }
  function addCost() {
    const [item] = pending();
    if (!item) return;
    state.costs = [...state.costs, item];
    setForm(false);
    renderCosts();
    openBtn.focus({ preventScroll: true });
  }

  renderCosts();
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
    toggle('Ödendi', state.paid, (v) => { state.paid = v; }),
    toggle('Fatura kesildi', state.invoiced, (v) => { state.invoiced = v; }),
    h('div', { class: 'field cost-box' }, h('span', {}, 'Maliyet'), costList, costSum, openBtn, costForm));
  // Asked by Kaydet before saving: a cost left half typed is never dropped quietly. Says what is missing
  // under the chips, puts the cursor there and returns the same words for a toast ('' when all is well).
  // The line has to stay in sight while the toast shows near the bottom: with no kind picked the chips,
  // several rows on a small phone, go to the top with the line right under them; a field to fill goes
  // to the middle, the line just above it.
  function costDraftProblem() {
    const problem = draftProblem();
    showProblem(problem);
    if (!problem) return '';
    if (catChips.contains(problem.at)) catChips.scrollIntoView({ block: 'start' });
    else problem.at.scrollIntoView({ block: 'center' });
    problem.at.focus({ preventScroll: true });
    return problem.text;
  }
  // A cost typed into the open form but not added with "Ekle" is still saved, never lost.
  return {
    el,
    read: () => ({ ...state, parts: [...state.parts], costs: [...state.costs, ...pending()], invoiced: state.invoiced }),
    costDraftProblem,
  };
}
