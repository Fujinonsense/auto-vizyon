// Thin promise wrapper over IndexedDB: one database, five stores.

const DB_NAME = 'autovizyon';
const VERSION = 1;
const STORES = ['folders', 'jobs', 'photos', 'settings', 'outbox'];
let dbPromise = null;

export function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('folders', { keyPath: 'id' });
      db.createObjectStore('jobs', { keyPath: 'id' }).createIndex('folderId', 'folderId');
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('folderId', 'folderId');
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export const get = async (name, key) => result((await store(name)).get(key));
export const all = async (name, count) => result((await store(name)).getAll(undefined, count));
export const byIndex = async (name, index, value) => result((await store(name)).index(index).getAll(value));
export const keysByIndex = async (name, index, value) => result((await store(name)).index(index).getAllKeys(value));
export const put = async (name, value) => result((await store(name, 'readwrite')).put(value));

// Writes that must land together. fn gets {storeName: IDBObjectStore} and may only issue
// requests synchronously or from other requests' callbacks (keeps the transaction alive).
export async function write(names, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    fn(Object.fromEntries(names.map((n) => [n, t.objectStore(n)])));
  });
}

export async function clearAll() {
  await write(STORES, (s) => STORES.forEach((n) => s[n].clear()));
}
