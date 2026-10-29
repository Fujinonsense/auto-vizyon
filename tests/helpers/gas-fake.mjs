// A small in-memory Google Apps Script world (Sheets, Drive, Properties…) that runs google/Code.gs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

class Range {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    return Array.from({ length: this.numRows }, (_, r) => {
      const src = this.sheet.data[this.row - 1 + r] || [];
      return Array.from({ length: this.numCols }, (_, c) => src[this.col - 1 + c] ?? '');
    });
  }
  getDisplayValues() { return this.getValues().map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : String(v)))); }
  setValues(values) {
    values.forEach((vals, r) => {
      const target = (this.sheet.data[this.row - 1 + r] ??= []);
      vals.forEach((v, c) => { target[this.col - 1 + c] = v; });
    });
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.numRows; }
  getSheet() { return this.sheet; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
  getLastRow() { return this.data.length; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(values) { this.data.push([...values]); return this; }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  clearContents() { this.data = []; return this; }
  setFrozenRows() {}
  setColumnWidth() {}
}

class Folder {
  constructor(drive, name) { Object.assign(this, { drive, name, id: randomUUID(), files: [], folders: [] }); drive.byId.set(this.id, this); }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  createFolder(name) { const f = new Folder(this.drive, name); this.folders.push(f); return f; }
  createFile(blob) {
    const file = { id: randomUUID(), blob, getId() { return this.id; }, getBlob() { return this.blob; }, getName() { return blob.getName(); } };
    this.files.push(file);
    this.drive.byId.set(file.id, file);
    return file;
  }
}

export function gasWorld() {
  const sheets = new Map();
  const spreadsheet = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/FAKE/edit',
  };
  const drive = { byId: new Map(), roots: [] };
  const props = new Map();
  const iter = (items) => ({ i: 0, hasNext() { return this.i < items.length; }, next() { return items[this.i++]; } });
  const pad = (n) => String(n).padStart(2, '0');

  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    DriveApp: {
      createFolder: (name) => { const f = new Folder(drive, name); drive.roots.push(f); return f; },
      getFoldersByName: (name) => iter(drive.roots.filter((f) => f.name === name)),
      getFolderById: (id) => { const f = drive.byId.get(id); if (!f) throw new Error('not found'); return f; },
      getFileById: (id) => { const f = drive.byId.get(id); if (!f) throw new Error('not found'); return f; },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      createTextOutput: (text) => ({ text, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }),
      MimeType: { JSON: 'json', CSV: 'csv', TEXT: 'text' },
    },
    Utilities: {
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => bytes, getName: () => name }),
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      getUuid: () => randomUUID(),
      // The script time zone is this machine's, like new Date(y, m, d) inside Apps Script.
      formatDate: (d, tz, fmt) => {
        const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        if (fmt === 'yyyy-MM') return ym;
        const s = `${ym}-${pad(d.getDate())}`;
        return fmt.includes('HH') ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
      },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    Logger: { log() {} },
    console,
    Date,
    JSON,
    Math,
  });
  vm.runInContext(readFileSync(new URL('../../google/Code.gs', import.meta.url), 'utf8'), context);

  // fetch as the phone would call the deployed web app
  const fetchStub = async (url, init = {}) => {
    const out = init.method === 'POST'
      ? context.doPost({ postData: { contents: init.body } })
      : context.doGet({ parameter: Object.fromEntries(new URL(url).searchParams) });
    const text = out.getContent();
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };

  return { context, sheets, drive, props, fetch: fetchStub };
}
