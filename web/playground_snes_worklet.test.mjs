import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SnesDspCore} from './spc.js';
import {SnesSynth} from './snessynth.js';
import {SpcResampler} from './spc_resampler.js';
import {createSnesClient} from './playground_snes.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
const brr=new Uint8Array([0xc3,0x12,0x34,0x56,0x76,0x54,0x32,0x10,0xfe]);
const peak=a=>a.reduce((max,n)=>Math.max(max,Math.abs(n)),0);
let binaries;
async function assets(){return binaries??=Promise.all([import('../docs/generated/spc_wasm.js').then(m=>m.default),readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url)),readFile(new URL('./playground_snes_worklet.js',import.meta.url),'utf8')]);}
async function setup(rate=48000) {
  const [factory,wasmBinary,source]=await assets(),main=new MessageChannel();let Processor;
  const scope={factory,SnesDspCore,SnesSynth,SpcResampler,sampleRate:rate,currentFrame:0,
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
