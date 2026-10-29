// Sync status in the home top bar and the Google card in Ayarlar.
import { syncSlot } from './chrome.js';
import { onSyncStatus, syncStatus, syncNow, testConnection, excelQueryCode } from '../sync/google.js';
import { settingsExtras } from './screens/settings.js';
import { setSetting } from '../data/repo.js';
import { h, icon, toast, spinner, copyText } from './dom.js';
import { go } from './router.js';

const LABEL = { off: 'Google bağlı değil', ok: 'Google ile eşit', syncing: 'Eşitleniyor', pending: 'İnternet bekleniyor', error: 'Eşitlenemedi' };
const ICON = { ok: 'cloud-check', pending: 'cloud', error: 'cloud-off' };

function renderSlot(st) {
  if (st.state === 'off') return syncSlot.replaceChildren();
  syncSlot.replaceChildren(h('button', {
    class: `icon-btn sync ${st.state}`, type: 'button', 'aria-label': LABEL[st.state], title: st.error || LABEL[st.state],
    onclick: () => go('/ayarlar'),
  }, st.state === 'syncing' ? spinner(22) : icon(ICON[st.state], 24)));
}

const time = (ms) => (ms ? new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(ms) : '');

function googleCard({ settings, rerender }) {
  const url = h('input', {
    type: 'url', value: settings.scriptUrl, placeholder: 'https://script.google.com/macros/s/…/exec', autocapitalize: 'off', spellcheck: 'false',
    onchange: async () => { await setSetting('scriptUrl', url.value.trim()); toast('Google adresi kaydedildi'); },
  });
  const token = h('input', {
    type: 'password', value: settings.token, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    onchange: async () => { await setSetting('token', token.value.trim()); toast('Google anahtarı kaydedildi'); },
  });
  const status = syncStatus.state === 'ok'
    ? `Eşitlendi${syncStatus.lastSync ? `, saat ${time(syncStatus.lastSync)}` : ''}`
    : syncStatus.error || LABEL[syncStatus.state];
  const sheetLink = h('div');

  const tryBtn = h('button', {
    class: 'btn small', type: 'button',
    onclick: async () => {
      tryBtn.replaceChildren(spinner(18), 'Deneniyor');
      try {
        const sheetUrl = await testConnection(url.value.trim(), token.value.trim());
        toast('Google bağlantısı tamam');
        sheetLink.replaceChildren(h('a', { class: 'btn small ghost', href: sheetUrl, target: '_blank', rel: 'noopener' }, icon('file-spreadsheet', 18), 'Tabloyu aç'));
      } catch (e) {
        toast(e.message || 'Google adresine ulaşılamadı', 'err');
      }
      tryBtn.replaceChildren(icon('check', 18), 'Bağlantıyı dene');
    },
  }, icon('check', 18), 'Bağlantıyı dene');

  const syncBtn = h('button', {
    class: 'btn small primary', type: 'button',
    onclick: async () => {
      syncBtn.replaceChildren(spinner(18), 'Eşitleniyor');
      await syncNow();
      toast(syncStatus.state === 'ok' ? 'Eşitlendi' : syncStatus.error || 'Eşitlenemedi', syncStatus.state === 'ok' ? '' : 'err');
      rerender();
    },
  }, icon('refresh', 18), 'Şimdi eşitle');

  return h('section', { class: 'card section stack' },
    h('div', { class: 'section-head' }, h('h3', {}, 'Google ve bilgisayar Excel\'i')),
    h('p', { class: `small ${syncStatus.state === 'ok' ? 'ok-text' : syncStatus.state === 'error' ? 'due-text' : 'muted'}` }, status),
    h('label', { class: 'field' }, h('span', {}, 'Google Apps Script adresi'), url),
    h('label', { class: 'field' }, h('span', {}, 'Google anahtarı'), token),
    h('div', { class: 'row-flex', style: { flexWrap: 'wrap' } }, tryBtn, syncBtn),
    sheetLink,
    h('p', { class: 'muted small' }, "Bilgisayardaki Excel'de Veri → Veri Al → Boş Sorgu → Gelişmiş Düzenleyici'ye bu kodu yapıştır. Excel tabloyu kendiliğinden yeniler."),
    h('button', {
      class: 'btn block', type: 'button',
      onclick: () => {
        if (!url.value.trim() || !token.value.trim()) return toast('Önce Google adresi ve anahtarı gir', 'err');
        copyText(excelQueryCode(url.value.trim(), token.value.trim()), 'Excel kodu');
      },
    }, icon('copy', 20), "Bilgisayar Excel'i için kodu kopyala"));
}

export function initSyncUi() {
  onSyncStatus(renderSlot);
  renderSlot(syncStatus);
  settingsExtras.push(googleCard);
}
