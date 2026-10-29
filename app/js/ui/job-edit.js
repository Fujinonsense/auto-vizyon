// Bottom sheet to add or edit one job of a folder.
import { getSettings, saveJob, deleteJob } from '../data/repo.js';
import { todayIso } from '../lib/format.js';
import { h, icon, sheet, toast, confirmSheet } from './dom.js';
import { jobFields } from './job-fields.js';

export async function openJobSheet(folderId, job = null) {
  const s = await getSettings();
  const ui = jobFields(job || {}, { vatRate: s.vatRate, vatMode: s.vatMode });
  const date = h('input', { class: 'input', type: 'date', value: job?.date || todayIso() });
  const note = h('textarea', { rows: 2, placeholder: 'İsteğe bağlı', value: job?.note || '' });

  async function save() {
    await saveJob({ ...(job ? { id: job.id } : {}), folderId, ...ui.read(), date: date.value || todayIso(), note: note.value });
    toast('Kaydedildi');
    ref.close();
  }

  async function remove() {
    const ok = await confirmSheet({ title: 'İş silinsin mi?', message: 'Bu işin tutarı kazanç ve Excel listesinden de çıkar.', okText: 'Sil', danger: true });
    if (!ok) return;
    await deleteJob(job.id);
    toast('İş silindi');
    ref.close();
  }

  const ref = sheet(h('div', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Tarih'), date),
    ui.el,
    h('label', { class: 'field' }, h('span', {}, 'Not'), note),
    h('button', { class: 'btn primary block', type: 'button', onclick: save }, icon('check'), 'Kaydet'),
    job && h('button', { class: 'btn danger ghost block', type: 'button', onclick: remove }, icon('trash', 20), 'İşi sil')),
  { title: job ? 'İşi düzenle' : 'Yeni iş' });
}
