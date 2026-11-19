// SPDX-License-Identifier: BSD-3-Clause
// Offline real WASM only: no AudioContext, device or speaker is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {Huc6280Instrument} from './instrument.js';
import {createDefaultPreset} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const peak=pcm=>Math.max(...pcm.left.map(Math.abs),...pcm.right.map(Math.abs));
const soundState=instrument=>{const {channelMuteMask,...state}=instrument.read();return state;};
async function setup(t,rate=48000){
  const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:rate});
  const instrument=new Huc6280Instrument(core);t.after(()=>instrument.dispose());return{core,instrument};
}
function configuration(kind){
  const preset=createDefaultPreset();preset.envelope.enabled=false;
  if(kind==='noise')preset.source='noise';
  if(kind==='dda'){
    preset.source='dda';preset.dda.data=encodeDdaData(Uint8Array.from({length:61},(_,i)=>(i*11+i%3)&31));
    preset.dda.loop=true;preset.dda.sampleRate=11025;
  }
  if(kind==='lfo')Object.assign(preset.lfo,{enabled:true,mode:'recorded',carrierPeriod:277,modulatorPeriod:71,frequency:7,depth:2,
    output:{enabled:true,volume:17,pan:{left:15,right:15}}});
  return preset;
}

test('app output masks validate atomically, acknowledge no preset/PCM, and roll back a partially rejected native update',async t=>{
  const {core,instrument}=await setup(t);instrument.loadPreset(configuration('dda'));instrument.noteOn('held',60);instrument.generateStereo(32);
  const before=soundState(instrument),slots=instrument.slots.slice(),epoch=instrument.codeEpoch,frame=instrument.frame;
  for(const mask of[-1,64,.5,NaN,Infinity,'1',null,undefined])assert.throws(()=>instrument.setChannelMuteMask(mask),/output mask/);
  assert.throws(()=>instrument.setChannelMuteMask(1,2),/output mask/);
  assert.deepEqual(soundState(instrument),before);assert.equal(core.channelMask,0);
  assert.deepEqual(instrument.setChannelMuteMask(5),{channelMuteMask:5});assert.equal(core.channelMask,5);
  assert.deepEqual(soundState(instrument),before);assert.equal(instrument.read().channelMuteMask,5);assert.deepEqual(instrument.slots,slots);assert.equal(instrument.codeEpoch,epoch);assert.equal(instrument.frame,frame);
  const native=core.setChannelMuted.bind(core),calls=[];let reject=true;
  core.setChannelMuted=(channel,muted)=>{calls.push([channel,muted]);native(channel,muted);if(channel===3&&reject){reject=false;throw Error('Rejected output mask');}};
  assert.throws(()=>instrument.setChannelMuteMask(63),/Rejected output mask/);
  assert.deepEqual(calls,[[1,true],[3,true],[1,false],[3,false]]);assert.equal(core.channelMask,5);assert.equal(instrument.channelMuteMask,5);assert.deepEqual(soundState(instrument),before);
  calls.length=0;assert.deepEqual(instrument.setChannelMuteMask(5),{channelMuteMask:5});assert.equal(calls.length,0);
  assert.deepEqual(instrument.setChannelMuteMask(0),{channelMuteMask:0});assert.equal(core.channelMask,0);
});

test('real Wave/Noise/DDA and paired LFO keep phase, feeding and owner state while all outputs are muted',async t=>{
  for(const rate of[44100,48000])for(const kind of['wave','noise','dda','lfo']){
    const a=await setup(t,rate),b=await setup(t,rate),preset=configuration(kind);
    a.instrument.loadPreset(preset);b.instrument.loadPreset(preset);
    a.instrument.noteOn('held',60);b.instrument.noteOn('held',60);
    assert.deepEqual(a.instrument.generateStereo(103),b.instrument.generateStereo(103));
    const before=soundState(b.instrument);b.instrument.setChannelMuteMask(63);assert.deepEqual(soundState(b.instrument),before);
    a.instrument.generateStereo(4096);assert.equal(peak(b.instrument.generateStereo(4096)),0,`${rate} ${kind}: output only silence`);
    assert.deepEqual(soundState(b.instrument),soundState(a.instrument),`${rate} ${kind}: register, gate and DDA cursor remain current`);
    b.instrument.setChannelMuteMask(0);assert.deepEqual(b.instrument.generateStereo(2048),a.instrument.generateStereo(2048),`${rate} ${kind}: exact future PCM phase`);
    assert(!Object.hasOwn(b.instrument.read().preset,'channelMuteMask'));
  }
});

test('a failed native rollback forces all six flags on the next accepted-mask request and propagates repair failure',async t=>{
  const {core,instrument}=await setup(t),native=core.setChannelMuted.bind(core),calls=[];
  core.setChannelMuted=(channel,muted)=>{
    calls.push([channel,muted]);
    if(channel===1&&!muted)throw Error('Rollback unavailable');
    native(channel,muted);if(channel===1)throw Error('Native update failed after mutation');
  };
  assert.throws(()=>instrument.setChannelMuteMask(3),/rollback failed/);
  assert.equal(instrument.channelMuteMask,0);assert.equal(core.channelMask,2);assert.equal(instrument.channelMuteMaskDirty,true);
  calls.length=0;
  core.setChannelMuted=(channel,muted)=>{calls.push([channel,muted]);if(channel===0)throw Error('Repair unavailable');native(channel,muted);};
  assert.throws(()=>instrument.setChannelMuteMask(0),/rollback failed/,'same accepted mask cannot silently acknowledge an unverified native state');
  assert.equal(instrument.channelMuteMaskDirty,true);assert.equal(instrument.channelMuteMask,0);
  calls.length=0;core.setChannelMuted=(channel,muted)=>{calls.push([channel,muted]);native(channel,muted);};
  assert.deepEqual(instrument.setChannelMuteMask(0),{channelMuteMask:0});
  assert.deepEqual(calls,Array.from({length:6},(_,channel)=>[channel,false]));assert.equal(core.channelMask,0);assert.equal(instrument.channelMuteMaskDirty,false);
  calls.length=0;instrument.setChannelMuteMask(0);assert.equal(calls.length,0,'only a verified mask can take the no-op path again');
});

test('mask changes retain Code epoch/gates and survive Stop, presets, reinitialization and native reset',async t=>{
  const {core,instrument}=await setup(t),metadata=instrument.beginCode(),session=metadata.session;
  instrument.code(session,'noteOn',[2,'E3']);const before=instrument.observeCode(),voices=instrument.read().voices;
  assert.deepEqual(instrument.setChannelMuteMask(4),{channelMuteMask:4});assert.equal(instrument.codeEpoch,session);assert.equal(instrument.codeActive,true);
  assert.deepEqual(instrument.observeCode(),before);assert.deepEqual(instrument.read().voices,voices);
  assert.equal(peak(instrument.generateStereo(128)),0);instrument.code(session,'setVolume',[2,19]);
  instrument.stop();assert.equal(instrument.channelMuteMask,4);assert.equal(core.channelMask,4);
  instrument.loadPreset(configuration('wave'));instrument.beginCode();assert.equal(core.channelMask,4);
  core.reset();assert.equal(core.channelMask,4);instrument.synth.initialize();
  instrument.stop();instrument.noteOn('fresh',60,2);assert.equal(peak(instrument.generateStereo(128)),0);
  instrument.setChannelMuteMask(0);assert(peak(instrument.generateStereo(128))>.001);
});
