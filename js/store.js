import { seed, migrate, validate } from './model.js';
let db;
export async function openStore() {
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('chad', 3);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('state')) r.result.createObjectStore('state'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('Close other Chad tabs and try again'));
  });
  db.onversionchange = () => db.close();
  return update(s => s);
}
// Read, change and write share one IndexedDB transaction. A failed change leaves the old snapshot intact.
export function update(mutator) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
    let result;
    const r = store.get('main');
    r.onsuccess = () => {
      try {
        const old = r.result ? migrate(r.result) : seed();
        const draft = structuredClone(old);
        result = mutator(draft) || draft;
        result.revision = (old.revision || 0) + 1;
        validate(result);
        store.put(result, 'main');
      } catch (e) { try { tx.abort(); } catch {} reject(e); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('Save cancelled'));
  });
}
export function read() {
  return new Promise((resolve, reject) => {
    const r = db.transaction('state').objectStore('state').get('main');
    r.onsuccess = () => { try { resolve(migrate(r.result)); } catch (e) { reject(e); } };
    r.onerror = () => reject(r.error);
  });
}
