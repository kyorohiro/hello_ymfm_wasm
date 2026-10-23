import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker,MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createRf5c164Client} from './playground_rf5c164.js';
import {encodeWav} from './wav.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional RF5C164 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t,{holdResponse=()=>false}={}){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native RF5C164 attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){this.pending=[];this.messages=[];this.heldResponses=[];this.ready=false;workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(holdResponse(message)){this.heldResponses.push([message,transfer]);return;}if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    releaseResponses(){for(const [message,transfer]of this.heldResponses.splice(0))this.worker.postMessage(message,transfer);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
const state=()=>({clock:12500000,channels:Array.from({length:8},(_,channel)=>({channel,start:0,loopStart:0,step:0,configuredStep:0,volume:0,pan:{left:0,right:0}})),enabled:false,mask:255,selected:0,bank:0,held:[],pendingCommands:[],memoryRevision:0,knownMemoryRanges:[]});
const sample=()=>({sampleRate:8000,channels:[Float32Array.from({length:32},(_,n)=>Math.sin(n*Math.PI/8))]});
function fixture(t,{mode='genesis',future=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),queue=[],waiters=[];let gate=null,offset=0;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,rf5c164Clock:12500000,running:true});
  function snapshot(instance){const source=rack.get(instance);if(!source)throw Error('Additional sound chip is not connected');return {rf5c164:{...structuredClone(source.state),pendingCommands:queue.filter(c=>c.instance===instance&&c.message.id).map(c=>c.message.id)},sampleRate:48000,frame:status().frame,revision:calls.length};}
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!rack.has(w.instance)){waiters.splice(i,1);w.reject(new DOMException('Disposed','AbortError'));}else if(!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(i,1);w.resolve(snapshot(w.instance));}}}
  function apply(source,m,{audition=false,action,owner,group=m.group}={}){
    const {state:s,manual,owned,ram}=source;if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    const allowed=ch=>audition||!manual.has(ch),offAllowed=ch=>allowed(ch)&&(audition||group===undefined||!owned.has(ch)||owned.get(ch)===group),off=ch=>{if(offAllowed(ch)){s.mask|=1<<ch;owned.delete(ch);}};
    if(m.method==='batch'){if(m.action==='off'&&manual.get(m.channel)!==m.voice)return;for(const command of m.commands)apply(source,command,{audition:true,action:m.action,owner,group});if(m.action==='on'){manual.set(m.channel,m.voice);owned.delete(m.channel);}else if(m.action==='off')manual.delete(m.channel);s.held=[...manual.keys()];return;}
    if(m.method==='clock'){if(manual.size)throw Error('Release the manually held additional RF5C164 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){if(!manual.size||audition){const {clock,memoryRevision,knownMemoryRanges}=s;Object.assign(s,state(),{clock,memoryRevision,knownMemoryRanges});owned.clear();manual.clear();}}
    else if(m.method==='load-memory'){if(!manual.size||audition){ram.set(m.data,m.offset);s.memoryRevision++;const ranges=[...s.knownMemoryRanges,{start:m.offset,end:m.offset+m.data.length}].sort((a,b)=>a.start-b.start);s.knownMemoryRanges=[];for(const range of ranges){const last=s.knownMemoryRanges.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else if(range.end>range.start)s.knownMemoryRanges.push({...range});}}else source.rejected.set(m.id,'Release manually held RF5C164 voices before overwriting their sample RAM');}
    else if(m.method==='set-channel'){if(allowed(m.channel)){s.enabled=true;s.selected=m.channel;Object.assign(s.channels[m.channel],structuredClone(m.options));if(m.options.step!==undefined&&action!=='on'&&action!=='off')s.channels[m.channel].configuredStep=m.options.step;}}
    else if(m.method==='key-on'){if(allowed(m.channel)){s.enabled=true;s.selected=m.channel;s.mask&=~(1<<m.channel);owned.set(m.channel,group);}}
    else if(m.method==='key-off')off(m.channel);
    else if(m.method==='stop-voices')for(let ch=0;ch<8;ch++)off(ch);
    else if(m.method==='cancel-main-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].instance===source.instance&&queue[i].message.group===m.targetGroup)queue.splice(i,1);for(const [ch,g]of [...owned])if(g===m.targetGroup)off(ch);}
    else if(m.method==='write'){
      const r=m.register,v=m.value,ch=s.selected,c=s.channels[ch];if(r===7){if(!manual.size||audition){s.enabled=!!(v&128);if(v&64)s.selected=v&7;else s.bank=v&15;}}
      else if(r===8){for(let i=0;i<8;i++)if(v&(1<<i))off(i);else if(allowed(i)){s.mask&=~(1<<i);owned.set(i,group);}}
      else if(allowed(ch)){if(r===0)c.volume=v;if(r===1)c.pan={left:v&15,right:v>>4};if(r===2)c.step=(c.step&65280)|v;if(r===3)c.step=(c.step&255)|(v<<8);if((r===2||r===3)&&!audition)c.configuredStep=c.step;if(r===4)c.loopStart=(c.loopStart&65280)|v;if(r===5)c.loopStart=(c.loopStart&255)|(v<<8);if(r===6)c.start=v<<8;}
    }
  }
  function advance(ms){offset+=ms;for(let i=0;i<queue.length;){const c=queue[i];if(c.frame<=status().frame){queue.splice(i,1);const source=rack.get(c.instance);if(source)apply(source,c.message,{owner:c.owner});}else i++;}settle();}
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_rf5c164_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');rack.set(args.instance,{instance:args.instance,state:state(),manual:new Map(),owned:new Map(),ram:new Uint8Array(65536),rejected:new Map()});}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({instance:args.instance,after:args.after,resolve,reject}));const rejection=rack.get(args.instance)?.rejected.get(args.after);if(rejection){rack.get(args.instance).rejected.delete(args.after);throw Error(rejection);}return snapshot(args.instance);}
    if(command==='native_genesis_rf5c164_status')return {...state(),sampleRate:48000,frame:status().frame};
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].owner===args.owner)queue.splice(i,1);for(const source of rack.values())apply(source,{method:'cancel-main-owner',targetGroup:`worker:${args.owner}`},{group:`worker:${args.owner}`});settle();}
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-rf5c164'){const source=rack.get(c.instance);if(!source)throw Error('Additional sound chip is not connected');if(future&&c.frame>status().frame)queue.push(c);else apply(source,c.message,{owner:c.owner});}settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,gate:value=>{gate=value;},advance,commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

test('Native additional RF5C164 independently owns RAM, eight channels, clocks and Mixer state',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});context.b=await createSoundChip('rf5c164',{id:'b'});`);const {a,b}=f.runtime.context;
  await a.loadMemory(new Uint8Array([128,200,255,255,255]));await b.loadMemory(new Uint8Array([129,210,255]),256);
  for(let ch=0;ch<8;ch++){await a.setChannel(ch,{start:0,loopStart:3,step:100+ch,volume:200,pan:{left:15,right:8}});await a.keyOn(ch);}
  await a.setClock(13000000);await b.setClock(12000000);const view=await f.synth.chipInspector.read('a');assert.equal(view.kind,'rf5c164');assert.equal(view.clock,13000000);assert.equal(view.channels.length,8);assert(view.channels.every(ch=>ch.configuredStep===100+ch.channel));assert.equal(view.mask,0);assert.deepEqual(view.memoryRanges,[{address:0,end:5}]);assert.equal(view.memory,undefined);assert.equal((await f.synth.chipInspector.read('b')).mask,255);assert.equal(b.clock,12000000);
  const [one,two]=[...f.rack.values()];assert.equal(one.ram[1],200);assert.equal(two.ram[1],0);assert.equal(two.ram[257],210);f.synth.mixer.set('a',{volume:.3,pan:-.5});await f.synth.flush();assert.equal(one.state.volume,.3);assert.equal(one.state.pan,-.5);assert.equal(f.synth.extraRf5c164Devices.size,2);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.deepEqual(f.errors,[]);
});
test('Native additional RF5C164 validates full edits before commands and reset retains waveform RAM',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164');`);const a=f.runtime.context.a;
  for(const callback of [()=>a.setChannel(8,{}),()=>a.setChannel(0,{step:70000}),()=>a.setChannel(0,{volume:200,pan:{left:16,right:0}}),()=>a.setPitch(0,-1),()=>a.writeRegister(9,0),()=>a.loadMemory(new Uint8Array(2),65535),()=>a.loadSample(sample(),{address:1}),()=>a.loadSample(sample(),{endGuardBytes:65537})]){const before=f.commands().length;await assert.rejects(callback());assert.equal(f.commands().length,before);}
  await a.loadMemory(new Uint8Array([123,255]),256);await a.setChannel(2,{start:256,step:1234,volume:200,pan:{left:15,right:15}});await a.keyOn(2);await a.reset();const view=await f.synth.chipInspector.read(a.id);assert.equal(view.mask,255);assert.equal(view.channels[2].step,0);assert.deepEqual(view.memoryRanges,[{address:256,end:258}]);assert.equal([...f.rack.values()][0].ram[256],123);assert.deepEqual(f.errors,[]);
});
test('Native additional RF5C164 samples preserve guard markers, exact clock pitch and per-instance allocation',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});context.b=await createSoundChip('rf5c164',{id:'b'});`);const a=f.runtime.context.a;
  await a.setClock(25000000);const loaded=await a.loadSample(sample(),{address:256,endGuardBytes:8});assert.equal(loaded.start,256);assert.equal(loaded.loopStart,289);assert([...f.rack.values()][0].ram.subarray(288,296).every(v=>v===255));
  const i=f.synth.chipInspector,first=await i.loadSample('a',sample(),{name:'first'}),second=await i.loadSample('a',sample(),{name:'second'}),other=await i.loadSample('b',sample(),{name:'other'});assert.equal(first.start,0);assert.equal(second.start,512);assert.equal(other.start,0);assert.equal(first.step,loaded.step);await assert.rejects(i.loadSample('a',sample(),{address:256}),/overwrite/);
  let view=await i.read('a');assert.equal(view.samples.length,3);assert.equal(view.samples.find(v=>v.address===256).endGuardBytes,8);assert.equal(view.samples[0].waveform.length>0,true);await a.loadMemory(new Uint8Array([128]),256);view=await i.read('a');assert(!view.samples.some(v=>v.address===256));assert.equal((await i.read('b')).samples.length,1);assert.deepEqual(f.errors,[]);
});
test('Native additional RF5C164 Keyboard transposes applied configured step and stale releases preserve replacements',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  await assert.rejects(i.invoke('a','auditionOn',[0,60,'empty']),/Load PCM RAM/);await a.loadMemory(new Uint8Array([128,210,255,255,255]));for(let ch=0;ch<8;ch++)await a.setChannel(ch,{start:0,loopStart:3,step:100+ch,volume:200,pan:{left:15,right:15}});
  for(let ch=0;ch<8;ch++)await i.invoke('a','auditionOn',[ch,72,`key${ch}`]);let view=await i.read('a');assert.equal(view.mask,0);assert.equal(view.held.length,8);assert(view.channels.every(ch=>ch.step===(100+ch.channel)*2&&ch.configuredStep===100+ch.channel));await assert.rejects(a.setClock(13000000),/manually held/);assert.equal(f.synth.state,'ready');
  await i.invoke('a','auditionOn',[7,60,'replacement']);await i.invoke('a','auditionOff',[7,'key7']);assert((await i.read('a')).held.includes(7));await i.invoke('a','setChannel',[7,{volume:40}]);assert.equal((await i.read('a')).channels[7].volume,40);await i.invoke('a','auditionAllOff');view=await i.read('a');assert.equal(view.mask,255);assert.deepEqual(view.held,[]);assert(view.channels.every(ch=>ch.step===100+ch.channel));await a.setClock(13000000);assert.equal(a.clock,13000000);assert.deepEqual(f.errors,[]);
});
for(const execution of ['main','worker'])test(`Native additional RF5C164 ${execution} keeps per-loop owners across every asynchronous RPC`,{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('rf5c164',{id:'a'});await a.loadMemory(new Uint8Array([128,210,255,255,255]));liveLoop('one',async()=>{const s=await useSoundChip('rf5c164');await s.setClock(12500000);await s.setChannel(1,{step:100,volume:100,pan:{left:15,right:15}});await s.setPitch(1,123);try{await s.setPitch(1,70000);throw Error('invalid pitch accepted');}catch(error){if(!/step/.test(error.message))throw error;}await s.keyOn(1);log('one-ready');await beat(100);});liveLoop('two',async()=>{const s=await useSoundChip('rf5c164');await s.setClock(12500000);await s.setChannel(7,{step:222,volume:100,pan:{left:15,right:15}});await s.writeRegister(7,0xc7);await s.writeRegister(8,0x7f);log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.logs.includes('one-ready')&&f.logs.includes('two-ready')&&(execution==='main'||f.runtime.getKeyboardTarget()));const gates=f.commands().filter(c=>c.type==='extra-rf5c164'&&(c.message.method==='key-on'||c.message.method==='write'&&c.message.register===8));assert.equal(new Set(gates.map(c=>execution==='worker'?c.owner:c.message.group)).size,2);if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();const view=await f.synth.chipInspector.read('rf5c164:shared');assert.equal(view.mask&2,2);assert.equal(view.mask&128,0);assert.deepEqual(f.errors,[]);
});
test('Actual Native RF5C164 Worker loadSample decodes PCM and awaits memory and clock acknowledgements',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await useSoundChip('rf5c164');const s=await a.loadSample({sampleRate:8000,channels:[Float32Array.from([0,.5,0,-.5])]},{address:256,endGuardBytes:8});if(s.start!==256||s.loopStart!==261)throw Error('sample');await a.setChannel(0,{start:s.start,loopStart:s.loopStart,step:s.step,volume:100,pan:{left:15,right:15}});await a.setClock(13000000);if(a.clock!==13000000)throw Error('clock');await a.keyOn(0);log('ready');`,{execution:'worker'});await until(()=>f.logs.includes('ready'));const view=await f.synth.chipInspector.read('rf5c164:shared');assert.equal(view.samples.length,1);assert.equal(view.samples[0].frames,4);assert.equal(view.samples[0].endGuardBytes,8);assert.equal(view.channels[0].start,256);assert.equal(view.mask&1,0);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 status reads do not replay future authored settings',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('rf5c164',{id:'a'});liveLoop('future',async()=>{await a.setPitch(3,1234);await a.keyOn(3);log('queued');await beat(100);});`,{execution:'worker'});await until(()=>f.queue.some(c=>c.message.method==='set-channel'));const before=f.commands().length,view=await f.synth.chipInspector.read('a');assert(!f.logs.includes('queued'));assert.equal(view.channels[3].step,0);assert.equal(view.mask,255);assert.equal(f.commands().length,before);f.advance(1000);await until(()=>f.logs.includes('queued'));assert.equal((await f.synth.chipInspector.read('a')).channels[3].step,1234);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 shared handles evict independently and primary Mega CD remains borrowed',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'mega-cd'});await f.runtime.playSource(`context.p=await useSoundChip('rf5c164');context.a=await createSoundChip('rf5c164',{id:'side'});`);assert.equal(f.runtime.context.p.id,'rf5c164');assert.equal(f.runtime.context.p.dispose,undefined);assert.equal(f.runtime.context.a.id,'side');assert.equal(f.synth.extraDevices.size,1);const old=f.synth.chipInspector.getConnectionToken('side');f.runtime.context.a.dispose();await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'side'});`);assert.notEqual(f.synth.chipInspector.getConnectionToken('side'),old);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 shared cache and sixteen-slot rack retire cleanly',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={useSoundChip,createSoundChip};`);const {useSoundChip,createSoundChip}=f.runtime.context.api,a=await useSoundChip('rf5c164');assert.equal(a,await useSoundChip('rf5c164'));a.dispose();const b=await useSoundChip('rf5c164');assert.notEqual(a,b);for(let n=0;n<15;n++)await createSoundChip('rf5c164',{id:`n${n}`});await assert.rejects(createSoundChip('rf5c164'),/at most 16/);await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});
for(const late of [false,true])test(`Actual Native RF5C164 Worker cancellation disposes ${late?'late response':'pending creation'}`,{timeout:10000},async t=>{
  const workers=installWorkers(t,{holdResponse:message=>late&&message.type==='response'&&message.value?.id==='pending'}),f=fixture(t),gate=deferred();if(!late)f.gate(gate);
  await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('rf5c164',{id:'pending'});await a.keyOn(7);await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>(late?workers[0].heldResponses.length===1:f.calls.some(c=>c.command==='native_genesis_extra_rf5c164_create'))&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));if(late)workers[0].releaseResponses();else gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command==='native_genesis_extra_rf5c164_dispose'));assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-rf5c164'&&c.message.method==='key-on'));assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 client cancels decoded and pending RPC continuations on disposal',async()=>{
  const channel=new MessageChannel(),gate=deferred(),messages=[];channel.port2.on('message',m=>messages.push(m));let context={name:'one'};
  const client=createRf5c164Client(channel.port1,()=>gate.promise,{native:true,captureContext:()=>context,restoreContext:value=>{context=value;},isStopped:()=>false});
  const decode=client.loadSample(new Uint8Array([1])),rejected=assert.rejects(decode,/stopped|disposed/);client.dispose();gate.resolve(sample());await rejected;await tick();assert(!messages.some(m=>m.method==='loadMemory'));channel.port2.close();
});
test('Native RF5C164 PCM WAV loading uses no AudioContext and a cancelled decoder cannot upload to a reused id',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});`);const a=f.runtime.context.a;
  const wav=encodeWav(sample());await a.loadSample(wav,{address:256});assert.equal((await f.synth.chipInspector.read('a')).samples[0].frames,32);
  const gate=deferred(),device=await f.synth.createExtraRf5c164({id:'decode',decodeAudio:async()=>gate.promise});const loading=device.client.loadSample(new Uint8Array([1,2,3])),rejected=assert.rejects(loading,/cancelled|not ready/);device.dispose();await f.synth.createExtraRf5c164({id:'decode'});gate.resolve({sampleRate:8000,numberOfChannels:1,getChannelData:()=>sample().channels[0]});await rejected;
  assert.equal(f.commands().filter(c=>c.type==='extra-rf5c164'&&c.message.method==='load-memory').length,1);assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 cancelled Main clock request cannot enter the lane or steal a later owner',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('rf5c164',{id:'a'});liveLoop('one',async()=>{const pending=a.setClock(13000000);stopLoop('one');await pending;await a.keyOn(0);});liveLoop('two',async()=>{await a.setClock(14000000);await a.setPitch(7,123);await a.keyOn(7);log('ready');await beat(100);});context.cancel=()=>stopLoop('two');`);await until(()=>f.logs.includes('ready'));assert(!f.commands().some(c=>c.type==='extra-rf5c164'&&c.message.method==='clock'&&c.message.hz===13000000));const i=f.synth.chipInspector;assert.equal((await i.read('a')).mask&128,0);f.runtime.context.cancel();await f.synth.flush();assert.equal((await i.read('a')).mask,255);assert.deepEqual(f.errors,[]);
});
for(const method of ['setPitch','setClock'])test(`Native RF5C164 future ${method} completion leaves Stop and owner cancellation unblocked`,{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('rf5c164',{id:'a'});liveLoop('future',async()=>{await a.${method}(${method==='setPitch'?'7,1234':'13000000'});await a.keyOn(7);log('applied');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('future');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.waiters.length===1&&f.runtime.getKeyboardTarget());assert(!f.logs.includes('applied'));assert.equal(f.synth.acceptedRequests,1);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled')&&!f.queue.length);await f.runtime.stopWithFade();assert.equal(f.waiters.length,0);assert.equal(f.synth.acceptedRequests,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 rejected manual RAM overwrite and protected reset retain applied sample metadata and Keyboard lease',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;const loaded=await a.loadSample(sample());await a.setChannel(0,{start:loaded.start,loopStart:loaded.loopStart,step:loaded.step,volume:200,pan:{left:15,right:15}});await i.invoke('a','auditionOn',[0,60,'held']);const before=(await i.read('a')).samples;
  await assert.rejects(a.loadSample(sample()),/manually held/);assert.deepEqual((await i.read('a')).samples,before);await a.reset();assert.deepEqual((await i.read('a')).held,[0]);await i.invoke('a','auditionOff',[0,'held']);assert.deepEqual((await i.read('a')).held,[]);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 serializes concurrent public uploads and Inspector allocations with their own sample metadata',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  const [raw,first,other]=await Promise.all([a.loadSample(sample(),{address:0}),i.loadSample('a',{sampleRate:16000,channels:[Float32Array.from([0,.25,0,-.25])]},{name:'UI first'}),i.loadSample('a',sample(),{name:'UI other'})]);
  assert.equal(raw.start,0);assert.equal(first.start,256);assert.equal(first.name,'UI first');assert.equal(first.frames,4);assert.equal(other.start,512);assert.equal(other.name,'UI other');const view=await i.read('a');assert.deepEqual(view.samples.map(v=>[v.address,v.name,v.frames]),[[0,'Sample',32],[256,'UI first',4],[512,'UI other',32]]);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 Inspector raw edits target the applied selected channel and global reset has its supported route',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;await a.setChannel(7,{volume:100,step:123});await i.invoke('a','writeRegister',[0,77]);let view=await i.read('a');assert.equal(view.channels[7].volume,77);assert.equal(view.channels[0].volume,0);const group=f.commands().findLast(c=>c.message.method==='batch');assert.equal(group.message.channel,7);assert.deepEqual(group.message.commands[0],{method:'write',register:7,value:0xc7});await i.invoke('a','writeRegister',[8,0]);assert.equal((await i.read('a')).mask,0);await i.invoke('a','reset');view=await i.read('a');assert.equal(view.mask,255);assert.equal(view.channels[7].volume,0);assert.equal(f.commands().at(-1).message.method,'reset');assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 captures trusted local file fetch before a script replaces globals',async t=>{
  installWorkers(t);const previous=globalThis.fetch,urls=[];globalThis.fetch=async url=>{urls.push(url);return {ok:true,arrayBuffer:async()=>encodeWav(sample()).buffer};};const f=fixture(t);t.after(()=>{globalThis.fetch=previous;});globalThis.fetch=()=>{throw Error('Untrusted script fetch');};
  await f.runtime.playSource(`const a=await createSoundChip('rf5c164',{id:'a'});await a.loadSample('./voice.wav');`);assert.deepEqual(urls,['./voice.wav']);assert.equal((await f.synth.chipInspector.read('a')).samples[0].frames,32);assert.deepEqual(f.errors,[]);
});
test('Native RF5C164 upload bytes are cloned synchronously before a queued transaction begins',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('rf5c164',{id:'a'});`);const a=f.runtime.context.a,bytes=new Uint8Array([128,190,255]);const first=a.loadMemory(bytes),second=a.loadMemory(bytes,256);bytes.fill(0);await Promise.all([first,second]);const ram=[...f.rack.values()][0].ram;assert.deepEqual([...ram.subarray(0,3)],[128,190,255]);assert.deepEqual([...ram.subarray(256,259)],[128,190,255]);assert.deepEqual(f.errors,[]);
});
