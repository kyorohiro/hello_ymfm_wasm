import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createAyTimedLifecycle} from '../../tetorica_src/runtime/playground_ay_timed_lifecycle.js';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function until(predicate,label='asynchronous boundary') {
  for(let n=0;n<1000;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}
  assert.fail(`Did not reach ${label}`);
}
function store() {
  const patterns=new Map(),staged=new Map(),events=[],cancelled=new Set();
  const key=(transaction,owner)=>JSON.stringify([transaction,owner]);
  const check=owner=>{if(cancelled.has(owner))throw new DOMException('Run stopped','AbortError');};
  const capability={
    async stage(transaction,owner,method,args){
      check(owner);events.push(['stage',transaction,owner,method]);
      if(args[0]?.invalid)throw Error('Invalid timed plan');
      const id=key(transaction,owner);if(!staged.has(id))staged.set(id,new Map());
      staged.get(id).set(method==='schedule'?args[1].name:args[0],method==='schedule'?{operations:structuredClone(args[0]),owner}:null);
      return {accepted:true};
    },
    async commit(transaction,owner){
      check(owner);events.push(['commit',transaction,owner]);const id=key(transaction,owner),entries=staged.get(id)??new Map();
      for(const [name,value]of patterns)if(value.owner===owner)patterns.delete(name);
      for(const [name,value]of entries)if(value)patterns.set(name,value);
      staged.delete(id);return {accepted:true};
    },
    async abort(transaction,owner){events.push(['abort',transaction,owner]);staged.delete(key(transaction,owner));},
    async schedule(operations,options,{owner}){check(owner);events.push(['schedule',owner]);patterns.set(options.name,{operations:structuredClone(operations),owner});return {accepted:true};},
    async clearSchedule(name,{owner}){check(owner);events.push(['clear',owner]);if(patterns.get(name)?.owner===owner)patterns.delete(name);return true;},
    async cancelOwner(owner){events.push(['cancel',owner]);cancelled.add(owner);for(const [name,value]of patterns)if(value.owner===owner)patterns.delete(name);},
  };
  const client={chip:'ay8910',clock:2000000,channels:3,_timedOperations:capability,
    schedule(){throw Error('Lifecycle bypass');},clearSchedule(){throw Error('Lifecycle bypass');},
    build(callback){const operations=[];const b={setEnvelope:settings=>operations.push({method:'setEnvelope',args:[settings]})};callback(b);return {operations};},
    getState:()=>({}),noteOff(){},keyOff(){},allNotesOff(){},dispose(){}};
  return {patterns,staged,events,capability,client};
}

test('AY lifecycle stages entry changes, aborts failed Apply and removes omitted names on empty success',async()=>{
  const f=store();let loop=null;
  const lifecycle=createAyTimedLifecycle({getLoop:()=>loop,setLoop:value=>{loop=value;}}),client=lifecycle.wrap(f.client);
  assert.deepEqual(Object.keys(client),Object.keys(f.client).filter(key=>key!=='_timedOperations'));
  assert.equal('schedule'in client,true);assert.equal('_timedOperations'in client,false);
  let transaction=lifecycle.begin();await client.schedule([1],{name:'one'});assert.equal(f.patterns.size,0);await lifecycle.commit(transaction);
  assert.equal(lifecycle.entryReservationCount,1);assert.equal(lifecycle.hasEntryReservations,true);
  const original=f.patterns.get('one'),owner=original.owner;
  transaction=lifecycle.begin();await client.schedule([2],{name:'one'});lifecycle.abort(transaction);
  assert.equal(f.patterns.get('one'),original);
  transaction=lifecycle.begin();await lifecycle.commit(transaction);assert.equal(f.patterns.size,0);
  assert.equal(lifecycle.entryReservationCount,0);assert.equal(lifecycle.hasEntryReservations,false);
  assert.equal(f.events.filter(event=>event[0]==='commit').at(-1)[2],owner);
  assert.throws(()=>client.clearSchedule('one'),/active entry evaluation or liveLoop/);
  lifecycle.stop();
});

test('Worker lifecycle uses script / performanceOwner identities and cancels through the existing owner path',async()=>{
  const f=store(),cancelled=[];let loop=null;
  const lifecycle=createAyTimedLifecycle({getLoop:()=>loop,setLoop:value=>{loop=value;},entryOwner:'script',loopOwner:value=>value.performanceOwner,
    cancelOwner:(_controller,owner)=>cancelled.push(owner)}),client=lifecycle.wrap(f.client);
  const transaction=lifecycle.begin();await client.schedule([1],{name:'entry'});await lifecycle.commit(transaction);
  assert.equal(f.patterns.get('entry').owner,'script');
  loop={name:'lead',performanceOwner:'loop:7',stopped:false};await client.schedule([2],{name:'loop'});
  assert.equal(f.patterns.get('loop').owner,'loop:7');loop.stopped=true;lifecycle.cancelLoop(loop);
  assert.deepEqual(cancelled,['loop:7']);await assert.rejects(async()=>client.clearSchedule('entry'),{name:'AbortError'});
  lifecycle.stop();assert(cancelled.includes('script'));
});

test('Stop observes hung cleanup acknowledgements and rejects pending entry calls promptly',async()=>{
  const f=store(),gate=deferred();let loop=null;
  f.capability.stage=()=>gate.promise;f.capability.abort=()=>new Promise(()=>{});f.capability.cancelOwner=()=>new Promise(()=>{});
  const lifecycle=createAyTimedLifecycle({getLoop:()=>loop,setLoop:value=>{loop=value;}}),client=lifecycle.wrap(f.client);
  lifecycle.begin();const pending=client.schedule([1],{name:'held'}).then(()=>null,error=>error);
  lifecycle.stop();assert.equal((await pending).name,'AbortError');gate.resolve();
});

test('AY runtime errors reach the existing logger only for owned active reservations and unsubscribe on Stop',async()=>{
  const f=store(),listeners=new Set(),errors=[];let loop=null;
  f.capability.onError=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
  const lifecycle=createAyTimedLifecycle({getLoop:()=>loop,setLoop:value=>{loop=value;},onError:error=>errors.push(error.message)}),client=lifecycle.wrap(f.client);
  const transaction=lifecycle.begin();await client.schedule([1],{name:'one'});await lifecycle.commit(transaction);
  const owner=f.patterns.get('one').owner,notification={message:'reservation failed',owner};
  for(const listener of listeners){listener({message:'other client',owner:'other'});listener(notification);}
  assert.deepEqual(errors,['reservation failed']);lifecycle.stop();assert.equal(listeners.size,0);
});

test('Main AY loop retirement uses optional full release but global Stop keeps cancellation future-only',async()=>{
  const f=store();let loop=null;
  f.capability.releaseOwner=async owner=>{f.events.push(['release',owner]);return f.capability.cancelOwner(owner);};
  const lifecycle=createAyTimedLifecycle({getLoop:()=>loop,setLoop:value=>{loop=value;}}),client=lifecycle.wrap(f.client);
  const transaction=lifecycle.begin();await lifecycle.commit(transaction);
  loop={name:'removed',stopped:false};await client.schedule([1],{name:'removed'});loop.stopped=true;lifecycle.cancelLoop(loop);
  assert.equal(f.events.filter(event=>event[0]==='release').length,1);
  loop={name:'stopped',stopped:false};await client.schedule([2],{name:'stopped'});lifecycle.stop();
  assert.equal(f.events.filter(event=>event[0]==='release').length,1,'global Stop never requests full release before its fade');
  assert.equal(f.patterns.size,0);
});

function mainFixture(t) {
  const f=store(),oldWindow=globalThis.window,media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
  globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
  const megaDrive={capabilities:{chip:'ay8910',fmChannels:0,dac:false,psg:false},state:'idle',audioContext:{currentTime:0},
    fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),clearFXChain:()=>[],
    primaryEndpoints:[{name:'ay8910',globalName:'ay',client:f.client,type:0x10,flags:1,instanceId:'ay:main-test',node:{port:{postMessage(){}}}}],
    async start(){this.state='ready';},async resume(){},async close(){},stopAllNative(){}};
  const logs=[],runtime=createPlaygroundRuntime({megaDrive,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>{runtime.stop();globalThis.window=oldWindow;});return {...f,runtime,logs};
}
const source=value=>`const ym=await useSoundChip("ay8910");await ym.schedule([${value}],{name:"main"});`;

test('production Main Playground stages AY through its primary borrowed facade and preserves failed Apply',async(t)=>{
  const f=mainFixture(t);await f.runtime.playSource(source(1));assert.deepEqual(f.patterns.get('main').operations,[1]);assert.equal(f.runtime.getState().playback,'running');
  const original=f.patterns.get('main');await assert.rejects(f.runtime.playSource(`${source(2)} throw Error("failed Apply");`),/failed Apply/);
  assert.equal(f.patterns.get('main'),original);assert.equal(f.staged.size,0);assert.equal(f.runtime.getState().playback,'running','failed Apply keeps Stop usable');
  await f.runtime.playSource('context.updated=true;console.table([{register:13,value:8}]);');assert.equal(f.patterns.size,0);assert.equal(f.runtime.getState().playback,'stopped');
  assert(f.logs.some(line=>line.includes('register')&&line.includes('value')));
});

test('production Main Playground cancels a removed AY loop without touching its entry-owned replacement',async(t)=>{
  const f=mainFixture(t);
  await f.runtime.playSource('const ym=await useSoundChip("ay8910");liveLoop("lead",async()=>{await ym.schedule([1],{name:"shared"});await new Promise(()=>{});});');
  await until(()=>f.patterns.has('shared'));const loopOwner=f.patterns.get('shared').owner;
  await f.runtime.playSource('const ym=await useSoundChip("ay8910");await ym.schedule([9],{name:"shared"});');
  assert.deepEqual(f.patterns.get('shared').operations,[9]);assert.notEqual(f.patterns.get('shared').owner,loopOwner);
  assert(f.events.some(event=>event[0]==='cancel'&&event[1]===loopOwner));
});

test('production Main Playground cancels AY patterns when their loop ends on tracked failure',async(t)=>{
  const f=mainFixture(t);
  await f.runtime.playSource('const ym=await useSoundChip("ay8910");liveLoop("failed",async()=>{await ym.schedule([1],{name:"failed"});pg.trackAsync(Promise.reject(Error("tracked failure")));await sleep(10);});');
  await until(()=>f.events.some(event=>event[0]==='cancel'),'failed loop cleanup');assert.equal(f.patterns.size,0);
});

test('production Worker Playground commits AY entry manifests with script identity and retains failure',async(t)=>{
  const f=store(),messages=[],channel=new MessageChannel(),commands=[];
  const workerUrl=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
  t.after(async()=>{channel.port1.close();channel.port2.close();await worker.terminate();});
  worker.on('message',message=>messages.push(message));worker.on('error',error=>messages.push({error}));
  channel.port1.on('message',async data=>{
    commands.push(data);
    if(data.type?.startsWith('performance-')){
      if(data.type==='performance-cancel-owner')await f.capability.cancelOwner(data.owner);
      if(data.type==='performance-stop'){for(const [name]of f.patterns)f.patterns.delete(name);}
      channel.port1.postMessage({type:'performance-result',id:data.id,session:data.session});return;
    }
    if(data.method!=='ayTimed'){if(data.id!==undefined)channel.port1.postMessage({id:data.id,value:true});return;}
    const payload=data.args[0],owner=data.timedPerformance?.owner??payload.owner;
    try{
      let value;
      if(payload.action==='stage')value=await f.capability.stage(payload.transactionId,owner,payload.method,payload.args);
      else if(payload.action==='commit')value=await f.capability.commit(payload.transactionId,owner);
      else if(payload.action==='abort')value=await f.capability.abort(payload.transactionId,owner);
      else if(payload.action==='schedule')value=await f.capability.schedule(payload.operations,payload.options,{owner});
      else if(payload.action==='clear')value=await f.capability.clearSchedule(payload.name,{owner});
      else if(payload.action==='cancelOwner')value=await f.capability.cancelOwner(owner);
      channel.port1.postMessage({id:data.id,value});
    }catch(error){channel.port1.postMessage({id:data.id,error:error.message,name:error.name});}
  });
  await until(()=>messages.some(message=>message.readyForTest),'worker import');
  worker.postMessage({type:'native-primary-ports',endpoints:[{id:'ay8910',name:'ay8910',globalName:'ay',clock:2000000,type:0x10,flags:1,instanceId:'ay:worker-test',state:{registers:Array(16).fill(0),levels:[9,9,9],clock:2000000,initialized:true},port:channel.port2}]},[channel.port2]);
  const run=async code=>{
    const start=messages.length;worker.postMessage({type:'run',sourceCode:code,capabilities:{chip:'ay8910',fmChannels:0,dac:false,psg:false},performance:{session:1,audioSeconds:0,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.1}});
    await until(()=>messages.slice(start).some(message=>message.type==='complete'||message.type==='execution-error'||message.error),'worker evaluation');
    return messages.slice(start).find(message=>message.type==='complete'||message.type==='execution-error'||message.error);
  };
  let result=await run('const ym=await useSoundChip("ay8910");const ops=ym.build(b=>b.setEnvelope({shape:8}));await ym.schedule(ops,{name:"worker",repeatSeconds:.01});');
  assert.equal(result.type,'complete',JSON.stringify(result));assert.equal(result.scheduledReservationCount,1);assert.equal(f.patterns.get('worker').owner,'script');
  channel.port1.postMessage({type:'ay-timed-error',owner:'script',session:1,message:'Expected recoverable clock mismatch'});
  await until(()=>messages.some(message=>message.type==='log'&&String(message.message).includes('Expected recoverable clock mismatch')),'worker diagnostic reason');
  const original=f.patterns.get('worker');result=await run('const ym=await useSoundChip("ay8910");await ym.clearSchedule("worker");throw Error("failed Worker Apply");');
  assert.equal(result.type,'execution-error');assert.equal(result.scheduledReservationCount,1);assert.equal(f.patterns.get('worker'),original);
  result=await run('context.empty=true;');assert.equal(result.type,'complete');assert.equal(result.scheduledReservationCount,0);assert.equal(f.patterns.size,0);
  const metadata=commands.filter(command=>command.method==='ayTimed');assert(metadata.length>0);assert(metadata.every(command=>command.timedPerformance?.owner==='script'));
  result=await run('const ym=await useSoundChip("ay8910");liveLoop("old",async()=>{await ym.schedule(ym.build(b=>b.setEnvelope({shape:8})),{name:"shared",repeatSeconds:.01});try{await sleep(10);}finally{await ym.clearSchedule("shared");}});');
  assert.equal(result.type,'complete');await until(()=>f.patterns.has('shared'),'worker loop schedule');
  const loopOwner=f.patterns.get('shared').owner;assert.match(loopOwner,/^loop:/);
  result=await run('const ym=await useSoundChip("ay8910");await ym.schedule(ym.build(b=>b.setEnvelope({shape:9})),{name:"shared",repeatSeconds:.01});console.table([{register:13,value:9}]);');
  assert.equal(result.type,'complete');await until(()=>f.events.some(event=>event[0]==='cancel'&&event[1]===loopOwner),'removed worker loop owner');
  assert.equal(f.patterns.get('shared').owner,'script');
  assert.equal(f.events.filter(event=>event[0]==='clear').length,0,'stale Worker loop finally is fenced');
  worker.postMessage({type:'stop'});await until(()=>messages.some(message=>message.type==='stopped'),'worker stop');assert.equal(f.patterns.size,0);
});
