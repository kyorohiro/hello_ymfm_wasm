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
      const before=m.channel===undefined?null:[s.core.read(m.channel*16+8),s.core.read(m.channel*16+10)];
      for(const command of m.commands)if(command.mask!==undefined){assert(Number.isInteger(command.mask)&&command.mask>0&&command.mask<=65535);assert.equal(Math.floor(command.register/16),m.channel);assert([8,10].includes(command.register%16));}
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
      for(const command of m.commands){if(command.method==='refresh-envelope'&&command.ifChanged&&before?.every((value,index)=>value===s.core.read(m.channel*16+8+index*2)))continue;apply(s,command,c,true);}
      if(m.audition&&m.action==='off')s.held.delete(ch);s.revision++;return;
    }
    if(m.method==='write'){
      s.core.write(m.register,m.mask===undefined?m.value:(s.core.read(m.register)&~m.mask)|(m.value&m.mask));
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
test('Native PS1 editor live ADSR retains PCM phase and its lease while the checkbox can defer updates',async t=>{
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
  // The ordinary API refreshes by default, and permits explicit deferral.
  await a.synth.chipInspector.invoke('ps1','auditionOff',[23,'held']);const start=a.commands().length;
  a.synth.spu.setEnvelope(0,{attackRate:20});await a.synth.flush();
  assert.equal(a.commands().slice(start).flatMap(c=>c.message.commands??[]).filter(c=>c.method==='refresh-envelope').length,1);
  const deferred=a.commands().length;a.synth.spu.setEnvelope(0,{attackRate:21},{live:false});await a.synth.flush();
  assert(a.commands().slice(deferred).flatMap(c=>c.message.commands??[]).every(c=>c.method==='write'));
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
});
for(const additional of[false,true])test(`Native ${additional?'additional':'primary'} public ADSR updates held and released voices without KON`,async t=>{
  const setups=[];
  for(let index=0;index<2;index++){
    const f=await fixture(t),device=additional?await f.synth.createExtraPs1({id:'side'}):null,client=device?.client??f.synth.spu;
    let sample=0;if(device){const{adpcm,...options}=createPs1InitSample();sample=await client.loadADPCM(adpcm,options);}
    client.setPreset(23,{sample,adsr1:15,adsr2:31});client.noteOn(23,'A4');await client.getState();
    setups.push({f,client,core:device?f.rack.get(device.nativeInstance).core:f.primary.core});
  }
  const[a,b]=setups,render=(s,n)=>{const left=new Float32Array(n),right=new Float32Array(n);s.core.renderInto(left,right);return left;},energy=pcm=>pcm.reduce((sum,v)=>sum+v*v,0);
  assert.deepEqual(render(a,1009),render(b,1009));const since=a.f.commands().length;
  a.client.setEnvelope(23,{sustainRate:40,sustainDecrease:true});b.client.setEnvelope(23,{sustainRate:40,sustainDecrease:true},{live:false});
  await Promise.all(setups.map(s=>s.client.getState()));
  const commands=a.f.commands().slice(since).filter(c=>c.message.method==='batch');
  assert.equal(commands.length,1);assert.equal(commands[0].message.action,'edit');assert(!commands[0].message.audition);
  assert.equal(commands[0].message.commands.at(-1).method,'refresh-envelope');assert.equal(commands[0].message.commands.filter(c=>c.method==='refresh-envelope').length,1);
  assert(!commands[0].message.commands.some(c=>c.method==='audition-key'||c.method==='write'&&[0x188,0x18a].includes(c.register)));
  const changed=render(a,4096),deferred=render(b,4096);assert.equal(changed[0],deferred[0]);assert(energy(changed)<energy(deferred)*.8);
  // Key Off clears the requested gate, while an infinite release still has a
  // live envelope. Changing RR must update that tail without a second note.
  for(const s of setups){s.client.setEnvelope(23,{sustainRate:127,sustainDecrease:false,releaseRate:31});s.client.noteOn(23,'A4');await s.client.getState();render(s,1009);s.client.keyOff(23);await s.client.getState();render(s,256);assert.equal((await s.client.getState()).channels[23].gate,false);}
  const releaseStart=a.f.commands().length;a.client.setEnvelope(23,{releaseRate:0});b.client.setEnvelope(23,{releaseRate:0},{live:false});await Promise.all(setups.map(s=>s.client.getState()));
  const released=render(a,512),held=render(b,512);assert(peak(held)>.01);assert(energy(released)<energy(held)*.1);assert.equal(peak(released.subarray(128)),0);
  const releaseOps=a.f.commands().slice(releaseStart).flatMap(c=>c.message.commands??[]);assert.equal(releaseOps.filter(c=>c.method==='refresh-envelope').length,1);assert(!releaseOps.some(c=>c.method==='write'&&[0x188,0x18a].includes(c.register)));
  for(const s of setups)assert.deepEqual(s.f.errors,[]);
});
for(const additional of[false,true])test(`Native ${additional?'additional':'primary'} editor RR edits stop an unheld release tail without a new manual lease`,async t=>{
  const setups=[];
  for(let index=0;index<2;index++){
    const f=await fixture(t),device=additional?await f.synth.createExtraPs1({id:'released'}):null,client=device?.client??f.synth.spu,endpoint=device?.endpoint??f.synth.nativePs1;
    let sample=0;if(device){const{adpcm,...options}=createPs1InitSample();sample=await client.loadADPCM(adpcm,options);}
    await endpoint.invoke('setPreset',[23,{sample,adsr1:15,adsr2:31}]);await endpoint.invoke('auditionOn',[23,69,'released']);
    setups.push({f,endpoint,core:device?f.rack.get(device.nativeInstance).core:f.primary.core});
  }
  const render=(s,n)=>{const left=new Float32Array(n),right=new Float32Array(n);s.core.renderInto(left,right);return left;},[a,b]=setups;
  for(const s of setups){render(s,1009);await s.endpoint.invoke('auditionOff',[23,'released']);render(s,256);const view=await s.endpoint.read();assert.equal(view.channels[23].gate,false);assert.equal(view.channels[23].envelope,32767);assert.deepEqual(view.auditions,[]);}
  assert.deepEqual(render(a,128),render(b,128));const since=a.f.commands().length;
  for(const s of setups){await s.endpoint.invoke('setEnvelope',[23,{releaseRate:0},{live:false}]);await s.endpoint.invoke('setEnvelope',[23,{releaseRate:0},{live:true}]);await s.endpoint.invoke('setPreset',[23,{volumeLeft:.75,volumeRight:.75},{live:true}]);}
  assert.deepEqual(render(a,512),render(b,512));assert.equal(a.core.read(23*16+12),32767);assert(a.f.commands().slice(since).flatMap(c=>c.message.commands??[]).every(c=>c.method!=='refresh-envelope'),'same-value and unrelated edits do not flush a deferred RR');
  for(const s of setups)await s.endpoint.invoke('setEnvelope',[23,{releaseRate:31},{live:false}]);
  const liveSince=a.f.commands().length;await a.endpoint.invoke('setEnvelope',[23,{releaseRate:0},{live:true}]);await b.endpoint.invoke('setEnvelope',[23,{releaseRate:0},{live:false}]);
  const edited=render(a,512),tail=render(b,512);assert(peak(tail)>.01);assert.equal(peak(edited.subarray(128)),0);assert.equal(a.core.read(23*16+12),0);
  const batches=a.f.commands().slice(liveSince).filter(c=>c.message.method==='batch');assert.equal(batches.length,1);assert.equal(batches[0].message.action,'edit');assert.equal(batches[0].message.voice,undefined);assert(batches[0].message.commands.some(c=>c.method==='refresh-envelope'&&c.channel===23));assert(!batches[0].message.commands.some(c=>c.method==='audition-key'||c.method==='write'&&[0x188,0x18a,0x18c,0x18e].includes(c.register)));
  assert.deepEqual((await a.endpoint.read()).auditions,[]);assert.equal(await a.endpoint.invoke('auditionOff',[23,'released']),false);for(const s of setups)assert.deepEqual(s.f.errors,[]);
});
for(const additional of[false,true])for(const originalRate of[31,0])test(`Native ${additional?'additional':'primary'} deferred RR${originalRate} edits survive manual release and apply on the next note`,async t=>{
  const nextRate=31-originalRate,setups=[];
  for(let index=0;index<4;index++){
    const f=await fixture(t),device=additional?await f.synth.createExtraPs1({id:'deferred-off'}):null,client=device?.client??f.synth.spu,endpoint=device?.endpoint??f.synth.nativePs1;
    let sample=0;if(device){const{adpcm,...options}=createPs1InitSample();sample=await client.loadADPCM(adpcm,options);}
    await endpoint.invoke('setPreset',[23,{sample,adsr1:15,adsr2:originalRate}]);
    if(index===3){client.noteOn(23,'A4');await client.getState();}else await endpoint.invoke('auditionOn',[23,69,'held']);
    setups.push({f,client,endpoint,core:device?f.rack.get(device.nativeInstance).core:f.primary.core});
  }
  const[a,reference,live,program]=setups,render=(s,n)=>{const left=new Float32Array(n),right=new Float32Array(n);s.core.renderInto(left,right);return left;};
  const onset=render(a,1009);assert.deepEqual(onset,render(reference,1009));assert.deepEqual(onset,render(live,1009));
  assert.deepEqual(onset.subarray(256),render(program,1009).subarray(256),'manual and program notes share the same decoded waveform after the click-prevention ramp and renderer history');
  const since=a.f.commands().length;
  await a.endpoint.invoke('setEnvelope',[23,{releaseRate:nextRate},{live:false}]);
  await live.endpoint.invoke('setEnvelope',[23,{releaseRate:nextRate},{live:true}]);
  program.client.setEnvelope(23,{releaseRate:nextRate},{live:false});await program.client.getState();
  const held=render(a,257);assert.deepEqual(held,render(reference,257),'deferred edits preserve the held envelope and sample phase');assert.deepEqual(held,render(live,257),'RR does not alter the held sustain');
  assert.deepEqual(held,render(program,257));
  const ops=a.f.commands().slice(since).flatMap(c=>c.message.commands??[]);assert(ops.length>0);assert(ops.every(c=>c.method==='write'),'deferred RR sends neither a refresh nor a new key');
  assert.equal(await a.endpoint.invoke('auditionOff',[23,'stale']),false);assert.deepEqual((await a.endpoint.read()).auditions,[{channel:23,id:'held'}]);
  for(const s of[a,reference,live])await s.endpoint.invoke('auditionOff',[23,'held']);program.client.keyOff(23);await program.client.getState();
  const released=render(a,512),unchanged=render(reference,512),updated=render(live,512);
  assert.deepEqual(released,unchanged,'manual key off must use the ADSR latched before the deferred edit');
  // Manual keys retain the intentional 128-native-frame click-prevention
  // floor. Raw keyOff may finish RR0 earlier; compare settled tails after
  // the ramp and native interpolation history,
  // while the untouched manual reference above still checks every frame.
  assert.deepEqual(released.subarray(256),render(program,512).subarray(256),'manual and ordinary keyOff keep the same deferred RR after the manual transition');
  if(originalRate===31){assert(peak(released.subarray(256))>.01,'the old infinite RR remains active');assert.equal(peak(updated.subarray(256)),0,'a live RR0 edit reaches the same manual key off');}
  else{assert.equal(peak(released.subarray(256)),0,'the old fast RR still fades');assert(peak(updated.subarray(256))>.01,'a live RR31 edit reaches the same manual key off');}
  assert.deepEqual((await a.endpoint.read()).auditions,[]);assert.equal((await a.endpoint.read()).channels[23].gate,false);
  await a.endpoint.invoke('auditionOn',[23,69,'next']);render(a,1009);assert.equal(a.core.read(23*16+12),32767);
  assert.deepEqual((await a.endpoint.read()).auditions,[{channel:23,id:'next'}]);await a.endpoint.invoke('auditionOff',[23,'next']);
  const nextRelease=render(a,512);if(nextRate===31)assert(peak(nextRelease.subarray(256))>.01,'the next Note On latches the new infinite RR');else assert.equal(peak(nextRelease.subarray(256)),0,'the next Note On latches the new fast RR');
  for(const s of setups)assert.deepEqual(s.f.errors,[]);
});
for(const additional of[false,true])test(`Native ${additional?'additional':'primary'} editor live changes preserve code-owned note cancellation`,async t=>{
  const f=await fixture(t),device=additional?await f.synth.createExtraPs1({id:'owned'}):null,client=device?.client??f.synth.spu,endpoint=device?.endpoint??f.synth.nativePs1,source=device?f.rack.get(device.nativeInstance):f.primary;
  let sample=0;if(device){const{adpcm,...options}=createPs1InitSample();sample=await client.loadADPCM(adpcm,options);}
  for(const ch of[23,2]){client.setPreset(ch,{sample});await client.getState();await rpc(endpoint,{method:'noteOn',args:[ch,ch===23?'A4':'C4']},{performance:7,owner:ch===23?3:4});}
  const left=new Float32Array(1009),right=new Float32Array(1009);source.core.renderInto(left,right);const before=source.core.read(23*16+12),note=source.notes.get(23),since=f.commands().length;
  await endpoint.invoke('setEnvelope',[23,{sustainRate:40,sustainDecrease:true},{live:true}]);source.core.renderInto(new Float32Array(512),new Float32Array(512));assert(source.core.read(23*16+12)<before);
  assert.equal(source.notes.get(23),note,'the edit does not replace the original voice lease');assert.deepEqual((await endpoint.read()).auditions,[]);assert(f.commands().slice(since).filter(c=>c.message.method==='batch').every(c=>c.message.action==='edit'&&c.message.voice===undefined));
  assert(!f.commands().slice(since).flatMap(c=>c.message.commands??[]).some(c=>c.method==='audition-key'||c.method==='write'&&[0x188,0x18a,0x18c,0x18e].includes(c.register)));
  await f.synth.setNativePerformance({op:'cancel-owner',performance:7,owner:3});const view=await endpoint.read();assert.equal(view.channels[23].active,false);assert.equal(view.channels[2].active,true,'cancelling the original code owner releases only its own voice');assert.deepEqual(f.errors,[]);
});

for(const additional of[false,true])test(`Native ${additional?'additional':'primary'} immediate ADSR edits merge applied words ahead of future authored edits`,async t=>{
  for(const scenario of ['same-sustain','distinct-attack','same-deferred']){
    const f=await fixture(t),device=additional?await f.synth.createExtraPs1({id:'ordered'}):null,client=device?.client??f.synth.spu,endpoint=device?.endpoint??f.synth.nativePs1,core=device?f.rack.get(device.nativeInstance).core:f.primary.core;
    let sample=0;if(device){const{adpcm,...options}=createPs1InitSample();sample=await client.loadADPCM(adpcm,options);}
    client.setPreset(23,{sample,adsr1:15,adsr2:0x2000});client.noteOn(23,'A4');await client.getState();
    const render=n=>{const left=new Float32Array(n),right=new Float32Array(n);core.renderInto(left,right);return left;};render(1009);assert.equal(core.read(23*16+12),32767);
    const settings={sustainRate:60,sustainDecrease:true};
    if(scenario==='same-deferred')client.setEnvelope(23,settings,{live:false});
    else await rpc(endpoint,{method:'setEnvelope',args:[23,settings]},{time:2,performance:7,owner:3});
    const before=f.commands().length;client.setEnvelope(23,scenario==='distinct-attack'?{attackRate:61}:settings);await client.getState();
    const edit=f.commands().slice(before).find(c=>c.message.commands?.some(op=>op.method==='refresh-envelope'));assert(edit);assert.equal(edit.message.commands.at(-1).ifChanged,true);
    const writes=edit.message.commands.filter(op=>op.method==='write');assert.equal(writes.length,1);assert.equal(writes[0].register,23*16+(scenario==='distinct-attack'?8:10));assert(writes[0].mask>0);
    if(scenario==='distinct-attack')assert.equal(core.read(23*16+10),0x2000,'an immediate AR edit cannot import the projected future SR');
    render(4096);
    if(scenario==='same-sustain')assert(core.read(23*16+12)<32767,'an immediate value matching the projected future still updates the actual held envelope');
    else assert.equal(core.read(23*16+12),32767,'an unrelated AR edit or unchanged deferred word does not apply a pending sustain slope');
    if(scenario==='distinct-attack'){
      f.advance(96000);assert.equal(core.read(23*16+8),0x3d0f,'future named SR fields preserve the immediate attack setting');render(4096);assert(core.read(23*16+12)<32767,'future masked SR applies at its own frame');
    }
    assert.deepEqual(f.errors,[]);
  }
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
test('Native primary and additional Worker public ADSR changes apply at their reserved frame without KON',async t=>{
  const f=await fixture(t),bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)}),host=createPerformanceHost({getContext:()=>f.synth.clock});
  let taskNow=1000;const sender=createPerformanceSender({leaseUntimed:true,now:()=>taskNow}),clients=[];
  try{
    const configuration=await host.start([bridge.port],.5);sender.configure({...configuration,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:.5});
    const extra=await f.synth.createExtraPs1({id:'worker-side',bridge});
    for(const[port,state]of[[bridge.ps1Port,f.synth.spu._getState()],[extra.port,extra.client._getState()]])clients.push(createPs1Client(sender.port(port,'ps1'),{sampleRate:48000,state}));
    const{adpcm,...options}=createPs1InitSample(),sample=await clients[1].loadADPCM(adpcm,options);
    clients[0].setPreset(23,{sample:0,adsr1:15,adsr2:31});clients[1].setPreset(23,{sample,adsr1:15,adsr2:31});
    for(const client of clients)client.noteOn(23,'A4');await Promise.all(clients.map(client=>client.getState()));f.advance(24000);
    const cores=[f.primary.core,f.rack.get(extra.nativeInstance).core],render=(core,n)=>{const left=new Float32Array(n),right=new Float32Array(n);core.renderInto(left,right);return left;};
    for(const core of cores){assert(peak(render(core,1009))>.01);assert.equal(core.read(23*16+12),32767);}
    const deferredSince=f.commands().length;taskNow=1250;for(const client of clients)client.setEnvelope(23,{sustainRate:60,sustainDecrease:true},{live:false});await Promise.all(clients.map(client=>client.getState()));
    const deferred=f.commands().slice(deferredSince).filter(c=>c.message.method==='batch');assert.equal(deferred.length,2);assert(deferred.every(c=>c.frame===36000&&c.message.commands.every(op=>op.method==='write')),'Worker options preserve explicit live false');
    f.advance(36000);for(const core of cores){render(core,128);assert.equal(core.read(23*16+12),32767,'a deferred Worker edit keeps the sounding sustain');}
    const since=f.commands().length;taskNow=1500;for(const client of clients)client.setEnvelope(23,{sustainRate:40,sustainDecrease:true});await Promise.all(clients.map(client=>client.getState()));
    const scheduled=f.commands().slice(since).filter(c=>c.message.commands?.some(op=>op.method==='refresh-envelope'));
    assert.equal(scheduled.length,2);assert.deepEqual(new Set(scheduled.map(c=>c.type)),new Set(['ps1','extra-ps1']));
    for(const command of scheduled){assert.equal(command.frame,48000);assert.equal(command.message.action,'edit');assert(!command.message.audition);assert(command.performance>0);assert(command.owner>0);assert.equal(command.message.commands.at(-1).method,'refresh-envelope');assert(!command.message.commands.some(op=>op.method==='audition-key'||op.method==='write'&&[0x188,0x18a].includes(op.register)));}
    f.advance(47999);for(const core of cores){render(core,128);assert.equal(core.read(23*16+12),32767,'future ADSR changes cannot affect the current voice');}
    f.advance(48000);for(const core of cores){const changed=render(core,4096);assert(peak(changed)>.01);assert.equal(peak(changed.subarray(3072)),0);assert.equal(core.read(23*16+12),0);}
    assert.deepEqual(f.errors,[]);
  }finally{for(const client of clients)client.dispose();sender.stop();host.stop();await bridge.dispose();}
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
