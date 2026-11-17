import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';
import {disassembleScspDsp} from '../js/scsp_dsp_assembler.js';
import {MODE_EXAMPLE_FILES,EXAMPLE_FILES} from './playground_examples.js';

const path='/examples/scsp/scsp-dsp-delay.js';
const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
test('managed Delay is an editable SCSP Files example and follows musical beats',()=>{
  assert.equal(MODE_EXAMPLE_FILES.scsp.find(file=>file.path===path)?.data,source);
  assert.equal(EXAMPLE_FILES.find(file=>file.path===path)?.data,source);
  assert(!MODE_EXAMPLE_FILES.genesis.some(file=>file.path===path));
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm,''),/\b(?:sleep|sleepSamples|setTimeout|reset)\s*\(/);
  assert.match(source,/setDspCoefficients\(\{1:/,'continuous motion uses small coefficient deltas');
});

test('the complete Files Delay example renders real echoes, preserves PCM and retains setup across Apply',async t=>{
  const core=await Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))}});
  const synth=new ScspSynth(core);t.after(()=>synth.dispose());
  const loops=new Map(),prepared=new Map(),beats=[];
  const run=()=>new (Object.getPrototypeOf(async function(){}).constructor)(
    'useSoundChip','setBpm','livePrepare','disassembleScspDsp','log','scale','liveLoop','choose','beat','tween',source)(
    async()=>synth,bpm=>assert.equal(bpm,120),async(name,prepare)=>{if(!prepared.has(name))prepared.set(name,await prepare());return prepared.get(name);},
    disassembleScspDsp,()=>{},()=>['E3'],(name,loop)=>loops.set(name,loop),notes=>notes[0],async value=>beats.push(value),
    async(seconds,update)=>{assert.equal(seconds,4);for(const p of [0,.25,.5,.75,1])await update(p);},
  );
  await run();const setup=synth.getState(),sample=setup.samples[0],pcm=core.readRam(sample.address,sample.byteLength);
  assert.equal(setup.dsp.profile,'delay-ring');assert.equal(setup.dsp.ram.byteLength,65536);assert.equal(loops.size,2);
  await run();assert.equal(synth.getState().ramUsedBytes,setup.ramUsedBytes);assert.equal(synth.getState().samples.length,1);
  await loops.get('scsp-dsp-delay-melody')();assert.deepEqual(beats,[.2,1.8]);
  synth.setMix(0,{directLevel:0});synth.noteOn(0,'E3');
  assert(synth.generateStereo(2205).left.every(value=>value===0));
  synth.noteOff(0);assert(synth.generateStereo(22050).left.some(value=>Math.abs(value)>.001));
  assert.deepEqual(core.readRam(sample.address,sample.byteLength),pcm);
  synth.keyOn(0);const ring=core.readRam(setup.dsp.ram.address,65536);
  await loops.get('scsp-dsp-delay-feedback')();
  assert(synth.getState().slots[0].gate);assert.equal(synth.getDspProgram().delay.feedback,Math.floor(.15*4096)/4096);
  assert.deepEqual(core.readRam(setup.dsp.ram.address,65536),ring);
  synth.stopVoices();assert(synth.generateStereo(16384).left.every(value=>value===0));
});
