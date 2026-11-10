// Native PCM is generated only into arrays; no device or AudioContext exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/rf5c164_wasm.js';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js';
import {createPcmBuiltinPreset,createSynthPcmVoice,createPcmPreset,buildPcmMemory,PCM_ENCODING,PCM_NATIVE_RATE} from './synth_pcm.js';
import {createSynthPcmRecordingPlayer,PCM_RECORDING_MAX_COMPILED_BYTES} from './synth_pcm_recording_player.js';
import {prepareSynthPcmRecording} from './synth_pcm_recording_prepare.js';
import {Worker} from 'node:worker_threads';

const RATE=48000,CLOCK=7670454;
const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
const preset=createPcmBuiltinPreset('sine');
const recording=(commands,durationSeconds=.16,initial=preset)=>({format:'tetorica-rf5c164-recording-v1',version:1,
  durationSeconds,initialState:{preset:structuredClone(initial),pitchClock:CLOCK},commands});
const note=(time,channel=0)=>({time,type:'noteOn',channel,block:4,fnum:644});
const off=(time,channel=0)=>({time,type:'noteOff',channel});
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
async function native() {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE});
  const pcm=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)}),ended=[];
  const player=createSynthPcmRecordingPlayer({sampleRate:RATE,pcm,onEnded:session=>ended.push(session)});
  const render=(left,right)=>{const output=chip.generateStereo(left.length);left.set(output.left);right.set(output.right);};
  function generate(frames,chunk=128) {
    const left=new Float32Array(frames),right=new Float32Array(frames);
    for(let start=0;start<frames;start+=chunk)player.render(left.subarray(start,Math.min(frames,start+chunk)),right.subarray(start,Math.min(frames,start+chunk)),render);
    return {left,right};
  }
  return {chip,pcm,player,ended,generate,dispose(){player.stop();chip.dispose();}};
}
async function manual(value,frames) {
  const h=await native(),doc=structuredClone(value),left=new Float32Array(frames),right=new Float32Array(frames);
  try {
    h.pcm.reset();const voice=createSynthPcmVoice({getPcm:()=>h.pcm,getPitchClock:()=>doc.initialState.pitchClock,preset:doc.initialState.preset});await voice.install();
    let cursor=0;
    for(const command of doc.commands) {
      const at=Math.round(command.time*RATE),count=at-cursor;
      if(count){const output=h.chip.generateStereo(count);left.set(output.left,cursor);right.set(output.right,cursor);cursor=at;}
      if(command.type==='noteOn')voice.noteOn(command.channel,command.block,command.fnum);
      else if(command.type==='noteOff')voice.noteOff(command.channel);
      else if(command.type==='setFrequency')voice.setFrequency(command.channel,command.block,command.fnum);
      else if(command.type==='stop')voice.stop();
      else if(command.type==='setPreset'){voice.setPreset(command.preset);await voice.install();}
      else {voice.setSettings(command.settings);if(!voice.isReady())await voice.install();}
    }
    if(cursor<frames){const output=h.chip.generateStereo(frames-cursor);left.set(output.left,cursor);right.set(output.right,cursor);}
    return {left,right};
  } finally{h.dispose();}
}

// Independent native reference: update marker RAM and loop registers directly,
// without using the editor voice or the recording player's settings logic.
async function manualMemoryEdits(doc,frames) {
  const h=await native(),left=new Float32Array(frames),right=new Float32Array(frames),held=new Map();
  let current=structuredClone(doc.initialState.preset),cursor=0;
  const step=note=>Math.max(1,Math.min(65535,Math.round(current.sample.sampleRate/PCM_NATIVE_RATE*2048*
    (note.fnum*doc.initialState.pitchClock*2**(note.block-1)/(144*2**20))/(440*2**((current.settings.rootNote-69)/12)))));
  const channelSettings=note=>({volume:current.settings.volume,pan:{left:current.settings.panLeft,right:current.settings.panRight},
    loopStart:current.settings.loopEnabled?current.settings.loopStart:current.settings.loopEnd+1,step:step(note)});
  try {
    h.pcm.reset();h.pcm.loadMemory(buildPcmMemory(current),0);
    for(const command of doc.commands) {
      const at=Math.round(command.time*RATE),count=at-cursor;
      if(count){const output=h.chip.generateStereo(count);left.set(output.left,cursor);right.set(output.right,cursor);cursor=at;}
      if(command.type==='setSettings') {
        current={...current,settings:command.settings};h.pcm.loadMemory(buildPcmMemory(current),0);
        for(const [channel,note]of held)h.pcm.setChannel(channel,channelSettings(note));
      } else if(command.type==='noteOn') {
        h.pcm.setChannel(command.channel,{start:0,...channelSettings(command)});h.pcm.keyOn(command.channel);held.set(command.channel,command);
      } else if(command.type==='noteOff') {h.pcm.keyOff(command.channel);held.delete(command.channel);}
      else throw new Error('Unexpected direct marker-edit reference command');
    }
    if(cursor<frames){const output=h.chip.generateStereo(frames-cursor);left.set(output.left,cursor);right.set(output.right,cursor);}
    return {left,right};
  } finally {h.dispose();}
}

test('native sample-clock PCM matches manually applied editor operations across event and render boundaries',async()=>{
  const a=await native(),b=await native();
  try {
    const changed={...preset.settings,volume:96,panLeft:0,panRight:15,rootNote:72,loopStart:16};
    const shorter={...changed,loopEnd:128},saw=createPcmBuiltinPreset('saw');
    const doc=recording([note(.0027),note(.0049,7),{time:.02165,type:'setSettings',settings:changed},
      {time:.0321,type:'setFrequency',channel:0,block:5,fnum:644},off(.041,7),
      {time:.06,type:'setSettings',settings:shorter},note(.065,2),{time:.09,type:'setPreset',preset:saw},
      note(.097,7),off(.14,7),{time:.15,type:'stop'}]);
    const original=structuredClone(doc),compiled=prepareSynthPcmRecording(doc,{sampleRate:RATE});
    assert.equal(compiled.banks.length,3,'volume / Pan / root changes reuse banks; End and sample edits prepare banks');
    assert.equal(compiled.byteLength,3*65536);
    a.player.play(compiled,{session:1});b.player.play(prepareSynthPcmRecording(doc,{sampleRate:RATE}),{session:1});
    const actual=a.generate(7680,128),other=b.generate(7680,71),expected=await manual(doc,7680);
    assert.deepEqual(actual,expected);assert.deepEqual(actual,other);assert.deepEqual(doc,original);
    assert(actual.left.subarray(0,Math.round(.0027*RATE)).every(value=>value===0),'no note before its sample-clock frame');
    assert(rms(actual.right.subarray(160,800))>.001);assert(actual.left.subarray(2000,2800).every(value=>value===0),'right-only Pan applies to held notes');
    assert(actual.left.subarray(6800).every(value=>value===0));assert(actual.left.every(Number.isFinite));
  } finally{a.dispose();b.dispose();}
});

test('eight physical channels, retrigger and stops preserve actual native output without remapping',async()=>{
  const h=await native();
  try {
    const commands=Array.from({length:8},(_,channel)=>note(0,channel));commands.push(...Array.from({length:8},(_,channel)=>off(.025,channel)),note(.04,7),note(.05,7),off(.07,7));
    const doc=recording(commands,.08),expected=await manual(doc,5000);h.player.play(prepareSynthPcmRecording(doc,{sampleRate:RATE}),{session:1});
    const actual=h.generate(5000);assert.deepEqual(actual,expected);assert(rms(actual.left.subarray(0,1000))>.1);
    assert(actual.left.subarray(3900).every(value=>value===0));assert.deepEqual(h.ended,[1]);
  }finally{h.dispose();}
});

test('eight held voices preserve native playback positions through Loop End shrink and grow without retriggering',async()=>{
  const h=await native(),other=await native();
  try {
    const edits=[[.01273,64,0],[.0337,224,16],[.05,128,32],[.07,256,0]];
    const doc=recording([...Array.from({length:8},(_,channel)=>note(0,channel)),
      ...edits.map(([time,loopEnd,loopStart])=>({time,type:'setSettings',settings:{...preset.settings,loopEnd,loopStart}})),
      ...Array.from({length:8},(_,channel)=>off(.09,channel))],.11);
    const prepared=prepareSynthPcmRecording(doc,{sampleRate:RATE});
    h.player.play(prepared,{session:1});other.player.play(prepared,{session:1});
    const ons=[],offs=[],keyOn=h.pcm.keyOn.bind(h.pcm),keyOff=h.pcm.keyOff.bind(h.pcm);
    h.pcm.keyOn=channel=>{ons.push(channel);return keyOn(channel);};h.pcm.keyOff=channel=>{offs.push(channel);return keyOff(channel);};
    const actual=h.generate(4800,128),expected=await manualMemoryEdits(doc,4800);
    assert.deepEqual(actual,expected);assert.deepEqual(actual,other.generate(4800,71));
    assert.deepEqual(ons,[0,1,2,3,4,5,6,7]);assert.deepEqual(offs,[0,1,2,3,4,5,6,7]);
    for(const [time]of edits){const start=Math.round(time*RATE)+8;assert(rms(actual.left.subarray(start,start+240))>.02);}
    assert.deepEqual(h.player.snapshot().heldChannels,[]);assert(actual.left.subarray(4400).every(value=>value===0));
  } finally {h.dispose();other.dispose();}
});

test('held one-shot End edits match marker RAM behavior including expansion after the old silent end',async()=>{
  const h=await native();
  try {
    const oneShot=createPcmBuiltinPreset('sine');oneShot.settings={...oneShot.settings,loopEnabled:false,loopEnd:64};
    const doc=recording([note(0,7),{time:.02,type:'setSettings',settings:{...oneShot.settings,loopEnd:224}},
      {time:.04,type:'setSettings',settings:{...oneShot.settings,loopEnd:32}},off(.06,7)],.08,oneShot);
    h.player.play(prepareSynthPcmRecording(doc,{sampleRate:RATE}),{session:1});
    const actual=h.generate(3840,71),expected=await manualMemoryEdits(doc,3840);
    assert.deepEqual(actual,expected);assert(actual.left.subarray(500,950).every(value=>value===0));
    assert(rms(actual.left.subarray(970,1020))>.01,'growing End restores sample bytes under the parked hardware cursor');
    assert(actual.left.subarray(1500).every(value=>value===0));assert.deepEqual(h.player.snapshot().heldChannels,[]);
  } finally {h.dispose();}
});

test('loop cycles reload their initial RAM and phase, and newer stops defeat stale plays',async()=>{
  const h=await native();
  try {
    const saw=createPcmBuiltinPreset('saw'),doc=recording([note(0),off(.02),{time:.03,type:'setPreset',preset:saw},note(.04,7),off(.06,7)],.08);
    const prepared=prepareSynthPcmRecording(doc,{sampleRate:RATE});h.player.play(prepared,{session:1,loop:true});
    const cycle=h.player.snapshot().cycleFrames,output=h.generate(cycle*3,127);
    assert.deepEqual(output.left.subarray(0,cycle),output.left.subarray(cycle,cycle*2));
    assert.deepEqual(output.right.subarray(0,cycle),output.right.subarray(cycle*2));assert.deepEqual(h.ended,[]);
    h.player.stop(3);assert(h.generate(1000).left.every(value=>value===0));assert.equal(h.player.play(prepared,{session:2}),false);
    h.player.play(prepareSynthPcmRecording(recording([note(0)],0),{sampleRate:RATE}),{session:4,loop:true});h.generate(2000);assert(h.player.snapshot().cycle>1);
    assert.equal(h.player.stop(2),false);assert(h.player.snapshot().playing);h.player.stop(5);assert(h.generate(1000).left.every(value=>value===0));
  }finally{h.dispose();}
});

test('Use current sound ignores recorded sample and settings while keeping all note channel / pitch events',async()=>{
  const h=await native(),other=await native();
  try {
    const current=createPcmBuiltinPreset('square');current.settings.panLeft=0;current.settings.panRight=15;
    const doc=recording([note(0,7),{time:.012,type:'setSettings',settings:{...preset.settings,volume:0}},
      {time:.02,type:'setFrequency',channel:7,block:5,fnum:644},off(.06,7)],.08);
    const reference=recording([note(0,7),{time:.02,type:'setFrequency',channel:7,block:5,fnum:644},off(.06,7)],.08,current);
    h.player.play(prepareSynthPcmRecording(doc,{sampleRate:RATE,ignorePatch:true,preset:current,pitchClock:CLOCK}),{session:1});
    other.player.play(prepareSynthPcmRecording(reference,{sampleRate:RATE}),{session:1});
    const actual=h.generate(4800);assert.deepEqual(actual,other.generate(4800));assert(actual.left.every(value=>value===0));assert(rms(actual.right.subarray(1000,2500))>.01);
    assert.equal(current.settings.volume,64);
  }finally{h.dispose();other.dispose();}
});

test('one-shot maximum-step samples finish silently while a key remains held, and can be retriggered',async()=>{
  const h=await native();
  try {
    const sample={name:'One frame',sampleRate:48000,encoding:PCM_ENCODING,data:btoa(String.fromCharCode(254))};
    const initial=createPcmPreset({sample,settings:{loopEnabled:false,rootNote:0}});
    const doc=recording([{...note(0,7),block:7,fnum:2047},{...note(.04,7),block:7,fnum:2047},off(.06,7)],.08,initial);
    h.player.play(prepareSynthPcmRecording(doc,{sampleRate:RATE}),{session:1});const output=h.generate(4800);
    assert(output.left.subarray(0,100).some(value=>value>0));assert(output.left.subarray(500,1900).every(value=>value===0));
    assert(output.left.subarray(1920,2020).some(value=>value>0));assert(output.left.subarray(2400).every(value=>value===0));
  }finally{h.dispose();}
});

test('Use current sound retains sample-replacement stops and ignores Loop End edits without stopping notes',async()=>{
  const h=await native(),other=await native();
  try {
    const current=createPcmBuiltinPreset('square'),next=createPcmBuiltinPreset('saw');
    const doc=recording([note(0),{time:.02,type:'setPreset',preset:next},note(.04,7),
      {time:.06,type:'setSettings',settings:{...next.settings,loopEnd:128}},note(.075,3),off(.09,3)],.1);
    const reference=recording([note(0),{time:.02,type:'stop'},note(.04,7),note(.075,3),off(.09,3)],.1,current);
    const prepared=prepareSynthPcmRecording(doc,{sampleRate:RATE,ignorePatch:true,preset:current,pitchClock:CLOCK});
    assert.deepEqual(prepared.events.map(event=>event.type),['noteOn','stop','noteOn','noteOn','noteOff']);
    h.player.play(prepared,{session:1});
    other.player.play(prepareSynthPcmRecording(reference,{sampleRate:RATE}),{session:1});
    const actual=h.generate(6000);assert.deepEqual(actual,other.generate(6000));
    assert(actual.left.subarray(1100,1900).every(value=>value===0));assert(rms(actual.left.subarray(3000,3500))>.01);
  }finally{h.dispose();other.dispose();}
});

test('invalid transfers and compiled-memory overflow preserve an already playing private chip',async()=>{
  const h=await native();
  try {
    const doc=recording([note(0),off(.1)],.15),prepared=prepareSynthPcmRecording(doc,{sampleRate:RATE});h.player.play(prepared,{session:1,loop:true});h.generate(300);
    const before=h.player.snapshot();
    const incomplete={...prepared.initial,settings:{loopEnd:256}};
    for(const bad of [{...prepared,version:2},{...prepared,sampleRate:44100},{...prepared,durationFrames:-1},
      {...prepared,banks:[]},{...prepared,byteLength:1},{...prepared,events:[{frame:0,type:'unknown'}]},
      {...prepared,initial:incomplete},{...prepared,events:[{frame:0,type:'setSettings',configuration:incomplete}]},
      {...prepared,events:[{frame:0,type:'noteOn',channel:8,block:4,fnum:644}]}])assert.throws(()=>h.player.play(bad,{session:2}));
    assert.throws(()=>h.player.play(prepared,{session:2,loop:'yes'}));assert.deepEqual(h.player.snapshot(),before);assert(rms(h.generate(500).left)>.001);
    const large=createPcmBuiltinPreset('sine'),bytes=new Uint8Array(1024).fill(128);large.sample.data=btoa(String.fromCharCode(...bytes));large.settings.loopEnd=1024;
    const commands=[note(0),...Array.from({length:PCM_RECORDING_MAX_COMPILED_BYTES/65536+1},(_,index)=>({time:.01+index*.00001,type:'setSettings',settings:{...large.settings,loopEnd:index+1}}))];
    assert.throws(()=>prepareSynthPcmRecording(recording(commands,.1,large),{sampleRate:RATE}),/32 MiB/);assert(h.player.snapshot().playing);
  }finally{h.dispose();}
});

test('private Worklet module registers without main-thread text / abort / base64 globals',async()=>{
  const entry=new URL('./synth_pcm_recording_worklet.js',import.meta.url).href;
  const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      for(const name of ['TextEncoder','TextDecoder','AbortController','btoa','atob'])delete globalThis[name];
      globalThis.AudioWorkletProcessor=class {};
      globalThis.registerProcessor=(name,processor)=>parentPort.postMessage({name,valid:typeof processor==='function'});
      import(workerData).catch(error=>parentPort.postMessage({error:error.stack}));
    `,{eval:true,workerData:entry});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('Worklet module import timed out'));},10000);
    worker.once('message',message=>{clearTimeout(timer);worker.terminate();message.error?reject(Error(message.error)):resolve(message);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  assert.deepEqual(result,{name:'tetorica-synth-pcm-recording',valid:true});
});
