import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth,createPs1InitSample} from './ps1synth.js';
import {preparePs1Waveform} from './ps1_waveform.js';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPs1Client} from './playground_ps1.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {MessageChannel,Worker as NodeWorker} from 'node:worker_threads';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {PS1_MEMORY_HELD_ERROR,PS1_STATE_HELD_ERROR} from './native_genesis_ps1.js';

let module;
async function fixture(t,{mode='ps1'}={}){
  module??=Promise.all([import('../docs/generated/ps1_spu_wasm.js'),readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url))]).then(([{default:factory},wasmBinary])=>factory({wasmBinary}));
  const primary=await source(0),rack=new Map(),calls=[],errors=[],queue=[],waiters=[];let frame=0,statusGate=null;
  async function source(instance){const core=await Ps1Spu.create({moduleFactory:()=>module});return {instance,core,validation:new Ps1Synth({core}),held:new Map(),notes:new Map(),enabled:0,revision:0,captures:new Map(),highWater:0x1000};}
  const status=()=>({session:1,mode,frame,sampleRate:48000,running:true,ymClock:7670454,psgClock:3579545});
  const value=s=>({registers:Array.from(s.validation.snapshot().registers),nativeFrames:s.core.nativeFrames,enabled:s.enabled,held:[...s.held.keys()],revision:s.revision,pendingCommands:queue.filter(c=>(c.instance??0)===s.instance&&c.message.id).map(c=>c.message.id)});
  const state=(s,args={})=>args.ram&&s.captures.has(args.after)?s.captures.get(args.after):{...value(s),...(args.ram?{ram:Array.from(s.core.readRam())}:{})};
  function apply(s,m,c={},bypass=false){
    if(m.method==='batch'){
      for(const command of m.commands)if(['audition-key','refresh-envelope'].includes(command.method)){
        assert.equal(command.channel,m.channel,'private live operations must target the declared Native channel');
        if(command.method==='audition-key'){
          assert.equal(m.audition,true,'private keys require a manual audition');assert(Number.isSafeInteger(m.voice));
          assert.equal(m.action,command.on?'on':'off','private keys must match the Native lease action');
        }
      }
      const ch=m.channel,held=s.held.get(ch);if(!m.audition&&(ch===undefined?s.held.size:held!==undefined))return;
      if(m.audition&&m.action==='off'&&held!==m.voice)return;
      if(m.audition&&m.action==='edit'&&(ch===undefined?[...s.held.values()].some(v=>v!==m.voice):held!==undefined&&held!==m.voice))return;
      if(m.audition&&m.action==='on')s.held.set(ch,m.voice);
      if(m.action==='on')s.notes.set(ch,{voice:m.voice,command:c});
      for(const command of m.commands)apply(s,command,c,true);
      if(m.audition&&m.action==='off')s.held.delete(ch);s.revision++;return;
    }
    if(m.method==='write'){
      s.core.write(m.register,m.value);
      if(m.register===0x188||m.register===0x18a)s.enabled|=m.value<<(m.register===0x18a?16:0);
      if(m.register===0x18c||m.register===0x18e)s.enabled&=~(m.value<<(m.register===0x18e?16:0));
    }else if(m.method==='audition-key'){
      s.core.auditionKey(m.channel,m.on);if(m.on)s.enabled|=1<<m.channel;else s.enabled&=~(1<<m.channel);
    }else if(m.method==='refresh-envelope')s.core.refreshEnvelope(m.channel);
    else if(m.method==='load-memory'){
      if(m.address<s.highWater&&s.held.size&&(!m.audition||s.held.get(m.channel)!==m.voice||[...s.held.keys()].some(ch=>ch!==m.channel)))throw Error(PS1_MEMORY_HELD_ERROR);
      s.core.loadRam(Uint8Array.from(m.data),m.address);s.highWater=Math.max(s.highWater,m.address+m.data.length);
    }else if(m.method==='reset'){if(s.held.size)throw Error(PS1_STATE_HELD_ERROR);s.core.reset({clearRam:m.clearRam});if(m.clearRam)s.highWater=0x1000;s.enabled=0;}
    else if(m.method==='stop-voices'){const registers=value(s).registers;s.core.reset();for(let at=0;at<512;at++)if(![0x188,0x18a,0x18c,0x18e,0x1a6,0x1a8].includes(at*2))s.core.write(at*2,registers[at]);s.enabled=0;s.held.clear();}
    else if(m.method==='all-notes-off'){for(let ch=0;ch<24;ch++)if(!s.held.has(ch)){s.core.write(ch<16?0x18c:0x18e,1<<(ch%16));s.enabled&=~(1<<ch);}}
    else if(m.method==='barrier'&&m.ram)s.captures.set(m.id,{...value(s),ram:Array.from(s.core.readRam())});
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='cancel-main-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].instance===s.instance&&queue[i].message.group===m.targetGroup)queue.splice(i,1);for(const [ch,n]of s.notes)if(n.command.message.group===m.targetGroup&&!s.held.has(ch)){s.enabled&=~(1<<ch);s.core.write(ch<16?0x18c:0x18e,1<<(ch%16));}}
    s.revision++;
  }
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!queue.some(c=>(c.instance??0)===w.s.instance&&c.message.id===w.args.after)){waiters.splice(i,1);w.resolve(state(w.s,w.args));}}}
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){
      const matches=c=>c.performance===args.performance&&c.owner===args.owner;
      for(let at=queue.length-1;at>=0;at--)if(matches(queue[at]))queue.splice(at,1);
      for(const s of [primary,...rack.values()])for(const [ch,note]of s.notes)if(matches(note.command)&&!s.held.has(ch)){s.enabled&=~(1<<ch);s.core.write(ch<16?0x18c:0x18e,1<<(ch%16));s.notes.delete(ch);s.revision++;}
      settle();return status();
    }
    if(command==='native_genesis_start'||command==='native_genesis_status'||command==='native_genesis_performance'||command==='native_genesis_fx')return status();
    if(command==='native_genesis_ps1_status'){if(queue.some(c=>!c.instance&&c.message.id===args.after))return new Promise(resolve=>waiters.push({s:primary,args,resolve}));const value=state(primary,args);if(statusGate&&args.after){const gate=statusGate;statusGate=null;gate.enter();await gate.promise;}return value;}
    const match=/^native_genesis_extra_ps1_(create|dispose|status)$/.exec(command);
    if(match){if(match[1]==='create')rack.set(args.instance,await source(args.instance));if(match[1]==='dispose'){rack.get(args.instance)?.core.dispose();rack.delete(args.instance);return true;}const s=rack.get(args.instance);if(!s)throw new DOMException('Disposed','AbortError');const result=state(s,args);return {ps1:result,frame,sampleRate:48000,revision:s.revision};}
    if(command==='native_genesis_commands'){for(const c of args.commands)if(['ps1','extra-ps1'].includes(c.type)){const s=c.instance?rack.get(c.instance):primary;if(c.frame>frame)queue.push(c);else apply(s,c.message,c);}settle();return status();}
    if(command==='native_genesis_stop'){queue.length=0;apply(primary,{method:'stop-voices'});settle();return status();}
    if(command==='native_genesis_shutdown')return status();
    throw new Error(`Unexpected fixture command ${command}`);
  };
  const synth=new NativeGenesisSynth({mode,invoke,now:()=>frame/48,onError:error=>errors.push(error)});
  t.after(async()=>{await synth.close();primary.core.dispose();for(const s of rack.values())s.core.dispose();});await synth.start();
  return {synth,primary,rack,calls,errors,queue,commands:()=>calls.filter(v=>v.command==='native_genesis_commands').flatMap(v=>v.args.commands),pauseStatus(){let release,enter;const promise=new Promise(done=>{release=done;}),entered=new Promise(done=>{enter=done;});statusGate={promise,enter};return {entered,release};},advance(next){frame=next;for(const c of queue.splice(0).sort((a,b)=>a.frame-b.frame))if(c.frame<=frame)apply(c.instance?rack.get(c.instance):primary,c.message,c);else queue.push(c);settle();}};
}
const rpc=async(endpoint,message,timing)=>{const result=await endpoint.dispatch(message,timing);return result?.deferred?await result.deferred:result;};
const peak=values=>values.reduce((a,v)=>Math.max(a,Math.abs(v)),0);
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode},workers=[];
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native PS1 attempted Web Audio');}};
  const url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{constructor(){this.ready=false;this.pending=[];workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];}else this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}terminate(){return this.terminated??=this.worker.terminate();}};
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});
}
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('Native PS1 runtime timed out');await new Promise(done=>setTimeout(done,2));}}

test('Native primary PS1 owns 24 real voices, ADPCM RAM, ADSR, reverb and Mixer without Web Audio',async t=>{
  const f=await fixture(t),spu=f.synth.spu;assert.equal(f.synth.node,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.fm,null);
  assert.deepEqual(f.calls[0],{command:'native_genesis_start',args:{mode:'ps1'}});assert.deepEqual(f.synth.primaryEndpoints,[{name:'ps1',globalName:'spu',client:spu}]);
  assert.equal((await spu.getState()).samples.length,1);spu.setEnvelope(23,{attackRate:0,sustainRate:127,releaseRate:13});spu.setPreset(23,{reverb:true,volumeLeft:.4,volumeRight:-.2});spu.setReverb({preset:'room',volumeLeft:.3,volumeRight:.5});spu.noteOn(23,'A4');await f.synth.flush();
  const state=await spu.getState();assert.equal(state.channels[23].sample,0);assert(state.channels[23].gate);assert.equal(state.channels[23].envelopeParameters.sustainRate,127);assert.equal(state.reverb.preset,'room');assert.equal(state.channels[23].reverb,true);assert(Math.abs(state.reverb.volumeRight-.5)<1e-4);
  const l=new Float32Array(8192),r=new Float32Array(8192);f.primary.core.renderInto(l,r);assert(peak(l)>.01,`audible peak ${peak(l)}`);assert(l.every(Number.isFinite));assert(r.every(Number.isFinite));
  const snapshot=await spu.snapshot();assert.equal(snapshot.ram.length,524288);assert.equal(snapshot.registers.length,512);assert.deepEqual(snapshot.ram.slice(0x1000,0x1040),createPs1InitSample().adpcm);
  f.synth.mixer.set('ps1',{volume:.25,pan:-.2});await f.synth.flush();assert.equal(f.primary.volume,.25);assert.deepEqual(f.errors,[]);
});
test('Native PS1 held waveform slots are reused, channel-owned, explicit retriggers keep their lease, and Stop retains presets',async t=>{
  const f=await fixture(t),spu=f.synth.spu,i=f.synth.chipInspector;
  await i.invoke('ps1','auditionOn',[23,69,'old']);await i.invoke('ps1','auditionOn',[23,72,'new']);assert.equal(await i.invoke('ps1','auditionOff',[23,'old']),false);
  const p=preparePs1Waveform(Array.from({length:112},(_,n)=>n<56?.3:-.3));
  const one=await i.invoke('ps1','setWaveform',[23,p,{retrigger:true}]);const two=await i.invoke('ps1','setWaveform',[23,p,{retrigger:true}]);assert.equal(one.id,two.id);assert.equal((await spu.getState()).samples.length,2);
  assert.throws(()=>spu.setPreset(0,{sample:one}),/another channel/);await i.invoke('ps1','setEnvelope',[23,{attackRate:15},{retrigger:true}]);await i.invoke('ps1','setReverb',[{preset:'hall',volumeLeft:.4}]);
  let view=await i.read('ps1');assert(view.channels[23].active);assert.equal(view.channels[23].waveform.pcm.length,112);assert.equal(view.reverb.preset,'hall');assert.equal(view.auditions[0].id,'new');
  const init=createPs1InitSample();assert.equal((await spu.loadADPCM(init.adpcm,{baseFrequencyHz:init.baseFrequencyHz,loopStartSamples:0})).id,2);assert.throws(()=>spu.reset(),/manually held/);
  await f.synth.stopNativeAudio();view=await i.read('ps1');assert(!view.channels[23].active);assert.equal(view.reverb.preset,'hall');assert.equal(view.channels[23].sample,one.id);assert.equal((await spu.snapshot()).ram[one.startAddress+1],6);
  await i.invoke('ps1','auditionOn',[23,69,'after-stop']);assert((await i.read('ps1')).channels[23].active);await i.invoke('ps1','auditionOff',[23,'after-stop']);assert.deepEqual(f.errors,[]);
});
test('Native PS1 live ADSR edits retain PCM phase and the manual lease while public edits keep raw latch behavior',async t=>{
  const a=await fixture(t),b=await fixture(t),render=(f,n)=>{const left=new Float32Array(n),right=new Float32Array(n);f.primary.core.renderInto(left,right);return left;};
  for(const f of[a,b]){await f.synth.chipInspector.invoke('ps1','setPreset',[23,{adsr1:15,adsr2:0x2000}]);await f.synth.chipInspector.invoke('ps1','auditionOn',[23,69,'held']);}
  assert.deepEqual(render(a,1009),render(b,1009));
  const since=a.commands().length;
  await a.synth.chipInspector.invoke('ps1','setEnvelope',[23,{attackRate:100},{live:true}]);
  await b.synth.chipInspector.invoke('ps1','setEnvelope',[23,{attackRate:100}]);
  assert.deepEqual(render(a,512),render(b,512),'changing attack in sustain preserves the complete decoded waveform');
  const emitted=a.commands().slice(since).flatMap(c=>c.message.commands??[]);
  assert(emitted.some(c=>c.method==='refresh-envelope'&&c.channel===23));
  assert(!emitted.some(c=>c.method==='audition-key'||c.method==='write'&&[0x188,0x18a].includes(c.register)),'live ADSR sends no KON');
  await a.synth.chipInspector.invoke('ps1','setEnvelope',[23,{sustainRate:40,sustainDecrease:true},{live:true}]);
  await b.synth.chipInspector.invoke('ps1','setEnvelope',[23,{sustainRate:40,sustainDecrease:true}]);
  const edited=render(a,4096),raw=render(b,4096),energy=pcm=>pcm.reduce((sum,v)=>sum+v*v,0);
  assert.equal(edited[0],raw[0],'live rate changes retain the first output level');assert(energy(edited)<energy(raw)*.8,'the new sustain slope is audible without restarting');
  const view=await a.synth.chipInspector.read('ps1');assert.equal(view.channels[23].adsr2&0x2000,0x2000);assert.deepEqual(view.auditions,[{channel:23,id:'held'}]);
  // The ordinary public API continues to write only the chip's raw registers.
  await a.synth.chipInspector.invoke('ps1','auditionOff',[23,'held']);const start=a.commands().length;
  a.synth.spu.setEnvelope(0,{attackRate:20});await a.synth.flush();
  assert(a.commands().slice(start).flatMap(c=>c.message.commands??[]).every(c=>c.method==='write'));
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
});
test('Native PS1 Stop before the first read retains the initial instrument on every channel',async t=>{
  const f=await fixture(t);await f.synth.stopNativeAudio();const view=await f.synth.chipInspector.read('ps1');assert(view.channels.every(ch=>ch.sample===0));
  await f.synth.chipInspector.invoke('ps1','auditionOn',[23,69,'first-after-stop']);assert((await f.synth.chipInspector.read('ps1')).channels[23].active);assert.deepEqual(f.errors,[]);
});
test('Native PS1 applied inspector edits preserve unrelated future authoring and script note identities',async t=>{
  const f=await fixture(t),spu=f.synth.spu,i=f.synth.chipInspector;
  await rpc(f.synth.nativePs1,{method:'setPreset',args:[1,{pitch:6000,adsr1:1234}]},{time:2,performance:2,owner:3});
  assert.equal(spu._getState().channels[1].pitch,6000);assert.equal((await i.read('ps1')).channels[1].pitch,4096);
  await i.invoke('ps1','auditionOn',[0,69,'held']);await i.invoke('ps1','setPreset',[0,{volumeLeft:.2}]);assert.equal(spu._getState().channels[1].pitch,6000);
  spu.setPitch(0,1000);await f.synth.flush();assert.notEqual((await i.read('ps1')).channels[0].pitch,1000,'script cannot steal held audition');
  f.advance(96000);assert.equal((await i.read('ps1')).channels[1].pitch,6000);assert.equal((await i.read('ps1')).channels[1].adsr1,1234);assert.deepEqual(f.errors,[]);
});
test('Native additional PS1 owns independent sample RAM, resources, reset and disposal',async t=>{
  const f=await fixture(t),a=await f.synth.createExtraPs1({id:'a'}),b=await f.synth.createExtraPs1({id:'b'}),init=createPs1InitSample(),opts={baseFrequencyHz:init.baseFrequencyHz,loopStartSamples:0};
  assert.equal((await a.client.getState()).samples.length,0);const input=init.adpcm.slice(),loading=a.client.loadADPCM(input,opts);input.fill(0);const one=await loading,two=await b.client.loadADPCM(init.adpcm,opts);assert.equal(one.id,0);assert.equal(two.id,0);
  a.client.setPreset(23,{sample:one});a.client.noteOn(23,'A4');await f.synth.flush();assert((await a.endpoint.read()).channels[23].active);assert(!(await b.endpoint.read()).channels[23].active);
  assert.deepEqual((await a.client.snapshot()).ram.slice(one.startAddress,one.startAddress+64),init.adpcm);
  a.client.reset();await a.client.getState();assert.equal((await a.client.getState()).samples.length,1);a.client.reset({clearRam:true});await a.client.getState();assert.equal((await a.client.getState()).samples.length,0);assert.equal((await b.client.getState()).samples.length,1);
  a.dispose();assert.equal(f.synth.extraPs1Devices.size,1);await assert.rejects(a.client.getState());assert.deepEqual(f.errors,[]);
});
for(const clearRam of [false,true])test(`Native PS1 ${clearRam?'clear':'default'} reset fences old upload replies without leaking bank metadata`,async t=>{
  const f=await fixture(t),spu=f.synth.spu,init=createPs1InitSample(),opts={baseFrequencyHz:init.baseFrequencyHz,loopStartSamples:0},gate=f.pauseStatus();
  const loading=spu.loadADPCM(init.adpcm,opts),cancelled=assert.rejects(loading,{name:'AbortError'});await gate.entered;
  spu.reset({clearRam});await f.synth.flush();gate.release();await cancelled;
  const state=await spu.getState();assert.equal(state.samples.length,clearRam?0:2);assert(state.channels.every(ch=>ch.sample===null&&!ch.gate));
  const next=await spu.loadADPCM(init.adpcm,opts);assert.equal(next.id,clearRam?0:2);assert.equal(next.startAddress,clearRam?0x1000:0x1080);assert.deepEqual(f.errors,[]);
});
test('Native PS1 Stop during an upload retains accepted bytes but cancels the old continuation',async t=>{
  const f=await fixture(t),spu=f.synth.spu,init=createPs1InitSample(),opts={baseFrequencyHz:init.baseFrequencyHz,loopStartSamples:0},gate=f.pauseStatus();
  const loading=spu.loadADPCM(init.adpcm,opts),cancelled=assert.rejects(loading,{name:'AbortError'});await gate.entered;
  await f.synth.stopNativeAudio();gate.release();await cancelled;const state=await spu.getState();assert.equal(state.samples.length,2);assert.equal((await spu.snapshot()).ram[0x1041],6);
  const next=await spu.loadADPCM(init.adpcm,opts);assert.equal(next.id,2);assert.equal(next.startAddress,0x1080);assert.deepEqual(f.errors,[]);
});
test('Native PS1 typed Worker port executes upload, controls, reads and preparation without AudioWorklet',async t=>{
  const f=await fixture(t),bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)});
  const host=createPerformanceHost({getContext:()=>f.synth.clock}),sender=createPerformanceSender({leaseUntimed:true});let spu;
  try{
    sender.configure(await host.start([bridge.port],0));
    spu=createPs1Client(sender.port(bridge.ps1Port,'independent'),{sampleRate:48000,state:f.synth.spu._getState()});
    const init=createPs1InitSample(),sample=await spu.loadADPCM(init.adpcm,{baseFrequencyHz:init.baseFrequencyHz,loopStartSamples:0});spu.setPreset(2,{sample,reverb:true});spu.setEnvelope(2,{sustainRate:127});spu.setReverb({preset:'room'});spu.noteOn(2,'A4');
    await spu.getState();f.advance(48000);const value=await spu.getState();assert(value.channels[2].gate);assert.equal(value.channels[2].envelopeParameters.sustainRate,127);assert.equal(value.reverb.preset,'room');assert.deepEqual(f.errors,[]);
  }finally{spu?.dispose();sender.stop();host.stop();await bridge.dispose();}
});
for(const execution of ['main','worker'])test(`Native PS1 ${execution} runtime exposes borrowed primary and independent createSoundChip APIs`,{timeout:15000},async t=>{
  installWorkers(t);const f=await fixture(t),logs=[],runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false,onLog:line=>logs.push(line)});
  try{
    await runtime.playSource(`const a=await useSoundChip('ps1');const b=await createSoundChip('ps1',{id:'side'});const data=new Uint8Array(${JSON.stringify(Array.from(createPs1InitSample().adpcm))});const s=await b.loadADPCM(data,{baseFrequencyHz:44100/112,loopStartSamples:0});b.setPreset(23,{sample:s,reverb:true});b.setEnvelope(23,{attackRate:0,sustainRate:127});b.setReverb({preset:'room'});b.noteOn(23,'A4');await b.getState();log(a.id+':'+(a.dispose===undefined)+':'+b.id);`,{execution});
    await until(()=>logs.includes('ps1:true:side'));f.advance(96000);const view=await f.synth.chipInspector.read('side');assert(view.channels[23].active);assert.equal(view.reverb.preset,'room');assert.equal(f.synth.extraPs1Devices.size,1);assert.deepEqual(f.errors,[]);
  }finally{await runtime.finalize();}
});
for(const execution of ['main','worker'])test(`Native PS1 ${execution} cancels one awaited loop without silencing its sibling`,{timeout:15000},async t=>{
  installWorkers(t);const f=await fixture(t),logs=[],runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false,onLog:line=>logs.push(line)});
  try{
    await runtime.playSource(`const a=await createSoundChip('ps1',{id:'side'});const s=await a.loadADPCM(new Uint8Array(${JSON.stringify(Array.from(createPs1InitSample().adpcm))}),{baseFrequencyHz:44100/112,loopStartSamples:0});a.setPreset(0,{sample:s});a.setPreset(1,{sample:s});liveLoop('one',async()=>{await a.getPreset(0);a.noteOn(0,'A4');log('one-ready');await beat(100);});liveLoop('two',async()=>{await a.getPreset(1);a.noteOn(1,'C5');log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
    await until(()=>logs.includes('one-ready')&&logs.includes('two-ready')&&(execution==='main'||runtime.getKeyboardTarget()));f.advance(96000);
    if(execution==='main')runtime.context.cancel();else{runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>logs.includes('cancelled'));}
    await f.synth.flush();const view=await f.synth.chipInspector.read('side');assert.equal(view.channels[0].active,false);assert.equal(view.channels[1].active,true);assert.deepEqual(f.errors,[]);
  }finally{await runtime.finalize();}
});
