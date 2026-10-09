/** Desktop drafts use structured cloning, preserving binary files without base64 or ZIP conversion. */
export async function openDraftStore(indexedDB, key) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tetorica-playground-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transact = (mode, operation) => new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', mode);
    const request = operation(transaction.objectStore('projects'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? request.error);
    transaction.onerror = () => reject(transaction.error ?? request.error);
  });
  return {
    load: () => transact('readonly', store => store.get(key)),
    save: snapshot => transact('readwrite', store => store.put(snapshot, key)),
    close: () => db.close(),
  };
}

/** Serialize writes: an older, slower save must never overwrite a newer edit. */
export function createProjectAutosave({store, capture, onStatus = () => {}}) {
  let pending = null, saving = false, completion = Promise.resolve(), stopped = false;
  function changed() {
    if (stopped) return completion;
    pending = capture();
    onStatus('Saving…');
    if (!saving) {
      saving = true;
      completion = (async () => {
        while (pending) {
          const snapshot = pending; pending = null;
          try { await store.save(snapshot); }
          catch (error) { pending = null; onStatus(`Autosave failed: ${error.message ?? error}`); throw error; }
        }
        onStatus('Saved automatically');
      })().finally(() => { saving = false; });
      // UI changes do not create unhandled promise rejections; flush still reports failures.
      void completion.catch(() => {});
    }
    return completion;
  }
  return {changed, flush: () => completion, dispose() {stopped = true;}};
}
