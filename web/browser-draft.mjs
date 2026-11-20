// Store the whole draft atomically, including media, under its Pages project path.
async function withDrafts(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('charta-browser-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', mode);
      const request = operation(transaction.objectStore('drafts'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Draft storage was interrupted.'));
    });
  } finally { db.close(); }
}

export async function readDraft(key) {
  if (globalThis.indexedDB) {
    try {
      const draft = await withDrafts('readonly', store => store.get(key));
      if (draft) return draft;
    } catch (error) {
      if (!['SecurityError', 'InvalidStateError'].includes(error.name)) throw error;
    }
  }
  let legacy;
  try { legacy = localStorage.getItem(key); } catch { return null; }
  if (!legacy) return null;
  try { return JSON.parse(legacy); }
  catch { throw new Error('Your saved browser draft could not be read.'); }
}

export async function saveDraft(key, catalog) {
  try {
    if (!globalThis.indexedDB) { localStorage.setItem(key, JSON.stringify(catalog)); return; }
    await withDrafts('readwrite', store => store.put(catalog, key));
  } catch { throw new Error('This browser could not save the draft. Connect GitHub or a local folder, or free some site storage and try again.'); }
  // A legacy draft stays recoverable until its replacement has committed.
  try { localStorage.removeItem(key); } catch { /* IndexedDB holds the current snapshot. */ }
}

export async function clearDraft(key) {
  localStorage.removeItem(key);
  if (globalThis.indexedDB) await withDrafts('readwrite', store => store.delete(key));
}
