import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Y8950} from './y8950.js';
import y8950Factory from '../docs/generated/y8950_wasm.js';
import {OPLSynth,OPL_PRESETS} from './opl_synth.js';
import {createOplClient} from './playground_opl.js';
import {OplVoiceInspector} from './playground_opl_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance,identifyPerformanceNote,performanceNoteRelease,nativeVoiceChannel} from './playground_performance_processor.js';
import {attachY8950Adpcm,copyY8950AdpcmMemory} from './y8950_adpcm.js';
import {validateY8950AdpcmPreview,prepareY8950AdpcmSample} from './y8950_adpcm_preview.js';
const binary=await readFile(new URL('../docs/generated/y8950_wasm.wasm',import.meta.url));
const source=(await readFile(new URL('./playground_opl_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const peak=pcm=>pcm.reduce((value,item)=>Math.max(value,Math.abs(item)),0);
const energy=pcm=>Math.max(...pcm)-Math.min(...pcm);
const tone=()=>({sampleRate:16000,channels:[Float32Array.from({length:4096},(_,i)=>.5*Math.sin(2*Math.PI*440*i/16000))]});
test('Y8950 Inspector edits and auditions ADPCM independently from FM; previews are observation-only and truthful',async t=>{
 const f=await setup();t.after(()=>f.close());const inspector=f.processor.inspector;
 assert.throws(()=>inspector.invoke('auditionOn',['adpcm',60,'unloaded']),/memory/);assert.equal(inspector.auditions.size,0);
 await f.client.adpcm.loadSample(tone(),{address:64});inspector.invoke('adpcm.setVolume',[200]);inspector.invoke('adpcm.setRepeat',[true]);
 f.client.setPreset(0,OPL_PRESETS.sine);inspector.invoke('auditionOn',[0,69,'fm']);f.render(128);
 const before=inspector.read(),snapshot=f.processor.chip.sampleMemory.slice();assert.equal(before.adpcm.waveformKnown,true);assert(before.adpcm.waveform.length<=512);assert.equal(before.adpcm.start,64);
 let writes=0;const write=f.processor.chip.write.bind(f.processor.chip);f.processor.chip.write=(...args)=>{writes++;return write(...args);};
 assert.deepEqual(inspector.read(),before);assert.equal(writes,0,'snapshot reads never touch the sound core');
 inspector.invoke('auditionOn',['adpcm',24,'old']);const delta=inspector.read().adpcm.deltaN;assert(energy(f.render(2048)[0])>.01);assert(inspector.auditions.has(0));assert(inspector.auditions.has('adpcm'));
 f.receive({method:'writeRegister',args:[7,1,0]});f.receive({method:'writeRegister',args:[8,0,0]});assert.equal(inspector.read().adpcm.playing,true);assert.equal(inspector.read().registers[8]&3,2,'script cannot change held ADPCM memory mode');
 inspector.invoke('adpcm.setVolume',[170]);assert.equal(inspector.read().adpcm.volume,170);assert.equal(inspector.read().channels[0].active,true);
 inspector.invoke('auditionOn',['adpcm',96,'new']);assert.equal(inspector.read().adpcm.deltaN,delta,'Keyboard triggers the configured rate');assert.equal(inspector.invoke('auditionOff',['adpcm','old']),false);
 inspector.invoke('auditionOff',['adpcm','new']);assert.equal(inspector.read().adpcm.playing,false);assert.equal(inspector.read().adpcm.repeat,true);assert.equal(inspector.read().channels[0].active,true);assert.deepEqual(f.processor.chip.sampleMemory,snapshot);
 inspector.invoke('adpcm.setSample',[{start:96,end:before.adpcm.end}]);assert.equal(inspector.read().adpcm.waveformKnown,false);inspector.invoke('adpcm.setSample',[{start:64,end:before.adpcm.end}]);assert.equal(inspector.read().adpcm.waveformKnown,true);
 f.client.writeRegister(15,0);assert.equal(inspector.read().adpcm.waveformKnown,false,'raw CPU writes invalidate compact source metadata');
});
test('Y8950 admin prepared upload validates before mutation and Stop invalidates pending uploads without resetting RAM',async t=>{
 const f=await setup();t.after(()=>f.close());const inspector=f.processor.inspector;
 const prepared=await prepareY8950AdpcmSample(tone(),{address:32,name:'Editor'},f.processor.clock),metadata={...prepared.metadata,sampleEpoch:inspector.sampleEpoch};
 const empty=f.processor.chip.sampleMemory.slice();assert.throws(()=>f.processor.loadInspectorSample(prepared.bytes,{...metadata,deltaN:0}),/prepared/);assert.deepEqual(f.processor.chip.sampleMemory,empty);
 f.processor.loadInspectorSample(prepared.bytes,metadata);assert.equal(inspector.read().adpcm.sampleName,'Editor');assert.equal(inspector.read().adpcm.playing,false);
 const memory=f.processor.chip.sampleMemory.slice(),epoch=inspector.sampleEpoch;await f.client._stopVoices();assert(inspector.sampleEpoch>epoch);
 assert.throws(()=>f.processor.loadInspectorSample(prepared.bytes,metadata),/cancelled/);assert.deepEqual(f.processor.chip.sampleMemory,memory);
 f.processor.loadInspectorSample(prepared.bytes,{...metadata,sampleEpoch:inspector.sampleEpoch});assert.equal(inspector.read().adpcm.waveformKnown,true);
 f.client.reset();inspector.invoke('adpcm.setSample',[{start:metadata.start,end:metadata.end}]);assert.equal(inspector.read().adpcm.waveformKnown,true,'chip reset retains sample RAM and source metadata');
});
async function setup(rate=48000,lifecycle={}){
 let Type,frame=0,resolve;const ready=new Promise(done=>resolve=done),messages=[],port={postMessage:message=>{messages.push(message);if(message.ready||message.error)resolve(message);}};
 vm.runInNewContext(source,{Y8950,y8950Factory,Ym3526:{},Ym3812:{},Ymf262:{},ym3526Factory:{},ym3812Factory:{},ymf262Factory:{},copyY8950AdpcmMemory,validateY8950AdpcmPreview,Uint8Array,OplVoiceInspector,receiveChipInspector,validateChipClock,sampleRate:rate,
  createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Type=Value});
 const processor=new Type({processorOptions:{chip:'y8950',wasmBinary:binary}});assert.equal((await ready).ready,true);
 const clientPort={start(){},close(){},postMessage:command=>processor.receive(command,{postMessage:reply=>clientPort.onmessage?.({data:reply})})};
 const client=createOplClient(clientPort,{chip:'y8950'},lifecycle);client.initialize();
 return {processor,client,messages,port,get frame(){return frame;},receive:data=>processor.receive(data,port),render(frames){const pcm=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[pcm]);frame+=frames;return pcm;},close(){client.dispose();processor.dispose();}};
}
for(const rate of [44100,48000,96000])test(`Y8950 actual Worklet at ${rate}: ADPCM-only and mixed FM match an independent real core across render segments`,async t=>{
 const f=await setup(rate);t.after(()=>f.close());
 const core=await Y8950.create({moduleFactory:y8950Factory,moduleOptions:{wasmBinary:binary}});t.after(()=>core.dispose());
 const reference=new OPLSynth({chip:'y8950',transport:{writeRegister(register,value,bank=0){core.write(bank*2,register);core.write(bank*2+1,value);}}});reference.initialize();
 attachY8950Adpcm(reference,{loadMemory:async(bytes,address)=>core.loadSampleMemory(bytes,address,Math.max(core.sampleMemory.length,address+bytes.length)),clearMemory:async()=>core.clearSampleMemory()});
 for(const client of [f.client,reference]){await client.adpcm.loadSample(tone(),{sampleRate:16000});client.adpcm.setVolume(200);client.adpcm.keyOn({repeat:true});}
 let remainder=0,left=0,right=0;
 function renderReference(frames){const pcm=[new Float32Array(frames),new Float32Array(frames)],sourceRate=core.sampleRate(reference.clock);for(let i=0;i<frames;i++){remainder+=sourceRate;const count=Math.floor(remainder/rate);remainder-=count*rate;if(count){const source=core.generateStereo(count);left=source.left.reduce((a,b)=>a+b,0)/count;right=source.right.reduce((a,b)=>a+b,0)/count;}pcm[0][i]=left;pcm[1][i]=right;}return pcm;}
 let amplitude=0;for(const frames of [1,37,128,3,511,1024]){const actual=f.render(frames),expected=renderReference(frames);assert.deepEqual(actual,expected);amplitude=Math.max(amplitude,energy(actual[0]));assert.deepEqual(actual[0],actual[1],'ADPCM is mono');}assert(amplitude>.05,'ADPCM alone wakes the output');
 for(const client of [f.client,reference]){client.setPreset(0,OPL_PRESETS.sine);client.noteOn(0,69);}
 assert.deepEqual(f.render(4096),renderReference(4096),'FM plus ADPCM passes through the shared chip mixing, rather than two separately rounded sources');
});
test('Worklet memory patches retain the entire previous address space and reset retains uploaded bytes',async t=>{
 const f=await setup();t.after(()=>f.close());await f.client.adpcm.loadMemory(Uint8Array.of(1,2,3,4),96);await f.client.adpcm.loadMemory(Uint8Array.of(99),97);
 assert.equal(f.processor.chip.sampleMemory.length,100);assert.deepEqual(f.processor.chip.sampleMemory.subarray(96),Uint8Array.of(1,99,3,4));
 f.client.reset();assert.deepEqual(f.processor.chip.sampleMemory.subarray(96),Uint8Array.of(1,99,3,4));
 const before=f.processor.chip.sampleMemory.slice();await assert.rejects(f.client.adpcm.loadMemory(new Uint8Array(2),0x1fffff),/2 MiB/);assert.deepEqual(f.processor.chip.sampleMemory,before);
 await f.client.adpcm.clearMemory();assert.equal(f.processor.chip.sampleMemory.length,0);assert.equal(f.processor.registers[7],1);
});
test('Stop cancels repeating ADPCM and a later FM trigger does not revive it; raw ADPCM restart remains usable',async t=>{
 const f=await setup();t.after(()=>f.close());await f.client.adpcm.loadSample(tone());f.client.adpcm.setVolume(255);f.client.adpcm.keyOn({repeat:true});assert(energy(f.render(4096)[0])>.05);
 await f.client._stopVoices();assert.equal(f.processor.registers[7],1);assert.equal(peak(f.render(1024)[0]),0);
 f.client.setPreset(0,OPL_PRESETS.sine);f.client.noteOn(0,69);assert(energy(f.render(4096)[0])>.01);assert.equal(f.processor.registers[7],1);
 f.client.keyOff(0);f.client.adpcm.keyOn({repeat:true});assert(energy(f.render(4096)[0])>.05);
});
test('public allNotesOff releases Y8950 ADPCM as well as FM while keeping sample RAM reusable',async t=>{
 const f=await setup();t.after(()=>f.close());await f.client.adpcm.loadSample(tone());f.client.adpcm.setVolume(200);f.client.adpcm.keyOn({repeat:true});assert(energy(f.render(4096)[0])>.05);
 const memory=f.processor.chip.sampleMemory.slice();f.client.allNotesOff();assert.equal(f.processor.registers[7],1);assert.equal(peak(f.render(1024)[0]),0);
 assert.deepEqual(f.processor.chip.sampleMemory,memory);f.client.adpcm.keyOn({repeat:true});assert(energy(f.render(4096)[0])>.05);
});
test('performance ownership cancels ADPCM separately and a stale owner cannot stop a replacement',async t=>{
 const f=await setup();t.after(()=>f.close());await f.client.adpcm.loadSample(tone());f.client.adpcm.setVolume(255);
 f.receive({type:'performance-start',session:1});
 const send=(owner,value)=>f.receive({performance:{session:1,owner,time:f.frame/48000},commands:[{method:'writeRegister',args:[7,value,0]}]});
 send('old',0xb0);f.render(128);send('new',0xb0);f.render(128);f.receive({type:'performance-cancel-owner',session:1,owner:'old'});assert.equal(f.processor.registers[7],0xb0);
 f.receive({type:'performance-cancel-owner',session:1,owner:'new'});assert.equal(f.processor.registers[7],1);assert.equal(peak(f.render(1024)[0].subarray(8)),0);
 assert.deepEqual(identifyPerformanceNote('y8950',{method:'writeRegister',args:[7,0xa0,0]}),{key:'adpcm',on:true});assert.deepEqual(performanceNoteRelease('y8950','adpcm'),{method:'writeRegister',args:[7,1,0]});assert.equal(nativeVoiceChannel('y8950',{method:'writeRegister',args:[9,0,0]}),'adpcm');
});
test('ADPCM mode/range changes preserve a held FM audition and its shared register 08 high bits',async t=>{
 const f=await setup();t.after(()=>f.close());f.client.setPreset(0,OPL_PRESETS.sine);f.processor.inspector.invoke('auditionOn',[0,69,'manual']);f.render(128);
 f.processor.writeRegister(8,0x40);assert.equal(f.client.getRegisterSnapshot()[8],0,'applied editor state may be newer than a script shadow');
 await f.client.adpcm.loadSample(tone());f.client.adpcm.setVolume(200);f.client.adpcm.keyOn({repeat:true});assert.equal(f.processor.registers[8],0x42);assert(f.processor.inspector.auditions.has(0));assert(energy(f.render(4096)[0])>.01);
});
test('disposal during decoding prevents a later transfer and register replay through the closed client',async t=>{
 let finish;const f=await setup(48000,{decodeAudio:()=>new Promise(resolve=>finish=resolve)});t.after(()=>f.close());
 const pending=f.client.adpcm.loadSample(Uint8Array.of(1));await Promise.resolve();f.client.dispose();finish(tone());await assert.rejects(pending,{name:'AbortError'});assert.equal(f.processor.dead,true);
});

test('an accepted RAM patch atomically stops ADPCM, keeps other RAM and FM, and cannot replay the old decoder when FM wakes',async t=>{
 const f=await setup();t.after(()=>f.close());await f.client.adpcm.loadSample(tone());f.client.adpcm.setVolume(255);f.client.adpcm.keyOn({repeat:true});f.client.setPreset(0,OPL_PRESETS.sine);f.client.noteOn(0,69);f.render(4096);
 const patchBefore=f.processor.chip.sampleMemory.slice(),fmBefore=Array.from(f.processor.registers).slice(0x20),clock=f.processor.clock;
 await f.client.adpcm.loadMemory(Uint8Array.of(0x17),64);assert.equal(f.processor.registers[7],1);assert.equal(f.processor.clock,clock);assert.deepEqual(Array.from(f.processor.registers).slice(0x20),fmBefore);
 assert.equal(f.processor.chip.sampleMemory.length,patchBefore.length);patchBefore[64]=0x17;assert.deepEqual(f.processor.chip.sampleMemory,patchBefore);assert(energy(f.render(4096)[0])>.01,'FM remains audible');
 f.client.keyOff(0);await f.client._stopVoices();assert.equal(peak(f.render(1024)[0]),0);f.client.noteOn(0,69);assert.equal(f.processor.registers[7],1);
});
test('a timestamped Worker RAM upload stops the currently applied decoder before a future key-off can arrive',async t=>{
 const f=await setup();t.after(()=>f.close());await f.client.adpcm.loadSample(tone());f.client.adpcm.setVolume(255);f.client.adpcm.keyOn({repeat:true});f.render(1024);
 f.receive({type:'performance-start',session:1});const time=f.frame/48000+.5;
 f.receive({performance:{session:1,owner:'loader',time},commands:[{method:'writeRegister',args:[7,1,0]}]});
 f.receive({performance:{session:1,owner:'loader',time},commands:[{method:'loadAdpcmMemory',args:[Uint8Array.of(1),10],id:'memory-ahead'}]});
 assert.equal(f.processor.registers[7],1);assert(f.messages.some(message=>message.id==='memory-ahead'&&!message.error));assert.equal(peak(f.render(1024)[0].subarray(8)),0);
});

for(const phase of ['decode','upload'])test(`primary-style Stop fences a pending default-scope ${phase} without disposing the client or changing its Run token`,async()=>{
 let release;const commands=[],gate=new Promise(resolve=>release=resolve);
 const port={start(){},close(){},postMessage(command){commands.push(command);if(command.id!==undefined){const reply=()=>port.onmessage?.({data:{id:command.id,value:true}});if(phase==='upload'&&command.method==='loadAdpcmMemory')gate.then(reply);else queueMicrotask(reply);}}};
 const client=createOplClient(port,{chip:'y8950'},{decodeAudio:async()=>{await gate;return tone();}});client.initialize();
 const pending=client.adpcm.loadSample(phase==='decode'?Uint8Array.of(1):tone());const rejected=assert.rejects(pending,{name:'AbortError'});
 await Promise.resolve();await client._stopVoices();const afterStop=commands.length;release();await rejected;
 assert(!commands.slice(afterStop).some(command=>command.method==='loadAdpcmMemory'||command.method==='writeRegister'),'late work cannot configure/retrigger after a pg.stopAll-style control fence');
 await client.adpcm.loadSample(tone());client.adpcm.setVolume(200);client.adpcm.keyOn();assert(commands.some(command=>command.method==='writeRegister'&&command.args[0]===7&&command.args[1]===0xa0),'the same borrowed primary is reusable after Stop');client.dispose();
});
for(const reset of ['parent','adpcm'])test(`${reset} reset invalidates an earlier decode and leaves subsequent sample loading usable`,async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),commands=[];
 const port={start(){},close(){},postMessage(command){commands.push(command);if(command.id!==undefined)queueMicrotask(()=>port.onmessage?.({data:{id:command.id,value:true}}));}};
 const client=createOplClient(port,{chip:'y8950'},{decodeAudio:async()=>{await gate;return tone();}});
 const pending=client.adpcm.loadSample(Uint8Array.of(1)),rejected=assert.rejects(pending,{name:'AbortError'});await Promise.resolve();
 if(reset==='parent')client.reset();else client.adpcm.reset();const afterReset=commands.length;release();await rejected;assert.equal(commands.length,afterReset);
 await client.adpcm.loadSample(tone());assert(commands.some(command=>command.method==='loadAdpcmMemory'));client.dispose();
});
