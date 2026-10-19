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
    remove: () => transact('readwrite', store => store.delete(key)),
    close: () => db.close(),
  };
}

/** Coalesce edits before capturing binary data, then serialize writes. flush()
 * bypasses the editing delay and includes changes made during an in-flight save.
 * dispose() cancels pending edits and closes storage; flush first when navigating. */
export function createProjectAutosave({store, capture, onStatus = () => {},
  delayMs = 750, maxWaitMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => performance.now()}) {
  let dirty = false, saving = false, stopped = false, flushing = false, timer = null;
  let firstChange = 0, lastChange = 0, completion = Promise.resolve(), settle = null;
  let status;
  const show = text => {if (text !== status) {status = text; onStatus(text);}};
  const cancelTimer = () => {if (timer !== null) clearTimer(timer); timer = null;};
  function cycle() {
    if (!settle) {
      completion = new Promise((resolve, reject) => {settle = {resolve, reject};});
      // Input handlers do not await saving; explicit flush still reports errors.
      void completion.catch(() => {});
    }
  }
  function schedule() {
    cancelTimer();
    if (stopped || saving || !dirty) return;
    const deadline = Math.min(lastChange + delayMs, firstChange + maxWaitMs);
    timer = setTimer(() => {timer = null; save();}, Math.max(0, deadline - now()));
  }
  function finish(error) {
    cancelTimer(); dirty = false; flushing = false;
    const current = settle; settle = null;
    if (error) {show(`Autosave failed: ${error.message ?? error}`); current?.reject(error);}
    else {show('Saved automatically'); current?.resolve();}
  }
  function save() {
    cancelTimer();
    if (saving || !dirty || stopped) return;
    dirty = false; saving = true; show('Saving…');
    // Capture only now, never on each keystroke or while a previous write waits.
    let result;
    try {result = store.save(capture());}
    catch (error) {saving = false; finish(error); return;}
    Promise.resolve(result).then(() => {
      saving = false;
      if (stopped || !dirty) finish();
      else if (flushing) save();
      else schedule();
    }, error => {saving = false; finish(error);});
  }
  function changed() {
    if (stopped) return completion;
    const time = now();
    if (!dirty) firstChange = time;
    lastChange = time; dirty = true; cycle();
    show('Unsaved changes'); schedule();
    return completion;
  }
  function flush() {
    if (!dirty && !saving) return completion;
    cancelTimer(); flushing = true;
    if (dirty && !saving) save();
    return completion;
  }
  return {changed, flush, dispose() {
    if (stopped) return;
    stopped = true; cancelTimer(); dirty = false;
    if (!saving && settle) {settle.resolve(); settle = null;}
    store.close?.();
  }};
}
