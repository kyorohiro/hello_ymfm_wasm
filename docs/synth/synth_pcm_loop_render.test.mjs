// Native RF5C164 renders into numeric arrays only. No audio device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderSynthPcmLoop,SYNTH_PCM_LOOP_MAX_PCM_BYTES} from './synth_pcm_loop_render.js';
import {createPcmBuiltinPreset,createPcmPreset,createSynthPcmVoice,PCM_ENCODING} from './synth_pcm.js';
import {Rf5c164} from '../js/rf5c164.js?v=audio-stability-2';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js';
import factory from '../generated/rf5c164_wasm.js';

const RATE=48000;
const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
const sine=createPcmBuiltinPreset('sine');
const doc=(commands,durationSeconds=.2,preset=sine)=>({format:'tetorica-rf5c164-recording-v1',version:1,
  durationSeconds,initialState:{preset:structuredClone(preset),pitchClock:7670454},commands});
const on=(time,channel=0)=>({time,type:'noteOn',channel,block:4,fnum:644});
const off=(time,channel=0)=>({time,type:'noteOff',channel});
const options={sampleRate:RATE,moduleOptions:{wasmBinary},yieldControl:async()=>{}};
const rms=values=>Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);

async function reference(recording,block=71) {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE});
  const pcm=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)});
  const voice=createSynthPcmVoice({getPcm:()=>pcm,preset:recording.initialState.preset,getPitchClock:()=>recording.initialState.pitchClock});
  const body=Math.max(1,Math.ceil(recording.durationSeconds*RATE)),tail=Math.ceil(RATE/1000);
  const left=new Float32Array(body+tail),right=new Float32Array(body+tail);
  const render=(begin,end)=>{for(let at=begin;at<end;at+=block){const count=Math.min(end-at,block),output=chip.generateStereo(count);left.set(output.left,at);right.set(output.right,at);}};
  try {
    await voice.install();let cursor=0;
    for(const command of recording.commands) {
      const frame=Math.round(command.time*RATE);render(cursor,frame);cursor=frame;
      if(command.type==='noteOn')voice.noteOn(command.channel,command.block,command.fnum);
      else if(command.type==='noteOff')voice.noteOff(command.channel);
      else if(command.type==='setFrequency')voice.setFrequency(command.channel,command.block,command.fnum);
      else if(command.type==='setSettings'){voice.setSettings(command.settings);if(!voice.isReady())await voice.install();}
      else if(command.type==='setPreset'){voice.setPreset(command.preset);await voice.install();}
      else voice.stop();
    }
    render(cursor,body);voice.stop();render(body,body+tail);return {left,right};
  }finally{voice.stop();chip.dispose();}
}

test('offline RF layers match complete manual sample/settings operations across arbitrary native chunk boundaries',async()=>{
  const changed={...sine.settings,volume:96,panLeft:0,panRight:15,rootNote:72,loopStart:16};
  const shorter={...changed,loopEnd:128},triangle=createPcmBuiltinPreset('triangle');
  const recording=doc([on(.0027),on(.0049,7),{time:.02165,type:'setSettings',settings:changed},
    {time:.0321,type:'setFrequency',channel:0,block:5,fnum:644},off(.041,7),
    {time:.06,type:'setSettings',settings:shorter},on(.065,2),{time:.09,type:'setPreset',preset:triangle},
    on(.097,7),off(.14,7),{time:.15,type:'stop'}]);
  const before=structuredClone(recording),actual=await renderSynthPcmLoop(recording,options),expected=await reference(recording,127);
  assert.equal(actual.sampleRate,RATE);assert.equal(actual.left.length,9648);assert.equal(actual.durationSeconds,.201);
  assert.equal(actual.byteLength,actual.left.byteLength+actual.right.byteLength);
  assert.deepEqual(actual.left,expected.left);assert.deepEqual(actual.right,expected.right);
  assert.deepEqual(recording,before);assert(actual.left.every(Number.isFinite));
  assert(rms(actual.right.subarray(200,800))>.001);assert(actual.left.subarray(2000,2800).every(x=>x===0));
  assert(actual.left.subarray(9600).every(x=>x===0));
});

test('raw layer gain, eight independent channels and end flushing contain no Master/System gain or Event Rec repeat padding',async()=>{
  const recording=doc(Array.from({length:8},(_,channel)=>on(0,channel)),.1);
  const actual=await renderSynthPcmLoop(recording,options),expected=await reference(recording);
  assert.deepEqual(actual.left,expected.left);assert.deepEqual(actual.right,expected.right);
  assert.equal(actual.left.length,4800+48,'only the performed interval and one stopped millisecond');
  const peak=Math.max(...actual.left.subarray(0,4800).map(Math.abs));assert(peak>.8&&peak<.95,'eight raw register-volume64 voices retain native headroom');
  assert(actual.left.subarray(4810).every(x=>x===0),'interpolation flush finishes silently');
  const first=await renderSynthPcmLoop(doc([on(0),off(.08)],.1),options);
  const square=createPcmBuiltinPreset('square');square.settings.panLeft=0;square.settings.panRight=15;
  const second=await renderSynthPcmLoop(doc([on(0,7),off(.08,7)],.1,square),options);
  assert(second.left.every(x=>x===0));assert(rms(first.left)>.01);assert(rms(second.right)>.01);
  assert.notDeepEqual(first.right,second.right,'each source sample is rendered on an independent chip');
});

test('one-shot maximum step remains silent after each short source and can be retriggered inside a layer',async()=>{
  const preset=createPcmPreset({sample:{name:'One frame',sampleRate:48000,encoding:PCM_ENCODING,data:btoa(String.fromCharCode(254))},settings:{rootNote:0,loopEnabled:false}});
  const recording=doc([{...on(0,7),block:7,fnum:2047},{...on(.04,7),block:7,fnum:2047},off(.08,7)],.1,preset);
  const actual=await renderSynthPcmLoop(recording,options),expected=await reference(recording,71);
  assert.deepEqual(actual.left,expected.left);assert(actual.left.subarray(0,50).some(x=>x!==0));
  assert(actual.left.subarray(100,1800).every(x=>x===0));assert(actual.left.subarray(1920,1970).some(x=>x!==0));
  assert(actual.left.subarray(2100).every(x=>x===0));
});

test('offline preparation yields and aborts while disposing native chips, without opening an audio device',async()=>{
  const controller=new AbortController(),oldDispose=Rf5c164.prototype.dispose;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');let disposed=0,devices=0,yields=0;
  Rf5c164.prototype.dispose=function(){disposed++;return oldDispose.call(this);};globalThis.AudioContext=function(){devices++;throw Error('No playback device');};
  try {
    await assert.rejects(renderSynthPcmLoop(doc([on(0),off(.9)],1.2),{...options,signal:controller.signal,
      yieldControl:async()=>{yields++;controller.abort();}}),{name:'AbortError'});
    assert.equal(yields,1);assert.equal(disposed,1);assert.equal(devices,0);
    const pre=new AbortController();pre.abort();await assert.rejects(renderSynthPcmLoop(doc([on(0)]),{...options,signal:pre.signal}),{name:'AbortError'});assert.equal(disposed,1);
    const error=Error('host rendering canceled');await assert.rejects(renderSynthPcmLoop(doc([on(0)],1.2),{...options,yieldControl:async()=>{throw error;}}),e=>e===error);assert.equal(disposed,2);
  }finally{Rf5c164.prototype.dispose=oldDispose;descriptor?Object.defineProperty(globalThis,'AudioContext',descriptor):delete globalThis.AudioContext;}
});

test('invalid durations, source documents and resource requests reject before native allocation',async()=>{
  const original=Rf5c164.create;let creates=0;Rf5c164.create=async(...args)=>{creates++;return original.apply(Rf5c164,args);};
  const valid=doc([on(0),off(.1)]);
  try {
    for(const value of [{...valid,format:'megasynth-recording-v1'},doc([on(0)],121),doc([]),doc([{...on(0),fnum:0}])]) {
      await assert.rejects(renderSynthPcmLoop(value,options));assert.equal(creates,0);
    }
    for(const extra of [{sampleRate:7999},{sampleRate:192001},{sampleRate:44100.5},{moduleOptions:null},{yieldControl:null},{signal:{}}]) {
      await assert.rejects(renderSynthPcmLoop(valid,{...options,...extra}));assert.equal(creates,0);
    }
    assert(120*192000*8>SYNTH_PCM_LOOP_MAX_PCM_BYTES);
    await assert.rejects(renderSynthPcmLoop(doc([on(0),off(120)],120),{...options,sampleRate:192000}),/128 MiB/);assert.equal(creates,0);
    const moduleOptions={wasmBinary};await renderSynthPcmLoop(valid,{...options,moduleOptions});assert.equal(creates,1);assert.deepEqual(Reflect.ownKeys(moduleOptions),['wasmBinary']);assert.equal(moduleOptions.wasmBinary,wasmBinary);
  }finally{Rf5c164.create=original;}
});
