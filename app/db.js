// Tiny IndexedDB wrapper. Mail stays in this browser; nothing is sent to any server.
// Demo mode (?demo) uses its own database so sample mail never mixes with real mail.
const DB_NAME = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo') ? 'tlg-mail-demo' : 'tlg-mail';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const msgs = db.createObjectStore('messages', { keyPath: 'id' });
      msgs.createIndex('threadId', 'threadId');
      db.createObjectStore('threads', { keyPath: 'threadId' });
      db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => wrap(s.getAll()));
export const get = (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key)));
export const put = (store, values) => tx(store, 'readwrite', (s) => { for (const v of [].concat(values)) s.put(v); });
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear());
export const byThread = (threadId) => tx('messages', 'readonly', (s) => wrap(s.index('threadId').getAll(threadId)));
export const existingIds = (ids) => tx('messages', 'readonly', async (s) => {
  const keys = new Set(await wrap(s.getAllKeys()));
  return ids.filter((id) => keys.has(id));
});
export const kvGet = async (k, dflt = null) => (await get('kv', k))?.v ?? dflt;
export const kvSet = (k, v) => put('kv', { k, v });
