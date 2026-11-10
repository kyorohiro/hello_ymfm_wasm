import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js';
import factory from '../generated/segapsg_wasm.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';
import {normalizeSynthPsgSettings} from './synth_psg.js';
import {prepareSynthPsgLoopUnit} from './synth_psg_loop_player.js';

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

test('PSG output mutes preserve tone/noise phase, survive reset, and ignore later author attenuation writes',async()=>{
  for(const channel of [0,3]) {
    const processor=await worklet(),reference=await worklet();
    try {
      for(const target of [processor,reference]) {
        const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>send(target,'write',[value])});
        api.allNotesOff();if(channel===3)api.noise({type:'white',rate:'tone3',attenuation:2});else api.tone(0,{frequency:440,attenuation:2});
      }
      assert.deepEqual(generate(processor,301),generate(reference,301));
      send(processor,'setChannelMuted',[channel,true]);
      send(processor,'write',[0x90|(channel<<5)|5]);send(reference,'write',[0x90|(channel<<5)|5]);
      assert(generate(processor,1703).left.every(value=>value===0));generate(reference,1703);
      send(processor,'setChannelMuted',[channel,false]);assert.deepEqual(generate(processor,2000),generate(reference,2000),'unmute resumes the same phase, with the newest author attenuation');
      send(processor,'setChannelMuted',[channel,true]);send(processor,'reset');
      send(processor,'write',[0x90|(channel<<5)]);assert(generate(processor,1000).left.every(value=>value===0));
      assert.equal(processor.channelMutes[channel],true);
      processor.dispose();assert(processor.channelMutes.every(value=>value===false));
    } finally {processor.dispose();reference.dispose();}
  }
});

test('private worklet loops finite PCM with overlapping release tails; remove/stop/reset/dispose cannot revive old layers',async()=>{
  const processor=await worklet(),unit={id:'tail',left:new Float32Array(3600).fill(.125),right:new Float32Array(3600).fill(-.25),offsetSeconds:0};
  try {
    const prepared=await prepareSynthPsgLoopUnit(unit,{sampleRate:48000,loopLength:.05});
    send(processor,'startLooper',[1,{loopLength:.05,startTime:0}]);send(processor,'addPreparedLooperUnit',[1,prepared]);
    const pcm=generate(processor,4800);
    assert(pcm.left.subarray(0,2400).every(x=>x===.125));assert(pcm.left.subarray(2400,3600).every(x=>x===.25));
    assert(pcm.left.subarray(3600).every(x=>x===.125));assert(pcm.right.subarray(2400,3600).every(x=>x===-.5));
    send(processor,'removeLooperUnit',[1,'tail']);assert(generate(processor,256).left.every(x=>x===0));
    send(processor,'addLooperUnit',[1,structuredClone(unit)]);send(processor,'stopLooper',[2]);
    send(processor,'startLooper',[1,{loopLength:.05,startTime:0}]);send(processor,'addLooperUnit',[1,structuredClone(unit)]);
    assert(generate(processor,256).left.every(x=>x===0));
    send(processor,'startLooper',[3,{loopLength:.05,startTime:processor.renderedFrames/48000}]);send(processor,'addLooperUnit',[3,structuredClone(unit)]);
    assert(generate(processor,128).left.some(x=>x!==0));send(processor,'reset');assert(generate(processor,128).left.every(x=>x===0));
    send(processor,'addLooperUnit',[3,structuredClone(unit)]);assert(generate(processor,128).left.every(x=>x===0));
    send(processor,'startLooper',[4,{loopLength:.05,startTime:processor.renderedFrames/48000}]);send(processor,'addLooperUnit',[4,structuredClone(unit)]);
    send(processor,'allNotesOff');assert(generate(processor,128).left.every(x=>x===0));
    send(processor,'startLooper',[5,{loopLength:.05,startTime:processor.renderedFrames/48000}]);send(processor,'addLooperUnit',[5,structuredClone(unit)]);
    send(processor,'dispose');assert(!processor.loopPlayer.snapshot().playing);assert(processor.dead);
  } finally {processor.dispose();}
});

test('unexpected non-finite prepared PCM is silenced before it reaches any worklet output',async()=>{
  const processor=await worklet(),left=new Float32Array(2400).fill(.1),right=new Float32Array(2400).fill(.1);left[1]=NaN;
  send(processor,'startLooper',[1,{loopLength:.05,startTime:0}]);
  send(processor,'addPreparedLooperUnit',[1,{id:'invalid',left,right,offsetSeconds:0,frameCount:2400,prefixCount:1}]);
  const output=[new Float32Array(128),new Float32Array(128)];
  assert.equal(processor.process([],[output]),false);assert(output.every(channel=>channel.every(value=>value===0)));
  assert(processor.dead);assert(processor.port.messages.some(message=>message.fatal&&/prepared/.test(message.error)));
});

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
