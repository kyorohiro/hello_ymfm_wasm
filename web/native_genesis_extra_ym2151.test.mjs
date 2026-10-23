import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional YM2151 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native YM2151 attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){
      this.pending=[];this.messages=[];this.ready=false;workers.push(this);
      this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
      this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});
      this.worker.on('error',error=>this.onerror?.({message:error.message}));
    }
    postMessage(message,transfer){if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
const state=()=>({clock:3579545,registers:Array(256).fill(0),keyMasks:Array(8).fill(0),amDepth:0,pmDepth:0,status:1,irq:true,held:[],pendingCommands:[]});
function fixture(t,{mode='genesis'}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),manual=new Map(),owners=new Map(),csm=new Map();let gate=null,offset=0;const started=Date.now(),now=()=>Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  function snapshot(kind,instance){const source=rack.get(instance);if(!source||source.kind!==kind)throw Error('Additional sound chip is not connected');return {[kind]:structuredClone(source.state),sampleRate:48000,frame:status().frame,revision:calls.length};}
  function apply(s,m,{audition=false,owner,group=m.group}={}){
    const held=manual.get(s),owned=owners.get(s);if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(s,command,{audition:true,owner,group});
      if(m.action==='on'){held.set(m.channel,m.voice);owned.delete(m.channel);}else if(m.action==='off')held.delete(m.channel);s.held=[...held.keys()];return;
    }
    if(m.method==='clock'){if(held.size)throw Error('Release the manually held additional YM2151 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){if(!held.size||audition){const clock=s.clock;Object.assign(s,state(),{clock});owned.clear();csm.delete(s);}}
    else if(m.method==='cancel-main-owner'){
      if(csm.get(s)===m.targetGroup){s.registers[0x14]&=~0x81;csm.delete(s);}
      for(const [ch,g]of [...owned])if(g===m.targetGroup)apply(s,{method:'key-off',channel:ch},{group:g});
    }else if(m.method==='all-notes-off'||m.method==='stop-voices'){
      for(let channel=0;channel<8;channel++)apply(s,{method:'key-off',channel},{audition,owner,group});
      if(group===undefined||csm.get(s)===group){s.registers[0x14]&=~0x81;csm.delete(s);}
    }else if(m.method==='key-off'){
      if(!audition&&held.has(m.channel))return;if(!audition&&group!==undefined&&owned.has(m.channel)&&owned.get(m.channel)!==group)return;s.keyMasks[m.channel]=0;owned.delete(m.channel);
    }else if(m.method==='audition-key-on'){s.keyMasks[m.channel]=m.mask;}
    else if(m.method==='write'){
      const r=m.register,v=m.value,ch=r===8?v&7:r>=0x20?r&7:r===15?7:null;
      if(!audition&&(ch!==null&&held.has(ch)||ch===null&&held.size))return;
      if(r===8){const on=!!(v&0x78);if(!on&&!audition&&group!==undefined&&owned.has(ch)&&owned.get(ch)!==group)return;s.keyMasks[ch]=v>>3&15;if(on)owned.set(ch,group);else owned.delete(ch);}
      if(r===0x14){const on=(v&0x81)===0x81;if(!on&&!audition&&group!==undefined&&csm.has(s)&&csm.get(s)!==group)return;if(on)csm.set(s,group);else csm.delete(s);}
      s.registers[r]=v;if(r===0x19){if(v&128)s.pmDepth=v&127;else s.amDepth=v&127;}
    }
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:status().frame,revision:0};
    const match=/^native_genesis_extra_(psg|ym2612|ym2203|ym2608|ym2610|ym2151)_(create|dispose|status)$/.exec(command);
    if(match){const kind=match[1]==='psg'?'segapsg':match[1],op=match[2];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');const s=state();rack.set(args.instance,{kind,state:s});manual.set(s,new Map());owners.set(s,new Map());}if(op==='dispose'){rack.delete(args.instance);return true;}return snapshot(kind,args.instance);}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown')rack.clear();
    if(command==='native_genesis_performance'&&args.op==='cancel-owner')for(const {kind,state:s}of rack.values())if(kind==='ym2151'){for(const [ch,g]of [...owners.get(s)])if(g===`worker:${args.owner}`)apply(s,{method:'key-off',channel:ch},{group:g});if(csm.get(s)===`worker:${args.owner}`){s.registers[0x14]&=~0x81;csm.delete(s);}}
    if(command==='native_genesis_commands')for(const entry of args.commands)if(entry.type==='extra-ym2151'){const source=rack.get(entry.instance);if(!source)throw Error('Additional sound chip is not connected');apply(source.state,entry.message,{owner:entry.owner});}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,gate:value=>{gate=value;},advance:ms=>{offset+=ms;},commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

test('Native additional YM2151 matches the public register-order API, cold clock and independent Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);const a=await f.runtime.context.api.createSoundChip('ym2151',{id:'a'}),b=await f.runtime.context.api.createSoundChip('ym2151',{id:'b'});
  assert.equal(a.clock,3579545);assert(!f.commands().some(c=>c.type==='extra-ym2151'&&c.message.method==='reset'),'cold Browser client does not reset its core');assert.equal(a.setPreset,undefined);assert.equal(a.read,undefined);assert.equal(a.prepareTimeline,undefined);a.setOperator(0,1,{tl:7,mul:3,ar:31});a.setAlgo(0,5,3);a.setPan(0,true,false);a.setNote(0,'A4');a.keyOn(0,9);a.setNoise(true,21);a.writeRegister(0x18,145);a.writeRegister(0x19,17);a.writeRegister(0x19,128|31);await f.synth.flush();let view=await f.synth.chipInspector.read(a.id);assert.equal(view.registers[0x68],7);assert.equal(view.channels[0].operators[2].tl,7);assert.equal(view.keyMasks[0],9);assert.equal(view.channels[0].algorithm,5);assert.equal(view.noise.frequency,21);assert.equal(view.lfo.amDepth,17);assert.equal(view.lfo.pmDepth,31);assert.equal((await f.synth.chipInspector.read(b.id)).registers[0x68],0);await a.setClock(4000000);assert.equal(a.clock,4000000);assert.equal((await f.synth.chipInspector.read(a.id)).clock,4000000);
  assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});f.synth.mixer.set(a.id,{volume:.3,pan:.5});await f.synth.flush();assert.equal(f.rack.get(1).state.volume,.3);assert.equal(f.rack.get(2).state.volume,1);assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2151 Inspector uses algorithm operator order and separate applied/author state with eight leases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2151',{id:'editor'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;a.setAlgo(0,5,2);await f.synth.flush();f.rack.get(1).state.registers[0x20]=0;await i.invoke(a.id,'setVoice',[0,{pan:{left:true}}]);assert.equal(a._getState().registers[0x20],64|21);assert.equal((await i.read(a.id)).registers[0x20],64);await i.invoke(a.id,'setOperator',[0,1,{tl:27}]);await i.invoke(a.id,'setLFO',[{frequency:123,amDepth:11,pmDepth:22,waveform:3}]);await i.invoke(a.id,'setNoise',[{enabled:true,frequency:19}]);let view=await i.read(a.id);assert.equal(view.registers[0x70],27);assert.equal(view.registers[0x68],0);assert.equal(view.channels[0].operators[1].tl,27);assert.equal(view.lfo.amDepth,11);assert.equal(view.lfo.pmDepth,22);const authored=a._getState();for(let ch=0;ch<8;ch++)await i.invoke(a.id,'auditionOn',[ch,60+ch,`key${ch}`]);view=await i.read(a.id);assert.deepEqual(view.held,[0,1,2,3,4,5,6,7]);assert.deepEqual(a._getState(),authored,'manual pitch never overwrites authoring state');await assert.rejects(a.setClock(4000000),/manually held additional YM2151/);assert.equal(f.synth.state,'ready');await i.invoke(a.id,'auditionOff',[7,'stale']);assert((await i.read(a.id)).held.includes(7));await i.invoke(a.id,'auditionAllOff');assert.deepEqual((await i.read(a.id)).held,[]);await a.setClock(4000000);assert.equal(a.clock,4000000);const before=f.commands().length;await assert.rejects(i.invoke(a.id,'setVoice',[0,{operators:[{tl:10},{tl:999}]}]),/tl/);assert.equal(f.commands().length,before);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2151 Main owner cancellation separates raw CSM, ordinary notes and manual voices',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('ym2151',{id:'voices'});liveLoop('csm',async()=>{a.writeRegister(0x14,0x85);await beat(100);});liveLoop('normal',async()=>{a.keyOn(2);a.keyOn(7);await beat(100);});context.cancel=name=>stopLoop(name);context.a=a;`);await until(()=>f.commands().some(c=>c.message?.method==='write'&&c.message.register===8));await f.synth.chipInspector.invoke('voices','auditionOn',[7,69,'manual']);f.runtime.context.cancel('csm');await f.synth.flush();let view=await f.synth.chipInspector.read('voices');assert.equal(view.registers[0x14]&0x81,0);assert.equal(f.runtime.context.a._getState().registers[0x14]&0x81,0);assert.equal(view.keyMasks[2],15);assert.equal(view.keyMasks[7],15);f.runtime.context.cancel('normal');await f.synth.flush();view=await f.synth.chipInspector.read('voices');assert.equal(view.keyMasks[2],0);assert.equal(view.keyMasks[7],15);assert.deepEqual(view.held,[7]);assert.deepEqual(f.errors,[]);
});
test('Native additional YM2151 concurrent Main lookups retain each caller’s loop owner',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2151');chip.keyOn(0);log('lookup-a');await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2151');chip.keyOn(1);log('lookup-b');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('lookup-a')&&f.logs.includes('lookup-b'));f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('ym2151:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('ym2151:shared');assert.equal(view.keyMasks[1],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2151 stopped independent Main creation releases its source and reserved ID',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('creating',async()=>{const chip=await createSoundChip('ym2151',{id:'pending'});chip.keyOn(0);await beat(100);});context.cancel=()=>stopLoop('creating');`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2151_create'));f.runtime.context.cancel();gate.resolve();await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2151_dispose')&&!f.rack.size);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-ym2151'&&c.message.method==='write'&&c.message.register===0x28));assert.deepEqual(f.errors,[]);
});

test('Native additional YM2151 cancelling one pending shared lookup keeps the other caller’s Run-owned source',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2151');chip.keyOn(0);await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2151');chip.keyOn(1);log('shared-b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2151_create'));f.runtime.context.cancel('a');gate.resolve();await until(()=>f.logs.includes('shared-b-ready'));const view=await f.synth.chipInspector.read('ym2151:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);assert.equal(f.rack.size,1);assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2151_create').length,1);f.runtime.context.cancel('b');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('ym2151:shared')).keyMasks[1],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2151 Worker preserves exact-instance editor state, acknowledged clock and shared cache replacement',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});await f.runtime.playSource(`const a=await useSoundChip('ym2151');if(a!==await useSoundChip('ym2151')||a.clock!==3579545)throw Error('Clock/cache mismatch');a.setOperator(7,1,{tl:12});a.setPan(7,true,true);await a.setClock(4000000);a.noteOn(7,'A4');log('worker-ready');keyboard.bind('edit',{async noteOn(){if(a._getState().registers[0x77]!==27||a.clock!==4000000)throw Error('Editor state lost');log('worker-state-ok');a.dispose();const next=await useSoundChip('ym2151');if(next===a||next.clock!==3579545)throw Error('Not replaced');next.setOperator(0,0,{tl:13});await next.setClock(4500000);log('worker-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('worker-ready')&&f.runtime.getKeyboardTarget());const i=f.synth.chipInspector,id='ym2151:shared',old=i.getConnectionToken(id);assert.equal((await i.read(id)).registers[0x6f],12);await i.invoke(id,'setOperator',[7,1,{tl:27}]);await tick();f.runtime.getKeyboardTarget().noteOn({id:'state',midi:60});await until(()=>f.logs.includes('worker-state-ok'));f.advance(2000);await until(()=>f.logs.includes('worker-replaced'));assert.notEqual(i.getConnectionToken(id),old);assert.equal((await i.read(id)).registers[0x60],13);assert.equal((await i.read(id)).clock,4500000);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2151 Worker coalesced lookups and clock awaits retain distinct ordinary and CSM owners',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`liveLoop('a',async()=>{const a=await useSoundChip('ym2151');await a.setClock(3579545);a.keyOn(0);a.writeRegister(0x14,0x85);log('owner-a-ready');await beat(100);});liveLoop('b',async()=>{const a=await useSoundChip('ym2151');await a.setClock(3579545);a.keyOn(1);log('owner-b-ready');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('a');log('owner-a-cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('owner-a-ready')&&f.logs.includes('owner-b-ready')&&f.runtime.getKeyboardTarget());const keys=f.commands().filter(c=>c.type==='extra-ym2151'&&c.message.method==='write'&&c.message.register===8&&c.message.value&0x78);assert.equal(new Set(keys.map(c=>c.owner)).size,2);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('owner-a-cancelled')&&f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));const view=await f.synth.chipInspector.read('ym2151:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);assert.equal(view.registers[0x14]&0x81,0);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2151 shares six-kind sixteen-slot admission and cleanup without authored Mixer entries',async t=>{
  installWorkers(t);const f=fixture(t),create=f.synth.createExtraYm2608.bind(f.synth);f.synth.createExtraYm2608=options=>create({...options,fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer})});await f.runtime.playSource(`context.api={createSoundChip};`);for(let index=0;index<16;index++)await f.runtime.context.api.createSoundChip(['ym2151','ym2610','ym2612','segapsg','ym2203','ym2608'][index%6],{id:`mixed-${index}`});assert.equal(f.synth.extraDevices.size,16);assert.equal(f.synth.extraYm2151Devices.size,3);await assert.rejects(f.runtime.context.api.createSoundChip('ym2151'),/at most 16/);assert.equal(new Set(f.calls.filter(c=>c.command.endsWith('_create')).map(c=>c.args.instance)).size,16);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});
