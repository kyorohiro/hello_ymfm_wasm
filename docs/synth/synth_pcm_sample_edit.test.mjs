// Silent numeric checks: native RF5C164 renders into arrays, never a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js';
import factory from '../generated/rf5c164_wasm.js';
import {createPcmPreset,createPcmBuiltinPreset,createSynthPcmVoice,normalizePcmSampleEdit,buildPcmMemory,
  pcmSampleBytes,PCM_ENCODING,PCM_NATIVE_RATE} from './synth_pcm.js';
import {SynthPcmRecordingManager,normalizePcmRecording,PCM_RECORDING_MAX_BANKS} from './synth_pcm_recording.js';
import {prepareSynthPcmRecording} from './synth_pcm_recording_prepare.js';
import {createSynthPcmRecordingPlayer} from './synth_pcm_recording_player.js';
import {createSynthPcmRelease} from './synth_pcm_release.js';
import {renderSynthPcmLoop} from './synth_pcm_loop_render.js';

const RATE=48000,CLOCK=7670454;
const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
const data=bytes=>Buffer.from(bytes).toString('base64');
const initial=createPcmPreset({sample:{name:'Non-periodic source',sampleRate:PCM_NATIVE_RATE,encoding:PCM_ENCODING,
  data:data(Uint8Array.from({length:1021},(_,index)=>128+(index*37)%127))},
  settings:{volume:37,rootNote:69,loopStart:37,loopEnd:1003,panLeft:7,panRight:13}});
function edit(preset,offset=1) {
  const next=structuredClone(preset),bytes=pcmSampleBytes(next.sample);
  for(let index=0;index<bytes.length;index++)bytes[index]=128+(index*17+offset*23)%127;
  next.sample.data=data(bytes);return next;
}
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
function fake() {
  const events=[],requests=[];
  const pcm={keyOff:channel=>events.push(['off',channel]),keyOn:channel=>events.push(['on',channel]),
    setChannel:(...args)=>events.push(['channel',...args]),setPitch:(...args)=>events.push(['pitch',...args]),
    loadMemory:(bytes,address)=>{events.push(['memory',bytes.slice(),address]);const request=deferred();requests.push(request);return request.promise;}};
  const commands=[],voice=createSynthPcmVoice({getPcm:()=>pcm,preset:initial,onCommand:command=>commands.push(command)});
  return {events,requests,commands,voice};
}
async function native({smooth=false,preset=initial}={}) {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE}),events=[];
  const direct=new RF5C164DirectTransport(chip),transport={write:(...args)=>{events.push(['write',...args]);return direct.write(...args);},
    loadMemory:(...args)=>{events.push(['memory']);return direct.loadMemory(...args);},reset:()=>direct.reset()};
  const raw=new RF5C164Synth({transport}),render=(left,right)=>{const output=chip.generateStereo(left.length);left.set(output.left);right.set(output.right);};
  const release=smooth?createSynthPcmRelease({pcm:raw,sampleRate:RATE,renderAudio:render}):null,pcm=release?.pcm??raw;
  const voice=createSynthPcmVoice({getPcm:()=>pcm,preset,getPitchClock:()=>CLOCK});await voice.install();
  const generate=frames=>{const left=new Float32Array(frames),right=new Float32Array(frames);(release?.render??render)(left,right);return{left,right};};
  return{chip,raw,pcm,voice,events,release,render:release?.render??render,generate,dispose(){voice.stop();chip.dispose();}};
}

test('sample edits validate all metadata before mutations, and identical bytes are a no-op',async()=>{
  const f=fake(),pending=f.voice.install();await Promise.resolve();f.requests.shift().resolve();await pending;
  f.voice.noteOn(0,4,644);const before=f.voice.getState(),count=f.events.length;
  for(const change of [value=>value.settings.rootNote++,value=>value.settings.volume++,value=>value.settings.loopStart++,
    value=>value.settings.loopEnd--,value=>value.settings.panLeft++,value=>value.sample.name='Other',
    value=>value.sample.sampleRate++,value=>value.sample.data=data(new Uint8Array(1022).fill(128))]) {
    const next=edit(initial);change(next);assert.throws(()=>f.voice.editSample(next),/preserve/);
    assert.deepEqual(f.voice.getState(),before);assert.equal(f.events.length,count);
  }
  const invalid=edit(initial);invalid.sample.data=data(new Uint8Array(1021).fill(255));
  assert.throws(()=>f.voice.editSample(invalid),/reserved/);assert.equal(f.voice.editSample(initial),false);
  assert.deepEqual(f.voice.getState(),before);assert.equal(f.commands.length,1);
});

test('same-endpoint drawing retains note ownership through delayed revisions, Key Up and Stop',async()=>{
  const f=fake(),first=f.voice.install();await Promise.resolve();f.requests.shift().resolve();await first;
  f.voice.noteOn(0,4,644);f.voice.noteOn(7,4,719);const begin=f.events.length;
  assert(f.voice.editSample(edit(initial)));const a=f.voice.install();await Promise.resolve();
  assert.deepEqual(f.voice.getState().heldChannels,[0,7]);assert.equal(f.voice.isReady(),false);
  assert(f.voice.setFrequency(7,5,800));assert(f.voice.noteOff(0));
  assert(f.voice.editSample(edit(initial,2)));const b=f.voice.install();await Promise.resolve();
  f.requests[0].resolve();assert.equal(await a,false);assert.equal(f.voice.isReady(),false);
  f.requests[1].resolve();assert(await b);assert.deepEqual(f.voice.getState().heldChannels,[7]);
  assert.deepEqual(f.events.slice(begin).filter(event=>['on','off'].includes(event[0])),[['off',0]]);
  assert.deepEqual(f.commands.map(command=>command.type),['noteOn','noteOn','editSample','setFrequency','noteOff','editSample']);
  const lastPreset=f.voice.getPreset();f.commands.at(-1).preset.sample.name='Detached';assert.deepEqual(f.voice.getPreset(),lastPreset);
  f.voice.editSample(edit(initial,3));const stopped=f.voice.install();await Promise.resolve();f.voice.stop();
  const afterStop=f.events.length;f.requests[2].resolve();assert(await stopped);
  assert.equal(f.events.length,afterStop);assert.deepEqual(f.voice.getState().heldChannels,[]);
});

test('real WASM drawing matches a direct RAM patch at eight ongoing playback cursors',async()=>{
  const host=await native(),reference=await native(),restart=await native();
  try {
    for(const instance of [host,reference,restart]) {
      for(let channel=0;channel<8;channel++)instance.voice.noteOn(channel,4,400+channel*37);
      instance.generate(417);
    }
    const next=edit(initial),before=host.voice.getState().voices,from=host.events.length;
    host.voice.editSample(next);await host.voice.install();reference.pcm.loadMemory(buildPcmMemory(next),0);
    restart.pcm.loadMemory(buildPcmMemory(next),0);
    for(let channel=0;channel<8;channel++)restart.voice.noteOn(channel,4,400+channel*37);
    assert.deepEqual(host.events.slice(from).map(event=>event[0]),['memory'],'no volume, mask, pitch or key write');
    assert.deepEqual(host.voice.getState().voices,before);assert.equal(host.raw.channelMask,0);
    const actual=host.generate(2048),expected=reference.generate(2048),wrong=restart.generate(2048);
    assert.deepEqual(actual,expected);assert.notDeepEqual(actual,wrong,'continuation is not a restart at frame zero');
    assert(actual.left.some(value=>value!==0));assert(actual.left.every(Number.isFinite));
    for(let channel=0;channel<8;channel++)host.voice.noteOff(channel);
    host.generate(128);assert(host.generate(1024).left.every(value=>value===0));assert.equal(host.raw.channelMask,255);
    assert.deepEqual(pcmSampleBytes(initial.sample),pcmSampleBytes(reference.voice.getPreset().sample),'source preset stays unchanged');
  }finally{host.dispose();reference.dispose();restart.dispose();}
});

test('drawing does not cancel a real four-millisecond release already in progress',async()=>{
  const host=await native({smooth:true}),reference=await native({smooth:true});
  try {
    for(const instance of [host,reference]){instance.voice.noteOn(3,4,644);instance.generate(433);instance.voice.noteOff(3);instance.generate(47);}
    const before=host.release.getState(),next=edit(initial);
    host.voice.editSample(next);await host.voice.install();reference.pcm.loadMemory(buildPcmMemory(next),0);
    assert.deepEqual(host.release.getState(),before);assert.deepEqual(before.releasingChannels,[3]);
    assert.deepEqual(host.generate(512),reference.generate(512));
    assert.deepEqual(host.release.getState().releasingChannels,[]);assert.equal(host.raw.channelMask,255);
    assert(host.generate(1024).left.every(value=>value===0));
  }finally{host.dispose();reference.dispose();}
});

test('recording a drawn edit retains final releases, round-trips and rejects changed shape atomically',()=>{
  let now=0;const manager=new SynthPcmRecordingManager({now:()=>now,getPreset:()=>initial});manager.startRecord();
  for(let channel=0;channel<8;channel++)manager.recordCommand({type:'noteOn',channel,block:4,fnum:644});
  now=.03;const next=edit(initial);manager.recordCommand({type:'editSample',preset:next});
  const saved=manager.exportRecording(),invalid=structuredClone(next);invalid.settings.rootNote++;
  assert.throws(()=>manager.recordCommand({type:'editSample',preset:invalid}),/preserve/);
  assert.deepEqual(manager.exportRecording(),saved);
  now=.06;const take=manager.stopRecord();
  assert.deepEqual(take.commands.slice(-8),Array.from({length:8},(_,channel)=>({time:.06,type:'noteOff',channel})));
  assert.deepEqual(normalizePcmRecording(JSON.parse(JSON.stringify(take))),take);
  const corrupt=structuredClone(take);corrupt.commands[8].preset.sample.sampleRate++;
  assert.throws(()=>normalizePcmRecording(corrupt),/preserve/);
});

const take=(commands,durationSeconds=.1)=>({format:'tetorica-rf5c164-recording-v1',version:1,durationSeconds,
  initialState:{preset:structuredClone(initial),pitchClock:CLOCK},commands});
const on=(time,channel=0)=>({time,type:'noteOn',channel,block:4,fnum:644+channel*17});
const off=(time,channel=0)=>({time,type:'noteOff',channel});

test('compiled edits validate against the preceding shape before retiring an active player',async()=>{
  const h=await native(),player=createSynthPcmRecordingPlayer({sampleRate:RATE,pcm:h.pcm});
  try {
    const compiled=prepareSynthPcmRecording(take([on(0),{time:.01,type:'editSample',preset:edit(initial)},off(.08)]),{sampleRate:RATE});
    player.play(compiled,{session:1});const left=new Float32Array(32),right=new Float32Array(32);player.render(left,right,h.render);
    const before=player.snapshot(),from=h.events.length;
    for(const change of [value=>value.frames--,value=>value.settings.rootNote++,value=>value.settings.volume++,
      value=>value.settings.loopStart++,value=>value.pitchFactors[4]*=2]) {
      const invalid=structuredClone(compiled);change(invalid.events[1].configuration);
      assert.throws(()=>player.play(invalid,{session:2}),/preserve|Invalid/);
      assert.deepEqual(player.snapshot(),before);assert.equal(h.events.length,from);
    }
  }finally{player.stop();h.dispose();}
});

test('sample-clock Event Rec matches direct continuing RAM edits; Use current sound ignores draws without stopping',async()=>{
  const h=await native(),reference=await native(),ignored=await native();
  const player=createSynthPcmRecordingPlayer({sampleRate:RATE,pcm:h.pcm});
  const ignorePlayer=createSynthPcmRecordingPlayer({sampleRate:RATE,pcm:ignored.pcm});
  try {
    const next=edit(initial),recording=take([on(0),on(0,7),{time:417/RATE,type:'editSample',preset:next},off(.075),off(.075,7)]);
    player.play(prepareSynthPcmRecording(recording,{sampleRate:RATE}),{session:1});
    ignorePlayer.play(prepareSynthPcmRecording(recording,{sampleRate:RATE,ignorePatch:true,preset:initial,pitchClock:CLOCK}),{session:1});
    for(const note of [on(0),on(0,7)])reference.voice.noteOn(note.channel,note.block,note.fnum);
    const a={left:new Float32Array(3600),right:new Float32Array(3600)},b=structuredClone(a);
    player.render(a.left.subarray(0,417),a.right.subarray(0,417),h.render);
    const early=reference.generate(417);b.left.set(early.left);b.right.set(early.right);
    reference.pcm.loadMemory(buildPcmMemory(next),0);
    player.render(a.left.subarray(417),a.right.subarray(417),h.render);
    const later=reference.generate(3600-417);b.left.set(later.left,417);b.right.set(later.right,417);
    assert.deepEqual(a,b);assert.deepEqual(player.snapshot().heldChannels,[0,7]);
    const output={left:new Float32Array(3600),right:new Float32Array(3600)};ignorePlayer.render(output.left,output.right,ignored.render);
    const unchanged=await native();try {
      for(const note of [on(0),on(0,7)])unchanged.voice.noteOn(note.channel,note.block,note.fnum);
      assert.deepEqual(output,unchanged.generate(3600));assert.notDeepEqual(output,a);
    }finally{unchanged.dispose();}
    const tailL=new Float32Array(1000),tailR=new Float32Array(1000);player.render(tailL,tailR,h.render);
    assert.deepEqual(player.snapshot().heldChannels,[]);assert.equal(h.raw.channelMask,255);
  }finally{player.stop();ignorePlayer.stop();h.dispose();reference.dispose();ignored.dispose();}
});

test('offline Looper keeps the drawn bank and continuing voice, including its release tail',async()=>{
  const next=edit(initial),recording=take([on(0,7),{time:.025,type:'editSample',preset:next},off(.075,7)]);
  const actual=await renderSynthPcmLoop(recording,{sampleRate:RATE,moduleOptions:{wasmBinary},yieldControl:async()=>{}});
  const reference=await native({smooth:true});
  try {
    reference.voice.noteOn(7,4,763);const before=reference.generate(1200);reference.pcm.loadMemory(buildPcmMemory(next),0);
    const after=reference.generate(2400);reference.voice.noteOff(7);const tail=reference.generate(actual.left.length-3600);
    const expected={left:new Float32Array(actual.left.length),right:new Float32Array(actual.right.length)};
    for(const [offset,block]of [[0,before],[1200,after],[3600,tail]]){expected.left.set(block.left,offset);expected.right.set(block.right,offset);}
    assert.deepEqual(actual.left,expected.left);assert.deepEqual(actual.right,expected.right);
    assert(actual.left.subarray(1250,2200).some(value=>value!==0));assert(actual.left.subarray(3900).every(value=>value===0));
  }finally{reference.dispose();}
});

test('drawn banks use the same bounded recording budget and preserve a full accepted take on rejection',()=>{
  let now=0;const manager=new SynthPcmRecordingManager({now:()=>now,getPreset:()=>initial});manager.startRecord();
  manager.recordCommand({type:'noteOn',channel:0,block:4,fnum:644});
  for(let index=1;index<PCM_RECORDING_MAX_BANKS;index++) {
    const next=structuredClone(initial),bytes=pcmSampleBytes(next.sample);bytes[0]=index%127;bytes[1]=Math.floor(index/127);next.sample.data=data(bytes);
    manager.recordCommand({type:'editSample',preset:next});
  }
  const before=manager.exportRecording(),extra=edit(initial,99);
  assert.throws(()=>manager.recordCommand({type:'editSample',preset:extra}),/512.*RAM banks/);
  assert.deepEqual(manager.exportRecording(),before);now=.1;const saved=manager.stopRecord();
  assert.equal(saved.commands.at(-1).type,'noteOff');assert.deepEqual(normalizePcmRecording(saved),saved);
});
