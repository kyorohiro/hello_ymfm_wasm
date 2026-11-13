// SPDX-License-Identifier: BSD-3-Clause
// Structured drafts retain binary data; reconnecting never restores app state.
export async function openSynthDraftStore(indexedDB=globalThis.indexedDB, {
  name='tetorica-fm2612-synth-drafts',version=1,storeName='projects',key='current',
}={}) {
  if(!indexedDB)return null;
  let connection=null,opening=null,closed=false,queue=Promise.resolve();
  const closedError=()=>new DOMException('Local draft storage is closed.','AbortError');
  function invalidate(db) {
    if(connection===db)connection=null;
    try{db.close();}catch{}
  }
  function connect() {
    if(closed)return Promise.reject(closedError());
    if(connection)return Promise.resolve(connection);
    if(opening)return opening;
    const pending=new Promise((resolve,reject)=>{
      let settled=false;
      const request=indexedDB.open(name,version);
      const fail=error=>{if(!settled){settled=true;reject(error);}};
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(storeName))db.createObjectStore(storeName);
      };
      request.onerror=()=>fail(request.error);
      request.onblocked=()=>fail(new Error('Local draft storage is blocked by another tab. Close that tab and retry.'));
      request.onsuccess=()=>{
        const db=request.result;
        if(settled||closed){db.close();fail(closedError());return;}
        settled=true;connection=db;
        db.onclose=()=>{if(connection===db)connection=null;};
        db.onversionchange=()=>invalidate(db);
        resolve(db);
      };
    });
    opening=pending;
    const clear=()=>{if(opening===pending)opening=null;};
    void pending.then(clear,clear);
    return pending;
  }
  function transact(db,mode,operation) {
    return new Promise((resolve,reject)=>{
      let transaction,request;
      try{transaction=db.transaction(storeName,mode);}
      catch(error){reject({error,retry:error?.name==='InvalidStateError'});return;}
      transaction.oncomplete=()=>resolve(request.result);
      transaction.onabort=()=>{
        const error=transaction.error??request?.error??new DOMException('Local draft transaction was aborted.','AbortError');
        reject({error,retry:error.name==='AbortError'});
      };
      // A request error normally aborts the whole transaction. Wait for that
      // rollback before retrying or allowing the next queued snapshot to run.
      transaction.onerror=()=>{};
      try{request=operation(transaction.objectStore(storeName));}
      catch(error){
        try{transaction.abort();}catch{}
        reject({error,retry:false});
      }
    });
  }
  function enqueue(mode,operation) {
    const result=queue.then(async()=>{
      for(let attempt=0;attempt<2;attempt++) {
        const db=await connect();
        try{return await transact(db,mode,operation);}
        catch(failure){
          if(failure.retry)invalidate(db);
          if(!failure.retry||attempt||closed)throw failure.error;
        }
      }
    });
    // A failed save must not poison future file operations or retain a stale
    // connection. Whole transactions are ordered, including their one retry.
    queue=result.catch(()=>{});
    return result;
  }
  await connect();
  return {
    load:()=>enqueue('readonly',store=>store.get(key)),
    save(snapshot) {
      // Capture before waiting behind an earlier save; later edits cannot
      // mutate the pending snapshot while a closing connection is reopened.
      const value=structuredClone(snapshot);
      return enqueue('readwrite',store=>store.put(value,key));
    },
    close(){closed=true;if(connection)invalidate(connection);},
  };
}
