import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth,createPs1InitSample} from './ps1synth.js';
import {Ps1Resampler} from './ps1_resampler.js';
import {createPs1Client} from './playground_ps1.js';
import {Ps1VoiceInspector} from './playground_ps1_inspector.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {preparePs1Waveform} from './ps1_waveform.js';
import {createPerformanceSender} from './playground_performance_sender.js';
const peak=a=>a.reduce((m,n)=>Math.max(m,Math.abs(n)),0);
const waveform=()=>preparePs1Waveform(Array.from({length:112},(_,i)=>.5*Math.sin(2*Math.PI*i/112)));
let assets;
async function setup(rate=48000){
  const [factory,wasmBinary,source]=await(assets??=Promise.all([import('../docs/generated/ps1_spu_wasm.js').then(m=>m.default),readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url)),readFile(new URL('./playground_ps1_worklet.js',import.meta.url),'utf8')]));
  const main=new MessageChannel();let Processor;
  const scope={factory,Ps1Spu,Ps1Synth,createPs1InitSample,Ps1Resampler,Ps1VoiceInspector,receiveChipInspector,sampleRate:rate,currentFrame:0,AudioWorkletProcessor:class{constructor(){this.port=main.port1;}},registerProcessor(name,Class){assert.equal(name,'tetorica-playground-ps1');Processor=Class;}};
  scope.createProcessorPerformance=options=>createProcessorPerformance({...options,rate,nowFrame:()=>scope.currentFrame});
  vm.runInNewContext(source.replace(/^import .*;\n/gm,'').replace('export class Ps1InstrumentProcessor','class Ps1InstrumentProcessor'),scope);
  const ready=new Promise((resolve,reject)=>{main.port2.onmessage=({data})=>data.ready?resolve(data):data.error?reject(Error(data.error)):undefined;});
  const processor=new Processor({processorOptions:{wasmBinary}}),metadata=await ready,remote=new MessageChannel();
  main.port2.postMessage({port:remote.port1},[remote.port1]);const client=createPs1Client(remote.port2,metadata);await client.getState();
  return{processor,client,scope,metadata,factory,wasmBinary,render(frames){const left=new Float32Array(frames),right=new Float32Array(frames),active=processor.process([],[[left,right]]);scope.currentFrame+=frames;return{left,right,active};},close(){client.dispose();processor.dispose();main.port1.close();main.port2.close();remote.port2.close();}};
}

test('PS1 editor waveform reuse does not change a sibling voice, its phase or shared RAM',async t=>{
 const a=await setup(),b=await setup();t.after(()=>{a.close();b.close();});
 for(const p of[a,b]){p.client.noteOn(1,69);await p.client.getState();}
 assert.deepEqual(a.render(1024).left,b.render(1024).left);
 const shared=a.processor.synth.core.readRam(0x1000,64),before=a.processor.inspector.read().channels[1];
 const first=a.processor.inspector.invoke('setWaveform',[23,waveform(),{retrigger:true}]);
 for(let i=0;i<20;i++)assert.equal(a.processor.inspector.invoke('setWaveform',[23,waveform(),{retrigger:true}]).id,first.id);
 assert.deepEqual(a.render(8192).left,b.render(8192).left,'upload never resets another active decoder or resampler');
 assert.deepEqual(a.processor.synth.core.readRam(0x1000,64),shared);assert.equal(a.processor.inspector.read().channels[1].sample,before.sample);
 const after=a.processor.inspector.read();assert.equal(after.samples.length,2);assert.equal(after.nextAddress,0x1080);assert.equal(after.channels[23].waveform.sample,first.id);
 const normal=await a.client.loadADPCM(...(()=>{const{adpcm,...options}=createPs1InitSample();return[adpcm,options];})());
 assert.equal(normal.id,2);assert.equal(normal.startAddress,0x1080);assert.deepEqual(a.client._getState().samples,(await a.client.getState()).samples);
 assert.throws(()=>a.client.setPreset(0,{sample:first}),/another channel/);a.client.setPreset(0,{sample:normal});await a.client.getState();
});

test('PS1 waveform resources synchronize Main and Worker shadows without replacing requested voice settings',async t=>{
 const p=await setup();t.after(()=>p.close());const secondary=new MessageChannel();
 p.processor.port.onmessage({data:{primaryWorker:true,port:secondary.port1}});
 const worker=createPs1Client(secondary.port2,p.metadata);t.after(()=>{worker.dispose();secondary.port1.close();});
 await worker.getState();p.client.setPitch(0,1234);worker.setPitch(1,2345);await worker.getState();await p.client.getState();
 const sample=p.processor.inspector.invoke('setWaveform',[23,waveform(),{retrigger:false}]);await worker.getState();await p.client.getState();
 assert.equal(p.client._getState().channels[0].pitch,1234);assert.equal(worker._getState().channels[1].pitch,2345);
 assert.deepEqual(worker._getState().samples,p.client._getState().samples);assert.equal(worker._getState().samples[1].editorChannel,23);
 const{adpcm,...options}=createPs1InitSample(),a=await worker.loadADPCM(adpcm,options),b=await p.client.loadADPCM(adpcm,options);
 assert.equal(a.id,2);assert.equal(a.startAddress,0x1080);assert.equal(b.id,3);assert.equal(b.startAddress,0x10c0);
 await worker.getState();assert.deepEqual(worker._getState().samples,p.client._getState().samples);assert.equal(worker._getState().nextAddress,0x1100);
 worker.setPreset(23,{sample});assert.throws(()=>worker.setPreset(0,{sample}),/another channel/);await worker.getState();
 worker.reset({clearRam:true});await worker.getState();await p.client.getState();assert.deepEqual(p.client._getState().samples,[]);assert.deepEqual(worker._getState().samples,[]);
 const fresh=await p.client.loadADPCM(adpcm,options);assert.equal(fresh.id,0);assert.equal(fresh.startAddress,0x1000);await worker.getState();assert.deepEqual(worker._getState().samples,p.client._getState().samples);
});

test('PS1 late Worker attachment establishes an existing bank epoch before an immediate upload',async t=>{
 const p=await setup();t.after(()=>p.close());p.client.reset({clearRam:true});await p.client.getState();p.client.reset({clearRam:true});await p.client.getState();
 const secondary=new MessageChannel();p.processor.port.onmessage({data:{primaryWorker:true,port:secondary.port1}});
 const worker=createPs1Client(secondary.port2);t.after(()=>{worker.dispose();secondary.port1.close();});
 const{adpcm,...options}=createPs1InitSample(),fresh=await worker.loadADPCM(adpcm,options);assert.equal(fresh.id,0);assert.equal(fresh.startAddress,0x1000);
 await p.client.getState();assert.deepEqual(worker._getState().samples,p.client._getState().samples);
});

test('PS1 interleaved client clears acknowledge their actual bank without cancelling subsequent uploads',async t=>{
 const p=await setup();t.after(()=>p.close());const secondary=new MessageChannel();p.processor.port.onmessage({data:{primaryWorker:true,port:secondary.port1}});
 const worker=createPs1Client(secondary.port2,p.metadata);t.after(()=>{worker.dispose();secondary.port1.close();});await worker.getState();
 // Deterministically deliver another client's clear before processing the
 // queued local clear. The fresh upload follows that local clear on its port.
 p.client.reset({clearRam:true});p.client.reset();
 p.processor.receive({method:'reset',args:[{clearRam:true}]},{postMessage(){}});
 const{adpcm,...options}=createPs1InitSample(),fresh=await p.client.loadADPCM(adpcm,options);assert.equal(fresh.id,0);assert.equal(fresh.startAddress,0x1000);
 await worker.getState();assert.deepEqual(worker._getState().samples,p.client._getState().samples);
 worker.reset({clearRam:true});p.processor.receive({method:'reset',args:[{clearRam:true}]},{postMessage(){}});
 const next=await worker.loadADPCM(adpcm,options);assert.equal(next.id,0);await p.client.getState();assert.deepEqual(worker._getState().samples,p.client._getState().samples);
});

test('PS1 scheduled Worker reset carries its resource fence through preparation and ignores an expired reset fence',async t=>{
 const p=await setup();t.after(()=>p.close());const secondary=new MessageChannel();p.processor.port.onmessage({data:{primaryWorker:true,port:secondary.port1}});
 p.processor.receive({type:'performance-start',session:12},{postMessage(){}});
 const sender=createPerformanceSender({now:()=>1000,getLoop:()=>({performanceOwner:'worker'})});sender.configure({session:12,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:.5});
 const worker=createPs1Client(sender.port(secondary.port2,'ps1'),p.metadata);t.after(()=>{worker.dispose();secondary.port1.close();});await worker.getState();
 worker.reset({clearRam:true});await worker.getState();assert.deepEqual(worker._getState().samples,[]);
 p.processor.inspector.invoke('setWaveform',[23,waveform(),{}]);await worker.getState();assert.equal(worker._getState().samples[0].editorChannel,23,'nested reset fence admits later editor resource broadcasts');
 const{adpcm,...options}=createPs1InitSample(),fresh=await worker.loadADPCM(adpcm,options);assert.equal(fresh.id,1);assert.equal(fresh.startAddress,0x1040);assert.deepEqual(worker._getState().samples,(await worker.getState()).samples);
 p.processor.receive({performance:{session:11,owner:'old',time:0},commands:[{method:'reset',args:[{clearRam:true}],resourceFence:99}]},secondary.port1);
 p.processor.inspector.invoke('setWaveform',[2,waveform(),{}]);await worker.getState();assert.equal(worker._getState().samples.length,3,'expired reset cannot poison the current port resource fence');
});

test('PS1 prepared waveform changes retrigger only owned auditions and rejected edits leave RAM untouched',async t=>{
 const p=await setup();t.after(()=>p.close());const i=p.processor.inspector;
 p.client.noteOn(2,60);await p.client.getState();i.invoke('auditionOn',[23,69,'held']);p.render(1024);
 const before=i.read(),raw=p.processor.synth.snapshot();
 assert.throws(()=>i.invoke('setWaveform',[23,waveform(),{retrigger:'yes'}]),/retrigger/);
 assert.throws(()=>i.invoke('setWaveform',[23,{...waveform(),pcm:[NaN]},{}]),/112/);assert.deepEqual(p.processor.synth.snapshot(),raw);
 i.invoke('setEnvelope',[23,{attackRate:110},{retrigger:false}]);i.invoke('setWaveform',[23,waveform(),{retrigger:false}]);p.render(128);
 assert(i.read().channels[23].envelope>30000,'deferred edit leaves current envelope held');
 i.invoke('setWaveform',[23,waveform(),{retrigger:true}]);p.render(128);assert.equal(i.read().channels[23].envelope,0);
 const scriptEnvelope=i.read().channels[2].envelope;i.invoke('setWaveform',[2,waveform(),{retrigger:true}]);p.render(128);assert.equal(i.read().channels[2].envelope,scriptEnvelope,'script-owned voice never gets KON from editor');
 assert.equal(i.read().channels[23].pitch,before.channels[23].pitch);assert.equal(i.read().channels[23].volumeLeft,before.channels[23].volumeLeft);
 await p.client._stopVoices();const saved=i.read().channels[23].waveform;assert(saved);assert.equal(peak(p.render(1024).left),0);i.invoke('auditionOn',[23,69,'again']);i.invoke('setEnvelope',[23,{attackRate:0},{retrigger:true}]);assert(peak(p.render(1024).left)>.001);
 p.client.reset();await p.client.getState();assert.equal(i.read().channels[23].waveform,null);assert.equal(i.invoke('setWaveform',[23,waveform(),{}]).id,saved.sample);
 p.client.reset({clearRam:true});await p.client.getState();assert.equal(i.invoke('setWaveform',[23,waveform(),{}]).id,0);
});
for(const rate of [44100,48000])test(`PS1 Worklet matches direct fixed-rate SPU through irregular ${rate} Hz quanta`,async t=>{
  const p=await setup(rate);t.after(()=>p.close());const core=await Ps1Spu.create({moduleFactory:p.factory,moduleOptions:{wasmBinary:p.wasmBinary}}),synth=new Ps1Synth({core});t.after(()=>synth.dispose());const{adpcm,...options}=createPs1InitSample(),sample=synth.loadADPCM(adpcm,options);for(let ch=0;ch<24;ch++)synth.setPreset(ch,{sample});const resampler=new Ps1Resampler(synth,rate);
  assert.equal(p.metadata.state.samples.length,1);assert.equal(p.metadata.state.channels.length,24);assert(peak(p.render(128).left)===0);resampler.render(new Float32Array(128),new Float32Array(128));
  for(const ch of [0,23]){p.client.noteOn(ch,ch===0?60:67);synth.noteOn(ch,ch===0?60:67);}await p.client.getState();let max=0;
  for(const frames of [1,127,53,1024,128]){const actual=p.render(frames),left=new Float32Array(frames),right=new Float32Array(frames);resampler.render(left,right);assert.deepEqual(actual.left,left);assert.deepEqual(actual.right,right);assert.equal(actual.active,true);max=Math.max(max,peak(left));}assert(max>.001);
  p.client.keyOff(23);synth.keyOff(23);await p.client.getState();const actual=p.render(1024),left=new Float32Array(1024),right=new Float32Array(1024);resampler.render(left,right);assert.deepEqual(actual.left,left);
});
test('PS1 authored keyboard works before Run; stale release and script owners cannot replace a held voice',async t=>{
  const p=await setup();t.after(()=>p.close());const i=p.processor.inspector,port={postMessage(){}};
  i.invoke('auditionOn',[23,60,'old']);assert(peak(p.render(512).left)>.001);const before=i.read().channels[23],frames=p.processor.synth.core.nativeFrames;for(let j=0;j<10;j++)i.read();assert.equal(p.processor.synth.core.nativeFrames,frames);
  i.invoke('auditionOn',[23,64,'new']);assert.equal(i.invoke('auditionOff',[23,'old']),false);const pitch=i.read().channels[23].pitch;assert(pitch>before.pitch);
  p.processor.receive({method:'setPitch',args:[23,123]},port);p.processor.receive({method:'keyOff',args:[23]},port);p.processor.receive({method:'allNotesOff'},port);assert.equal(i.read().channels[23].pitch,pitch);assert.equal(i.read().channels[23].active,true);
  p.processor.receive({type:'performance-start',session:2},port);p.processor.receive({performance:{session:2,owner:'script',time:p.scope.currentFrame/48000},commands:[{method:'noteOn',args:[23,72]},{method:'noteOn',args:[1,60]}]},port);p.render(128);assert.equal(i.read().channels[23].pitch,pitch);assert(i.read().channels[1].active);
  p.processor.receive({type:'performance-cancel-owner',session:2,owner:'script'},port);assert(i.read().channels[23].active);assert.equal(i.read().channels[1].active,false);
  i.invoke('auditionOff',[23,'new']);p.render(4096);assert.equal(peak(p.render(128).left),0);
});
test('PS1 Stop acknowledges immediate silence, cancels future notes and retains sample/presets',async t=>{
  const p=await setup();t.after(()=>p.close());const i=p.processor.inspector,port={postMessage(){}};i.invoke('auditionOn',[0,69,'old']);assert(peak(p.render(512).left)>.001);const before=i.read();
  p.processor.receive({type:'performance-start',session:3},port);p.processor.receive({performance:{session:3,owner:'future',time:1},commands:[{method:'noteOn',args:[2,72]}]},port);
  await p.client._stopVoices();assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(peak(p.render(48001).left),0);const after=i.read();assert.deepEqual(after.samples,before.samples);assert.equal(after.channels[0].pitch,before.channels[0].pitch);assert.equal(after.auditions.length,0);assert.equal(i.invoke('auditionOff',[0,'old']),false);
  i.invoke('auditionOn',[23,60,'after']);assert(peak(p.render(1024).left)>.001);
});
test('PS1 future notes start at reserved host frame and old owner cancellation cannot release replacement',async t=>{
  const p=await setup();t.after(()=>p.close());const port={postMessage(){}},processor=p.processor;
  processor.receive({type:'performance-start',session:4},port);processor.receive({performance:{session:4,owner:'old',time:64/48000},commands:[{method:'noteOn',args:[23,60]}]},port);
  assert.equal(peak(p.render(64).left),0);p.render(128);assert(processor.synth.gates[23]);
  processor.receive({performance:{session:4,owner:'new',time:p.scope.currentFrame/48000},commands:[{method:'noteOn',args:[23,67]}]},port);p.render(128);
  processor.receive({type:'performance-cancel-owner',session:4,owner:'old'},port);assert(processor.synth.gates[23]);processor.receive({type:'performance-cancel-owner',session:4,owner:'new'},port);assert.equal(processor.synth.gates[23],false);
  processor.receive({type:'performance-stop',session:4},port);assert.equal(peak(p.render(1024).left),0);
});
test('PS1 repeated uploads are owned and read snapshots never advance; disposal fences late core creation',async t=>{
  const p=await setup();t.after(()=>p.close());const{adpcm,...options}=createPs1InitSample(),before=adpcm.slice(),sample=await p.client.loadADPCM(adpcm,options);assert.equal(sample.id,1);assert.deepEqual(adpcm,before);p.client.setPreset(23,{sample});p.client.noteOn(23,60);const snap=await p.client.snapshot();assert.equal(snap.channels[23].sample,1);assert.equal(snap.ram.length,524288);
  const state=await p.client.getState();for(let n=0;n<5;n++)await p.client.getState();assert.equal((await p.client.getState()).nativeFrames,state.nativeFrames);
  const file=await readFile(new URL('./playground_ps1_worklet.js',import.meta.url),'utf8');let resolveCore,Processor;const main=new MessageChannel(),fake={disposeCount:0,dispose(){this.disposeCount++;}};
  const scope={factory(){},Ps1Spu:{create:()=>new Promise(resolve=>resolveCore=resolve)},Ps1Synth,createPs1InitSample,Ps1Resampler,Ps1VoiceInspector,receiveChipInspector,createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.port=main.port1;}},registerProcessor(_,Class){Processor=Class;}};
  vm.runInNewContext(file.replace(/^import .*;\n/gm,'').replace('export class Ps1InstrumentProcessor','class Ps1InstrumentProcessor'),scope);const processor=new Processor();processor.dispose();resolveCore(fake);await processor.ready;assert.equal(fake.disposeCount,1);assert.equal(processor.synth,null);main.port1.close();main.port2.close();
});
test('PS1 manual voice allows append-only uploads and invalid inspector edits remain recoverable',async t=>{
 const p=await setup();t.after(()=>p.close());const i=p.processor.inspector;i.invoke('auditionOn',[0,69,'held']);assert(peak(p.render(512).left)>.001);const before=i.read().channels[0];assert.throws(()=>i.invoke('setPreset',[0,{volumeLeft:2}]),/volumeLeft/);assert.throws(()=>i.invoke('setPitch',[0,0xffff]),/pitch/);assert.equal(i.read().channels[0].pitch,before.pitch);
 i.invoke('setPitch',[0,before.pitch+1]);assert.equal(i.read().channels[0].pitch,before.pitch+1,'manual UI edits may change their leased voice');const{adpcm,...options}=createPs1InitSample(),sample=await p.client.loadADPCM(adpcm,options);assert.equal(sample.id,1);assert.equal(i.read().channels[0].active,true);assert(peak(p.render(512).left)>.001);
});

test('PS1 decoded ADSR edits retrigger only an explicitly owned audition and retain reserved bits',async t=>{
 const p=await setup();t.after(()=>p.close());const i=p.processor.inspector;
 p.client.noteOn(2,60);await p.client.getState();i.invoke('setPreset',[23,{adsr2:0x2000}]);i.invoke('auditionOn',[23,69,'held']);p.render(1024);
 const full=i.read().channels[23].envelope;assert(full>30000);
 i.invoke('setEnvelope',[23,{attackRate:110},{retrigger:false}]);p.render(128);assert.equal(i.read().channels[23].envelope,full,'register edit does not restart a held envelope by itself');
 i.invoke('setEnvelope',[23,{attackRate:110,decayRate:4},{retrigger:true}]);p.render(128);const changed=i.read().channels[23];assert(changed.envelope<full/4);assert.equal(changed.adsr2&0x2000,0x2000);assert.equal(changed.envelopeParameters.decayRate,4);
 const scriptEnvelope=i.read().channels[2].envelope;i.invoke('setEnvelope',[2,{attackRate:110},{retrigger:true}]);p.render(128);assert.equal(i.read().channels[2].envelope,scriptEnvelope,'an editor patch never restarts a code-owned note');
 const before=i.read().channels[23];assert.throws(()=>i.invoke('setEnvelope',[23,{releaseRate:32},{retrigger:true}]),/releaseRate/);assert.throws(()=>i.invoke('setEnvelope',[23,{releaseRate:8},{retrigger:1}]),/retrigger/);assert.equal(i.read().channels[23].adsr2,before.adsr2);
 i.invoke('auditionOn',[23,72,'new']);assert.equal(i.invoke('auditionOff',[23,'held']),false);assert.equal(i.read().channels[23].active,true);
});

test('PS1 inspector edits run in a Worklet without structuredClone and own scalar patches',async t=>{
 const p=await setup();t.after(()=>p.close());const i=p.processor.inspector,clone=globalThis.structuredClone;
 try{
  globalThis.structuredClone=undefined;
  const sample={...p.processor.synth.samples[0]},patch={sample,volumeLeft:.3,reverb:true};
  i.invoke('setPreset',[23,patch]);patch.volumeLeft=.9;sample.id=999;
  i.invoke('auditionOn',[23,69,'worklet']);i.invoke('setEnvelope',[23,{attackRate:35},{retrigger:true}]);i.invoke('setReverb',[{preset:'room',volumeLeft:.2}]);
  i.invoke('setPitch',[23,4096]);const state=i.read();assert.equal(state.channels[23].sample,0);assert.equal(state.channels[23].volumeLeft,.3);assert.equal(state.channels[23].envelopeParameters.attackRate,35);assert.equal(state.reverb.preset,'room');assert(peak(p.render(8192).left)>0);
 }finally{globalThis.structuredClone=clone;}
});

test('PS1 leased editor reverb is live, blocks competing script patches and Stop retains settings with no tail',async t=>{
 const p=await setup();t.after(()=>p.close());const i=p.processor.inspector,port={postMessage(){}};
 i.invoke('setPreset',[23,{reverb:true,volumeLeft:.3,volumeRight:.3}]);i.invoke('setReverb',[{preset:'room',volumeLeft:.5,volumeRight:.5}]);i.invoke('auditionOn',[23,69,'wet']);
 assert(peak(p.render(24000).left)>.01);p.processor.receive({method:'setEnvelope',args:[23,{attackRate:120}]},port);p.processor.receive({method:'setReverb',args:[{preset:'off'}]},port);
 assert.equal(i.read().channels[23].envelopeParameters.attackRate,0);assert.equal(i.read().reverb.preset,'room');
 i.invoke('setReverb',[{volumeLeft:.4}]);assert.equal(i.read().reverb.volumeLeft,.4);assert.equal(i.read().channels[23].active,true);
 i.invoke('auditionOff',[23,'wet']);p.render(4096);const tail=p.render(8192);assert(peak(tail.left)>.00001,'real SPU reverb survives voice release');
 const before=i.read();await p.client._stopVoices();assert.equal(peak(p.render(12000).left),0);assert.deepEqual(i.read().reverb,before.reverb);assert.equal(i.read().channels[23].reverb,true);assert.deepEqual(i.read().samples,before.samples);
 i.invoke('auditionOn',[23,69,'after']);assert(peak(p.render(8192).left)>.01);assert.equal(i.read().channels[2].reverb,false);assert.equal(i.invoke('auditionOff',[23,'wet']),false);
});

test('PS1 real WASM factory boots in an AudioWorklet-like realm without URL or network APIs',async()=>{
 const source=await readFile(new URL('../docs/generated/ps1_spu_wasm.js',import.meta.url),'utf8'),wasmBinary=await readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url));
 const scope=vm.createContext({console,WebAssembly});
 // Retain the emitted loader body. Only ESM bindings are adapted for vm.Script;
 // URL, fetch, XMLHttpRequest, WorkerGlobalScope and process remain unavailable.
 const executable=source.replaceAll('import.meta.url',JSON.stringify('https://test.invalid/generated/ps1_spu_wasm.js')).replace(/export default Module;?/, 'globalThis.factory=Module;');
 vm.runInContext(executable,scope);assert.equal(vm.runInContext('typeof URL',scope),'undefined');assert.equal(vm.runInContext('typeof fetch',scope),'undefined');
 let located=0;const module=await scope.factory({wasmBinary,locateFile:path=>{located++;assert.equal(path,'ps1_spu_wasm.wasm');return path;}});
 assert.equal(module.cwrap('ps1_spu_sample_rate','number',[])(),44100);assert.equal(located,1);
 const core=await Ps1Spu.create({moduleFactory:()=>module}),synth=new Ps1Synth({core});try{const{adpcm,...options}=createPs1InitSample(),sample=synth.loadADPCM(adpcm,options);synth.setPreset(23,{sample});synth.noteOn(23,60);const left=new Float32Array(1024),right=new Float32Array(1024);synth.renderInto(left,right);assert(peak(left)>.001);}finally{synth.dispose();}
});

test('PS1 Worker reset is an immediate preparation barrier and preserves following independent timed command batches',async t=>{
 const p=await setup();t.after(()=>p.close());const processor=p.processor,port={postMessage(){}};
 processor.receive({type:'performance-start',session:10},port);
 processor.receive({performance:{session:10,owner:'prior',time:.05},commands:[{method:'noteOn',args:[3,60]}]},port);assert.equal(processor.performance.getStats().queuedCommands,1);
 for(const command of [{method:'reset',args:[]},{method:'setPreset',args:[23,{sample:0}]},{method:'noteOn',args:[23,69]}])processor.receive({performance:{session:10,owner:'script',time:.1},commands:[command]},port);
 assert.equal(processor.synth.channels[23].sample,null,'reset applies before its reserved time');assert.equal(processor.synth.samples.length,1);assert.equal(processor.performance.getStats().queuedCommands,2,'barrier drops only older queued commands');assert.equal(peak(p.render(4800).left),0);assert(peak(p.render(1024).left)>.001);assert.equal(processor.synth.gates[3],false);assert.equal(processor.synth.gates[23],true);
 processor.receive({type:'performance-stop',session:10},port);assert.equal(peak(p.render(128).left),0);
});
test('PS1 Worker clearRam reset precedes immediate uploads and rejects expired reset envelopes without changing the bank',async t=>{
 const p=await setup();t.after(()=>p.close());const processor=p.processor,messages=[],port={postMessage:data=>messages.push(data)},{adpcm,...options}=createPs1InitSample();
 processor.receive({type:'performance-start',session:11},port);processor.receive({performance:{session:11,owner:'script',time:.1},commands:[{method:'reset',args:[{clearRam:true}]}]},port);assert.equal(processor.synth.samples.length,0);
 processor.receive({method:'loadADPCM',args:[adpcm,options],id:201},port);const sample=messages.find(message=>message.id===201).value;assert.equal(sample.id,0);assert.equal(sample.startAddress,0x1000);
 processor.receive({performance:{session:10,owner:'expired',time:.1},commands:[{method:'reset',args:[{clearRam:true}]}]},port);assert.equal(processor.synth.samples.length,1);assert.equal(processor.validation.samples.length,1,'expired reset cannot clear validation metadata');
 for(const command of [{method:'setPreset',args:[23,{sample}]},{method:'noteOn',args:[23,69]}])processor.receive({performance:{session:11,owner:'script',time:.1},commands:[command]},port);
 assert.equal(peak(p.render(4800).left),0);assert(peak(p.render(1024).left)>.001);assert.equal(processor.synth.channels[23].sample,0);
});
test('PS1 Main reset clears held manual leases and keeps local and applied sample metadata aligned',async t=>{
 const p=await setup();t.after(()=>p.close());const i=p.processor.inspector;i.invoke('auditionOn',[23,69,'held']);assert(peak(p.render(512).left)>.001);
 p.client.reset({clearRam:true});const remote=await p.client.getState();assert.equal(remote.samples.length,0);assert.equal(p.client._getState().samples.length,0);assert.equal(i.read().auditions.length,0);assert.equal(i.invoke('auditionOff',[23,'held']),false);assert.equal(peak(p.render(1024).left),0);
 const{adpcm,...options}=createPs1InitSample(),sample=await p.client.loadADPCM(adpcm,options);assert.equal(sample.id,0);p.client.setPreset(23,{sample});p.client.noteOn(23,69);await p.client.getState();assert(peak(p.render(1024).left)>.001);
});
