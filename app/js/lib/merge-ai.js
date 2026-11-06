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
  // Never used for the folder name: which of the two drivers is the customer is not known.
  tutanak: {
    aAdSoyad: 'tutanak.aAdSoyad', aTc: 'tutanak.aTc', aEhliyet: 'tutanak.aEhliyet', aAlindigiYer: 'tutanak.aAlindigiYer',
    aAdres: 'tutanak.aAdres', aTel: 'tutanak.aTel', aPlaka: 'tutanak.aPlaka',
    bAdSoyad: 'tutanak.bAdSoyad', bTc: 'tutanak.bTc', bEhliyet: 'tutanak.bEhliyet', bAlindigiYer: 'tutanak.bAlindigiYer',
    bAdres: 'tutanak.bAdres', bTel: 'tutanak.bTel', bPlaka: 'tutanak.bPlaka',
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

function deletePath(obj, path) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o?.[k], obj);
  if (parent && typeof parent === 'object') delete parent[last];
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

// A document that a new photo replaces as a whole (the accident report: one reading of one accident).
// What the AI read from the last photo goes first, marks and all, so a field the new photo leaves empty is
// empty again and a field it could not read is marked to check. Fields typed by hand are not AI-filled
// and stay. The document is there afterwards even if nothing could be read, so it replaces the last one.
export function replaceAi(folder, kind, fields, unclearKeys = []) {
  const paths = Object.entries(AI_PATHS[kind]);
  const own = new Set(paths.map(([, path]) => path));
  const ai = new Set(folder.aiFilled || []);
  for (const path of own) if (ai.has(path)) deletePath(folder, path);
  folder.aiFilled = [...ai].filter((p) => !own.has(p));
  folder.unclear = (folder.unclear || []).filter((p) => !own.has(p));
  for (const path of own) if (path.includes('.')) folder[path.split('.')[0]] ??= {};
  const changed = mergeAi(folder, kind, fields, unclearKeys);
  for (const [key, path] of paths) {
    if (!fields[key] && unclearKeys.includes(key) && !getPath(folder, path)) folder.unclear.push(path);
  }
  return changed;
}

export function markManual(folder, path) {
  folder.aiFilled = (folder.aiFilled || []).filter((p) => p !== path);
  folder.unclear = (folder.unclear || []).filter((p) => p !== path);
}
