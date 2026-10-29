// What the folder screen shows and copies (for insurance forms), and the call / WhatsApp links.
import { getPath } from './merge-ai.js';
import { formatPhone, normalizePhone, waNumber } from './format.js';

const SECTIONS = [
  ['musteri', 'Müşteri', [['Ad soyad', 'name'], ['Telefon', 'phone']]],
  ['arac', 'Araç', [
    ['Plaka', 'plate'], ['Marka', 'brand'], ['Model', 'model'], ['Renk', 'color'], ['Model yılı', 'modelYear'],
    ['Şase no', 'vin'], ['Motor no', 'engineNo'], ['Ticari adı', 'modelFull'],
  ]],
  ['ruhsat', 'Ruhsat', [
    ['Ruhsat sahibi', 'ruhsat.sahibi'], ['TC / Vergi no', 'ruhsat.tcVkn'], ['Belge seri no', 'ruhsat.belgeSeriNo'],
    ['Tescil tarihi', 'ruhsat.tescilTarihi'], ['Tipi', 'ruhsat.tipi'],
  ]],
  ['ehliyet', 'Ehliyet', [
    ['Ad soyad', 'ehliyet.adSoyad'], ['TC kimlik no', 'ehliyet.tc'], ['Ehliyet no', 'ehliyet.ehliyetNo'],
    ['Sınıf', 'ehliyet.sinif'], ['Veriliş tarihi', 'ehliyet.verilisTarihi'], ['Doğum tarihi', 'ehliyet.dogumTarihi'],
  ]],
  ['kimlik', 'Kimlik', [
    ['Ad soyad', 'kimlik.adSoyad'], ['TC kimlik no', 'kimlik.tc'], ['Doğum tarihi', 'kimlik.dogumTarihi'],
    ['Seri no', 'kimlik.seriNo'], ['Son geçerlilik', 'kimlik.gecerlilik'],
  ]],
];

export function folderSections(folder) {
  return SECTIONS.map(([kind, title, rows]) => ({
    kind,
    title,
    rows: rows.map(([label, path]) => {
      const raw = String(getPath(folder, path) ?? '').trim();
      return { label, value: path === 'phone' ? formatPhone(raw) : raw, path };
    }),
  }));
}

export function sectionCopyText(rows) {
  return rows.filter((r) => r.value).map((r) => `${r.label}: ${r.value}`).join('\n');
}

export function folderCopyText(folder) {
  return folderSections(folder).map((s) => sectionCopyText(s.rows)).filter(Boolean).join('\n\n');
}

export function waLink(folder, template) {
  const number = waNumber(folder.phone);
  if (!number) return '';
  const text = template.replaceAll('{ad}', folder.name || '').replaceAll('{plaka}', folder.plate || '').trim();
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function telLink(phone) {
  const d = normalizePhone(phone);
  return d ? `tel:${d}` : '';
}
