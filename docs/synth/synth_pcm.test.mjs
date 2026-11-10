// Silent verification: native PCM is generated into arrays, never a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/rf5c164_wasm.js';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js';
import {PCM_MAX_FRAMES,PCM_NATIVE_RATE,PCM_RAM_BYTES,PCM_ENCODING,PCM_MIN_SAMPLE_RATE,
  createPcmBuiltinPreset,createPcmPreset,normalizePcmPreset,parsePcmPreset,serializePcmPreset,
  pcmSampleBytes,buildPcmMemory,pcmPresetFromAudio,createSynthPcmVoice} from './synth_pcm.js';

const encoded=bytes=>{const chunks=[];for(let at=0;at<bytes.length;at+=8192)chunks.push(String.fromCharCode(...bytes.subarray(at,at+8192)));return btoa(chunks.join(''));};
function documentFor(bytes,settings={}) {
  return createPcmPreset({sample:{name:'Fixture',sampleRate:48000,encoding:PCM_ENCODING,data:encoded(bytes)},settings});
}
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
const silence=values=>values.every(value=>value===0);
const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
async function native(preset) {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000});
  const synth=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)});
  const voice=createSynthPcmVoice({getPcm:()=>synth,...(preset?{preset}:{})});
  await voice.install();return {chip,synth,voice,dispose(){voice.stop();chip.dispose();}};
}

test('PCM builtins and canonical documents detach complete settings and bounded encoded samples',()=>{
  for(const shape of ['sine','triangle','saw','square']) {
    const preset=createPcmBuiltinPreset(shape),bytes=pcmSampleBytes(preset.sample);
    assert.equal(bytes.length,256);assert(!bytes.includes(255));assert.equal(preset.settings.loopEnd,256);
    assert.deepEqual(parsePcmPreset(serializePcmPreset(preset)),preset);
    assert.deepEqual(parsePcmPreset(new TextEncoder().encode(serializePcmPreset(preset))),preset);
    assert.equal(preset.settings.rootNote,60);assert.equal(preset.settings.loopEnabled,true);
  }
  const preset=createPcmPreset(),normalized=normalizePcmPreset(preset);
  normalized.settings.volume=0;normalized.sample.name='Changed';assert.equal(preset.settings.volume,64);assert.equal(preset.sample.name,'Sine');
  for(const bad of [{...preset,version:2},{...preset,kind:'other'},{...preset,extra:1},
    {...preset,settings:{...preset.settings,loopStart:256}},{...preset,settings:{...preset.settings,loopEnd:257}},
    {...preset,settings:{...preset.settings,panLeft:16}},{...preset,sample:{...preset.sample,data:'AA=='}},
    {...preset,sample:{...preset.sample,data:'//==' }},{...preset,sample:{...preset.sample,encoding:'float'}},
    {...preset,sample:{...preset.sample,sampleRate:0}},{...preset,sample:{...preset.sample,name:'bad\nname'}}])assert.throws(()=>normalizePcmPreset(bad));
  assert.throws(()=>createPcmBuiltinPreset('noise'));assert.throws(()=>parsePcmPreset(Uint8Array.from([255])));
});

test('full RAM layout reserves end guards and the silent one-shot target even at maximum frame count',()=>{
  const bytes=new Uint8Array(PCM_MAX_FRAMES).fill(254),preset=documentFor(bytes,{loopEnabled:false}),memory=buildPcmMemory(preset);
  assert.equal(memory.length,PCM_RAM_BYTES);assert.equal(memory[PCM_MAX_FRAMES-1],254);
  assert.equal(memory[PCM_MAX_FRAMES],255);assert.equal(memory[PCM_MAX_FRAMES+1],255);
  assert(memory.subarray(PCM_MAX_FRAMES+2).every(value=>value===255));
  assert.equal(memory.length-PCM_MAX_FRAMES,33,'maximum hardware step cannot wrap past the marker guard');
  assert.throws(()=>documentFor(new Uint8Array(PCM_MAX_FRAMES+1).fill(128)));
  const shortened=buildPcmMemory({...preset,settings:{...preset.settings,loopEnd:12,loopStart:4}});
  assert(shortened.subarray(0,12).every(value=>value===254));assert(shortened.subarray(12).every(value=>value===255));
});

test('decoded audio converts to mono sign magnitude; software fit preserves duration on a hardware step grid',()=>{
  const result=pcmPresetFromAudio({channels:[Float32Array.from([1,-1,0,.5]),Float32Array.from([1,-1,0,-.5])],sampleRate:48000},{name:'Stereo'});
  assert.deepEqual(pcmSampleBytes(result.preset.sample),Uint8Array.from([254,126,128,128]));
  assert.equal(result.preset.settings.loopEnabled,false);assert.equal(result.fitted,false);assert.match(result.notice,/Software conversion/);
  const length=PCM_MAX_FRAMES*3,input=Float32Array.from({length},(_,index)=>Math.sin(index*.03));
  const fit=pcmPresetFromAudio({channels:[input],sampleRate:48000},{name:'Long'}),out=pcmSampleBytes(fit.preset.sample);
  assert(fit.fitted);assert(out.length<=PCM_MAX_FRAMES);assert(!out.includes(255));assert.match(fit.notice,/Software resampling/);
  assert(Math.abs(out.length/fit.preset.sample.sampleRate-length/48000)<1/fit.preset.sample.sampleRate+1e-9);
  assert(Math.abs(fit.preset.sample.sampleRate/PCM_NATIVE_RATE*2048-Math.round(fit.preset.sample.sampleRate/PCM_NATIVE_RATE*2048))<1e-9);
  assert.throws(()=>pcmPresetFromAudio({channels:[input],sampleRate:48000},{autoFit:false}));
  const corrupt=input.slice();corrupt[10000]=NaN;
  assert.throws(()=>pcmPresetFromAudio({channels:[corrupt],sampleRate:48000}));
  assert.throws(()=>pcmPresetFromAudio({channels:[new Float32Array(PCM_MAX_FRAMES+100)],sampleRate:PCM_MIN_SAMPLE_RATE}));
});

test('RAM install coalesces one revision, never starts a note, and rejects stale completion and invalid edits atomically',async()=>{
  const calls=[],pending=[];
  let available;
  const pcm=available={keyOff:ch=>calls.push(['off',ch]),loadMemory:(bytes,address)=>{calls.push(['load',bytes.slice(),address]);return new Promise(resolve=>pending.push(resolve));},
    setChannel:(...args)=>calls.push(['channel',...args]),keyOn:ch=>calls.push(['on',ch]),setPitch:(...args)=>calls.push(['pitch',...args])};
  const voice=createSynthPcmVoice({getPcm:()=>available});
  assert.equal(voice.noteOn(0,4,644),null);assert.equal(voice.isReady(),false);
  const first=voice.install();assert.equal(voice.install(),first);await Promise.resolve();
  assert.equal(pending.length,1);assert(!calls.some(call=>call[0]==='on'));
  voice.setPreset(createPcmBuiltinPreset('square'));const latest=voice.install();await Promise.resolve();
  pending[1]();assert.equal(await latest,true);assert(voice.isReady());pending[0]();assert.equal(await first,false);assert(voice.isReady());
  assert.deepEqual(voice.getChannels(),[0,1,2,3,4,5,6,7]);
  for(let channel=0;channel<8;channel++)voice.noteOn(channel,4,644);
  assert.deepEqual(voice.getState().heldChannels,[0,1,2,3,4,5,6,7]);
  const copy=voice.getState();copy.preset.settings.volume=0;assert.equal(voice.getPreset().settings.volume,64);
  const before=calls.length,preset=voice.getPreset();
  assert.throws(()=>voice.setSettings({loopEnd:0}));assert.throws(()=>voice.setPreset({...preset,version:3}));
  assert.equal(calls.length,before);assert.deepEqual(voice.getPreset(),preset);
  voice.setSettings({volume:96,panLeft:0,panRight:15,rootNote:72,loopStart:16});
  assert.equal(calls.filter(call=>call[0]==='on').length,8,'live register edits never retrigger');
  voice.setSettings({loopEnd:128});assert.equal(voice.isReady(),false);assert.deepEqual(voice.getState().heldChannels,[]);
  const changed=voice.install();await Promise.resolve();pending.at(-1)();assert(await changed);
  available=null;assert.equal(voice.isReady(),false);assert.equal(voice.noteOn(0,4,644),null);
});

test('PCM semantic hooks report accepted operations only, with detached state and no internal RAM-install events',async()=>{
  const commands=[],calls=[],pending=[];
  const pcm={keyOff:ch=>calls.push(['off',ch]),loadMemory:()=>new Promise(resolve=>pending.push(resolve)),
    setChannel:(...args)=>calls.push(['channel',...args]),keyOn:ch=>calls.push(['on',ch]),setPitch:(...args)=>calls.push(['pitch',...args])};
  const voice=createSynthPcmVoice({getPcm:()=>pcm,onCommand:command=>commands.push(command)});
  assert.equal(voice.noteOn(0,4,644),null);assert.equal(voice.setFrequency(0,4,644),null);
  assert.equal(voice.noteOff(0),false);assert.deepEqual(commands,[]);
  const install=voice.install();await Promise.resolve();pending.shift()();await install;assert.deepEqual(commands,[]);
  voice.noteOn(7,4,644);voice.setFrequency(7,4,700);voice.noteOff(7);assert.equal(voice.noteOff(7),false);
  const before=commands.length;assert.throws(()=>voice.noteOn(8,4,644));assert.throws(()=>voice.setSettings({loopEnd:0}));assert.equal(commands.length,before);
  voice.setSettings({volume:73});voice.setSettings({volume:73});
  voice.noteOn(0,4,644);voice.setSettings({loopEnd:128});
  assert.deepEqual(commands.map(c=>c.type),['noteOn','setFrequency','noteOff','setSettings','noteOn','setSettings']);
  assert.equal(commands.at(-1).settings.loopEnd,128);assert.equal(voice.isReady(),false);
  commands.at(-1).settings.volume=0;assert.equal(voice.getSettings().volume,73);
  const reinstall=voice.install();await Promise.resolve();pending.shift()();await reinstall;
  assert.equal(commands.length,6,'RAM ACK cannot fabricate an event');
  voice.setPreset(createPcmBuiltinPreset('triangle'));assert.equal(commands.at(-1).type,'setPreset');
  commands.at(-1).preset.sample.name='Changed';assert.equal(voice.getPreset().sample.name,'Triangle');
  voice.stop();assert.deepEqual(commands.at(-1),{type:'stop'});
  assert.throws(()=>createSynthPcmVoice({getPcm:()=>pcm,onCommand:1}));
});

test('real WASM default sample tunes around C4, live volume/pan/root changes and all eight physical channels stop',async()=>{
  const host=await native();
  try {
    const note=host.voice.noteOn(0,4,644),first=host.chip.generateStereo(48000);
    const crossings=[];for(let index=1;index<first.left.length;index++)if(first.left[index-1]<=0&&first.left[index]>0)crossings.push(index);
    const actual=48000*(crossings.length-1)/(crossings.at(-1)-crossings[0]),expected=PCM_NATIVE_RATE*note.step/(2048*256);
    assert(Math.abs(actual-expected)<2,`RF marker-loop pitch ${actual} versus step estimate ${expected}`);assert(actual>259&&actual<263);
    const level=rms(first.left);host.voice.setSettings({volume:32});const half=host.chip.generateStereo(48000);
    assert(Math.abs(rms(half.left)/level-.5)<.015);
    host.voice.setSettings({panLeft:0,panRight:15});host.chip.generateStereo(256);const right=host.chip.generateStereo(4096);
    assert(silence(right.left));assert(rms(right.right)>.01);
    host.voice.setSettings({rootNote:72});const transposed=host.voice.getState().voices[0];assert(Math.abs(transposed.step/note.step-.5)<.001);
    host.voice.stop();host.chip.generateStereo(128);assert(silence(host.chip.generateStereo(1024).left));
    for(let channel=0;channel<8;channel++) {host.voice.noteOn(channel,4,644);assert(rms(host.chip.generateStereo(512).right)>.01);host.voice.noteOff(channel);host.chip.generateStereo(128);assert(silence(host.chip.generateStereo(128).right));}
  } finally {host.dispose();}
});

test('real WASM default register volume leaves headroom for eight simultaneous aligned sine voices',async()=>{
  const host=await native();
  try {
    assert.equal(host.voice.getSettings().volume,64);
    for(let channel=0;channel<8;channel++)host.voice.noteOn(channel,4,644);
    const output=host.chip.generateStereo(24000),peak=Math.max(...output.left.map(Math.abs));
    assert(peak>.8&&peak<.95,`Eight native voices peak at ${peak}, below the chip clipping threshold`);
    assert(output.left.every(Number.isFinite));assert.deepEqual(output.left,output.right);
    host.voice.stop();host.chip.generateStereo(128);assert(silence(host.chip.generateStereo(1024).left));
  } finally {host.dispose();}
});

test('real WASM guarded one-shot stays silent at maximum step and RAM boundary, including a one-frame sample',async()=>{
  for(const frames of [1,PCM_MAX_FRAMES]) {
    const host=await native(documentFor(new Uint8Array(frames).fill(254),{loopEnabled:false,rootNote:0}));
    try {
      const note=host.voice.noteOn(7,7,2047);assert.equal(note.step,65535);assert(note.pitchClamped);
      const first=host.chip.generateStereo(10000);assert(first.left.some(value=>value>0));
      assert(silence(host.chip.generateStereo(48000).left),'a skipped marker never wraps into the sample again');
      host.voice.noteOff(7);assert.equal(host.voice.getState().heldChannels.length,0);
    } finally {host.dispose();}
  }
});

test('real WASM loop range excludes hidden sample data; switching to one-shot reaches silence without a retrigger',async()=>{
  const data=new Uint8Array(256).fill(254);data.fill(100,16,32);
  const host=await native(documentFor(data,{loopEnabled:true,loopStart:16,loopEnd:32,rootNote:0}));
  try {
    host.voice.noteOn(2,7,2047);host.chip.generateStereo(256);
    const loop=host.chip.generateStereo(4096);assert(loop.left.every(value=>value<0),'loop must stay in the negative encoded region');
    host.voice.setSettings({loopEnabled:false});host.chip.generateStereo(128);assert(silence(host.chip.generateStereo(4096).left));
    assert.deepEqual(host.voice.getState().heldChannels,[2],'one-shot completion does not fabricate a keyboard release');
  } finally {host.dispose();}
});
