/**
 * Auto Vizyon — Google tarafı (E-Tablo + Drive).
 *
 * Kurulum (bir kere):
 *  1. Google Drive'da yeni bir E-Tablo aç, adını "Auto Vizyon" koy.
 *  2. Uzantılar → Apps Script. Açılan dosyanın içini silip bu dosyanın tamamını yapıştır, kaydet.
 *  3. Üstten "kurulum" fonksiyonunu seçip Çalıştır'a bas, izin ver. Yürütme günlüğünde Google anahtarı yazar.
 *  4. Dağıt → Yeni dağıtım → Tür: Web uygulaması, Çalıştıran: Ben, Erişimi olan: Herkes → Dağıt.
 *     Çıkan "Web uygulaması" adresini ve anahtarı kurulum koduna yaz.
 *
 * Telefon her değişikliği buraya yazar, buradaki elle düzeltmeleri geri okur. Fotoğraflar Drive'da
 * "Auto Vizyon" klasöründe her müşteriye ayrı klasöre kaydedilir.
 */

var SHEET_JOBS = 'İşler';
var SHEET_FOLDERS = 'Müşteriler';
var SHEET_SUMMARY = 'Özet';
var STAMP = 'Güncellendi';
var JOB_ID = 'Kayıt No';
var FOLDER_ID = 'Klasör No';
var DRIVE_LINK = 'Drive Klasörü';
var ROOT_FOLDER = 'Auto Vizyon';

// Must stay identical to app/js/excel/columns.js (a test checks it).
var JOB_HEADERS = ['Tarih', 'Müşteri', 'Telefon', 'Plaka', 'Araç', 'Model Yılı', 'Şase No', 'Yapılan İş', 'Parçalar',
  'Tutar (KDV Hariç)', 'KDV Oranı', 'KDV', 'Toplam (KDV Dahil)', 'Ödeme', 'Ödeyen', 'Sigorta Şirketi', 'Dosya No', 'Not',
  'Güncellendi', 'Kayıt No', 'Klasör No'];
var FOLDER_HEADERS = ['Ad Soyad', 'Telefon', 'Plaka', 'Marka', 'Model', 'Renk', 'Model Yılı', 'Şase No', 'Motor No',
  'Ticari Adı', 'Ruhsat Sahibi', 'Ruhsat TC/VKN', 'Belge Seri No', 'Tescil Tarihi', 'Ruhsat Tipi', 'Ehliyet Ad Soyad',
  'Ehliyet TC', 'Ehliyet No', 'Ehliyet Sınıfı', 'Ehliyet Veriliş', 'Ehliyet Doğum Tarihi', 'Kimlik Ad Soyad', 'Kimlik TC',
  'Kimlik Doğum Tarihi', 'Kimlik Seri No', 'Kimlik Geçerlilik', 'Drive Klasörü', 'Not', 'Güncellendi', 'Klasör No'];
var SUMMARY_HEADERS = ['Ay', 'İş Sayısı', 'KDV Hariç', 'KDV', 'Toplam', 'Tahsil Edilen', 'Bekleyen'];
var MONEY = ['Tutar (KDV Hariç)', 'KDV', 'Toplam (KDV Dahil)'];
var KIND = { arac: 'Araç', once: 'Hasar öncesi', sonra: 'Hasar sonrası', ruhsat: 'Ruhsat', ehliyet: 'Ehliyet', kimlik: 'Kimlik' };

function kurulum() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  prepareSheet_(ss, SHEET_JOBS, JOB_HEADERS);
  prepareSheet_(ss, SHEET_FOLDERS, FOLDER_HEADERS);
  prepareSheet_(ss, SHEET_SUMMARY, SUMMARY_HEADERS);
  rootFolder_();
  var props = props_();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  Logger.log('Google anahtarı (kurulum koduna yaz): ' + token);
  return token;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!authorized_(p.token)) return json_({ ok: false, error: 'token' });
  if (p.action === 'csv') return csv_(p.sheet === 'musteriler' ? SHEET_FOLDERS : SHEET_JOBS);
  return json_(handle_(p));
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'json' });
  }
  if (!authorized_(body.token)) return json_({ ok: false, error: 'token' });
  return json_(handle_(body));
}

// Manual edits in the sheet: stamp the row so the phone picks it up, keep KDV and total right.
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var name = sh.getName();
  if (name !== SHEET_JOBS && name !== SHEET_FOLDERS) return;
  var headers = headers_(sh);
  var stampCol = headers.indexOf(STAMP) + 1;
  var last = e.range.getRow() + e.range.getNumRows() - 1;
  for (var r = Math.max(2, e.range.getRow()); r <= last; r++) {
    sh.getRange(r, stampCol).setValue(new Date());
    if (name === SHEET_JOBS) recompute_(sh, headers, r);
  }
}

function handle_(req) {
  if (req.action === 'ping') return { ok: true, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(), serverTime: Date.now() };
  if (req.action === 'pull') return pull_(Number(req.since) || 0);
  var ops = req.ops || [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var results = ops.map(runOp_);
    if (ops.some(function (o) { return o.op !== 'photo'; })) writeSummary_();
    return { ok: true, results: results, serverTime: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

function runOp_(op) {
  try {
    switch (op.op) {
      case 'upsertFolder': return upsertFolder_(op);
      case 'upsertJob': return upsert_(SHEET_JOBS, JOB_ID, op.row || {});
      case 'deleteFolder':
        deleteRows_(SHEET_FOLDERS, FOLDER_ID, op.id);
        deleteRows_(SHEET_JOBS, FOLDER_ID, op.id);
        return { ok: true };
      case 'deleteJob':
        deleteRows_(SHEET_JOBS, JOB_ID, op.id);
        return { ok: true };
      case 'photo': return savePhoto_(op);
      default: return { ok: false, error: 'op' };
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Writes the known columns of one row; columns the app doesn't send (or added by hand) are kept.
function upsert_(name, idHeader, row) {
  var id = row[idHeader];
  if (!id) return { ok: false, error: 'id' };
  var sh = sheet_(name);
  var headers = headers_(sh);
  var r = findRow_(sh, headers.indexOf(idHeader), id);
  var existing = r ? sh.getRange(r, 1, 1, headers.length).getValues()[0] : null;
  var values = headers.map(function (h, i) {
    if (h === STAMP) return new Date();
    if (!(h in row)) return existing ? existing[i] : '';
    if (h === 'Tarih') return toDate_(row[h]);
    return safe_(row[h]);
  });
  if (r) sh.getRange(r, 1, 1, headers.length).setValues([values]);
  else sh.appendRow(values);
  return { ok: true };
}

function upsertFolder_(op) {
  var row = op.row || {};
  delete row[DRIVE_LINK]; // the Drive link is written here, never by the phone
  var res = upsert_(SHEET_FOLDERS, FOLDER_ID, row);
  var driveId = props_().getProperty('DRIVE_' + row[FOLDER_ID]);
  if (driveId && op.title) {
    try {
      var folder = DriveApp.getFolderById(driveId);
      if (folder.getName() !== op.title) folder.setName(op.title);
      res.driveUrl = folder.getUrl();
    } catch (err) {
      // folder removed from Drive by hand: a new one is made with the next photo
    }
  }
  return res;
}

function savePhoto_(op) {
  var folder = driveFolder_(op.folderId, op.title);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var name = (KIND[op.kind] || 'Fotoğraf') + ' ' + stamp + ' ' + String(op.photoId).slice(0, 6) + '.jpg';
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(op.base64), 'image/jpeg', name));
  setCell_(SHEET_FOLDERS, FOLDER_ID, op.folderId, DRIVE_LINK, folder.getUrl());
  return { ok: true, driveFileId: file.getId(), driveUrl: folder.getUrl() };
}

function driveFolder_(folderId, title) {
  var props = props_();
  var key = 'DRIVE_' + folderId;
  var id = props.getProperty(key);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      // removed by hand: make a new one below
    }
  }
  var folder = rootFolder_().createFolder(title || String(folderId));
  props.setProperty(key, folder.getId());
  return folder;
}

function rootFolder_() {
  var props = props_();
  var id = props.getProperty('ROOT');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      // removed by hand: find or make it again
    }
  }
  var found = DriveApp.getFoldersByName(ROOT_FOLDER);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(ROOT_FOLDER);
  props.setProperty('ROOT', folder.getId());
  return folder;
}

function pull_(since) {
  return { ok: true, folders: rowsSince_(SHEET_FOLDERS, since), jobs: rowsSince_(SHEET_JOBS, since), serverTime: Date.now() };
}

// Dates leave as "yyyy-MM-dd" and the stamp as milliseconds, so the phone never sees time zones.
function rowsSince_(name, since) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = headers_(sh);
  var stampCol = headers.indexOf(STAMP);
  var tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, last - 1, headers.length).getValues()
    .filter(function (r) { return toMs_(r[stampCol]) > since; })
    .map(function (r) {
      var o = {};
      headers.forEach(function (h, i) {
        var v = r[i];
        if (v instanceof Date) v = h === STAMP ? v.getTime() : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        o[h] = v;
      });
      return o;
    });
}

function recompute_(sh, headers, r) {
  var row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
  var net = Number(row[headers.indexOf('Tutar (KDV Hariç)')]) || 0;
  var rawRate = row[headers.indexOf('KDV Oranı')];
  var rate = rawRate === '' ? 20 : Number(rawRate) || 0;
  var vat = Math.round(net * rate) / 100;
  sh.getRange(r, headers.indexOf('KDV') + 1).setValue(vat);
  sh.getRange(r, headers.indexOf('Toplam (KDV Dahil)') + 1).setValue(Math.round((net + vat) * 100) / 100);
}

function writeSummary_() {
  var jobs = sheet_(SHEET_JOBS);
  var headers = headers_(jobs);
  var col = function (h) { return headers.indexOf(h); };
  var months = {};
  var last = jobs.getLastRow();
  if (last >= 2) {
    jobs.getRange(2, 1, last - 1, headers.length).getValues().forEach(function (r) {
      var d = r[col('Tarih')];
      if (!(d instanceof Date)) return;
      var key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
      var m = months[key] || (months[key] = [key, 0, 0, 0, 0, 0, 0]);
      var total = Number(r[col('Toplam (KDV Dahil)')]) || 0;
      m[1] += 1;
      m[2] += Number(r[col('Tutar (KDV Hariç)')]) || 0;
      m[3] += Number(r[col('KDV')]) || 0;
      m[4] += total;
      if (String(r[col('Ödeme')]).toLowerCase().indexOf('ödendi') === 0) m[5] += total;
      else m[6] += total;
    });
  }
  var summary = sheet_(SHEET_SUMMARY);
  summary.clearContents();
  summary.appendRow(SUMMARY_HEADERS);
  Object.keys(months).sort().reverse().forEach(function (k) { summary.appendRow(months[k]); });
}

// For the computer's Excel (Power Query): plain numbers, ISO dates, UTF-8.
function csv_(name) {
  var sh = sheet_(name);
  var headers = headers_(sh);
  var tz = Session.getScriptTimeZone();
  var lines = [headers.map(quote_).join(',')];
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, headers.length).getValues().forEach(function (r) {
      lines.push(r.map(function (v, i) {
        if (v instanceof Date) return quote_(Utilities.formatDate(v, tz, headers[i] === STAMP ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'));
        if (typeof v === 'number') return String(v);
        return quote_(v);
      }).join(','));
    });
  }
  return ContentService.createTextOutput(lines.join('\r\n')).setMimeType(ContentService.MimeType.CSV);
}

function prepareSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#111111').setFontColor('#F3E3B8');
  sh.setFrozenRows(1);
  headers.forEach(function (h, i) {
    var column = sh.getRange(2, i + 1, 999, 1);
    if (h === 'Tarih') column.setNumberFormat('dd.mm.yyyy');
    else if (h === STAMP) column.setNumberFormat('dd.mm.yyyy hh:mm');
    else if (MONEY.indexOf(h) >= 0 || (name === SHEET_SUMMARY && i > 1)) column.setNumberFormat('#,##0.00 "₺"');
    else if (h === 'KDV Oranı' || (name === SHEET_SUMMARY && i === 1)) column.setNumberFormat('0');
    else column.setNumberFormat('@');
  });
  return sh;
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var headers = name === SHEET_JOBS ? JOB_HEADERS : name === SHEET_FOLDERS ? FOLDER_HEADERS : SUMMARY_HEADERS;
  return prepareSheet_(ss, name, headers);
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function findRow_(sh, idCol, id) {
  var last = sh.getLastRow();
  if (last < 2 || idCol < 0) return 0;
  var ids = sh.getRange(2, idCol + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function deleteRows_(name, header, id) {
  var sh = sheet_(name);
  var col = headers_(sh).indexOf(header);
  if (col < 0) return;
  for (var r = sh.getLastRow(); r >= 2; r--) {
    if (String(sh.getRange(r, col + 1).getValue()) === String(id)) sh.deleteRow(r);
  }
}

function setCell_(name, idHeader, id, header, value) {
  var sh = sheet_(name);
  var headers = headers_(sh);
  var r = findRow_(sh, headers.indexOf(idHeader), id);
  if (r) sh.getRange(r, headers.indexOf(header) + 1).setValue(value);
}

// A leading apostrophe makes Sheets keep "=…" as text instead of running it as a formula.
function safe_(v) {
  return typeof v === 'string' && v.charAt(0) === '=' ? "'" + v : v;
}

function toDate_(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : v;
}

function toMs_(v) {
  return v instanceof Date ? v.getTime() : Number(v) || 0;
}

function authorized_(token) {
  var expected = props_().getProperty('TOKEN');
  return !!expected && token === expected;
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function quote_(v) {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
