import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';
import {assembleScspDsp,disassembleScspDsp} from '../js/scsp_dsp_assembler.js';
import {MODE_EXAMPLE_FILES,EXAMPLE_FILES} from './playground_examples.js';

const path='/examples/scsp/scsp-dsp-routing.js';
const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
test('two-path example is an editable SCSP file with beat-based notes',()=>{
  assert.equal(MODE_EXAMPLE_FILES.scsp.find(file=>file.path===path)?.data,source);
  assert.equal(EXAMPLE_FILES.find(file=>file.path===path)?.data,source);
  assert(!MODE_EXAMPLE_FILES.genesis.some(file=>file.path===path));
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm,''),/\b(?:sleep|sleepSamples|setTimeout|reset)\s*\(/);
});

test('actual Files setup renders independent stereo paths and Apply retains PCM / returns',async t=>{
  const core=await Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))}}),synth=new ScspSynth(core);t.after(()=>synth.dispose());
  const loops=new Map(),prepared=new Map(),beats=[];
  const run=()=>new (Object.getPrototypeOf(async function(){}).constructor)(
    'useSoundChip','setBpm','livePrepare','assembleScspDsp','disassembleScspDsp','log','scale','liveLoop','choose','beat','tween',source)(
    async()=>synth,bpm=>assert.equal(bpm,120),async(name,prepare)=>{if(!prepared.has(name))prepared.set(name,await prepare());return prepared.get(name);},
    assembleScspDsp,disassembleScspDsp,()=>{},()=>['E3'],(name,loop)=>loops.set(name,loop),notes=>notes[0],async value=>beats.push(value),
    async(seconds,update)=>{assert.equal(seconds,4);for(const p of [0,.25,.5,.75,1])await update(p);},
  );
  await run();const state=synth.getState();assert.equal(state.samples.length,1);assert.equal(state.dsp.profile,'ram-free');assert.equal(state.dspRam,undefined);
  assert.deepEqual(state.dsp.returns,[{level:7,pan:31},{level:7,pan:15}]);
  assert.equal(state.slots[0].dspInput,0);assert.equal(state.slots[1].dspInput,1);
  await run();assert.equal(synth.getState().ramUsedBytes,state.ramUsedBytes);assert.equal(synth.getState().samples.length,1);assert.equal(loops.size,2);
  await loops.get('scsp-dsp-routing-melody')();assert.deepEqual(beats,[.375,.125]);
  synth.noteOn(0,'E3');synth.noteOn(1,'E3');const before=core.readRam(),out=synth.generateStereo(2048);
  assert(out.left.some(v=>Math.abs(v)>.001));assert(out.right.some(v=>Math.abs(v)>.001));assert.notDeepEqual(out.left,out.right);
  await loops.get('scsp-dsp-routing-filter')();assert(synth.getState().slots[0].gate&&synth.getState().slots[1].gate);
  assert.deepEqual(core.readRam(),before);assert.deepEqual(synth.getDspProgram().returns,state.dsp.returns);
  synth.stopVoices();const stopped=synth.generateStereo(2048);assert(stopped.left.every(v=>v===0)&&stopped.right.every(v=>v===0));
});
