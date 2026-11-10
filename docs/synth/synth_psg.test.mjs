import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import psgFactory from '../generated/segapsg_wasm.js';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js';
import {createSegaPsgApi,psgPeriodFromFrequency} from '../js/segapsg_api.js';
import {createSynthPsgVoice,normalizeSynthPsgSettings,SYNTH_PSG_DEFAULTS} from './synth_psg.js';

const pitch={block:4,fnum:1083};
const pitchHz=(block,fnum,clock=7670454)=>fnum*clock*2**(block-1)/(144*2**20);
function fixture(settings={}) {
  const writes=[],states=[];let clock=7670454,available=true;
  const psg=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>writes.push(value)});
  const voice=createSynthPsgVoice({getPsg:()=>available?psg:null,getPitchClock:()=>clock,onState:state=>states.push(state),settings});
  return {voice,psg,writes,states,setClock:value=>clock=value,setAvailable:value=>available=value};
}

test('default PSG settings are detached JSON data and preparing controls emits no register or Note On',()=>{
  const f=fixture();assert.deepEqual(f.voice.getSettings(),SYNTH_PSG_DEFAULTS);
  assert.deepEqual(f.voice.getChannels(),[0,1,2]);assert.deepEqual(f.voice.getState().heldChannels,[]);assert.deepEqual(f.writes,[]);
  f.voice.getSettings().attenuation=0;f.voice.getState().settings.source='noise';
  assert.deepEqual(f.voice.getSettings(),SYNTH_PSG_DEFAULTS);
  assert.deepEqual(normalizeSynthPsgSettings(JSON.parse(JSON.stringify(f.voice.getSettings()))),SYNTH_PSG_DEFAULTS);
  assert(Object.isFrozen(SYNTH_PSG_DEFAULTS));
});

test('Tone uses caller-owned physical channels and converts the actual FM keyboard clock to PSG Hz',()=>{
  const f=fixture();
  for(const channel of [0,1,2]) {
    const voice=f.voice.noteOn(channel,pitch.block,pitch.fnum);
    const hz=pitchHz(pitch.block,pitch.fnum),period=psgPeriodFromFrequency(hz,SEGAPSG_CLOCK);
    assert.equal(voice.frequencyHz,hz);assert.equal(voice.period,period);
    assert.deepEqual(f.writes.slice(-3),[0x80|(channel<<5)|(period&15),period>>4,0x90|(channel<<5)|6]);
  }
  assert.deepEqual(f.voice.getState().heldChannels,[0,1,2]);
  f.setClock(8000000);const updated=f.voice.setFrequency(1,pitch.block,pitch.fnum);
  assert.equal(updated.frequencyHz,pitchHz(pitch.block,pitch.fnum,8000000));
  assert.deepEqual(f.writes.slice(-2),[0xa0|(updated.period&15),updated.period>>4]);
  const exported=f.voice.getState();exported.voices[0].period=1;
  assert.notEqual(f.voice.getState().voices[0].period,1);
  assert(f.voice.noteOff(1));assert.equal(f.writes.at(-1),0xbf);
  assert.equal(f.voice.noteOff(1),false);assert.deepEqual(f.voice.getState().heldChannels,[0,2]);
});

test('live attenuation changes only held voices, without retriggering pitch or noise',()=>{
  const f=fixture();f.voice.setSettings({attenuation:4});assert.deepEqual(f.writes,[]);
  f.voice.noteOn(0,4,1083);f.voice.noteOn(2,4,1364);f.writes.length=0;
  f.voice.setSettings({attenuation:8});assert.deepEqual(f.writes,[0x98,0xd8]);
  f.voice.noteOff(0);f.writes.length=0;f.voice.setSettings({attenuation:10});
  assert.deepEqual(f.writes,[0xda],'released voices stay muted');
  f.writes.length=0;f.voice.setSettings({attenuation:10});assert.deepEqual(f.writes,[],'unchanged settings do not create writes');
  assert.deepEqual(f.voice.getState().heldChannels,[2]);
});

test('Noise is one monophonic voice, fixed clocks ignore keyboard bend, and type/clock edits reset only noise control',()=>{
  const f=fixture();f.voice.noteOn(0,4,1083);f.writes.length=0;
  f.voice.setSettings({source:'noise'});assert.deepEqual(f.writes,[0x9f,0xbf,0xdf,0xff]);
  assert.deepEqual(f.voice.getChannels(),[3]);assert.deepEqual(f.voice.getState().heldChannels,[]);
  f.writes.length=0;f.voice.setSettings({noiseType:'periodic',noiseRate:'low'});assert.deepEqual(f.writes,[]);
  f.voice.noteOn(3,4,1083);assert.deepEqual(f.writes,[0xe0,0xf6]);
  f.writes.length=0;f.voice.setFrequency(3,5,1083);assert.deepEqual(f.writes,[]);
  assert.equal(f.voice.getState().voices[0].frequencyHz,pitchHz(5,1083));
  f.voice.setSettings({noiseType:'white'});assert.deepEqual(f.writes,[0xe4]);
  f.writes.length=0;f.voice.setSettings({noiseRate:'high'});assert.deepEqual(f.writes,[0xe6]);
  f.writes.length=0;f.voice.setSettings({attenuation:9});assert.deepEqual(f.writes,[0xf9]);
  f.writes.length=0;f.voice.noteOn(3,4,1364);assert.deepEqual(f.writes,[0xe6,0xf9]);
  assert.deepEqual(f.voice.getState().heldChannels,[3]);assert.equal(f.voice.getState().voices.length,1);
  assert(f.voice.noteOff(3));assert.equal(f.writes.at(-1),0xff);
});

test('Tone3 noise clock follows current keyboard pitch while physical Tone3 output stays muted',()=>{
  const f=fixture({source:'noise'});f.voice.noteOn(3,4,1083);f.writes.length=0;
  f.voice.setSettings({noiseRate:'tone3'});
  const period=psgPeriodFromFrequency(pitchHz(4,1083));
  assert.deepEqual(f.writes,[0xdf,0xc0|(period&15),period>>4,0xe7]);
  assert.equal(f.psg._getState().attenuations[2],15);assert.equal(f.psg._getState().attenuations[3],6);
  f.writes.length=0;const updated=f.voice.setFrequency(3,5,1083);
  assert.deepEqual(f.writes,[0xc0|(updated.period&15),updated.period>>4]);
  f.writes.length=0;f.voice.setSettings({source:'tone'});assert.deepEqual(f.writes,[0x9f,0xbf,0xdf,0xff]);
  assert.deepEqual(f.voice.getState().heldChannels,[]);
  f.writes.length=0;f.voice.stop();assert.deepEqual(f.writes,[0x9f,0xbf,0xdf,0xff]);
});

test('invalid settings, physical channels, pitch and clocks reject atomically before writing',()=>{
  const f=fixture(),before=f.voice.getState();
  for(const patch of [null,[],{source:'fm'},{attenuation:-1},{attenuation:16},{attenuation:1.5},
    {noiseType:'pink'},{noiseRate:'div512'},{other:1},{attenuation:0,noiseRate:null}]) {
    assert.throws(()=>f.voice.setSettings(patch));assert.deepEqual(f.voice.getState(),before);assert.deepEqual(f.writes,[]);
  }
  for(const args of [[3,4,1083],[-1,4,1083],[0,8,1083],[0,4,0],[0,4,2048],[0,NaN,1083]]) {
    assert.throws(()=>f.voice.noteOn(...args));assert.throws(()=>f.voice.setFrequency(...args));assert.deepEqual(f.writes,[]);
  }
  f.setClock(NaN);assert.throws(()=>f.voice.noteOn(0,4,1083));assert.deepEqual(f.writes,[]);
  f.setClock(7670454);f.setAvailable(false);assert.equal(f.voice.noteOn(0,4,1083),null);assert.deepEqual(f.voice.getState(),before);
  assert.throws(()=>createSynthPsgVoice({getPsg:null}),/callbacks/);
});

const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
async function native(settings={}) {
  const chip=await SegaPSG.create({moduleFactory:psgFactory,moduleOptions:{wasmBinary},sampleRate:48000,clock:SEGAPSG_CLOCK});
  const psg=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>chip.write(value)});
  return {chip,voice:createSynthPsgVoice({getPsg:()=>psg,settings})};
}
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
function risingFrequency(values,rate) {
  const crossings=[];
  for(let index=1;index<values.length;index++)if(values[index-1]<=0&&values[index]>0)crossings.push(index);
  assert(crossings.length>3,'the hardware rendered multiple waveform periods');
  return rate*(crossings.length-1)/(crossings.at(-1)-crossings[0]);
}

test('real WASM Tone starts silent, tracks quantized pitch, applies hardware attenuation and stops exactly',async()=>{
  const {chip,voice}=await native();
  try {
    assert(chip.generateStereo(512).left.every(value=>value===0),'opening PSG does not start a default tone');
    const note=voice.noteOn(0,4,1083),first=chip.generateStereo(48000);
    const measured=risingFrequency(first.left,48000),expected=SEGAPSG_CLOCK/(32*note.period);
    assert(Math.abs(measured-expected)<1,`hardware pitch ${measured} vs quantized ${expected}`);
    const level=rms(first.left);assert(level>.01&&level<.1);
    voice.setSettings({attenuation:8});const quiet=chip.generateStereo(48000);
    assert(Math.abs(rms(quiet.left)/level-10**(-4/20))<.015,'two attenuation steps reduce the hardware signal by approximately 4dB');
    const higher=voice.setFrequency(0,5,1083),up=chip.generateStereo(48000);
    assert(Math.abs(risingFrequency(up.left,48000)-SEGAPSG_CLOCK/(32*higher.period))<1);
    voice.noteOff(0);assert(chip.generateStereo(1024).left.every(value=>value===0));
    voice.noteOn(1,4,1083);voice.noteOn(2,4,1364);voice.setSettings({source:'noise'});
    assert(chip.generateStereo(1024).left.every(value=>value===0),'source changes stop every previously held tone');
  } finally {voice.stop();chip.dispose();}
});

test('real WASM fixed Noise ignores note pitch/bend, while Tone3 clock responds without audible square tone',async()=>{
  const first=await native({source:'noise'}),second=await native({source:'noise'});
  try {
    first.voice.noteOn(3,4,1083);second.voice.noteOn(3,5,1364);
    assert.deepEqual(first.chip.generateStereo(4096),second.chip.generateStereo(4096),'fixed noise has identical hardware output for different keyboard notes');
    first.voice.setFrequency(3,6,1083);
    assert.deepEqual(first.chip.generateStereo(4096),second.chip.generateStereo(4096),'fixed clock continues identically through pitch bend');
    first.voice.setSettings({noiseRate:'tone3',noiseType:'periodic'});first.voice.setFrequency(3,4,1083);
    const low=first.chip.generateStereo(48000);const lowHz=risingFrequency(low.left,48000);
    first.voice.setFrequency(3,5,1083);const high=first.chip.generateStereo(48000);const highHz=risingFrequency(high.left,48000);
    assert(highHz>lowHz*1.8&&highHz<lowHz*2.2,'periodic noise repeats faster when the hidden Tone3 clock doubles');
    assert(lowHz<100&&highHz<150,'the audible output is the LFSR pattern rather than the clock square wave');
    first.voice.noteOff(3);assert(first.chip.generateStereo(1024).left.every(value=>value===0));
    first.voice.stop();second.voice.stop();assert(second.chip.generateStereo(1024).left.every(value=>value===0));
  } finally {first.voice.stop();second.voice.stop();first.chip.dispose();second.chip.dispose();}
});
