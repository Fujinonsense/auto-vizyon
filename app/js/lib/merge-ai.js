// Writes what the AI read into a folder without ever overwriting what the dad typed.
// folder.aiFilled: paths the AI wrote and nobody edited since; folder.unclear: paths to double-check.

export const AI_PATHS = {
  arac: { plaka: 'plate', renk: 'color', marka: 'brand', model: 'model' },
  ruhsat: {
    plaka: 'plate', marka: 'brand', model: 'model', ticariAdi: 'modelFull', tipi: 'ruhsat.tipi',
    modelYili: 'modelYear', renk: 'color', saseNo: 'vin', motorNo: 'engineNo', sahibiAdSoyad: 'ruhsat.sahibi',
    tcVkn: 'ruhsat.tcVkn', belgeSeriNo: 'ruhsat.belgeSeriNo', tescilTarihi: 'ruhsat.tescilTarihi',
  },
  ehliyet: {
    adSoyad: 'ehliyet.adSoyad', tc: 'ehliyet.tc', ehliyetNo: 'ehliyet.ehliyetNo', sinif: 'ehliyet.sinif',
    verilisTarihi: 'ehliyet.verilisTarihi', dogumTarihi: 'ehliyet.dogumTarihi',
  },
  kimlik: {
    adSoyad: 'kimlik.adSoyad', tc: 'kimlik.tc', dogumTarihi: 'kimlik.dogumTarihi', seriNo: 'kimlik.seriNo',
    gecerlilik: 'kimlik.gecerlilik',
  },
};

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) o = o[k] ??= {};
  o[last] = value;
}

export function mergeAi(folder, kind, fields, unclearKeys = []) {
  const ai = new Set(folder.aiFilled || []);
  const unclear = new Set(folder.unclear || []);
  const changed = [];
  for (const [key, path] of Object.entries(AI_PATHS[kind])) {
    const value = fields[key];
    if (!value) continue;
    const current = getPath(folder, path);
    if (current && !ai.has(path)) continue;
    if (current !== value) {
      setPath(folder, path, value);
      changed.push(path);
    }
    ai.add(path);
    if (unclearKeys.includes(key)) unclear.add(path);
    else unclear.delete(path);
  }
  if (!folder.name || ai.has('name')) {
    const name = folder.ruhsat?.sahibi || folder.kimlik?.adSoyad || folder.ehliyet?.adSoyad;
    if (name && name !== folder.name) {
      folder.name = name;
      ai.add('name');
      changed.push('name');
    }
  }
  folder.aiFilled = [...ai];
  folder.unclear = [...unclear];
  return changed;
}

export function markManual(folder, path) {
  folder.aiFilled = (folder.aiFilled || []).filter((p) => p !== path);
  folder.unclear = (folder.unclear || []).filter((p) => p !== path);
}
