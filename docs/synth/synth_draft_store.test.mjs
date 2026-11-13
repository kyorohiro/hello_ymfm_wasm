import test from 'node:test';
import assert from 'node:assert/strict';
import {openSynthDraftStore} from './synth_draft_store.js';

const failure=name=>new DOMException(`Injected ${name}`,name);
async function until(check) {
  for(let step=0;step<100;step++) {
    if(check())return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.fail('storage operation did not reach its expected boundary');
}

// Control request success and transaction commit independently. In particular,
// an IDB request may succeed before the entire transaction later rolls back.
function storageFixture({openPlans=[],transactionPlans=[]}={}) {
  const values=new Map(),opens=[],databases=[],transactions=[],commits=[];
  let schemaCreated=false;
  const factory={open(name,version) {
    const plan=openPlans.shift()??{},request={name,version,error:null};opens.push(request);
    request.fail=error=>{request.error=error;request.onerror?.();};
    request.succeed=()=>{
      const db={closed:false,closes:0,
        objectStoreNames:{contains:store=>schemaCreated&&store==='projects'},
        createObjectStore(store){assert.equal(store,'projects');schemaCreated=true;},
        close(){db.closed=true;db.closes++;},
        transaction(storeName,mode) {
          assert.equal(storeName,'projects');
          if(db.closed)throw failure('InvalidStateError');
          const next=transactionPlans.shift()??{};
          if(next.createError)throw next.createError;
          const tx={db,mode,error:null,request:null,settled:false,requested:false};
          transactions.push(tx);
          tx.commit=()=>{
            assert(tx.requested,'the request completes before its transaction');
            if(tx.settled)return;tx.settled=true;
            if(tx.operation==='put'){values.set(tx.key,structuredClone(tx.value));commits.push(structuredClone(tx.value));}
            tx.oncomplete?.();
          };
          tx.fail=error=>{
            if(tx.settled)return;tx.settled=true;tx.error=error;
            if(tx.request)tx.request.error=error;
            tx.onerror?.();tx.onabort?.();
          };
          tx.abort=()=>{queueMicrotask(()=>tx.fail(failure('AbortError')));};
          function execute(operation,key,value) {
            if(next.operationError)throw next.operationError;
            tx.operation=operation;tx.key=key;
            if(operation==='put')tx.value=structuredClone(value);
            const request={error:null};tx.request=request;
            queueMicrotask(()=>{
              if(tx.settled)return;
              if(next.requestError){tx.fail(next.requestError);return;}
              request.result=operation==='get'?structuredClone(values.get(key)):key;
              tx.requested=true;request.onsuccess?.();
              if(!next.hold)queueMicrotask(tx.commit);
            });
            return request;
          }
          tx.objectStore=()=>({get:key=>execute('get',key),put:(value,key)=>execute('put',key,value)});
          return tx;
        },
      };
      databases.push(db);request.result=db;
      if(!schemaCreated)request.onupgradeneeded?.();
      request.onsuccess?.();return db;
    };
    queueMicrotask(()=>{
      if(plan.manual)return;
      if(plan.error)request.fail(plan.error);
      else if(plan.blocked)request.onblocked?.();
      else request.succeed();
    });
    return request;
  }};
  return {factory,values,opens,databases,transactions,commits};
}

test('load resolves only after the complete transaction commits',async()=>{
  const f=storageFixture({transactionPlans:[{hold:true}]}),saved={file:new Uint8Array([0,128,255])};
  f.values.set('current',saved);const store=await openSynthDraftStore(f.factory);
  let settled=false;const loading=store.load().then(value=>{settled=true;return value;});
  await until(()=>f.transactions[0]?.requested);assert.equal(settled,false);
  f.transactions[0].commit();const result=await loading;
  assert.deepEqual(result,saved);assert.notEqual(result.file,saved.file);
  store.close();
});

test('successful put request cannot report durability before its transaction completes',async()=>{
  const f=storageFixture({transactionPlans:[{hold:true}]}),store=await openSynthDraftStore(f.factory);
  let settled=false;const saving=store.save({generation:1}).then(()=>{settled=true;});
  await until(()=>f.transactions[0]?.requested);
  assert.equal(settled,false);assert.equal(f.values.has('current'),false);
  f.transactions[0].commit();await saving;
  assert.deepEqual(f.values.get('current'),{generation:1});store.close();
});

test('quota rollback after request success is reported once and a later save still works',async()=>{
  const f=storageFixture({transactionPlans:[{hold:true}]}),store=await openSynthDraftStore(f.factory);
  f.values.set('current',{generation:0});const saving=store.save({generation:1});
  const rejected=assert.rejects(saving,{name:'QuotaExceededError'});
  await until(()=>f.transactions[0]?.requested);
  f.transactions[0].fail(failure('QuotaExceededError'));await rejected;
  assert.equal(f.opens.length,1);assert.equal(f.transactions.length,1);
  assert.deepEqual(f.values.get('current'),{generation:0});
  await store.save({generation:2});assert.deepEqual(f.values.get('current'),{generation:2});store.close();
});

test('DataCloneError during put is not retried and preserves the last committed draft',async()=>{
  const f=storageFixture({transactionPlans:[{operationError:failure('DataCloneError')}]}),store=await openSynthDraftStore(f.factory);
  f.values.set('current',{generation:0});
  await assert.rejects(store.save({generation:1}),{name:'DataCloneError'});
  assert.equal(f.opens.length,1);assert.equal(f.transactions.length,1);
  assert.deepEqual(f.values.get('current'),{generation:0});
  assert.throws(()=>store.save({callback(){}}),{name:'DataCloneError'});
  await store.save({generation:2});assert.deepEqual(f.values.get('current'),{generation:2});store.close();
});

test('failed reopen is not retried in a loop or cached against the next operation',async()=>{
  const f=storageFixture({openPlans:[{}, {error:failure('VersionError')}, {}]}),store=await openSynthDraftStore(f.factory);
  f.databases[0].onversionchange();
  await assert.rejects(store.save({generation:1}),{name:'VersionError'});
  assert.equal(f.opens.length,2);assert.equal(f.transactions.length,0);
  await store.save({generation:2});
  assert.equal(f.opens.length,3);assert.deepEqual(f.values.get('current'),{generation:2});store.close();
});

test('a blocked open rejects without deleting data and closes a late successful connection',async()=>{
  const f=storageFixture({openPlans:[{blocked:true}]});f.values.set('current',{retained:true});
  await assert.rejects(openSynthDraftStore(f.factory),/blocked by another tab/);
  const late=f.opens[0].succeed();
  assert.equal(late.closed,true);assert.equal(late.closes,1);
  assert.deepEqual(f.values.get('current'),{retained:true});
  const retry=await openSynthDraftStore(f.factory);assert.deepEqual(await retry.load(),{retained:true});retry.close();
});

test('versionchange closes the old connection and its late close event leaves the new connection usable',async()=>{
  const f=storageFixture(),store=await openSynthDraftStore(f.factory),first=f.databases[0];
  first.onversionchange();assert.equal(first.closed,true);
  await store.save({generation:1});assert.equal(f.opens.length,2);
  const second=f.databases[1];first.onclose();
  await store.save({generation:2});assert.equal(f.opens.length,2);
  assert.equal(second.closed,false);assert.deepEqual(f.values.get('current'),{generation:2});store.close();
});

test('a closing connection without a close event is reopened before saving the complete draft',async()=>{
  const f=storageFixture(),store=await openSynthDraftStore(f.factory);
  f.values.set('current',{generation:0});f.databases[0].close();
  const saved={generation:1,code:'current edit',bytes:new Uint8Array([0,255])};
  await store.save(saved);
  assert.equal(f.opens.length,2);assert.equal(f.transactions.length,1);
  assert.deepEqual(f.values.get('current'),saved);store.close();
});

test('explicit close while reopening closes the late database and never starts a queued write',async()=>{
  const f=storageFixture({openPlans:[{}, {manual:true}]}),store=await openSynthDraftStore(f.factory);
  f.databases[0].onversionchange();const saving=store.save({generation:1});
  const rejected=assert.rejects(saving,{name:'AbortError'});
  await until(()=>f.opens.length===2);store.close();
  const late=f.opens[1].succeed();await rejected;
  assert.equal(late.closed,true);assert.equal(f.transactions.length,0);
  await assert.rejects(store.save({generation:2}),{name:'AbortError'});assert.equal(f.opens.length,2);
});

test('whole-transaction retry stays ahead of newer immutable binary snapshots',async()=>{
  const f=storageFixture({transactionPlans:[{hold:true}, {}, {}]}),store=await openSynthDraftStore(f.factory);
  const first={generation:1,bytes:new Uint8Array([1,2])},second={generation:2,bytes:new Uint8Array([3,4])};
  const expectedFirst=structuredClone(first),expectedSecond=structuredClone(second);
  const savingFirst=store.save(first),savingSecond=store.save(second);
  first.bytes.fill(90);first.generation=90;second.bytes.fill(91);second.generation=91;
  await until(()=>f.transactions[0]?.requested);assert.equal(f.transactions.length,1);
  f.transactions[0].fail(failure('AbortError'));await Promise.all([savingFirst,savingSecond]);
  assert.equal(f.opens.length,2);assert.equal(f.transactions.length,3);
  assert.deepEqual(f.commits,[expectedFirst,expectedSecond]);assert.deepEqual(f.values.get('current'),expectedSecond);store.close();
});

test('connection retry is bounded and a later operation can recover after both attempts abort',async()=>{
  const f=storageFixture({transactionPlans:[{requestError:failure('AbortError')},{requestError:failure('AbortError')},{}]}),store=await openSynthDraftStore(f.factory);
  await assert.rejects(store.save({generation:1}),{name:'AbortError'});
  assert.equal(f.opens.length,2);assert.equal(f.transactions.length,2);assert.equal(f.values.has('current'),false);
  await store.save({generation:2});assert.equal(f.opens.length,3);assert.deepEqual(f.values.get('current'),{generation:2});store.close();
});

test('without IndexedDB the draft store stays explicitly unavailable',async()=>{
  assert.equal(await openSynthDraftStore(null),null);
});
