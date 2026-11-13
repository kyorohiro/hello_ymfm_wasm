import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuCodeProject,createSpuProjectStore} from '../synth-spu/code_project.js';
import {createSidCodeProject,createSidProjectStore} from '../synth-sid/code_project.js';
import {createGameboyCodeProject,createGameboyProjectStore} from '../synth-dmg/code_project.js';

const adapters=[
  {chip:'SPU',name:'tetorica-spu-synth-files',project:createSpuCodeProject,store:createSpuProjectStore},
  {chip:'SID',name:'tetorica-sid-synth-files',project:createSidCodeProject,store:createSidProjectStore},
  {chip:'DMG',name:'tetorica-dmg-synth-files',project:createGameboyCodeProject,store:createGameboyProjectStore},
];
const failure=name=>new DOMException(`Injected ${name}`,name);
async function until(check){
  for(let step=0;step<100;step++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}
  assert.fail('storage did not reach its expected transaction boundary');
}
function snapshot(adapter,revision=1){
  const project=adapter.project({starterCode:`// ${adapter.chip} source ${revision}\ncontext.keep = ${revision};\n`});
  project.importFiles([{path:'/data/readme.txt',data:`音色 ${revision}\n`},
    {path:'/data/raw.bin',type:'binary',data:Uint8Array.of(0,255,revision)},
    {path:'/presets/editing.json',data:'{"unfinished":'}]);
  if(adapter.chip==='SID'){const settings=project.settings;settings.channels[0].voice.pulseWidth=900+revision;project.setSettings(settings);}
  if(adapter.chip==='DMG'){const settings=project.settings;settings.source='wave';settings.wave.samples[4]=revision;project.setSettings(settings);}
  project.select('/index.js');project.setCodeState({mode:'code',path:'/index.js'});
  return {...project.snapshot(),workspaceId:`${adapter.chip}-workspace`,filesVisible:true,revision};
}
const raw=value=>value.filesystem.files.find(file=>file.path==='/data/raw.bin').data;

// Native-like request success and commit are independent; writes become visible
// only at commit, and aborted transactions leave the old stored value intact.
function indexedDbFixture(name,initial){
  const values=new Map([[name,structuredClone(initial)]]),connections=[],opens=[],transactions=[],commits=[],creations=[],invalidStates=[];
  const openPlans=[],transactionPlans=[];
  const factory={open(databaseName,version){
    assert.equal(databaseName,name,'each adapter retains its own legacy database name');assert.equal(version,1,'no schema migration');
    const plan=openPlans.shift()??{},request={error:null};opens.push(request);
    request.succeed=()=>{
      const db={name:databaseName,closed:false,closes:0,objectStoreNames:{contains:store=>store==='projects'},
        createObjectStore(store){creations.push(store);},
        close(){db.closed=true;db.closes++;},
        transaction(storeName,mode){
          assert.equal(storeName,'projects');assert(['readonly','readwrite'].includes(mode));
          if(db.closed){const error=failure('InvalidStateError');invalidStates.push(error);throw error;}
          const next=transactionPlans.shift()??{},tx={db,mode,error:null,request:null,requested:false,settled:false};transactions.push(tx);
          tx.complete=()=>{
            if(tx.settled)return;assert(tx.requested);tx.settled=true;
            if(mode==='readwrite'){values.set(databaseName,structuredClone(tx.value));commits.push(structuredClone(tx.value));}
            tx.oncomplete?.();
          };
          tx.fail=error=>{
            if(tx.settled)return;tx.settled=true;tx.error=error;if(tx.request)tx.request.error=error;
            tx.onerror?.();tx.onabort?.();
          };
          tx.abort=()=>queueMicrotask(()=>tx.fail(failure('AbortError')));
          function execute(key,value){
            assert.equal(key,'current','the saved project key is retained');
            if(mode==='readwrite')tx.value=structuredClone(value);
            const operation={error:null};tx.request=operation;
            queueMicrotask(()=>{
              if(tx.settled)return;operation.result=mode==='readonly'?structuredClone(values.get(databaseName)):key;
              tx.requested=true;operation.onsuccess?.();if(!next.hold)queueMicrotask(tx.complete);
            });return operation;
          }
          tx.objectStore=store=>{assert.equal(store,'projects');return{get:key=>execute(key),put:(value,key)=>execute(key,value)};};
          return tx;
        },
      };connections.push(db);request.result=db;request.onsuccess?.();return db;
    };
    queueMicrotask(()=>{if(plan.error){request.error=plan.error;request.onerror?.();}else if(!plan.hold)request.succeed();});
    return request;
  }};
  return{factory,values,connections,opens,transactions,commits,creations,invalidStates,openPlans,transactionPlans};
}

for(const adapter of adapters){
  test(`${adapter.chip} reads its committed legacy project and reconnects a silently closed connection without changing data`,async()=>{
    const initial=snapshot(adapter),f=indexedDbFixture(adapter.name,initial),store=adapter.store({indexedDB:f.factory,storage:null});
    f.transactionPlans.push({hold:true});let loaded=false;
    const reading=store.read().then(value=>{loaded=true;return value;});
    await until(()=>f.transactions[0]?.requested);assert.equal(loaded,false,'request success alone cannot authorize startup restoration');
    f.transactions[0].complete();assert.deepEqual(await reading,initial);assert.deepEqual(f.creations,[],'existing schema is not recreated');
    f.connections[0].close();const latest=snapshot(adapter,2);
    assert.equal(await store.write(latest),true);assert.equal(f.invalidStates.length,1);assert.equal(f.opens.length,2);
    const restored=await store.read();assert.deepEqual(restored,latest);assert(raw(restored) instanceof Uint8Array);
    assert.equal(adapter.project({snapshot:restored}).fs.get('/index.js').data,latest.filesystem.files.find(file=>file.path==='/index.js').data);
    raw(restored).fill(77);assert.deepEqual(await store.read(),latest,'reading returns detached binary files');
    await store.close();
  });

  test(`${adapter.chip} snapshots queued before initial open stay immutable and close drains all accepted writes`,async()=>{
    const f=indexedDbFixture(adapter.name,snapshot(adapter)),store=adapter.store({indexedDB:f.factory,storage:null});
    f.openPlans.push({hold:true});f.transactionPlans.push({hold:true});
    const first=snapshot(adapter,2),second=snapshot(adapter,3),expectedFirst=structuredClone(first),expectedSecond=structuredClone(second);
    const firstWrite=store.write(first),secondWrite=store.write(second);
    raw(first).fill(88);first.revision=88;raw(second).fill(99);second.revision=99;
    await until(()=>f.opens.length===1);assert.equal(f.transactions.length,0,'pending initial open is shared');
    let closed=false;const closing=store.close().then(()=>{closed=true;});
    await assert.rejects(store.write(snapshot(adapter,4)),{name:'AbortError'});
    f.opens[0].succeed();await until(()=>f.transactions[0]?.requested);
    assert.equal(closed,false);assert.equal(f.connections[0].closed,false);assert.equal(f.transactions.length,1);
    f.transactions[0].complete();assert.deepEqual(await Promise.all([firstWrite,secondWrite]),[true,true]);await closing;
    assert.deepEqual(f.commits,[expectedFirst,expectedSecond]);assert.deepEqual(f.values.get(adapter.name),expectedSecond);
    assert.equal(f.connections[0].closed,true);assert.equal(f.opens.length,1);
    await assert.rejects(store.read(),{name:'AbortError'});await store.close();assert.equal(f.opens.length,1,'late callbacks cannot reopen disposed storage');
  });

  test(`${adapter.chip} retries an aborted whole project ahead of a newer edit while reopening`,async()=>{
    const initial=snapshot(adapter),f=indexedDbFixture(adapter.name,initial),store=adapter.store({indexedDB:f.factory,storage:null});
    await store.read();f.transactionPlans.push({hold:true});
    const first=snapshot(adapter,2),expectedFirst=structuredClone(first),firstWrite=store.write(first);
    await until(()=>f.transactions.at(-1)?.requested&&f.transactions.at(-1).mode==='readwrite');
    f.openPlans.push({hold:true});const failed=f.transactions.at(-1);failed.fail(failure('AbortError'));
    await until(()=>f.opens.length===2);
    const second=snapshot(adapter,3),expectedSecond=structuredClone(second),secondWrite=store.write(second);
    raw(first).fill(90);raw(second).fill(91);first.codeState.mode='keyboard';second.codeState.mode='keyboard';
    assert.deepEqual(f.values.get(adapter.name),initial,'an aborted put never changes durable data');assert.deepEqual(f.commits,[]);
    f.opens[1].succeed();assert.deepEqual(await Promise.all([firstWrite,secondWrite]),[true,true]);
    assert.deepEqual(f.commits,[expectedFirst,expectedSecond]);assert.deepEqual(await store.read(),expectedSecond);
    assert.equal(f.opens.length,2);await store.close();
  });

  test(`${adapter.chip} failed initial open is not cached against the next storage operation or downgraded to localStorage`,async()=>{
    const initial=snapshot(adapter),f=indexedDbFixture(adapter.name,initial);f.openPlans.push({error:failure('UnknownError')});
    const storage={getItem:()=>assert.fail('IndexedDB failure must not read a different fallback project'),setItem:()=>assert.fail('IndexedDB failure must not write a fallback project')};
    const store=adapter.store({indexedDB:f.factory,storage});
    await assert.rejects(store.read(),{name:'UnknownError'});assert.equal(f.opens.length,1);assert.deepEqual(f.values.get(adapter.name),initial);
    const latest=snapshot(adapter,2);assert.equal(await store.write(latest),true);assert.equal(f.opens.length,2);
    assert.deepEqual(await store.read(),latest);await store.close();
  });
}
