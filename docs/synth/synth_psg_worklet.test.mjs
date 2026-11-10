import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js';
import factory from '../generated/segapsg_wasm.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';
import {normalizeSynthPsgSettings} from './synth_psg.js';

class Port {
  constructor(){this.messages=[];this.closed=false;this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
  postMessage(data){this.messages.push(data);if(data.ready)this.resolve();if(data.error)this.reject(Error(data.error));}
  close(){this.closed=true;}start(){}
}
let Processor;
const globals=['AudioWorkletProcessor','registerProcessor'];
const previous=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
globalThis.AudioWorkletProcessor=class{constructor(){this.port=new Port();}};
globalThis.registerProcessor=(name,processor)=>{assert.equal(name,'tetorica-segapsg');Processor=processor;};
try {await import('./synth_psg_worklet.js');}
finally {for(const [name,descriptor]of previous)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}
const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
async function worklet() {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'sampleRate');globalThis.sampleRate=48000;
  let processor;
  try {processor=new Processor({processorOptions:{wasmBinary,clock:SEGAPSG_CLOCK,stereoEnabled:false}});}
  finally {previous?Object.defineProperty(globalThis,'sampleRate',previous):delete globalThis.sampleRate;}
  await processor.port.ready;
  return processor;
}
const send=(processor,method,args=[],extra={})=>processor.receive({method,args,...extra},processor.port);
const generate=(processor,count)=>{
  const left=new Float32Array(count),right=new Float32Array(count);
  for(let start=0;start<count;start+=128)assert(processor.process([],[[left.subarray(start,Math.min(count,start+128)),right.subarray(start,Math.min(count,start+128))]]));
  return {left,right};
};

test('private worklet schedules a complete event stream, reports its end and rejects stale playback after stop/reset',async()=>{
  const processor=await worklet();
  const doc={format:'tetorica-sega-psg-recording-v1',version:1,durationSeconds:.15,
    initialState:{settings:normalizeSynthPsgSettings({attenuation:3,envelope:{enabled:true,attackMs:0,decayMs:0,sustain:100,releaseMs:70}}),pitchClock:7670454},
    commands:[{time:0,type:'noteOn',channel:0,block:4,fnum:1083},{time:.02,type:'noteOff',channel:0}]};
  try {
    send(processor,'playRecording',[1,doc,{loop:true}]);assert(generate(processor,1000).left.some(x=>x!==0));
    send(processor,'stopRecording',[2]);assert(generate(processor,2000).left.every(x=>x===0));
    send(processor,'playRecording',[1,doc,{loop:true}]);assert(generate(processor,1000).left.every(x=>x===0));
    send(processor,'playRecording',[3,doc,{loop:false}]);const pcm=generate(processor,11000).left;
    assert(pcm.subarray(0,800).some(x=>x!==0));assert(pcm.subarray(8000).every(x=>x===0));
    assert.deepEqual(processor.port.messages.filter(value=>value.type==='psg-recording-ended'),[{type:'psg-recording-ended',session:3}]);
    send(processor,'playRecording',[4,doc,{loop:true}]);generate(processor,128);send(processor,'reset');
    assert(!processor.player.snapshot().playing);assert(generate(processor,1000).left.every(x=>x===0));
    send(processor,'playRecording',[4,doc,{loop:true}]);assert(generate(processor,1000).left.every(x=>x===0));
    send(processor,'playRecording',[5,doc,{loop:true}]);generate(processor,128);send(processor,'allNotesOff');assert(generate(processor,1000).left.every(x=>x===0));
    send(processor,'playRecording',[6,doc,{loop:true}]);generate(processor,128);send(processor,'dispose');assert(!processor.player.snapshot().playing);assert(processor.dead);
  } finally {processor.dispose();}
});

test('private worklet Envelope Off generates the exact shared PSG PCM for ordinary tone/noise commands',async()=>{
  const processor=await worklet(),chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000,clock:SEGAPSG_CLOCK});
  try {
    const direct=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>chip.write(value)});
    const routed=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>send(processor,'write',[value])});
    for(const api of [direct,routed]){api.allNotesOff();api.tone(0,{frequency:440,attenuation:6});api.tone(2,{frequency:660,attenuation:9});api.noise({type:'white',rate:'medium',attenuation:12});}
    assert.deepEqual(generate(processor,12000),chip.generateStereo(12000));
    send(processor,'allNotesOff');assert(generate(processor,1000).left.every(value=>value===0));
  } finally {processor.dispose();chip.dispose();}
});

test('software attenuation cannot redirect a split tone high byte into an unrelated PSG volume register',async()=>{
  const processor=await worklet();
  try {
    for(const value of [0x9f,0xbf,0xdf,0xff,0x8a,0x23,0xc4,0x12])send(processor,'write',[value]);
    send(processor,'envelopeNoteOn',[2,{enabled:true,attackMs:10,decayMs:20,sustain:70,releaseMs:200},0]);
    send(processor,'write',[0x8c]);
    generate(processor,128);assert.equal(processor.latched,5,'the audio-rate envelope selected Tone3 attenuation');
    send(processor,'write',[0x15],{psgRegister:0});
    assert.equal(processor.periods[0],0x15c,'tone0 keeps both the preceding low nibble and intended high data');
    assert.equal(processor.periods[2],0x124,'the independent modulated voice retains its oscillator period');
    send(processor,'envelopeNoteOff',[2]);generate(processor,1024);
    send(processor,'stopEnvelopes');assert.equal(processor.envelope.snapshot().voices.length,0);
    assert(generate(processor,4000).left.every(value=>value===0),'no stopped release can write an audible level later');
  } finally {processor.dispose();}
});

test('reset, retirement and invalid control cannot leave a running software release',async()=>{
  const processor=await worklet();
  send(processor,'envelopeNoteOn',[3,{enabled:true,attackMs:0,decayMs:0,sustain:100,releaseMs:5000},0]);
  send(processor,'envelopeNoteOff',[3]);generate(processor,1000);
  send(processor,'reset');assert.equal(processor.envelope.snapshot().voices.length,0);
  send(processor,'envelopeNoteOn',[0,{enabled:true,attackMs:0,decayMs:0,sustain:100,releaseMs:5000},0]);
  const chip=processor.chip;
  send(processor,'dispose');assert.equal(processor.envelope.snapshot().voices.length,0);assert.equal(chip.handle,0);assert.equal(processor.process([],[[new Float32Array(128),new Float32Array(128)]]),false);
  send(processor,'envelopeNoteOn',[0,{enabled:true},0]);assert.equal(processor.envelope.snapshot().voices.length,0);
  const invalid=await worklet();send(invalid,'envelopeNoteOn',[0,{enabled:'invalid'},0]);
  assert.equal(invalid.dead,true);assert(invalid.port.messages.some(message=>message.fatal&&message.error));
});
