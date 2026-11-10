// Silent checks only: the optional native fixture generates PCM into arrays.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPcmWaveDraft} from './synth_pcm_wave_edit.js';
import {PCM_ENCODING,PCM_MAX_FRAMES,createPcmPreset,createPcmBuiltinPreset,pcmSampleBytes,
  serializePcmPreset,parsePcmPreset,buildPcmMemory,createSynthPcmVoice} from './synth_pcm.js';
import {createSynthProject} from './synth_project.js';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js';
import factory from '../generated/rf5c164_wasm.js';

const sample=(bytes,settings={})=>createPcmPreset({sample:{name:'Recorded source',sampleRate:32000,
  encoding:PCM_ENCODING,data:Buffer.from(bytes).toString('base64')},settings});
const encoded=value=>Math.round(Math.abs(value)*126)|(value>=0?128:0);

test('one software stroke preserves untouched source bytes and every instrument setting without mutating its input',()=>{
  const preset=sample([0,127,1,128,200,254],{rootNote:57,volume:94,panLeft:2,panRight:13,loopStart:1,loopEnd:5});
  const before=structuredClone(preset),draft=createPcmWaveDraft(preset);
  assert(draft.setPoint({index:3,value:.5}));
  assert.deepEqual(preset,before);assert.deepEqual(pcmSampleBytes(preset.sample),Uint8Array.of(0,127,1,128,200,254));
  const result=draft.finish();assert.notEqual(result,preset);
  assert.deepEqual(pcmSampleBytes(result.sample),Uint8Array.of(0,127,1,191,200,254));
  assert.deepEqual(result.settings,before.settings);
  for(const field of ['name','sampleRate','encoding'])assert.equal(result.sample[field],before.sample[field]);
  result.settings.rootNote=12;result.sample.name='Detached';assert.deepEqual(preset,before);
});

test('forward and backward drawing fill every intervening source frame on the same amplitude ramp',()=>{
  const preset=sample(new Uint8Array(11).fill(128)),forward=createPcmWaveDraft(preset),backward=createPcmWaveDraft(preset);
  forward.setPoint({index:2,value:-1});forward.setPoint({index:8,value:1});
  backward.setPoint({index:8,value:1});backward.setPoint({index:2,value:-1});
  const expected=Uint8Array.of(128,128,...Array.from({length:7},(_,index)=>encoded(-1+index/3)),128,128);
  assert.deepEqual(forward.bytes,expected);assert.deepEqual(backward.bytes,expected);
  forward.setPoint({index:8,value:0});assert.equal(forward.bytes[8],128,'a vertical stroke overwrites its single frame');
  assert.equal(forward.bytes[7],expected[7],'same-frame motion does not repaint a neighboring frame');
});

test('amplitude boundaries saturate safely without producing a loop marker, including a one-frame sample',()=>{
  const draft=createPcmWaveDraft(sample([128]));
  for(const [value,byte]of [[-100,126],[-1,126],[-.5,63],[-0,128],[0,128],[.5,191],[1,254],[100,254]]) {
    draft.setPoint({index:0,value});assert.equal(draft.bytes[0],byte);assert.notEqual(byte,255);
  }
  assert.equal(pcmSampleBytes(draft.finish().sample).length,1);
});

test('invalid points reject atomically and cannot replace the previous interpolation anchor',()=>{
  const draft=createPcmWaveDraft(sample(new Uint8Array(5).fill(128)));
  draft.setPoint({index:0,value:-1});const before=draft.bytes.slice();
  for(const point of [null,[],{}, {index:-1,value:0},{index:5,value:0},{index:1.5,value:0},
    {index:NaN,value:0},{index:1,value:NaN},{index:1,value:Infinity},{index:1,value:'0'}]) {
    assert.throws(()=>draft.setPoint(point));assert.deepEqual(draft.bytes,before);
  }
  draft.setPoint({index:4,value:1});assert.deepEqual(draft.bytes,Uint8Array.of(126,63,128,191,254));
  draft.bytes[0]=255;assert.throws(()=>draft.finish(),/reserved/,'external view mutation still cannot bypass preset validation');
});

test('unchanged strokes are no-ops, including repainting and restoring the exact original bytes',()=>{
  const draft=createPcmWaveDraft(sample([128,128,128]));assert.equal(draft.finish(),null);
  assert.equal(draft.setPoint({index:0,value:0}),false);assert.equal(draft.finish(),null);
  draft.setPoint({index:2,value:0});assert.equal(draft.finish(),null);
  draft.setPoint({index:2,value:1});assert(draft.finish());
  draft.setPoint({index:2,value:0});assert.equal(draft.finish(),null);
});

test('finishing preserves current Root and range settings but rejects a changed source sample',()=>{
  const preset=createPcmBuiltinPreset('sine'),draft=createPcmWaveDraft(preset);
  draft.setPoint({index:7,value:-.75});
  const current=structuredClone(preset);Object.assign(current.settings,{rootNote:72,volume:12,loopStart:3,loopEnd:99,loopEnabled:false});
  assert.deepEqual(draft.finish(current).settings,current.settings);
  for(const field of ['name','sampleRate','encoding','data']) {
    const changed=structuredClone(current);
    if(field==='name')changed.sample.name='Different sample';
    if(field==='sampleRate')changed.sample.sampleRate=16000;
    if(field==='encoding')changed.sample.encoding='foreign';
    if(field==='data')changed.sample.data=createPcmBuiltinPreset('square').sample.data;
    assert.throws(()=>draft.finish(changed),/changed while drawing|encoding/);
  }
  preset.sample.name='Mutated by caller';preset.settings.volume=0;
  assert.equal(draft.finish().sample.name,'Sine');assert.equal(draft.finish().settings.volume,64);
});

test('full-RAM edited samples retain exact length, marker guards and existing project/JSON persistence',()=>{
  const preset=sample(new Uint8Array(PCM_MAX_FRAMES).fill(128)),draft=createPcmWaveDraft(preset);
  draft.setPoint({index:0,value:-1});draft.setPoint({index:PCM_MAX_FRAMES-1,value:1});
  const edited=draft.finish(),bytes=pcmSampleBytes(edited.sample);
  assert.equal(bytes.length,PCM_MAX_FRAMES);assert(!bytes.includes(255));assert.equal(bytes[0],126);assert.equal(bytes.at(-1),254);
  assert.deepEqual(parsePcmPreset(serializePcmPreset(edited)),edited);
  const memory=buildPcmMemory(edited);assert(memory.subarray(PCM_MAX_FRAMES).every(value=>value===255));
  const project=createSynthProject(),path=project.createTone(preset,'Drawn').path;project.syncTone(path);
  project.writeTone(path,edited);assert(project.isToneModified(path));assert.deepEqual(project.readTone(path).preset,edited);
  assert.deepEqual(project.revertTone(path).preset,preset);
});

test('a committed stroke reaches the real RF core through the existing preset-install path and produces finite PCM',async()=>{
  const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000});
  const raw=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)}),commands=[];
  const original=sample(new Uint8Array(32).fill(128)),voice=createSynthPcmVoice({getPcm:()=>raw,preset:original,onCommand:command=>commands.push(command)});
  try {
    await voice.install();voice.noteOn(0,4,644);
    assert(chip.generateStereo(480).left.every(value=>value===0));
    const draft=createPcmWaveDraft(original);draft.setPoint({index:0,value:1});draft.setPoint({index:31,value:-1});
    voice.setPreset(draft.finish());assert.deepEqual(voice.getState().heldChannels,[]);
    assert.equal(commands.at(-1).type,'setPreset');assert.equal(raw.channelMask,255);
    assert(await voice.install());voice.noteOn(0,4,644);
    const pcm=chip.generateStereo(480);
    assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
    assert(pcm.left.some(value=>Math.abs(value)>.001),'drawn amplitudes reach hardware PCM output');
    assert.deepEqual(pcm.left,pcm.right);assert.equal(commands.filter(command=>command.type==='setPreset').length,1);
    assert.deepEqual(pcmSampleBytes(original.sample),new Uint8Array(32).fill(128));
  } finally {voice.stop();chip.dispose();}
});
