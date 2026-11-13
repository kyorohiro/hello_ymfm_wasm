// SPDX-License-Identifier: BSD-3-Clause
// Project adapters retain their schema/fallback encoding. This layer owns only
// ordered I/O, reconnecting the existing database without restoring app state.
import {openSynthDraftStore} from './synth_draft_store.js?v=draft-reconnect-1';

export function createSynthProjectStore({indexedDB=globalThis.indexedDB,name,
  readFallback=()=>null,writeFallback=()=>false}={}) {
  if(typeof name!=='string'||!name)throw new TypeError('Project storage needs its existing database name.');
  let opened=null,queue=Promise.resolve(),accepting=true,closing=null;
  const closedError=()=>new DOMException('Local project storage is closed.','AbortError');
  function database() {
    if(!opened) {
      const pending=openSynthDraftStore(indexedDB,{name});opened=pending;
      void pending.catch(()=>{if(opened===pending)opened=null;});
    }
    return opened;
  }
  function enqueue(operation) {
    if(!accepting)return Promise.reject(closedError());
    const result=queue.then(async()=>operation(indexedDB?await database():null));
    queue=result.catch(()=>{});return result;
  }
  return {
    read:()=>enqueue(async store=>store?(await store.load())??null:readFallback()),
    write(snapshot) {
      if(!accepting)return Promise.reject(closedError());
      const value=structuredClone(snapshot);
      return enqueue(async store=>{
        if(!store)return writeFallback(value);
        await store.save(value);return true;
      });
    },
    close() {
      if(!closing) {
        accepting=false;
        // Finish accepted writes before closing; late callbacks cannot reopen
        // a disposed store. A failed open must not make close reject either.
        closing=queue.then(async()=>{if(opened){const store=await opened;store.close();}});
      }
      return closing;
    },
  };
}
