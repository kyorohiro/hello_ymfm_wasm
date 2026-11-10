// Native PCM stays in arrays. These tests never create an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/rf5c164_wasm.js';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth} from '../js/rf5c164synth.js';
import {createSynthPcmVoice} from './synth_pcm.js';
import {PCM_RELEASE_SECONDS,createSynthPcmRelease} from './synth_pcm_release.js';

const RATE=48000;
const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
const rms=a=>Math.sqrt(a.reduce((sum,value)=>sum+value*value,0)/a.length);
const silent=a=>a.every(value=>value===0);
const maxStep=a=>Math.max(...a.slice(1).map((value,index)=>Math.abs(value-a[index])));
async function native(smooth=true) {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE}),writes=[];
  const raw=new RF5C164Synth({transport:{write:(r,v)=>{writes.push([r,v]);chip.writeRegister(r,v);},
    loadMemory:(bytes,address)=>chip.loadMemory(bytes,address),reset:()=>chip.reset()}});
  const renderAudio=(left,right)=>{const out=chip.generateStereo(left.length);left.set(out.left);right.set(out.right);};
  const engine=smooth?createSynthPcmRelease({pcm:raw,sampleRate:RATE,renderAudio}):null,pcm=engine?.pcm??raw;
  const voice=createSynthPcmVoice({getPcm:()=>pcm});await voice.install();
  function generate(frames,chunk=frames||1) {
    const left=new Float32Array(frames),right=new Float32Array(frames);
    for(let at=0;at<frames;at+=chunk)(engine?.render??renderAudio)(left.subarray(at,Math.min(frames,at+chunk)),right.subarray(at,Math.min(frames,at+chunk)));
    return {left,right};
  }
  return {chip,raw,pcm,voice,engine,writes,generate,dispose(){chip.dispose();}};
}

test('4 ms software release removes the abrupt native key-off edge without changing sustained PCM',async()=>{
  const smooth=await native(),raw=await native(false);
  try {
    assert.equal(PCM_RELEASE_SECONDS,.004);
    for(const h of [smooth,raw])h.voice.noteOn(0,4,644);
    const before=smooth.generate(256),reference=raw.generate(256);assert.deepEqual(before,reference);
    const level=before.left.at(-1);assert(level>.08);
    smooth.pcm.releaseNote(0);raw.pcm.keyOff(0);
    const after=smooth.generate(512),cut=raw.generate(512);
    const rawStep=maxStep(Float32Array.from([level,...cut.left])),softStep=maxStep(Float32Array.from([level,...after.left]));
    assert(rawStep>.08);assert(softStep<rawStep*.2,`release edge ${softStep} is below hard key-off ${rawStep}`);
    assert(rms(after.left.subarray(0,120))>.005,'a short real-chip fade follows the key release');
    assert(silent(after.left.subarray(208)));assert.deepEqual(after.left,after.right);
    assert.equal(smooth.engine.getState().actualMask,255);assert.deepEqual(smooth.engine.getState().releasingChannels,[]);
    assert.equal(smooth.engine.getState().actualVolumes[0],0);
  } finally {smooth.dispose();raw.dispose();}
});

test('release PCM and completion are identical across arbitrary output block boundaries',async()=>{
  const a=await native(),b=await native(),c=await native();
  try {
    for(const h of [a,b,c]){h.voice.noteOn(0,4,644);h.generate(257);h.pcm.releaseNote(0);}
    const first=a.generate(1024,128);assert.deepEqual(first,b.generate(1024,71));assert.deepEqual(first,c.generate(1024,1));
    assert.deepEqual(a.engine.getState(),b.engine.getState());assert.deepEqual(a.engine.getState(),c.engine.getState());
    assert.equal(a.engine.getState().releaseFrames,192);
  } finally {a.dispose();b.dispose();c.dispose();}
});

test('one channel release leaves a separately panned held channel sample-for-sample unchanged',async()=>{
  const smooth=await native(),reference=await native(false);
  try {
    for(const h of [smooth,reference]) {
      h.voice.noteOn(0,4,644);h.pcm.setChannel(0,{pan:{left:15,right:0}});
      h.voice.noteOn(1,4,700);h.pcm.setChannel(1,{pan:{left:0,right:15}});h.generate(417);
    }
    smooth.pcm.releaseNote(0);reference.pcm.keyOff(0);
    const output=smooth.generate(2048,127),expected=reference.generate(2048,127);
    assert.deepEqual(output.right,expected.right,'the held voice is not faded by a master-bus ramp');
    assert(rms(output.right)>.01);assert(rms(output.left.subarray(0,100))>.001);assert(silent(output.left.subarray(208)));
    assert.deepEqual(smooth.engine.getState().heldChannels,[1]);assert.equal(smooth.engine.getState().actualMask,253);
    smooth.pcm.releaseNote(1);smooth.generate(256);assert(silent(smooth.generate(128).right));
  } finally {smooth.dispose();reference.dispose();}
});

test('retrigger cancels a release and another channel cannot revive a completed voice',async()=>{
  const h=await native();
  try {
    h.voice.noteOn(0,4,644);h.generate(41);assert(h.pcm.releaseNote(0));h.generate(80);
    const deadline=h.engine.getState().frame;assert.equal(h.pcm.releaseNote(0),false,'duplicate release cannot extend the tail');
    h.pcm.keyOn(0);assert.deepEqual(h.engine.getState().releasingChannels,[]);assert.equal(h.engine.getState().actualVolumes[0],64);
    assert(rms(h.generate(512).left)>.01);assert(h.engine.getState().frame>deadline+192);
    h.pcm.releaseNote(0);h.generate(256);assert.equal(h.engine.getState().actualMask,255);
    h.voice.noteOn(1,4,700);assert.equal(h.engine.getState().actualMask,253,'new channel keyOn keeps the old completed channel masked off');
    h.pcm.releaseNote(1);h.generate(40);h.pcm.keyOn(0);h.generate(256);
    assert.equal(h.engine.getState().actualMask,254,'another pending tail can end without killing or reviving the new voice');
    assert.deepEqual(h.engine.getState().heldChannels,[0]);assert.deepEqual(h.engine.getState().releasingChannels,[]);
  } finally {h.dispose();}
});

test('hard keyOff, raw mask and reset cancel every future release write',async()=>{
  const h=await native();
  try {
    for(const operation of [()=>h.pcm.keyOff(0),()=>h.pcm.writeRegister(8,255),()=>h.pcm.reset()]) {
      h.voice.noteOn(0,4,644);h.generate(59);h.pcm.releaseNote(0);h.generate(38);operation();
      assert.deepEqual(h.engine.getState().releasingChannels,[]);assert.equal(h.engine.getState().actualMask,255);
      const count=h.writes.length;h.generate(256);assert(silent(h.generate(128).left));
      assert.equal(h.writes.length,count,'canceled tails never write to the chip later');
    }
  } finally {h.dispose();}
});

test('internal volume updates preserve the banked register target and global enable',async()=>{
  const h=await native();
  try {
    h.voice.noteOn(0,4,644);h.generate(39);h.pcm.setChannel(3,{volume:25});h.pcm.writeRegister(7,0x8a);
    h.pcm.releaseNote(0);h.generate(64);assert.equal(h.engine.getState().selected,3);assert.equal(h.engine.getState().control,0x8a);
    assert.deepEqual(h.writes.at(-1),[7,0x8a],'RAM window selection is restored after a different channel volume update');
    h.pcm.writeRegister(0,77);assert.equal(h.engine.getState().baseVolumes[3],77);assert.equal(h.engine.getState().baseVolumes[0],64);
    h.pcm.writeRegister(7,0x0b);const start=h.writes.length;h.generate(256);
    assert(h.writes.slice(start).filter(([register])=>register===7).every(([,value])=>!(value&128)),'release work cannot enable a disabled chip');
    assert.equal(h.engine.getState().control,0x0b);assert.equal(h.engine.getState().actualMask,255);
    assert(silent(h.generate(128).left));
  } finally {h.dispose();}
});

test('invalid controls and stereo buffers leave native state and release ownership unchanged',async()=>{
  const h=await native();
  try {
    h.voice.noteOn(0,4,644);h.generate(27);h.pcm.releaseNote(0);h.generate(10);
    const before=h.engine.getState(),count=h.writes.length;
    for(const call of [()=>h.pcm.releaseNote(8),()=>h.pcm.releaseNote(NaN),()=>h.pcm.keyOn(-1),()=>h.pcm.keyOff(8),
      ()=>h.pcm.writeRegister(8,256),()=>h.pcm.setChannel(0,{volume:256}),()=>h.pcm.loadMemory(new Uint8Array(2),65535),
      ()=>h.engine.render(new Float32Array(2),new Float32Array(3)),()=>h.engine.render(new Float64Array(2),new Float32Array(2))])assert.throws(call);
    assert.deepEqual(h.engine.getState(),before);assert.equal(h.writes.length,count);
    h.engine.render(new Float32Array(0),new Float32Array(0));assert.deepEqual(h.engine.getState(),before);
    for(const sampleRate of [0,-1,NaN,Infinity,768001])assert.throws(()=>createSynthPcmRelease({pcm:h.raw,sampleRate,renderAudio(){}}));
    assert.throws(()=>createSynthPcmRelease({pcm:{},sampleRate:RATE,renderAudio(){}}));
  } finally {h.dispose();}
});
