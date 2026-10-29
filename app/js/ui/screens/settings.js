// Ayarlar: setup code, AI key and model, KDV, WhatsApp text, Google link, backup.
import { getSettings, setSetting } from '../../data/repo.js';
import { decodeSetup } from '../../lib/setupcode.js';
import { testKey, OPUS, HAIKU } from '../../ai/claude.js';
import { exportBackup, restoreBackup } from '../../data/backup.js';
import { shareOrDownload } from '../../excel/xlsx.js';
import { todayIso } from '../../lib/format.js';
import { h, icon, toast, seg, spinner, confirmSheet } from '../dom.js';
import { setTopbar, setTab } from '../chrome.js';
import { showWelcome } from '../welcome.js';

const MODEL_HINT = {
  [OPUS]: 'En doğru okuyan. Araç ve ruhsat başına yaklaşık 5 cent.',
  [HAIKU]: 'Çok ucuz, araç başına yaklaşık 0,1 cent. Zor fotoğraflarda daha sık yanılır.',
};

// Extra cards (Google sync) register here so this screen doesn't import them.
export const settingsExtras = [];

const card = (title, ...children) => h('section', { class: 'card section stack' }, h('div', { class: 'section-head' }, h('h3', {}, title)), ...children);
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint && h('small', { class: 'muted small' }, hint));

export async function settingsScreen(params, ctx) {
  setTopbar({ title: 'Ayarlar', back: '/' });
  setTab('');
  const root = h('div', { class: 'stack' });

  async function render() {
    const s = await getSettings();
    const saved = (key, label = 'Kaydedildi') => async (value) => {
      await setSetting(key, value);
      toast(label);
    };

    // Setup code
    const codeBox = h('textarea', { class: 'input', rows: 3, placeholder: 'AV1-…', autocapitalize: 'off', spellcheck: 'false' });
    async function applyCode(text) {
      try {
        const setup = decodeSetup(text);
        for (const [k, v] of Object.entries(setup)) await setSetting(k, v);
        toast('Kurulum tamam');
        render();
      } catch (e) {
        toast(e.message, 'err');
      }
    }
    const setupCard = card('Kurulum kodu',
      h('p', { class: 'muted small' }, 'Oğlunun gönderdiği kodu kopyala, sonra "Yapıştır"a bas. Anahtar ve Google bağlantısı kendiliğinden ayarlanır.'),
      h('button', {
        class: 'btn primary block', type: 'button',
        onclick: async () => {
          try {
            await applyCode(await navigator.clipboard.readText());
          } catch {
            codeBox.focus();
            toast('Kodu aşağıdaki kutuya yapıştır', 'err');
          }
        },
      }, icon('clipboard', 22), 'Yapıştır'),
      codeBox,
      h('button', { class: 'btn block', type: 'button', onclick: () => applyCode(codeBox.value) }, 'Kutudaki kodu uygula'));

    // AI
    const keyInput = h('input', {
      type: 'password', value: s.apiKey, placeholder: 'sk-ant-…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      onchange: () => saved('apiKey', 'Anahtar kaydedildi')(keyInput.value.trim()),
    });
    const hint = h('small', { class: 'muted small' }, MODEL_HINT[s.model] || '');
    const testBtn = h('button', {
      class: 'btn small', type: 'button',
      onclick: async () => {
        testBtn.replaceChildren(spinner(18), 'Deneniyor');
        try {
          await testKey(keyInput.value.trim(), (await getSettings()).model);
          toast('Anahtar çalışıyor');
        } catch (e) {
          toast(e.message, 'err');
        }
        testBtn.replaceChildren(icon('check', 18), 'Anahtarı dene');
      },
    }, icon('check', 18), 'Anahtarı dene');
    const aiCard = card('Yapay zeka',
      h('p', { class: `small ${s.apiKey ? 'ok-text' : 'due-text'}` }, s.apiKey ? `Anahtar kayıtlı (…${s.apiKey.slice(-4)})` : 'Anahtar yok, fotoğraflar okunmaz'),
      field('Anthropic API anahtarı', keyInput),
      h('div', { class: 'row-flex' },
        testBtn,
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } }, icon('eye', 18), 'Göster')),
      field('Model', seg([[OPUS, 'En doğru'], [HAIKU, 'En ucuz']], s.model, async (v) => {
        hint.textContent = MODEL_HINT[v];
        await saved('model', 'Model değişti')(v);
      }), null),
      hint);

    // KDV
    const rate = h('input', {
      class: 'input', inputmode: 'numeric', value: String(s.vatRate),
      onchange: () => {
        const n = Number(rate.value.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 100) return toast('KDV oranı 0 ile 100 arasında olmalı', 'err');
        saved('vatRate', 'KDV oranı kaydedildi')(n);
      },
    });
    const vatCard = card('KDV',
      field('Oran (%)', rate),
      field('Tutarı yazarken', seg([['haric', 'KDV hariç'], ['dahil', 'KDV dahil']], s.vatMode, saved('vatMode')), 'Yeni işlerde bu seçili gelir.'));

    // WhatsApp
    const wa = h('textarea', { rows: 3, value: s.waTemplate, onchange: () => saved('waTemplate', 'Mesaj kaydedildi')(wa.value) });
    const waCard = card('WhatsApp mesajı', field('"Aracınız hazır" mesajı', wa, '{ad} müşterinin adı, {plaka} aracın plakası olarak yazılır.'));

    // Backup
    const restoreInput = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: async () => {
        const file = restoreInput.files[0];
        restoreInput.value = '';
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          const ok = await confirmSheet({ title: 'Yedek yüklensin mi?', message: `${data.folders?.length ?? 0} klasör ve ${data.jobs?.length ?? 0} iş eklenecek ya da güncellenecek.`, okText: 'Yükle' });
          if (!ok) return;
          const r = await restoreBackup(data);
          toast(`${r.folders} klasör, ${r.jobs} iş yüklendi`);
        } catch (e) {
          toast(e.message || 'Yedek dosyası okunamadı', 'err');
        }
      },
    });
    const backupCard = card('Yedek',
      h('p', { class: 'muted small' }, 'Bilgiler yedeklenir; fotoğraflar Google Drive\'da durur. Yedekte anahtarlar yer almaz.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            const blob = new Blob([JSON.stringify(await exportBackup())], { type: 'application/json' });
            await shareOrDownload(blob, `AutoVizyon-yedek-${todayIso()}.json`);
          },
        }, icon('download', 20), 'Yedek al'),
        h('button', { class: 'btn', type: 'button', onclick: () => restoreInput.click() }, icon('upload', 20), 'Yedekten yükle')),
      restoreInput);

    const appCard = card('Uygulama',
      h('button', { class: 'btn block', type: 'button', onclick: () => showWelcome() }, icon('star', 20), 'Karşılama ekranını göster'),
      h('p', { class: 'muted small' }, 'Auto Vizyon 1.0, sadece bu telefonda çalışır.'));

    root.replaceChildren(setupCard, aiCard, vatCard, waCard, ...settingsExtras.map((make) => make({ settings: s, rerender: render })), backupCard, appCard);
  }

  await render();
  return root;
}
