import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker,MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createGameboyClient} from './playground_gameboy.js';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional Game Boy test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t,{holdResponse=()=>false}={}){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native Game Boy attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){this.pending=[];this.messages=[];this.heldResponses=[];this.ready=false;workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(holdResponse(message)){this.heldResponses.push([message,transfer]);return;}if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    releaseResponses(){for(const [message,transfer]of this.heldResponses.splice(0))this.worker.postMessage(message,transfer);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
const baseClock=4194304;
function source(instance){return {instance,clock:baseClock,applied:new GameboyVoiceInspector({writeRegister(){},reset(){}},{clock:()=>baseClock}),manual:new Map(),owners:new Map()};}
function fixture(t,{mode='genesis',future=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),queue=[],waiters=[],primary=source(0);let gate=null,offset=0;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const value=s=>({clock:s.clock,registers:Array.from(s.applied.registers),voice:Array.from(s.applied.voice),gates:s.applied.gates.slice(),held:[...s.manual.keys()],pendingCommands:queue.filter(c=>c.instance===s.instance&&c.message.id).map(c=>c.message.id)});
  const snapshot=instance=>{const s=rack.get(instance);if(!s)throw Error('Additional sound chip is not connected');return {gameboy:value(s),sampleRate:48000,frame:status().frame,revision:calls.length};};
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!rack.has(w.instance)){waiters.splice(i,1);w.reject(new DOMException('Disposed','AbortError'));}else if(!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(i,1);w.resolve(snapshot(w.instance));}}}
  const voiceChannel=address=>address<=19?Math.floor(address/5):address>=32?2:null;
  function apply(s,m,{audition=m.audition===true,owner,group=m.group}={}){
    if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    if(m.method==='batch'){if(m.action==='off'&&s.manual.get(m.channel)!==m.voice)return;for(const c of m.commands)apply(s,c,{audition:true,owner,group});if(m.action==='on'){if(s.applied.gates[m.channel])s.manual.set(m.channel,m.voice);else s.manual.delete(m.channel);s.owners.delete(m.channel);}else if(m.action==='off')s.manual.delete(m.channel);return;}
    if(m.method==='clock'){if(s.manual.size&&!audition)throw Error('Release the manually held additional Game Boy voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){if(!s.manual.size||audition){s.applied.reset();s.owners.clear();s.manual.clear();}}
    else if(m.method==='write'){
      const channel=voiceChannel(m.address);if(!audition&&(channel===null?s.manual.size:s.manual.has(channel)))return;
      const trigger=[4,9,14,19].indexOf(m.address),dac=[2,7,10,17].indexOf(m.address),off=dac>=0&&!(m.value&(dac===2?128:248));
      if(off&&!audition&&group!==undefined&&s.owners.has(dac)&&s.owners.get(dac)!==group)return;
      s.applied.observeWrite(m.address,m.value);if(trigger>=0&&(m.value&128))s.owners.set(trigger,group);if(off)s.owners.delete(dac);if(m.address===22&&!(m.value&128)){s.manual.clear();s.owners.clear();}
    }else if(m.method==='cancel-main-owner'){
      for(let i=queue.length-1;i>=0;i--)if(queue[i].instance===s.instance&&queue[i].message.group===m.targetGroup)queue.splice(i,1);
      for(const [channel,owned]of s.owners)if(owned===m.targetGroup&&!s.manual.has(channel)){s.applied.observeWrite([2,7,10,17][channel],0);s.owners.delete(channel);}
    }else if(['all-notes-off','stop-voices'].includes(m.method))for(let channel=0;channel<4;channel++)if(!s.manual.has(channel)&&(group===undefined||!s.owners.has(channel)||s.owners.get(channel)===group)){s.applied.observeWrite([2,7,10,17][channel],0);s.owners.delete(channel);}
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_gameboy_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');rack.set(args.instance,source(args.instance));}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({instance:args.instance,after:args.after,resolve,reject}));return snapshot(args.instance);}
    if(command==='native_genesis_gameboy_status')return value(primary);
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].owner===args.owner)queue.splice(i,1);for(const s of rack.values())apply(s,{method:'cancel-main-owner',targetGroup:`worker:${args.owner}`});settle();}
    if(command==='native_genesis_commands'){
      for(const c of args.commands)if(c.type==='extra-gameboy'&&c.message.method==='clock'&&rack.get(c.instance)?.manual.size&&!c.message.audition)throw Error('Release the manually held additional Game Boy voices before changing the clock');
      for(const c of args.commands)if(c.type==='extra-gameboy'){const s=rack.get(c.instance);if(!s)throw Error('Additional sound chip is not connected');if(future&&c.frame>status().frame)queue.push(c);else apply(s,c.message,{owner:c.owner});}else if(c.type==='gameboy')apply(primary,c.message,{owner:c.owner});
    }
    settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,gate:value=>{gate=value;},commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}
test('Native additional Game Boy preserves synchronous initialize contract, independent four voices, wave RAM, clock and Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('gameboy',{id:'a'});context.b=await createSoundChip('gameboy',{id:'b'});`);const {a,b}=f.runtime.context;
  assert.throws(()=>a.pulse.keyOn(0),/initialize/);assert.equal(a.initialize(),undefined);b.initialize();a.pulse.setVoice(0,{volume:13,duty:.25});a.wave.setWaveform(Array.from({length:32},(_,n)=>n%16));b.wave.setWaveform(Array(32).fill(4));a.setPan(0,true,false);a.noteOn(0,60);a.noteOn(1,64);a.wave.noteOn(67);a.noise.keyOn();await a.setClock(8388608);await b.setClock(2097152);
  const one=await f.synth.chipInspector.read('a'),two=await f.synth.chipInspector.read('b');assert.equal(one.clock,8388608);assert.equal(two.clock,2097152);assert.equal(one.channels[0].volume,13);assert.deepEqual(one.channels[0].pan,{left:true,right:false});assert.deepEqual(one.channels[2].waveform,Array.from({length:32},(_,n)=>n%16));assert.deepEqual(two.channels[2].waveform,Array(32).fill(4));assert(one.channels.every(c=>c.active));assert(two.channels.every(c=>!c.active));assert.equal(f.synth.extraGameboyDevices.size,2);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  f.synth.mixer.set('a',{volume:.3,pan:-.5});await f.synth.flush();assert.equal([...f.rack.values()][0].volume,.3);assert.deepEqual(f.errors,[]);
});
test('Native Game Boy validates atomic setters, applied reads leave authoring state intact, partial UI edits preserve unrelated author bits',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('gameboy',{id:'a'});context.a.initialize();`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  const before=f.commands().length;assert.throws(()=>a.wave.setWaveform(Array(32).fill(16)));assert.throws(()=>a.pulse.setVoice(0,{volume:4,duty:.3}));assert.throws(()=>a.setPan(0,'yes',false));assert.throws(()=>a.writeRegister(48,1));assert.equal(f.commands().length,before);
  a.pulse.setVoice(0,{volume:14,envelope:{direction:'up',period:7}});a.setPan(1,false,true);await f.synth.flush();const state=a._getState?.();await i.read('a');if(state)assert.deepEqual(a._getState(),state);
  await i.invoke('a','setVoice',[0,{volume:9}]);assert.equal(a.pulse.setFrequency(0,440)>0,true);assert.equal((await i.read('a')).channels[0].volume,9);assert.deepEqual((await i.read('a')).channels[1].pan,{left:false,right:true});assert.deepEqual(f.errors,[]);
});
test('Native Game Boy four channel auditions retain configured voices, reject stale releases and clock changes, and power off releases all leases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('gameboy',{id:'a'});context.a.initialize();`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  for(let ch=0;ch<4;ch++)await i.invoke('a','auditionOn',[ch,60+ch,`old${ch}`]);assert.deepEqual((await i.read('a')).held,[0,1,2,3]);a.reset();await f.synth.flush();assert.deepEqual((await i.read('a')).held,[0,1,2,3]);await assert.rejects(a.setClock(8388608),/manually held/);assert.equal(f.synth.state,'ready');
  await i.invoke('a','setVoice',[0,{volume:7}]);await i.invoke('a','auditionOn',[0,64,'new']);await i.invoke('a','auditionOff',[0,'old0']);assert.deepEqual((await i.read('a')).held,[0,1,2,3]);await i.invoke('a','setPower',[false]);const view=await i.read('a');assert.equal(view.powered,false);assert.deepEqual(view.held,[]);assert.equal(view.channels[0].active,false);await i.invoke('a','setPower',[true]);await a.setClock(8388608);assert.equal(a.clock,8388608);assert.deepEqual(f.errors,[]);
});
test('Native Game Boy wave edits ending a DAC gate release the applied manual lease before a later stale key-up',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('gameboy',{id:'a'});context.a.initialize();`);const i=f.synth.chipInspector;
  await i.invoke('a','auditionOn',[2,60,'wave']);assert.deepEqual((await i.read('a')).held,[2]);await i.invoke('a','setVoice',[2,{waveform:Array(32).fill(3)}]);assert.deepEqual((await i.read('a')).held,[]);assert.equal(await i.invoke('a','auditionOff',[2,'wave']),false);await f.runtime.context.a.setClock(8388608);assert.deepEqual(f.errors,[]);
});
for(const execution of ['main','worker'])test(`Native Game Boy ${execution} nested section and clock continuations retain loop ownership`,{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await useSoundChip('gameboy');a.initialize();let ready=false;liveLoop('one',async()=>{const s=await useSoundChip('gameboy');await s.setClock(4194304);s.pulse.noteOn(0,60);s.wave.noteOn(60);ready=true;log('one-ready');await beat(100);});liveLoop('two',async()=>{while(!ready)await beat(.001);const s=await useSoundChip('gameboy');await s.setClock(4194304);s.pulse.noteOn(0,64);s.wave.noteOn(64);log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.logs.includes('one-ready')&&f.logs.includes('two-ready')&&f.commands().filter(c=>c.type==='extra-gameboy'&&c.message.method==='write'&&c.message.address===4&&(c.message.value&128)).length===2&&(execution==='main'||f.runtime.getKeyboardTarget()));const notes=f.commands().filter(c=>c.type==='extra-gameboy'&&c.message.method==='write'&&c.message.address===4&&(c.message.value&128));assert.equal(new Set(notes.map(c=>execution==='worker'?c.owner:c.message.group)).size,2);if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();const view=await f.synth.chipInspector.read('gameboy:shared');assert(view.channels[0].active);assert(view.channels[2].active);assert.deepEqual(f.errors,[]);
});
for(const late of [false,true])test(`Native Game Boy actual Worker cancellation disposes ${late?'late response':'pending creation'}`,{timeout:10000},async t=>{
  const workers=installWorkers(t,{holdResponse:message=>late&&message.type==='response'&&message.value?.id==='pending'}),f=fixture(t),gate=deferred();if(!late)f.gate(gate);
  await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('gameboy',{id:'pending'});a.initialize();a.pulse.noteOn(0,60);await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>(late?workers[0].heldResponses.length===1:f.calls.some(c=>c.command==='native_genesis_extra_gameboy_create'))&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));if(late)workers[0].releaseResponses();else gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command==='native_genesis_extra_gameboy_dispose'));assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-gameboy'&&c.message.method==='write'&&c.message.address===4&&(c.message.value&128)));assert.deepEqual(f.errors,[]);
});
test('Native Game Boy primary borrowing, independent creation, sixteen slots, shared eviction and fixed id fences',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'gameboy'});await f.runtime.playSource(`context.p=await useSoundChip('gameboy');context.a=await createSoundChip('gameboy',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.equal(f.runtime.context.p.id,'gameboy');assert.equal(f.runtime.context.p.dispose,undefined);const token=f.synth.chipInspector.getConnectionToken('side');f.runtime.context.a.dispose();await f.runtime.playSource(`context.a=await createSoundChip('gameboy',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.notEqual(f.synth.chipInspector.getConnectionToken('side'),token);for(let n=0;n<15;n++)await f.runtime.context.api.createSoundChip('gameboy',{id:`n${n}`});await assert.rejects(f.runtime.context.api.createSoundChip('gameboy'),/at most 16/);await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});
test('Native Game Boy actual future clock completion leaves ordinary reads, cancellation and Stop unblocked', {timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('gameboy',{id:'a'});a.initialize();liveLoop('future',async()=>{await a.setClock(8388608);log('applied');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('future');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.waiters.length&&f.runtime.getKeyboardTarget());assert(!f.logs.includes('applied'));const before=f.commands().length;assert.equal((await f.synth.chipInspector.read('a')).clock,baseClock);assert.equal(f.commands().length,before);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled')&&!f.queue.some(c=>c.message.method==='clock'));await f.runtime.stopWithFade();assert.equal(f.waiters.length,0);assert.equal(f.synth.acceptedRequests,0);assert.deepEqual(f.errors,[]);
});
test('Native Game Boy author patches merge shared registers atomically and disposed clock continuations cannot resume loops',async()=>{
  const channel=new MessageChannel(),messages=[],restored=[];channel.port2.on('message',message=>messages.push(message));const client=createGameboyClient(channel.port1,{native:true},{captureContext:()=>({name:'one'}),restoreContext:context=>restored.push(context),isStopped:()=>false});
  try{client.initialize();client.pulse.setVoice(0,{volume:13,envelope:{direction:'up',period:7}});client.setPan(1,false,true);client._applyAuthorEdit({registers:[[2,0x40,0xf0],[21,0x11,0x11]],voice:[[2,0x40,0xf0],[21,0x11,0x11]]});assert.equal(client._getState().voice[2],0x4f);assert.equal(client._getState().voice[21]&0x22,2);const state=client._getState();assert.throws(()=>client._applyAuthorEdit({voice:[[2,0]],clock:1}),/clock/);assert.deepEqual(client._getState(),state);const clock=client.setClock(8388608),rejected=assert.rejects(clock,/disposed|stopped/);await until(()=>messages.some(m=>m.method==='clock'));client.dispose();await rejected;assert.deepEqual(restored,[]);}finally{client.dispose();channel.port2.close();}
});
