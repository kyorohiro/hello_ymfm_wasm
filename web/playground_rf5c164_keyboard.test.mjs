import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/rf5c164_wasm.js';
import {Rf5c164} from './rf5c164.js';
import {createRf5c164Control,createRf5c164Client} from './playground_rf5c164.js';
import {RfInspectorState,receiveChipInspector,rfSampleMetadata} from './playground_chip_inspector_state.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {RF5C164Synth} from './rf5c164synth.js';
import {ChipClockResampler,CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js';

const RATE=48000,wasmBinary=await readFile(new URL('../docs/generated/rf5c164_wasm.wasm',import.meta.url));
const source=(await readFile(new URL('./rf5c164-worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
async function setup(){
  let Processor,current=0,readyResolve;const messages=[],ready=new Promise(resolve=>readyResolve=resolve);
  vm.runInNewContext(source,{Rf5c164,factory,RfInspectorState,receiveChipInspector,rfSampleMetadata,createRf5c164Control,RF5C164Synth,ChipClockResampler,CHIP_CLOCKS,validateChipClock,sampleRate:RATE,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>current}),
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>{messages.push(data);if(data.ready||data.error)readyResolve(data);}};}},registerProcessor(_name,Type){Processor=Type;}});
  const processor=new Processor({processorOptions:{wasmBinary}});assert.equal((await ready).ready,true);
  const port={postMessage:data=>messages.push(data)},request=(action,method,args=[])=>{processor.receive({type:'chip-inspector',id:'admin',action,method,args},port);const reply=messages.at(-1);if(reply.error)throw Error(reply.error);return reply.value;};
  return {processor,messages,port,read:()=>request('read'),invoke:(method,args)=>request('invoke',method,args),receive:data=>processor.receive(data,port),render(frames){const left=new Float32Array(frames),right=new Float32Array(frames);processor.process([],[[left,right]]);current+=frames;return[left,right];}};
}
const peak=values=>values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
function configure(p){
  const wave=Uint8Array.from({length:129},(_,i)=>i===128?255:Math.round(Math.abs(Math.sin(i*2*Math.PI/128))*100)|(Math.sin(i*2*Math.PI/128)>=0?128:0));
  p.processor.control.loadMemory(wave,0);
  for(let channel=0;channel<8;channel++)p.processor.control.setChannel(channel,{start:0,loopStart:0,step:2048,volume:80,pan:{left:15,right:0}});
}

test('RF Keyboard reaches all eight loaded PCM channels and octave notes retain their configured reference step',async t=>{
  const p=await setup();t.after(()=>p.processor.dispose());configure(p);
  const before=p.read();
  for(let channel=0;channel<8;channel++){
    p.invoke('auditionOn',[channel,60,`base-${channel}`]);assert.equal(p.read().channels[channel].step,2048);
    let pcm=p.render(4800);assert(peak(pcm[0])>.01);assert.equal(peak(pcm[1]),0);
    p.invoke('auditionOn',[channel,72,`high-${channel}`]);assert.equal(p.read().channels[channel].step,4096);
    assert.equal(p.invoke('auditionOff',[channel,`base-${channel}`]),false);assert(p.read().channels[channel].active);
    pcm=p.render(4800);assert(pcm.every(values=>values.every(value=>Number.isFinite(value)&&Math.abs(value)<1)));
    p.invoke('auditionOff',[channel,`high-${channel}`]);p.render(128);assert.equal(peak(p.render(128)[0]),0);
    p.invoke('auditionOn',[channel,60,`return-${channel}`]);assert.equal(p.read().channels[channel].step,2048);p.invoke('auditionOff',[channel,`return-${channel}`]);
  }
  const after=p.read();assert.equal(after.memoryRevision,before.memoryRevision);assert.deepEqual(after.memoryRanges,before.memoryRanges);assert.deepEqual(after.samples,before.samples);
  assert.deepEqual(after.channels,before.channels);
});

test('RF manual channel leases protect pitch, RAM and raw mask while another code channel keeps playing',async t=>{
  const p=await setup();t.after(()=>p.processor.dispose());configure(p);p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[7,60,'manual']);
  p.receive({performance:{session:1,owner:'code',time:0},commands:[
    {method:'setChannel',args:[7,{step:999,volume:1}]},{method:'keyOff',args:[7]},
    {method:'writeRegister',args:[7,0xc7]},{method:'writeRegister',args:[2,44]},{method:'writeRegister',args:[8,255]},
    {method:'setChannel',args:[1,{step:3072,pan:{left:0,right:15}}]},{method:'keyOn',args:[1]},
    {method:'loadMemory',args:[Uint8Array.of(255),0],id:93},
  ]});
  p.render(128);let state=p.read();assert.equal(state.channels[7].step,2048);assert.equal(state.channels[7].volume,80);assert(state.channels[7].active);assert(state.channels[1].active);assert.equal(state.channels[1].step,3072);assert.equal(state.memoryRevision,1);assert(p.messages.some(message=>message.id===93&&!message.error),'blocked immediate RAM load still acknowledges acceptance');
  p.receive({method:'writeRegister',args:[8,255],id:94});state=p.read();assert(state.channels[7].active);assert(!state.channels[1].active);assert(p.messages.some(message=>message.id===94&&!message.error));
  p.receive({method:'writeRegister',args:[7,0x47]});assert.equal(p.read().enabled,true,'a code global-disable cannot mute the held manual channel');
  p.invoke('auditionOn',[7,72,'new']);assert.equal(p.invoke('auditionOff',[7,'manual']),false);p.invoke('auditionOff',[7,'new']);p.render(128);assert.equal(peak(p.render(128)[0]),0);
});

test('RF Stop ACK cancels future notes and old identities while preserving loaded material and channel settings',async t=>{
  const p=await setup();t.after(()=>p.processor.dispose());configure(p);p.receive({type:'performance-start',session:8});p.invoke('auditionOn',[6,60,'before-stop']);
  const before=p.read();p.receive({performance:{session:8,owner:'late',time:2},commands:[{method:'keyOn',args:[6]}]});
  let delayed,settled=false,ackObserved=false;const direct={onmessage:null,start(){},close(){},postMessage:data=>{if(data.method==='stopVoices')delayed=data;else p.processor.receive(data,reply);}},reply={postMessage:data=>{if(data.id===delayed?.id){assert(p.read().channels.every(channel=>!channel.active));assert.equal(p.read().auditions.length,0);ackObserved=true;}direct.onmessage?.({data});}};
  const client=createRf5c164Client(direct,async()=>{throw Error('unused');});t.after(()=>client.dispose());
  const stop=client._stopVoices().then(value=>{settled=true;return value;});await Promise.resolve();assert(delayed?.id);assert.equal(settled,false);client._cancelClockRequests('stopped');assert.equal(settled,false);
  p.processor.receive(delayed,reply);assert.equal(await stop,true);assert(ackObserved);assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[6,'before-stop']),false);assert.equal(peak(p.render(RATE*3)[0]),0);
  const after=p.read();assert.deepEqual(after.channels,before.channels.map(channel=>({...channel,active:false})));assert.deepEqual(after.samples,before.samples);assert.deepEqual(after.memoryRanges,before.memoryRanges);assert.equal(after.memoryRevision,before.memoryRevision);
  p.receive({type:'performance-start',session:9});p.invoke('auditionOn',[6,60,'after-stop']);p.receive({type:'performance-stop',session:8});assert(p.read().channels[6].active);assert(peak(p.render(2048)[0])>.01);p.invoke('auditionOff',[6,'after-stop']);assert.equal(peak(p.render(128)[0]),0);
  const pending=client._stopVoices();client.dispose();await assert.rejects(pending,/disposed/);
});
