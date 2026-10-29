// Kazanç: one month at a time, who still owes money, and the Excel file in and out.
import { listFolders, onChange } from '../../data/repo.js';
import { monthlySummary, monthKey } from '../../lib/stats.js';
import { formatMoney, formatMonth, folderTitle } from '../../lib/format.js';
import { buildWorkbook, readWorkbook, importRecords, shareOrDownload } from '../../excel/xlsx.js';
import { h, icon, toast, spinner, confirmSheet } from '../dom.js';
import { setTopbar, setTab } from '../chrome.js';
import { go } from '../router.js';

let month = monthKey(new Date()); // kept while the app is open

function shiftMonth(m, by) {
  const [y, mo] = m.split('-').map(Number);
  return monthKey(new Date(y, mo - 1 + by, 1));
}

const metric = (label, value, cls = '') => h('div', { class: `metric ${cls}` }, h('span', {}, label), h('b', { class: 'money' }, value));

export async function earningsScreen(params, ctx) {
  setTopbar({ title: 'Kazanç', back: null });
  setTab('earn');
  const root = h('div', { class: 'stack' });
  const fileInput = h('input', { type: 'file', accept: '.xlsx,.xls', hidden: true, onchange: () => importFile() });

  async function exportExcel(btn, onlyMonth) {
    const old = [...btn.childNodes];
    btn.replaceChildren(spinner(), 'Hazırlanıyor');
    try {
      const summaries = await listFolders();
      const blob = await buildWorkbook({ folders: summaries.map((s) => s.folder), jobs: summaries.flatMap((s) => s.jobs), month: onlyMonth ? month : '' });
      await shareOrDownload(blob, onlyMonth ? `AutoVizyon-${month}.xlsx` : 'AutoVizyon-tum-kayitlar.xlsx');
    } catch (e) {
      console.error(e);
      toast('Excel dosyası hazırlanamadı', 'err');
    }
    btn.replaceChildren(...old);
  }

  async function importFile() {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = await readWorkbook(file);
      if (!data.jobs.length && !data.folders.length) return toast('Dosyada okunacak kayıt bulunamadı', 'err');
      const ok = await confirmSheet({
        title: 'Excel içe aktarılsın mı?',
        message: `${data.jobs.length} iş ve ${data.folders.length} müşteri bulundu. Aynı kayıtlar güncellenir, yeniler eklenir.`,
        okText: 'İçe aktar',
      });
      if (!ok) return;
      const r = await importRecords(data);
      toast(`${r.jobs} iş, ${r.folders} klasör aktarıldı`);
    } catch (e) {
      console.error(e);
      toast('Bu dosya okunamadı. Excel (.xlsx) dosyası seç.', 'err');
    }
  }

  async function render() {
    const summaries = await listFolders();
    const months = monthlySummary(summaries.flatMap((s) => s.jobs));
    const m = months.find((x) => x.month === month) || { month, count: 0, net: 0, vat: 0, total: 0, paid: 0, unpaid: 0 };
    const paidShare = m.total ? Math.round((m.paid / m.total) * 100) : 0;
    const debtors = summaries
      .map((s) => ({ s, due: s.jobs.filter((j) => !j.paid).reduce((a, j) => a + j.total, 0) }))
      .filter((x) => x.due > 0)
      .sort((a, b) => b.due - a.due);

    const hero = h('section', { class: 'earn-hero' },
      h('img', { class: 'earn-bg', src: 'img/earnings.webp', alt: '' }),
      h('div', { class: 'earn-month' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Önceki ay', onclick: () => { month = shiftMonth(month, -1); render(); } }, icon('chevron-left', 26)),
        h('b', {}, formatMonth(month)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sonraki ay', onclick: () => { month = shiftMonth(month, 1); render(); } }, icon('chevron-right', 26))),
      h('div', { class: 'earn-total' }, h('span', {}, 'Toplam ciro, KDV dahil'), h('b', { class: 'money' }, formatMoney(m.total))));

    const stats = h('section', { class: 'card section' },
      h('div', { class: 'metrics' },
        metric('İş sayısı', String(m.count)),
        metric('KDV hariç', formatMoney(m.net)),
        metric('KDV', formatMoney(m.vat)),
        metric('Bekleyen', formatMoney(m.unpaid), m.unpaid ? 'due' : '')),
      h('div', { class: 'collect' },
        h('div', { class: 'collect-text' }, h('span', {}, 'Tahsil edilen'), h('b', { class: 'money' }, `${formatMoney(m.paid)}`), h('span', {}, `%${paidShare}`)),
        h('div', { class: 'bar', role: 'img', 'aria-label': `Bu ayın yüzde ${paidShare} kadarı tahsil edildi` }, h('span', { style: { width: `${paidShare}%` } }))));

    const debtCard = h('section', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h3', {}, 'Alacaklar'), debtors.length > 0 && h('span', { class: 'badge due' }, `${debtors.length} kişi`)),
      debtors.length
        ? debtors.map(({ s, due }) => h('button', { class: 'jobrow', type: 'button', onclick: () => go(`/klasor/${s.folder.id}`) },
          h('div', { class: 'grow' }, h('b', {}, folderTitle(s.folder))),
          h('b', { class: 'money due-amount' }, formatMoney(due))))
        : h('p', { class: 'muted small' }, 'Kimsenin borcu yok.'));

    const excel = h('section', { class: 'card section excel-card' },
      h('div', { class: 'excel-head' },
        h('img', { src: 'img/ic-coins.webp', alt: '' }),
        h('div', {}, h('h3', {}, 'Excel'), h('p', { class: 'muted small' }, 'Dosyayı WhatsApp, mail ya da Dosyalar ile gönderebilirsin.'))),
      h('button', { class: 'btn primary block', type: 'button', onclick: (e) => exportExcel(e.currentTarget, true) }, icon('file-spreadsheet', 22), `${formatMonth(month)} Excel'i`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: (e) => exportExcel(e.currentTarget, false) }, icon('download', 20), 'Tüm kayıtlar'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, icon('upload', 20), "Excel'den al")),
      fileInput);

    const history = months.length > 0 && h('section', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h3', {}, 'Aylar')),
      months.map((x) => h('button', { class: `jobrow${x.month === month ? ' on' : ''}`, type: 'button', onclick: () => { month = x.month; render(); window.scrollTo(0, 0); } },
        h('div', { class: 'grow' }, h('b', {}, formatMonth(x.month)), h('span', {}, `${x.count} iş`)),
        h('b', { class: 'money' }, formatMoney(x.total)))));

    root.replaceChildren(hero, stats, debtCard, excel, history || '');
  }

  ctx.onLeave(onChange((c) => { if (c.type !== 'settings') render(); }));
  await render();
  return root;
}
