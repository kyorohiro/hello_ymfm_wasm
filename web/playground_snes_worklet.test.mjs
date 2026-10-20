import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SpcCore,SnesDspCore} from './spc.js';
import {SnesSynth} from './snessynth.js';
import {SpcResampler} from './spc_resampler.js';
import {createSnesClient} from './playground_snes.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {createSyntheticSpc} from './spc_test_fixture.mjs';
import {SnesVoiceInspector} from './playground_snes_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
const brr=new Uint8Array([0xc3,0x12,0x34,0x56,0x76,0x54,0x32,0x10,0xfe]);
const peak=a=>a.reduce((max,n)=>Math.max(max,Math.abs(n)),0);
let binaries;
async function assets(){return binaries??=Promise.all([import('../docs/generated/spc_wasm.js').then(m=>m.default),readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url)),readFile(new URL('./playground_snes_worklet.js',import.meta.url),'utf8')]);}
async function setup(rate=48000) {
  const [factory,wasmBinary,source]=await assets(),main=new MessageChannel();let Processor;
  const scope={factory,SnesDspCore,SnesSynth,SpcResampler,SnesVoiceInspector,receiveChipInspector,sampleRate:rate,currentFrame:0,
    AudioWorkletProcessor:class{constructor(){this.port=main.port1;}},registerProcessor(name,Class){assert.equal(name,'tetorica-playground-snes');Processor=Class;}};
  scope.createProcessorPerformance=options=>createProcessorPerformance({...options,rate,nowFrame:()=>scope.currentFrame});
  vm.runInNewContext(source.replace(/^import .*;\n/gm,'').replace('export class SnesInstrumentProcessor','class SnesInstrumentProcessor'),scope);
  const ready=new Promise((resolve,reject)=>{main.port2.onmessage=({data})=>data.ready?resolve(data):data.error?reject(Error(data.error)):undefined;});
  const processor=new Processor({processorOptions:{wasmBinary}}),metadata=await ready,remote=new MessageChannel();
  main.port2.postMessage({port:remote.port1},[remote.port1]);const client=createSnesClient(remote.port2,metadata);await client.getState();
  return{processor,client,scope,factory,wasmBinary,
    render(frames){const left=new Float32Array(frames),right=new Float32Array(frames),active=processor.process([],[[left,right]]);scope.currentFrame+=frames;return{left,right,active};},
    close(){client.dispose();processor.dispose();main.port1.close();main.port2.close();remote.port2.close();}};
}
for(const rate of [44100,48000])test(`SNES instrument Worklet matches native DSP-only core at${rate}Hz through split quanta`,async t=>{
  const p=await setup(rate);t.after(()=>p.close());const core=await SnesDspCore.create({moduleFactory:p.factory,moduleOptions:{wasmBinary:p.wasmBinary}});t.after(()=>core.dispose());
  const synth=new SnesSynth({core}),resampler=new SpcResampler(synth,rate,{sourceFrames:1});
  const sample=await p.client.loadBRR(brr,{rootNote:60,loopStartSamples:0}),direct=synth.loadBRR(brr,{rootNote:60,loopStartSamples:0});
  for(const ch of [0,7]){p.client.setPreset(ch,{sample,gain:127});synth.setPreset(ch,{sample:direct,gain:127});p.client.noteOn(ch,ch===0?'C4':'E4');synth.noteOn(ch,ch===0?'C4':'E4');}
  await p.client.getState();let max=0;
  let part=0;for(const frames of [128,1,127,53,1024]){if(part++===2){p.client.setPreset(0,{gain:127});await p.client.getState();} const pcm=p.render(frames),left=new Float32Array(frames),right=new Float32Array(frames);resampler.render(left,right);assert.deepEqual(pcm.left,left);assert.deepEqual(pcm.right,right);assert.equal(pcm.active,true);max=Math.max(max,peak(left));}
  assert.ok(max>0.01,'authored BRR chord is audible');
  p.client.keyOff(7);synth.keyOff(7);await p.client.getState();
  const pcm=p.render(1024),left=new Float32Array(1024),right=new Float32Array(1024);resampler.render(left,right);assert.deepEqual(pcm.left,left);
  assert.equal((await p.client.snapshot()).dsp[0x5c],0xfe,'KOFF releases channel7 while channel0 stays enabled');
});

test('SNES Keyboard requires authored BRR, reads applied DSP without advancing, and ignores stale manual releases',async t=>{
  const p=await setup();t.after(()=>p.close());const inspector=p.processor.inspector;
  assert.throws(()=>inspector.invoke('auditionOn',[0,69,'empty']),/Assign a BRR sample/);assert.equal(p.processor.synth.samples.length,0,'Keyboard must not create a hidden sample');
  const sample=await p.client.loadBRR(brr,{rootNote:69,loopStartSamples:0});p.client.setPreset(0,{sample,gain:100,volumeLeft:80,volumeRight:90});await p.client.getState();
  inspector.invoke('auditionOn',[0,69,'old']);assert(peak(p.render(1024).left)>.01);const frame=p.processor.synth.core.nativeFrames,preset=inspector.read().channels[0];
  for(let i=0;i<10;i++)assert.equal(inspector.read().channels[0].sample,sample.id);assert.equal(p.processor.synth.core.nativeFrames,frame,'polling cannot render');
  inspector.invoke('auditionOn',[0,72,'new']);assert.equal(inspector.invoke('auditionOff',[0,'old']),false);assert.equal(inspector.read().channels[0].active,true);assert(peak(p.render(1024).left)>.01);assert(inspector.read().channels[0].pitch>preset.pitch,'MIDI uses declared BRR tuning');
  inspector.invoke('auditionOff',[0,'new']);p.render(2048);assert.equal(peak(p.render(128).left),0);assert.equal(inspector.read().channels[0].gain,100);assert.equal(inspector.read().channels[0].sample,0);
});

test('SNES manual channel survives Main/Worker preset, KOFF/KON masks and allNotesOff while another channel advances',async t=>{
  const p=await setup();t.after(()=>p.close());const processor=p.processor,inspector=processor.inspector,sample=await p.client.loadBRR(brr,{rootNote:69,loopStartSamples:0}),port={postMessage(){}};
  for(const ch of [0,1])p.client.setPreset(ch,{sample,gain:127});await p.client.getState();inspector.invoke('auditionOn',[0,69,'held']);p.render(512);const pitch=inspector.read().channels[0].pitch;
  processor.receive({method:'setPitch',args:[0,123]},port);processor.receive({method:'keyOff',args:[0]},port);processor.receive({method:'allNotesOff'},port);assert.equal(inspector.read().channels[0].pitch,pitch);assert(inspector.read().channels[0].active);
  processor.receive({type:'performance-start',session:20},port);processor.receive({performance:{session:20,owner:'code',time:p.scope.currentFrame/48000},commands:[{method:'setPitch',args:[0,234]},{method:'keyOff',args:[0]},{method:'noteOn',args:[1,72]},{method:'writeDsp',args:[0x5c,3]}]},port);p.render(128);
  assert.equal(inspector.read().channels[0].pitch,pitch);assert(inspector.read().channels[0].active);assert.equal(inspector.read().channels[1].active,false,'masked KOFF still releases the unheld channel');
  processor.receive({method:'writeDsp',args:[0x4c,3]},port);assert(inspector.read().channels[0].active);assert(inspector.read().channels[1].active,'masked KON still starts the unheld channel');assert(peak(p.render(1024).left)>.01);
  processor.receive({type:'performance-cancel-owner',session:20,owner:'code'},port);assert(inspector.read().channels[0].active,'cancelled code owner does not release the manual voice');
  inspector.invoke('auditionOff',[0,'held']);processor.receive({method:'noteOn',args:[0,72]},port);assert(inspector.read().channels[0].pitch>pitch,'code resumes after manual release');
});

test('SNES Stop clears manual IDs, queued notes and release tails while retaining BRR and applied raw/current voice settings',async t=>{
  const p=await setup();t.after(()=>p.close());const processor=p.processor,inspector=processor.inspector,sample=await p.client.loadBRR(brr,{rootNote:69,loopStartSamples:0}),port={postMessage(){}};
  p.client.setPreset(0,{sample,gain:127,volumeLeft:80,volumeRight:70});await p.client.getState();inspector.invoke('auditionOn',[0,69,'old-stop']);assert(peak(p.render(512).left)>.01);
  const before=inspector.read();processor.receive({type:'performance-start',session:30},port);processor.receive({performance:{session:30,owner:'late',time:1},commands:[{method:'noteOn',args:[0,72]}]},port);processor.receive({method:'stopVoices'},port);
  const stopped=inspector.read();assert.deepEqual(stopped.samples,before.samples);for(const key of ['sample','adsr1','adsr2','gain','volumeLeft','volumeRight','pitch'])assert.equal(stopped.channels[0][key],before.channels[0][key]);assert.equal(stopped.auditions.length,0);assert(stopped.channels.every(ch=>!ch.active));assert.equal(processor.performance.getStats().queuedCommands,0);assert.equal(peak(p.render(48001).left),0,'Stop has no hardware release or stale future note');
  assert.equal(inspector.invoke('auditionOff',[0,'old-stop']),false);inspector.invoke('auditionOn',[0,69,'new-stop']);assert(peak(p.render(1024).left)>.01,'same authored instrument can be auditioned after Stop');
});

test('SNES Stop ACK waits for remote silence before allowing a subsequent admin audition',async t=>{
  const p=await setup();t.after(()=>p.close());const processor=p.processor,sample=await p.client.loadBRR(brr,{rootNote:69,loopStartSamples:0});p.client.setPreset(0,{sample,gain:127});await p.client.getState();processor.inspector.invoke('auditionOn',[0,69,'old']);assert(peak(p.render(512).left)>.01);
  const receive=processor.receive.bind(processor);let delayed,settled=false,received;const observed=new Promise(resolve=>received=resolve);processor.receive=(data,port)=>{if(data.method==='stopVoices'){delayed={data,port};received();}else receive(data,port);};
  const pending=p.client._stopVoices().then(value=>{settled=true;return value;});pending.catch(()=>{});await observed;assert.equal(settled,false,'posting a Stop must not complete its cross-port fence');assert(processor.inspector.read().channels[0].active);
  receive(delayed.data,delayed.port);assert.equal(await pending,true);assert.equal(settled,true);assert.equal(processor.inspector.read().auditions.length,0);assert.equal(peak(p.render(128).left),0);processor.inspector.invoke('auditionOn',[0,69,'new']);assert(peak(p.render(1024).left)>.01,'new admin audition survives after the acknowledged remote Stop');
});
test('SNES timed preset/note apply at reserved output frame and owner replacement cannot be released by old loop',async t=>{
  const p=await setup();t.after(()=>p.close());const sample=await p.client.loadBRR(brr,{rootNote:60,loopStartSamples:0});
  const messages=[],port={postMessage:m=>messages.push(m)},processor=p.processor;
  processor.receive({type:'performance-start',session:1},port);
  processor.receive({performance:{session:1,owner:'old',time:64/48000},commands:[{method:'setPreset',args:[0,{sample,gain:127}]},{method:'noteOn',args:[0,'C4']}]},port);
  assert.equal(processor.synth.getPreset(0).sample,null);assert.equal(peak(p.render(64).left),0);p.render(1);
  assert.equal(processor.synth.getPreset(0).sample,0,'preset appears only at output frame64');assert.equal(processor.synth.koff,254);
  processor.receive({performance:{session:1,owner:'new',time:128/48000},commands:[{method:'noteOn',args:[0,'E4']}]},port);
  p.render(128);assert.equal(processor.synth.koff,254);
  processor.receive({type:'performance-cancel-owner',session:1,owner:'old'},port);assert.equal(processor.synth.koff,254,'old owner cannot release new note');
  processor.receive({type:'performance-cancel-owner',session:1,owner:'new'},port);assert.equal(processor.synth.koff,255,'new owner cancellation emits SNES KOFF');
});
test('SNES future uploads stay ready, owner-cancelled notes and Stop cannot fire later',async t=>{
  const p=await setup();t.after(()=>p.close());const messages=[],port={postMessage:m=>messages.push(m)},processor=p.processor;
  processor.receive({type:'performance-start',session:2},port);
  processor.receive({performance:{session:2,owner:'old',time:.5},commands:[{method:'loadBRR',args:[brr,{rootNote:60,loopStartSamples:0}],id:10}]},port);
  assert.equal(messages.find(m=>m.id===10)?.value.id,0,'resource upload resolves before future performance');
  processor.receive({performance:{session:2,owner:'old',time:.5},commands:[{method:'setPreset',args:[0,{sample:0}]},{method:'noteOn',args:[0,'C4']}]},port);
  processor.receive({type:'performance-cancel-owner',session:2,owner:'old'},port);assert.equal(processor.performance.getStats().queuedCommands,0);
  assert.equal(peak(p.render(24001).left),0);
  processor.receive({performance:{session:2,owner:'new',time:1},commands:[{method:'setPreset',args:[0,{sample:0}]},{method:'noteOn',args:[0,'C4']}]},port);
  processor.receive({type:'performance-stop',session:2},port);assert.equal(processor.performance.getStats().queuedCommands,0);assert.equal(peak(p.render(24001).left),0);
});

async function timeline(p,frames=2048) {
  const core=await SpcCore.create({moduleFactory:p.factory,moduleOptions:{wasmBinary:p.wasmBinary}});
  try {
    core.load(createSyntheticSpc({echo:true,pmon:true,voices:2}));core.beginTrace();
    core.renderInto(new Float32Array(frames),new Float32Array(frames));
    return core.endTrace();
  } finally {core.dispose();}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

for(const rate of [32000,44100,48000])test(`editable SNES timeline Worklet matches accurate native replay at ${rate} Hz and awaits output completion`,async t=>{
  const p=await setup(rate);t.after(()=>p.close());const trace=await timeline(p),events=[];
  // A deliberately sub-frame edit proves event clocks are not PCM-frame indices.
  for(let i=0;i<trace.events.length;i+=4)events.push(Array.from(trace.events.subarray(i,i+4)));
  events.push([512*32+7,0,0x0c,16]);events.sort((a,b)=>a[0]-b[0]);trace.events=new Uint32Array(events.flat());
  const original=trace.events.slice();
  const prepared=await p.client.prepareTimeline(trace);assert.equal(prepared.loaded,true);assert.equal(prepared.playing,false);
  assert.deepEqual(trace.events,original,'upload never detaches caller-owned editable events');
  assert.equal(peak(p.render(128).left),0,'preparing data cannot start playback');
  assert.throws(()=>p.client.writeDsp(0x0c,127),/exclusive/);
  await assert.rejects(p.client.loadBRR(brr,{rootNote:60,loopStartSamples:0}),/exclusive/);
  const reference=await SnesDspCore.create({moduleFactory:p.factory,moduleOptions:{wasmBinary:p.wasmBinary}});t.after(()=>reference.dispose());
  reference.loadTimeline(trace);const resampler=new SpcResampler(reference,rate,{sourceFrames:128});
  let complete=false;const completion=p.client.playTimeline().then(state=>{complete=true;return state;});
  assert.equal((await p.client.getTimelineState()).playing,true);assert.equal(complete,false);
  const count=Math.ceil(2048*rate/32000)+128,partitions=[1,127,53,128];let rendered=0,index=0,max=0;
  while(rendered<count){
    const frames=Math.min(partitions[index++%partitions.length],count-rendered);
    const actual=p.render(frames),left=new Float32Array(frames),right=new Float32Array(frames);resampler.render(left,right);
    assert.deepEqual(actual.left,left);assert.deepEqual(actual.right,right);max=Math.max(max,peak(left));rendered+=frames;
    if(rendered<2048*rate/32000-128){await tick();assert.equal(complete,false,'the RPC waits past command acceptance until the audible end');}
  }
  const ended=await completion;assert.equal(ended.ended,true);assert.equal(ended.playing,false);assert.ok(max>.01);
  p.client.reset();const sample=await p.client.loadBRR(brr,{rootNote:60,loopStartSamples:0});
  p.client.setPreset(0,{sample});p.client.noteOn(0,'C4');await p.client.getState();assert.ok(peak(p.render(1024).left)>.01,'reset restores normal instrument control');
});

test('SNES timeline Stop aborts completion, flushes buffered output and permits a clean restart',async t=>{
  const p=await setup();t.after(()=>p.close());const trace=await timeline(p,8192);await p.client.prepareTimeline(trace);
  const rejected=assert.rejects(p.client.playTimeline(),{name:'AbortError'});await p.client.getTimelineState();
  const first=p.render(128);assert.ok(peak(first.left)>.01);
  await p.client.stopTimeline();await rejected;assert.equal(peak(p.render(128).left),0);
  const replay=p.client.playTimeline();await p.client.getTimelineState();assert.deepEqual(p.render(128).left,first.left);
  const cancelled=assert.rejects(replay,/disposed/);p.client.dispose();await cancelled;
});

test('SNES reset or a replacement upload fences late timeline preparation replies',async t=>{
  const p=await setup();t.after(()=>p.close());const trace=await timeline(p);
  const stale=p.client.prepareTimeline(trace);p.client.reset();
  await assert.rejects(stale,{name:'AbortError'});await p.client.getState();
  assert.throws(()=>p.client.playTimeline(),/Prepare/);
  const first=p.client.prepareTimeline(trace),second=p.client.prepareTimeline(trace);
  await assert.rejects(first,{name:'AbortError'});assert.equal((await second).loaded,true);
  const prepared=p.client.prepareTimeline(trace),stopped=p.client.stopTimeline();
  await assert.rejects(prepared,{name:'AbortError'});assert.equal((await stopped).playing,false);
});

test('Worker timeline owners cancel pending or active completion without stopping a replacement owner',async t=>{
  const p=await setup();t.after(()=>p.close());await p.client.prepareTimeline(await timeline(p,8192));
  const messages=[],port={postMessage:message=>messages.push(message)},processor=p.processor;
  processor.receive({type:'performance-start',session:10},port);
  processor.receive({performance:{session:10,owner:'pending',time:1},commands:[{method:'playTimeline',args:[],id:1}]},port);
  assert.equal(messages.some(message=>message.id===1),false,'acceptance does not resolve a playback completion promise');
  processor.receive({type:'performance-cancel-owner',session:10,owner:'pending'},port);
  assert.match(messages.find(message=>message.id===1)?.error,/cancelled/);assert.equal(messages.find(message=>message.id===1)?.name,'AbortError');assert.equal(peak(p.render(128).left),0);
  const start=(owner,id)=>processor.receive({performance:{session:10,owner,time:p.scope.currentFrame/48000},commands:[{method:'playTimeline',args:[],id}]},port);
  start('old',2);p.render(128);assert.equal(processor.synth.getTimelineState().playing,true);
  start('new',3);p.render(128);assert.equal(messages.find(message=>message.id===2)?.name,'AbortError');
  processor.receive({type:'performance-cancel-owner',session:10,owner:'old'},port);assert.equal(processor.synth.getTimelineState().playing,true);
  processor.receive({type:'performance-cancel-owner',session:10,owner:'new'},port);assert.equal(processor.synth.getTimelineState().playing,false);
  assert.equal(messages.find(message=>message.id===3)?.name,'AbortError');assert.equal(peak(p.render(128).left),0);
  start('final',4);p.render(128);processor.receive({type:'performance-stop',session:10},port);
  assert.equal(messages.find(message=>message.id===4)?.name,'AbortError');assert.equal(peak(p.render(128).left),0);
});
