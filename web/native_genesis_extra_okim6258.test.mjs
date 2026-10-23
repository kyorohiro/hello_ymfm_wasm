import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker,MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createOki6258Client} from './playground_okim6258.js';
import {encodeWav} from './wav.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional OKIM6258 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t,{holdResponse=()=>false}={}){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native OKIM6258 attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){this.pending=[];this.messages=[];this.heldResponses=[];this.ready=false;workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(holdResponse(message)){this.heldResponses.push([message,transfer]);return;}if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    releaseResponses(){for(const [message,transfer]of this.heldResponses.splice(0))this.worker.postMessage(message,transfer);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
const state=()=>({clock:8000000,divider:512,pan:0,playing:false,streaming:false,repeat:false,positionFrames:0,fedBytes:0,memoryRevision:0,sampleId:0,sample:null,held:[],pendingCommands:[]});
const sample=()=>({sampleRate:8000,channels:[Float32Array.from({length:32},(_,n)=>Math.sin(n*Math.PI/8))]});
function fixture(t,{mode='genesis',future=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),queue=[],waiters=[];let gate=null,offset=0;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  function snapshot(instance){const source=rack.get(instance);if(!source)throw Error('Additional sound chip is not connected');return {okim6258:{...structuredClone(source.state),pendingCommands:queue.filter(c=>c.instance===instance&&c.message.id).map(c=>c.message.id)},sampleRate:48000,frame:status().frame,revision:calls.length};}
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!rack.has(w.instance)){waiters.splice(i,1);w.reject(new DOMException('Disposed','AbortError'));}else if(!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(i,1);w.resolve(snapshot(w.instance));}}}
  function apply(source,m,{audition=m.audition===true,owner,group=m.group}={}){
    const s=source.state;if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    const allowed=audition||!source.manual,canStop=allowed&&(audition||group===undefined||source.owned===undefined||source.owned===group);
    if(m.method==='batch'){if(m.action==='off'&&source.manual!==m.voice)return;for(const c of m.commands)apply(source,c,{audition:true,owner,group});if(m.action==='on'){source.manual=m.voice;source.owned=undefined;}else if(m.action==='off')source.manual=undefined;s.held=source.manual?[0]:[];return;}
    if(m.method==='clock'){if(source.manual&&!audition)throw Error('Release the manually held additional OKIM6258 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.mixPan=m.pan;}
    else if(m.method==='load-memory'&&!allowed)throw Error('Release the manually held additional OKIM6258 voices before replacing their sample');
    else if(m.method==='load-memory'&&allowed){source.bytes=Uint8Array.from(m.data);s.sampleId=m.sampleId;s.memoryRevision++;s.sample={...structuredClone(m.metadata),bytes:m.data.length,frames:m.data.length*2,durationSeconds:m.data.length*2/m.metadata.sampleRate};s.playing=s.streaming=false;source.manual=source.owned=undefined;s.held=[];}
    else if(m.method==='reset'&&allowed){const {clock,memoryRevision,sampleId,sample}=s;Object.assign(s,state(),{clock,memoryRevision,sampleId,sample});source.manual=source.owned=undefined;}
    else if(m.method==='play'&&allowed){s.playing=s.streaming=true;s.repeat=m.repeat;source.owned=group;}
    else if(['stop','stop-voices'].includes(m.method)&&canStop){s.playing=s.streaming=false;source.owned=undefined;}
    else if(m.method==='set-repeat'&&allowed)s.repeat=m.repeat;
    else if(m.method==='write'&&allowed){if(m.register===12)s.divider=[1024,768,512,512][m.value&3];if(m.register===2)s.pan=m.value&3;if(m.register===0){s.playing=!!(m.value&2)&&!(m.value&1);s.streaming=false;if(s.playing)source.owned=group;}}
    else if(m.method==='cancel-main-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].instance===source.instance&&queue[i].message.group===m.targetGroup)queue.splice(i,1);if(source.owned===m.targetGroup&&!source.manual){s.playing=s.streaming=false;source.owned=undefined;}}
  }
  function advance(ms){offset+=ms;for(let i=0;i<queue.length;){const c=queue[i];if(c.frame<=status().frame){queue.splice(i,1);const source=rack.get(c.instance);if(source)apply(source,c.message,{owner:c.owner});}else i++;}settle();}
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_okim6258_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');rack.set(args.instance,{instance:args.instance,state:state(),bytes:new Uint8Array()});}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({instance:args.instance,after:args.after,resolve,reject}));return snapshot(args.instance);}
    if(command==='native_genesis_x68000_status')return {okim6258:state(),sampleRate:48000,frame:status().frame};
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].owner===args.owner)queue.splice(i,1);for(const source of rack.values())apply(source,{method:'cancel-main-owner',targetGroup:`worker:${args.owner}`},{group:`worker:${args.owner}`});settle();}
    if(command==='native_genesis_commands'){
      // Native admission retains the entire batch before any renderer sees it.
      // In particular, an early write to a different instance must roll back
      // when a later sample replacement is rejected by a manual lease.
      for(const c of args.commands)if(c.type==='extra-okim6258'){
        const source=rack.get(c.instance);if(!source)throw Error('Additional sound chip is not connected');
        if(source.manual&&!c.message.audition){
          if(c.message.method==='clock')throw Error('Release the manually held additional OKIM6258 voices before changing the clock');
          if(c.message.method==='load-memory')throw Error('Release the manually held additional OKIM6258 voices before replacing their sample');
        }
      }
      for(const c of args.commands)if(c.type==='extra-okim6258'){const source=rack.get(c.instance);if(future&&c.frame>status().frame)queue.push(c);else apply(source,c.message,{owner:c.owner});}
    }
    settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,gate:value=>{gate=value;},advance,commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

test('Native additional OKIM6258 owns independent sample, divider, clock, pan, Mixer and synchronous controls',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'a'});context.b=await createSoundChip('okim6258',{id:'b'});`);const {a,b}=f.runtime.context;
  await a.loadMemory(new Uint8Array([0x87,0x43]));await b.loadMemory(new Uint8Array([0x12,0x34,0x56]));assert.equal(a.setDivider(768),8000000/768);assert.equal(a.setPan(true,false),undefined);assert.equal(a.play({repeat:true}),undefined);assert.equal(b.writeRegister(12,0),undefined);await a.setClock(4000000);await b.setClock(6000000);
  const i=f.synth.chipInspector,one=await i.read('a'),two=await i.read('b');assert.equal(one.divider,768);assert.equal(one.clock,4000000);assert.deepEqual(one.pan,{left:true,right:false});assert.equal(one.sample.bytes,2);assert.equal(one.playing,true);assert.equal(two.divider,1024);assert.equal(two.sample.bytes,3);assert.equal(two.playing,false);assert.equal(a.clock,4000000);assert.equal(b.clock,6000000);assert.equal(f.synth.extraOkim6258Devices.size,2);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  f.synth.mixer.set('a',{volume:.3,pan:-.5});await f.synth.flush();assert.equal([...f.rack.values()][0].state.volume,.3);assert.deepEqual(f.errors,[]);
});
test('Native additional OKIM6258 validates before upload, copies synchronously, serializes metadata, and reset retains sample',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'a'});`);const a=f.runtime.context.a;
  for(const callback of [()=>a.loadMemory(new Uint8Array()),()=>a.loadMemory('bad'),()=>a.loadSample(sample(),{sampleRate:-1})]){const before=f.commands().length;await assert.rejects(callback());assert.equal(f.commands().length,before);}
  assert.throws(()=>a.setDivider(123),/divider/);assert.throws(()=>a.setPan('yes'),/booleans/);assert.throws(()=>a.play(),/Load/);assert.throws(()=>a.writeRegister(13,0),/register/);
  const bytes=Uint8Array.from([0x87,0x42]),one=a.loadMemory(bytes),two=a.loadMemory(bytes);bytes.fill(0);await Promise.all([one,two]);assert.deepEqual([...f.rack.values()][0].bytes,Uint8Array.from([0x87,0x42]));const loaded=await f.synth.chipInspector.loadSample('a',sample(),{name:'Keyboard sample'});assert(loaded.bytes>0);let view=await f.synth.chipInspector.read('a');assert.equal(view.sample.name,'Keyboard sample');assert(view.sample.waveform.length>0);a.setDivider(1024);a.setPan(false,true);a.play();a.reset();await f.synth.flush();view=await f.synth.chipInspector.read('a');assert.equal(view.divider,512);assert.deepEqual(view.pan,{left:true,right:true});assert.equal(view.sample.name,'Keyboard sample');assert.equal(view.playing,false);a.play();await f.synth.flush();assert.equal((await f.synth.chipInspector.read('a')).playing,true);assert.deepEqual(f.errors,[]);
});
test('Native additional OKIM6258 Keyboard uses one sample stream and stale releases retain replacement auditions',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'a'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  await assert.rejects(i.invoke('a','auditionOn',[0,60,'empty']),/Load/);await a.loadSample(sample());await i.invoke('a','setVoice',[{divider:768,pan:{left:false,right:true},repeat:true}]);await i.invoke('a','auditionOn',[0,72,'old']);await i.invoke('a','setClock',[6000000]);assert.deepEqual((await i.read('a')).held,[0]);assert.equal((await i.read('a')).clock,6000000);assert.equal(f.commands().findLast(c=>c.message?.method==='clock').message.audition,true);await assert.rejects(a.setClock(4000000),/manually held/);assert.equal(f.synth.state,'ready');await i.invoke('a','auditionOn',[0,48,'new']);await i.invoke('a','auditionOff',[0,'old']);assert.deepEqual((await i.read('a')).held,[0]);await assert.rejects(a.loadMemory(Uint8Array.of(0x11)),/manually held|manual audition/);assert.equal(f.synth.state,'ready');assert.equal((await i.read('a')).playing,true);a.reset();await f.synth.flush();assert.deepEqual((await i.read('a')).held,[0]);await i.invoke('a','auditionOff',[0,'new']);assert.deepEqual((await i.read('a')).held,[]);await assert.rejects(i.invoke('a','auditionOn',[1,60,'wrong']),/one channel/);await a.setClock(4000000);assert.equal(a.clock,4000000);assert.deepEqual(f.errors,[]);
});
for(const execution of ['main','worker'])test(`Native OKIM6258 ${execution} sample and clock continuations keep loop owners and late off cannot stop another owner`,{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await useSoundChip('okim6258');await a.loadSample({sampleRate:8000,channels:[Float32Array.from([0,.5,0,-.5])]});let oneReady=false;liveLoop('one',async()=>{const s=await useSoundChip('okim6258');await s.setClock(8000000);await s.loadSample({sampleRate:8000,channels:[Float32Array.from([0,.3,0,-.3])]});s.play({repeat:true});oneReady=true;log('one-ready');await beat(100);});liveLoop('two',async()=>{while(!oneReady)await beat(.001);const s=await useSoundChip('okim6258');await s.setClock(8000000);s.play({repeat:true});log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.logs.includes('one-ready')&&f.logs.includes('two-ready')&&f.commands().filter(c=>c.type==='extra-okim6258'&&c.message.method==='play').length===2&&(execution==='main'||f.runtime.getKeyboardTarget()));const play=f.commands().filter(c=>c.type==='extra-okim6258'&&c.message.method==='play');assert.equal(new Set(play.map(c=>execution==='worker'?c.owner:c.message.group)).size,2);const last=play.at(-1);if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();assert.equal((await f.synth.chipInspector.read('okim6258:shared')).playing,true);assert.deepEqual(f.errors,[]);
});
for(const late of [false,true])test(`Native OKIM6258 actual Worker cancellation disposes ${late?'late response':'pending creation'}`,{timeout:10000},async t=>{
  const workers=installWorkers(t,{holdResponse:message=>late&&message.type==='response'&&message.value?.id==='pending'}),f=fixture(t),gate=deferred();if(!late)f.gate(gate);
  await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('okim6258',{id:'pending'});await a.loadMemory(new Uint8Array([0x87]));a.play();await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>(late?workers[0].heldResponses.length===1:f.calls.some(c=>c.command==='native_genesis_extra_okim6258_create'))&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));if(late)workers[0].releaseResponses();else gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command==='native_genesis_extra_okim6258_dispose'));assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-okim6258'&&c.message.method==='play'));assert.deepEqual(f.errors,[]);
});
test('Native OKIM6258 borrows primary X68000 while explicit instances, shared eviction and fixed ids stay independent',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'x68000'});await f.runtime.playSource(`context.p=await useSoundChip('okim6258');context.a=await createSoundChip('okim6258',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.equal(f.runtime.context.p.id,'okim6258');assert.equal(f.runtime.context.p.dispose,undefined);const a=f.runtime.context.a,token=f.synth.chipInspector.getConnectionToken('side');a.dispose();await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'side'});`);assert.notEqual(f.synth.chipInspector.getConnectionToken('side'),token);assert.equal(f.synth.extraDevices.size,1);assert.deepEqual(f.errors,[]);
});
test('Native OKIM6258 shared cache, sixteen slots and pending decode retirement leave no endpoints',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={useSoundChip,createSoundChip};`);const {useSoundChip,createSoundChip}=f.runtime.context.api,a=await useSoundChip('okim6258');assert.equal(a,await useSoundChip('okim6258'));a.dispose();assert.notEqual(a,await useSoundChip('okim6258'));for(let n=0;n<15;n++)await createSoundChip('okim6258',{id:`n${n}`});await assert.rejects(createSoundChip('okim6258'),/at most 16/);await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});
test('Native OKIM6258 PCM WAV and stale decoder use no Web Audio and cannot overwrite reused instances',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'a'});`);await f.runtime.context.a.loadSample(encodeWav(sample()));assert((await f.synth.chipInspector.read('a')).sample.frames>0);
  const gate=deferred(),device=await f.synth.createExtraOkim6258({id:'decode',decodeAudio:async()=>gate.promise});const loading=device.client.loadSample(new Uint8Array([1,2,3])),rejected=assert.rejects(loading,/cancelled|not ready/);device.dispose();await f.synth.createExtraOkim6258({id:'decode'});gate.resolve({sampleRate:8000,numberOfChannels:1,getChannelData:()=>sample().channels[0]});await rejected;assert.equal(f.commands().filter(c=>c.type==='extra-okim6258'&&c.message.method==='load-memory').length,1);assert.deepEqual(f.errors,[]);
});
test('Native OKIM6258 actual future clock confirmation leaves owner cancellation and Stop unblocked', {timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('okim6258',{id:'a'});liveLoop('future',async()=>{await a.setClock(4000000);log('applied');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('future');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.waiters.length&&f.runtime.getKeyboardTarget());assert(!f.logs.includes('applied'));const before=f.commands().length,view=await f.synth.chipInspector.read('a');assert.equal(view.clock,8000000);assert.equal(f.commands().length,before);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled')&&!f.queue.length);await f.runtime.stopWithFade();assert.equal(f.waiters.length,0);assert.equal(f.synth.acceptedRequests,0);assert.deepEqual(f.errors,[]);
});
test('Native OKIM6258 Worker client cancels pending decoding before any upload on disposal',async()=>{
  const channel=new MessageChannel(),gate=deferred(),messages=[];channel.port2.on('message',m=>messages.push(m));const client=createOki6258Client(channel.port1,{native:true},{decodeAudio:()=>gate.promise,isStopped:()=>false});const loading=client.loadSample(new Uint8Array([1])),rejected=assert.rejects(loading,/stopped|disposed/);client.dispose();gate.resolve(sample());await rejected;await tick();assert(!messages.some(m=>m.method==='loadMemory'));channel.port2.close();
});
test('Native OKIM6258 inspector clock uses standalone acknowledged clock operation',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'a'});`);await f.synth.chipInspector.invoke('a','setClock',[4000000]);assert.equal(f.runtime.context.a.clock,4000000);const edit=f.commands().findLast(c=>c.type==='extra-okim6258'&&c.message.method==='clock');assert.equal(edit.message.hz,4000000);assert(!f.commands().some(c=>c.message?.commands?.some(m=>m.method==='clock')));assert.deepEqual(f.errors,[]);
});
test('Native OKIM6258 author patches preserve unrelated future controls and validate sample state',()=>{
  const channel=new MessageChannel(),client=createOki6258Client(channel.port1,{native:true});try{client.setDivider(1024);client.setPan(false,true);client._applyAuthorEdit({clock:4000000});assert.equal(client.divider,1024);assert.equal(client.pan,2);assert.equal(client.clock,4000000);client._applyAuthorEdit({sample:{bytes:2,frames:4,sampleRate:8000,durationSeconds:.0005}});assert.equal(client.divider,1024);assert.equal(client.pan,2);assert.equal(client.sample.bytes,2);assert.throws(()=>client._applyAuthorEdit({divider:123}),/Invalid/);assert.equal(client.divider,1024);}finally{client.dispose();channel.port2.close();}
});
test('Native OKIM6258 worst-divider clock guard leaves 8 kHz sessions reset-safe',async t=>{
  const f=fixture(t);await f.synth.start();f.synth.clock.sampleRate=8000;const device=await f.synth.createExtraOkim6258({id:'slow'});device.client.setDivider(1024);await device.client.setClock(57344000);assert.equal(device.client.clock,57344000);const before=f.commands().length;await assert.rejects(device.client.setClock(57344001),/VCLK/);await assert.rejects(device.endpoint.invoke('setClock',[100000000]),/VCLK/);assert.equal(f.commands().length,before);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
test('Native transport accepts 16 MiB OKI samples without blocking zero-payload controls',async t=>{
  const calls=[],status={session:1,mode:'genesis',engine:'ymfm',sampleRate:48000,frame:0,ymClock:7670454,psgClock:3579545,running:true},synth=new NativeGenesisSynth({now:()=>0,invoke:async(command,args)=>{calls.push({command,args});return status;}});t.after(()=>synth.close());await synth.start();
  // Native transport accounts payload bytes without reading their contents.
  // This sentinel avoids allocating or cloning a 16 MiB sample in a unit test.
  synth.enqueue({type:'extra-okim6258',instance:1,frame:0,message:{method:'load-memory',data:{length:16*1024*1024}}});assert.equal(synth.acceptedPcmBytes,16*1024*1024);assert.doesNotThrow(()=>synth.write(0,0x22,0));await synth.flush();assert.equal(synth.acceptedPcmBytes,0);assert(calls.some(c=>c.args?.commands?.some(m=>m.type==='extra-okim6258')));
});
test('Native OKIM6258 rejected sample replacement rolls back queued writes while held playback and engine remain usable',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('okim6258',{id:'a'});context.b=await createSoundChip('okim6258',{id:'b'});`);const {a,b}=f.runtime.context,i=f.synth.chipInspector;
  await a.loadMemory(Uint8Array.of(0x87,0x43));await i.invoke('a','auditionOn',[0,60,'held']);const before=await i.read('a'),start=f.calls.length;
  // loadMemory starts an asynchronous transaction. This immediate register
  // edit enters the same Native batch before the replacement is admitted.
  const replacement=a.loadMemory(Uint8Array.of(0x11,0x22,0x33));b.setPan(false,true);
  await assert.rejects(replacement,error=>error.code==='EXTRA_OKIM6258_CONTROL_REJECTED'&&/manually held/.test(error.message));
  const batch=f.calls.slice(start).find(c=>c.command==='native_genesis_commands'&&c.args.commands.some(command=>command.message?.method==='load-memory')).args.commands;
  assert.deepEqual(batch.map(c=>c.message.method),['write','load-memory']);assert.notEqual(batch[0].instance,batch[1].instance);
  const held=await i.read('a');assert.equal(held.playing,true);assert.deepEqual(held.held,[0]);assert.deepEqual(held.sample,before.sample);assert.equal(held.memoryRevision,before.memoryRevision);assert.deepEqual((await i.read('b')).pan,{left:true,right:true});assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
  await i.invoke('a','auditionOff',[0,'held']);await a.loadMemory(Uint8Array.of(0x11,0x22,0x33));b.setPan(false,true);a.play();await f.synth.flush();assert.equal((await i.read('a')).sample.bytes,3);assert.equal((await i.read('a')).playing,true);assert.deepEqual((await i.read('b')).pan,{left:false,right:true});assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
