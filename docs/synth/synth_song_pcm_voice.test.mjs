// Silent checks: all native samples stay in numeric arrays, never an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/rf5c164_wasm.js';
import {Rf5c164,RF5C164_CLOCK} from '../js/rf5c164.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js';
import {createPcmRegisterState} from './synth_song_pcm_state.js';
import {pcmSampleBytes,parsePcmPreset,serializePcmPreset} from './synth_pcm.js';
import {
  captureSynthPcmSongSample,createSynthPcmSongDisplay,describeSynthPcmSongVoice,
  createSynthPcmSongCopyPreset,createSynthPcmSongVoice,
} from './synth_song_pcm_voice.js';

const START=0x2000,CHANNEL=6;
function source({clock=RF5C164_CLOCK,step=4096,loop=START+32,volume=83,pan=0x9f,mask=~(1<<CHANNEL)&255,enabled=true}={}) {
  const decoder=createPcmRegisterState(clock),bytes=new Uint8Array(256+33).fill(255);
  for(let i=0;i<256;i++) {
    const value=Math.sin(i/256*Math.PI*2),magnitude=Math.round(Math.abs(value)*126);
    bytes[i]=magnitude|(value>=0?128:0);
  }
  decoder.loadBankedMemory(bytes,START);
  decoder.write(7,(enabled?128:0)|64|CHANNEL);
  for(const [register,value]of [[0,volume],[1,pan],[2,step&255],[3,step>>8],
    [4,loop&255],[5,loop>>8],[6,START>>8]])decoder.write(register,value);
  decoder.write(8,mask);
  return {decoder,bytes,snapshot:decoder.snapshot(100)};
}
function endpoint({pending=false}={}) {
  const writes=[];let complete;
  const pcm={
    keyOff:ch=>writes.push(['off',ch]),keyOn:ch=>writes.push(['on',ch]),
    setChannel:(ch,settings)=>writes.push(['channel',ch,structuredClone(settings)]),
    setPitch:(ch,step)=>writes.push(['pitch',ch,step]),
    loadMemory:(bytes,address)=>{
      writes.push(['memory',address,bytes.slice()]);
      if(pending)return new Promise(resolve=>{complete=resolve;});
    },
  };
  return {pcm,writes,ack:()=>complete()};
}
const altered=(snapshot,patch,channel=CHANNEL)=>({...snapshot,channels:snapshot.channels.map((voice,index)=>
  index===channel?{...voice,...patch}:voice)});

test('PCM snapshot Copy relocates its exact bytes and loop, detaches settings, and preserves recorded speed',()=>{
  const {snapshot,bytes}=source({clock:8000000}),before=structuredClone(snapshot);
  const display=createSynthPcmSongDisplay(snapshot,CHANNEL);
  assert(display.playable);assert.equal(display.frames,256);assert.equal(display.sourceStart,START);
  assert.equal(display.sourceEnd,START+256);assert.equal(display.sourceLoopStart,START+32);
  const preset=createSynthPcmSongCopyPreset(snapshot,CHANNEL);
  assert.deepEqual(pcmSampleBytes(preset.sample),bytes.subarray(0,256));
  assert.equal(preset.sample.sampleRate,8000000/384*4096/2048);
  assert.equal(preset.settings.rootNote,60);assert.equal(preset.settings.volume,83);
  assert.equal(preset.settings.panLeft,15);assert.equal(preset.settings.panRight,9);
  assert.equal(preset.settings.loopStart,32);assert.equal(preset.settings.loopEnd,256);
  assert.equal(preset.settings.loopEnabled,true);
  assert.deepEqual(parsePcmPreset(serializePcmPreset(preset)),preset);
  preset.settings.volume=0;preset.sample.name='Changed';
  const capture=captureSynthPcmSongSample(snapshot,CHANNEL);capture.bytes.fill(0);
  assert.deepEqual(pcmSampleBytes(createSynthPcmSongCopyPreset(snapshot,CHANNEL).sample),bytes.subarray(0,256));
  assert.deepEqual(snapshot,before);
});

test('PCM display retains valid source bytes while muted; audition/Copy explain disabled settings and allow gate-off retrigger',()=>{
  const original=source().snapshot;
  for(const [snapshot,reason]of [[{...original,enabled:false},/globally disabled/],
    [altered(original,{volume:0}),/zero volume/],[altered(original,{panLeft:0,panRight:0}),/pan outputs muted/]]) {
    const display=createSynthPcmSongDisplay(snapshot,CHANNEL);
    assert(display.preset);assert.equal(display.frames,256);assert.equal(display.playable,false);
    assert.match(display.reason,reason);assert.throws(()=>createSynthPcmSongCopyPreset(snapshot,CHANNEL),reason);
  }
  const off=source({mask:255}).snapshot;
  assert.equal(off.channels[CHANNEL].active,false);
  assert(describeSynthPcmSongVoice(off,CHANNEL).playable,'a keyed-off recorded sound can be retriggered');
});

test('known marker-to-marker is one-shot; unknown, wrapping, disjoint or unsafe source memory is not guessed',()=>{
  const {snapshot}=source({loop:START+257});
  const oneShot=createSynthPcmSongCopyPreset(snapshot,CHANNEL);
  assert.equal(oneShot.settings.loopEnabled,false);assert.equal(oneShot.settings.loopStart,0);
  const unknownKnown=Array.from(snapshot.known);unknownKnown[START+90]=0;
  const unknownLoop=Array.from(snapshot.known);unknownLoop[START+300]=0;
  const unsafeRam=Array.from(snapshot.ram);unsafeRam[START+257]=128;
  const disjointRam=Array.from(snapshot.ram),disjointKnown=Array.from(snapshot.known);
  disjointRam[0x1000]=128;disjointKnown[0x1000]=1;
  const cases=[
    [{...snapshot,known:unknownKnown},/incomplete/],
    [altered({...snapshot,known:unknownLoop},{loopStart:START+300}),/incomplete/],
    [{...snapshot,ram:unsafeRam},/safe guard/],
    [altered({...snapshot,ram:disjointRam,known:disjointKnown},{loopStart:0x1000}),/outside/],
    [altered(snapshot,{step:0}),/zero playback step/],
    [altered(snapshot,{step:65535}),/sample-rate range/],
  ];
  for(const [value,reason]of cases) {
    const display=createSynthPcmSongDisplay(value,CHANNEL);
    assert.equal(display.preset,null);assert.equal(display.playable,false);assert.match(display.reason,reason);
    assert.throws(()=>createSynthPcmSongCopyPreset(value,CHANNEL),reason);
  }
  const ram=Array(65536).fill(128),known=Array(65536).fill(1);
  const wrapped=altered({...snapshot,ram,known},{start:0xff00,loopStart:0xff00,step:2048});
  assert.match(describeSynthPcmSongVoice(wrapped,CHANNEL).reason,/wraps/);
  const tooLong=altered({...snapshot,ram,known},{start:0,loopStart:0,step:2048});
  assert.match(describeSynthPcmSongVoice(tooLong,CHANNEL).reason,/65503/);
});

test('frozen RAM capture is reused across advancing frames and fast volume writes without reading sample bytes again',()=>{
  const original=source().snapshot;let reads=0;
  const ram=new Proxy(original.ram,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
  const snapshot={...original,ram};
  const first=createSynthPcmSongDisplay(snapshot,CHANNEL),initialReads=reads;
  assert(first.playable&&initialReads>256);
  for(let index=0;index<20;index++) {
    const next=altered({...snapshot,frame:100+index},{volume:40+index});
    const display=createSynthPcmSongDisplay(next,CHANNEL);
    assert(display.playable);assert.equal(display.preset.settings.volume,40+index);
  }
  assert.equal(reads,initialReads,'same immutable sample is not rescanned or re-encoded per UI tick');
});

test('asynchronous paused audition waits for RAM ACK, stays on the selected physical channel and validates before writes',async()=>{
  const snapshot=source().snapshot,before=structuredClone(snapshot),a=endpoint({pending:true});
  const preparing=createSynthPcmSongVoice(a.pcm,snapshot,CHANNEL);
  await Promise.resolve();
  assert(a.writes.some(write=>write[0]==='memory'));assert(!a.writes.some(write=>write[0]==='on'));
  a.ack();const voice=await preparing;
  assert.deepEqual(voice.getChannels(),[CHANNEL]);assert(voice.isReady());
  const memory=a.writes.find(write=>write[0]==='memory')[2];
  assert.equal(memory.length,65536);assert(memory.subarray(256).every(byte=>byte===255));
  const first=voice.noteOn(0,4,644);assert.equal(first.channel,CHANNEL);
  assert.equal(a.writes.at(-1)[0],'on');assert.equal(a.writes.at(-1)[1],CHANNEL);
  const second=voice.noteOn(3,5,644);assert(second.step>first.step);
  assert.equal(a.writes.at(-1)[1],CHANNEL);voice.setFrequency(0,6,644);
  assert.equal(a.writes.at(-1)[0],'pitch');assert.equal(a.writes.at(-1)[1],CHANNEL);
  assert(voice.noteOff(0));assert.equal(voice.noteOff(),false);
  const count=a.writes.length;assert.throws(()=>voice.noteOn(0,4,0));assert.throws(()=>voice.setFrequency(0,8,644));
  assert.equal(a.writes.length,count);assert.deepEqual(snapshot,before);
  for(const invalid of [null,{},altered(snapshot,{volume:256}),{...snapshot,clockHz:0}]) {
    const untouched=endpoint();await assert.rejects(()=>createSynthPcmSongVoice(untouched.pcm,invalid,CHANNEL));
    assert.deepEqual(untouched.writes,[]);
  }
});

test('cancelled paused preparation cannot start a note before or after the asynchronous RAM transfer',async()=>{
  const snapshot=source().snapshot,early=new AbortController(),first=endpoint();early.abort();
  await assert.rejects(()=>createSynthPcmSongVoice(first.pcm,snapshot,CHANNEL,{signal:early.signal}),{name:'AbortError'});
  assert.deepEqual(first.writes,[]);
  const late=new AbortController(),second=endpoint({pending:true});
  const preparation=createSynthPcmSongVoice(second.pcm,snapshot,CHANNEL,{signal:late.signal});
  await Promise.resolve();late.abort();second.ack();await assert.rejects(()=>preparation,{name:'AbortError'});
  assert(!second.writes.some(write=>write[0]==='on'));
});

const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
async function native() {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000});
  return {chip,api:new RF5C164Synth({transport:new RF5C164DirectTransport(chip)})};
}
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
const c4=440*2**((60-69)/12);
const exactC4Clock=c4*144*2**20/(644*2**(4-1));

test('real WASM paused copy matches a relocated looping source at the reference key, preserving native volume/Pan',async()=>{
  const fixture=source(),original=await native(),keyboard=await native();
  try {
    original.api.loadMemory(fixture.bytes,START);
    original.api.setChannel(CHANNEL,{start:START,loopStart:START+32,step:4096,volume:83,pan:{left:15,right:9}});
    const voice=await createSynthPcmSongVoice(keyboard.api,fixture.snapshot,CHANNEL,{getPitchClock:()=>exactC4Clock});
    assert(keyboard.chip.generateStereo(128).left.every(value=>value===0));
    keyboard.chip.reset(); // Reset the output resampler phase for a bit-exact comparison.
    original.api.keyOn(CHANNEL);voice.noteOn(0,4,644);
    const expected=original.chip.generateStereo(4096),actual=keyboard.chip.generateStereo(4096);
    assert.deepEqual(actual,expected);assert(rms(actual.left)>.001);assert(rms(actual.left)>rms(actual.right));
    voice.noteOff();keyboard.chip.generateStereo(128);
    assert(keyboard.chip.generateStereo(1024).left.every(value=>value===0));
    assert(rms(original.chip.generateStereo(1024).left)>.001,'keyboard off did not mutate the reference endpoint');
  } finally {original.chip.dispose();keyboard.chip.dispose();}
});

test('real WASM captured one-shot finishes under a held key, repeats on note-on and remains safe at maximum keyboard step',async()=>{
  const fixture=source({loop:START+257}),keyboard=await native();
  try {
    const voice=await createSynthPcmSongVoice(keyboard.api,fixture.snapshot,CHANNEL,{getPitchClock:()=>exactC4Clock});
    voice.noteOn(0,4,644);const first=keyboard.chip.generateStereo(4096);
    assert(first.left.some(value=>value!==0));assert(first.left.subarray(2000).every(value=>value===0));
    voice.noteOn(0,4,644);assert(keyboard.chip.generateStereo(512).left.some(value=>value!==0));
    const high=voice.noteOn(0,7,2047);assert.equal(high.step,65535);
    keyboard.chip.generateStereo(256);assert(keyboard.chip.generateStereo(48000).left.every(value=>value===0));
    voice.stop();
  } finally {keyboard.chip.dispose();}
});
