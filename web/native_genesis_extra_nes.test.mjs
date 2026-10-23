import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker,MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNesClient} from './playground_nes.js';
import {NesVoiceInspector} from './playground_native_voice_inspector.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional NES test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t,{holdResponse=()=>false}={}){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native NES attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){this.pending=[];this.messages=[];this.heldResponses=[];this.ready=false;workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(holdResponse(message)){this.heldResponses.push([message,transfer]);return;}if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    releaseResponses(){for(const [message,transfer]of this.heldResponses.splice(0))this.worker.postMessage(message,transfer);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
function source(instance,{clock=1789773,fds=false}={}){return {instance,clock,baseClock:clock,fds,applied:new NesVoiceInspector({clock,fdsEnabled:fds,writeRegister(){},reset(){},loadMemory(){}},{clock:()=>clock}),manual:new Map(),owners:new Map(),memory:new Uint8Array(65536)};}
function fixture(t,{mode='genesis',future=false,holdMemory=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),queue=[],waiters=[],memoryReplies=[],primary=source(0,{fds:true});let gate=null,offset=0,rejection;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const value=s=>({clock:s.clock,baseClock:s.baseClock,fdsEnabled:s.fds,registers:Array.from(s.applied.registers),modulation:Array.from(s.applied.modTable),enabled:s.applied.enabled,fdsGain:s.applied.fdsGain,fdsMaster:s.applied.fdsMaster,fdsActive:s.fds&&!!(s.applied.registers[0x23]&2)&&!(s.applied.registers[0x83]&128),dmcActive:!!(s.applied.enabled&16),memoryRanges:s.applied.memoryRanges.slice(),held:[...s.manual.keys()],pendingCommands:queue.filter(c=>c.instance===s.instance&&c.message.id).map(c=>c.message.id)});
  const snapshot=instance=>{const s=rack.get(instance);if(!s)throw Error('Additional sound chip is not connected');return {nes:value(s),sampleRate:48000,frame:status().frame,revision:calls.length};};
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!rack.has(w.instance)){waiters.splice(i,1);w.reject(new DOMException('Disposed','AbortError'));}else if(!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(i,1);w.resolve(snapshot(w.instance));}}}
  const voiceChannel=address=>address<=0x400f?Math.floor((address-0x4000)/4):address>=0x4010&&address<=0x4013?4:address>=0x4023?5:null;
  function apply(s,m,{audition=m.audition===true,owner,group=m.group}={}){
    if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    if(m.method==='batch'){if(m.action==='off'&&s.manual.get(m.channel)!==m.voice)return;for(const c of m.commands)apply(s,c,{audition:true,owner,group});if(m.fdsGain!==undefined)s.applied.fdsGain=m.fdsGain;if(m.fdsMaster!==undefined)s.applied.fdsMaster=m.fdsMaster;if(m.action==='on'){s.manual.set(m.channel,m.voice);s.owners.delete(m.channel);}else if(m.action==='off')s.manual.delete(m.channel);return;}
    if(m.method==='clock'){if(s.manual.size&&!audition)throw Error('Release the manually held additional NES voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='memory'){if(s.manual.has(4)&&!audition)throw Error('Release the manually held additional NES DMC voice before replacing sample memory');s.memory.set(m.data,m.offset);s.applied.memoryRanges.push({address:m.offset,end:m.offset+m.data.length});}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){if(!s.manual.size||audition){s.applied.reset();s.owners.clear();s.manual.clear();}}
    else if(m.method==='enable'){
      if(!audition&&s.manual.has(m.channel))return;if(!m.enabled&&!audition&&group!==undefined&&s.owners.has(m.channel)&&s.owners.get(m.channel)!==group)return;
      const bit=1<<m.channel;s.applied.enabled=m.enabled?s.applied.enabled|bit:s.applied.enabled&~bit;s.applied.registers[0x15]=s.applied.enabled;
      if(m.enabled)s.owners.set(m.channel,group);else s.owners.delete(m.channel);
    }else if(m.method==='write'){
      const channel=voiceChannel(m.address);if(!audition&&s.manual.has(channel))return;
      s.applied.observeWrite(m.address,m.value);
      if(m.address===0x4083){if(!(m.value&128))s.owners.set(5,group);else s.owners.delete(5);}
    }else if(m.method==='cancel-main-owner'){
      for(let i=queue.length-1;i>=0;i--)if(queue[i].instance===s.instance&&queue[i].message.group===m.targetGroup)queue.splice(i,1);
      for(const [channel,owned]of s.owners)if(owned===m.targetGroup&&!s.manual.has(channel)){if(channel===5)s.applied.observeWrite(0x4083,s.applied.registers[0x83]|128);else s.applied.enabled&=~(1<<channel);s.owners.delete(channel);}
    }else if(['all-notes-off','stop-voices'].includes(m.method))for(let channel=0;channel<(s.fds?6:5);channel++)if(!s.manual.has(channel)&&(group===undefined||!s.owners.has(channel)||s.owners.get(channel)===group)){if(channel===5)s.applied.observeWrite(0x4083,s.applied.registers[0x83]|128);else s.applied.enabled&=~(1<<channel);s.owners.delete(channel);}
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_nes_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');rack.set(args.instance,source(args.instance,args));}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&holdMemory&&calls.some(c=>c.command==='native_genesis_commands'&&c.args.commands.some(c=>c.instance===args.instance&&c.message?.method==='memory'&&c.message.id===args.after)))return new Promise(resolve=>memoryReplies.push(()=>resolve(snapshot(args.instance))));if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({instance:args.instance,after:args.after,resolve,reject}));return snapshot(args.instance);}
    if(command==='native_genesis_nes_status')return value(primary);
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].owner===args.owner)queue.splice(i,1);for(const s of rack.values())apply(s,{method:'cancel-main-owner',targetGroup:`worker:${args.owner}`});settle();}
    if(command==='native_genesis_commands'){
      if(rejection){const error=rejection;rejection=undefined;throw new Error(error);}
      for(const c of args.commands)if(c.type==='extra-nes'&&c.message.method==='clock'&&rack.get(c.instance)?.manual.size&&!c.message.audition)throw Error('Release the manually held additional NES voices before changing the clock');else if(c.type==='extra-nes'&&c.message.method==='memory'&&rack.get(c.instance)?.manual.has(4)&&!c.message.audition)throw Error('Release the manually held additional NES DMC voice before replacing sample memory');
      for(const c of args.commands)if(c.type==='extra-nes'){const s=rack.get(c.instance);if(!s)throw Error('Additional sound chip is not connected');if(future&&c.frame>status().frame)queue.push(c);else apply(s,c.message,{owner:c.owner});}else if(c.type==='nes')apply(primary,c.message,{owner:c.owner});
    }
    settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,memoryReplies,rejectNext:value=>{rejection=value;},gate:value=>{gate=value;},commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

test('Native additional NES auto-initializes, preserves optional FDS, fractional PAL clock, independent RAM and Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('nes',{id:'a',fds:true});context.b=await createSoundChip('nes',{id:'b',clock:1662607.125});`);const {a,b}=f.runtime.context;
  assert.equal(a.pulse.noteOn(0,'C4'),undefined);a.triangle.noteOn('E4');a.noise.noteOn();a.fds.noteOn('G4');await a.dmc.loadSample(new Uint8Array([1,2,3]));a.dmc.play();await b.loadMemory(new Uint8Array([7,8]),0xc000);await f.synth.flush();
  const one=await f.synth.chipInspector.read('a'),two=await f.synth.chipInspector.read('b');assert.equal(one.fdsEnabled,true);assert.equal(two.fdsEnabled,false);assert.equal(two.clock,1662607.125);assert.equal(two.channels.length,5);assert(one.channels[0].active);assert(one.fds.active);assert(one.dmc.loaded);assert.equal([...f.rack.values()][0].memory[0xc000],1);assert.equal([...f.rack.values()][1].memory[0xc000],7);assert.throws(()=>b.fds.noteOn('C4'),/FDS requires/);
  f.synth.mixer.set('a',{volume:.3,pan:-.5});await f.synth.flush();assert.equal([...f.rack.values()][0].volume,.3);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.equal(f.synth.extraNesDevices.size,2);assert.deepEqual(f.errors,[]);
});
test('Native NES manual Keyboard leases, DMC replacement rejection and partial author edits preserve other channels',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('nes',{id:'a',fds:true});await context.a.dmc.loadSample(new Uint8Array(17));context.a.pulse.setVoice(0,{volume:14,duty:.25,sweep:{enabled:true,period:6,shift:3}});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  const before=a._getState?.();await i.read('a');if(before)assert.deepEqual(a._getState(),before);
  for(let channel=0;channel<6;channel++)await i.invoke('a','auditionOn',[channel,60+channel,`old${channel}`]);assert.deepEqual((await i.read('a')).held,[0,1,2,3,4,5]);
  await assert.rejects(a.setClock(2000000),/manually held/);await assert.rejects(a.loadMemory(new Uint8Array([8]),0xc000),/manually held/);assert.equal(f.synth.state,'ready');await i.invoke('a','setPulseVoice',[0,{volume:5,sweep:{shift:1}}]);await i.invoke('a','setFdsVolume',[{master:2}]);const view=await i.read('a');assert.equal(view.channels[0].volume,5);assert.equal(view.channels[0].sweep.period,6);assert.equal(view.fds.master,2);
  await i.invoke('a','auditionOn',[0,64,'new']);await i.invoke('a','auditionOff',[0,'old0']);assert.equal((await i.read('a')).held.length,6);await i.invoke('a','auditionAllOff');await a.setClock(2000000);assert.equal(a.clock,2000000);assert.deepEqual(f.errors,[]);
});
for(const execution of ['main','worker'])test(`Native NES ${execution} async DMC and clock continuations retain nested owner scope`,{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await useSoundChip('nes');let ready=false;liveLoop('one',async()=>{const s=await useSoundChip('nes');await s.dmc.loadSample(new Uint8Array([1]));await s.setClock(1789773);s.pulse.noteOn(0,60);s.dmc.play();ready=true;log('one-ready');await beat(100);});liveLoop('two',async()=>{while(!ready)await beat(.001);const s=await useSoundChip('nes');await s.setClock(1789773);s.pulse.noteOn(0,64);s.dmc.play();log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.logs.includes('one-ready')&&f.logs.includes('two-ready')&&f.commands().filter(c=>c.type==='extra-nes'&&c.message.method==='enable'&&c.message.channel===0&&c.message.enabled).length===2&&(execution==='main'||f.runtime.getKeyboardTarget()));const notes=f.commands().filter(c=>c.type==='extra-nes'&&c.message.method==='enable'&&c.message.channel===0&&c.message.enabled);assert.equal(new Set(notes.map(c=>execution==='worker'?c.owner:c.message.group)).size,2);if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();assert((await f.synth.chipInspector.read('nes:shared')).channels[0].active);assert.deepEqual(f.errors,[]);
});
for(const late of [false,true])test(`Native NES actual Worker cancellation disposes ${late?'late response':'pending creation'}`,{timeout:10000},async t=>{
  const workers=installWorkers(t,{holdResponse:message=>late&&message.type==='response'&&message.value?.id==='pending'}),f=fixture(t),gate=deferred();if(!late)f.gate(gate);
  await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('nes',{id:'pending',fds:true});a.fds.noteOn('C4');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>(late?workers[0].heldResponses.length===1:f.calls.some(c=>c.command==='native_genesis_extra_nes_create'))&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));if(late)workers[0].releaseResponses();else gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command==='native_genesis_extra_nes_dispose'));assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});
test('Native NES primary borrowing, independent creation, sixteen slots and fixed id fences',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'nes'});await f.runtime.playSource(`context.p=await useSoundChip('nes');context.a=await createSoundChip('nes',{id:'side',fds:false});context.api={useSoundChip,createSoundChip};`);assert.equal(f.runtime.context.p.id,'nes');assert.equal(f.runtime.context.p.dispose,undefined);const token=f.synth.chipInspector.getConnectionToken('side');f.runtime.context.a.dispose();await f.runtime.playSource(`context.a=await createSoundChip('nes',{id:'side',fds:true});context.api={useSoundChip,createSoundChip};`);assert.notEqual(f.synth.chipInspector.getConnectionToken('side'),token);for(let n=0;n<15;n++)await f.runtime.context.api.createSoundChip('nes',{id:`n${n}`});await assert.rejects(f.runtime.context.api.createSoundChip('nes'),/at most 16/);await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});
for(const method of ['clock'])test(`Native NES future ${method} completion leaves explicit reads and Stop unblocked`,{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('nes',{id:'a'});liveLoop('future',async()=>{await ${method==='clock'?'a.setClock(2000000)':'a.dmc.loadSample(new Uint8Array([1]))'};log('applied');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('future');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.waiters.length&&f.runtime.getKeyboardTarget());assert(!f.logs.includes('applied'));const before=f.commands().length;assert.equal((await f.synth.chipInspector.read('a')).clock,1789773);assert.equal(f.commands().length,before);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled')&&!f.queue.some(c=>c.message.method===method));await f.runtime.stopWithFade();assert.equal(f.waiters.length,0);assert.equal(f.synth.acceptedRequests,0);assert.deepEqual(f.errors,[]);
});
test('Native NES author patches validate atomically, merge shared bits and reject disposed async continuations',async()=>{
  const channel=new MessageChannel(),messages=[],restored=[];channel.port2.on('message',message=>messages.push(message));const client=createNesClient(channel.port1,{native:true,fdsEnabled:true},{captureContext:()=>({name:'one'}),restoreContext:context=>restored.push(context),isStopped:()=>false});
  try{client.pulse.setVoice(0,{volume:13,duty:.25});client.pulse.noteOn(1,60);client._applyAuthorEdit({registers:[[0,5,15]],enabled:{value:1,mask:1}});assert.equal(client._getState().registers[0]&0xc0,0x40);assert.equal(client._getState().enabled,3);const before=client._getState();assert.throws(()=>client._applyAuthorEdit({registers:[[0,0]],clock:1}),/clock/);assert.deepEqual(client._getState(),before);const upload=client.dmc.loadSample(new Uint8Array(17)),rejected=assert.rejects(upload,/disposed|stopped/);await until(()=>messages.some(m=>m.method==='loadMemory'));client.dispose();await rejected;assert.deepEqual(restored,[]);}finally{client.dispose();channel.port2.close();}
});

test('Native NES actual Worker accepts fractional PAL construction and optional FDS state handoff',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('nes',{id:'pal',clock:1662607.125});a.pulse.noteOn(0,'A4');log(a.clock);`,{execution:'worker'});await until(()=>f.logs.includes('1662607.125')&&f.commands().some(c=>c.type==='extra-nes'&&c.message.method==='enable'&&c.message.enabled));assert.equal((await f.synth.chipInspector.read('pal')).clock,1662607.125);assert.deepEqual(f.errors,[]);
});

for(const execution of ['main','worker'])test(`Native NES ${execution} DMC load cancellation prevents playback after its late completion`,{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{holdMemory:true});await f.runtime.playSource(`const a=await createSoundChip('nes',{id:'a'});liveLoop('load',async()=>{await a.dmc.loadSample(new Uint8Array([1]));a.dmc.play();log('resumed');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('load');":"keyboard.bind('cancel',{noteOn(){stopLoop('load');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.memoryReplies.length&&(execution==='main'||f.runtime.getKeyboardTarget()));if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();for(const reply of f.memoryReplies.splice(0))reply();await until(()=>f.synth.acceptedRequests===0);await tick();assert(!f.logs.includes('resumed'));assert(!f.commands().some(c=>c.type==='extra-nes'&&c.message.method==='enable'&&c.message.channel===4&&c.message.enabled));assert.deepEqual(f.errors,[]);
});

test('Native NES bounded upload rejections leave the engine usable and release queued byte accounting',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('nes',{id:'a'});`);for(const message of ['Native additional NES upload batch exceeds 64 KiB','Native additional NES pending uploads exceed 1 MiB across the shared rack','Native NES pending command limit reached (8 MiB)']){f.rejectNext(message);await assert.rejects(f.runtime.context.a.loadMemory(new Uint8Array(17)),error=>error.message===message);assert.equal(f.synth.state,'ready');assert.equal(f.synth.acceptedPcmBytes,0);}await f.runtime.context.a.loadMemory(new Uint8Array([3]),0xc000);assert.equal([...f.rack.values()][0].memory[0xc000],3);assert.deepEqual(f.errors,[]);
});
