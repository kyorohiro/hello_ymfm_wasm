import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assembleScspDsp, disassembleScspDsp} from '../js/scsp_dsp_assembler.js';
import {EXAMPLE_FILES,MODE_EXAMPLE_FILES,MODE_DEFAULT_CODES} from './playground_examples.js';
import {buildExampleBundle} from '../../scripts/build_playground_examples.mjs';
import {reconcileModeProject} from './playground_mode_starters.js';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const paths=['/examples/scsp/scsp-dsp-gain.js','/examples/scsp/scsp-dsp-iir-motion.js'];
const sources=await Promise.all(paths.map(path=>readFile(new URL('.'+path,import.meta.url),'utf8')));

function harness() {
  const events=[],loops=new Map(),prepared=new Map(),coefficients=[];
  const sample={id:123},notes=['E3','G3'];
  const chip={
    async applyDspProgram(words,options) {events.push(['program',words,options]);},
    async loadPCM(pcm,options) {assert(pcm instanceof Int16Array);assert.equal(pcm.length,64);assert(Math.max(...pcm.map(Math.abs))<=4096);events.push(['pcm',options]);return sample;},
    async setPreset(ch,preset) {assert.equal(ch,0);assert.equal(preset.sample,sample);events.push(['preset',ch,preset]);},
    async setMix(ch,mix) {assert.equal(ch,0);assert.equal(mix.directLevel,0);assert.equal(mix.dspSend,7);events.push(['mix',ch,mix]);},
    async setDspReturn(value) {assert.deepEqual(value,{level:7,pan:0});events.push(['return',value]);},
    async noteOn(ch,note) {assert.equal(ch,0);assert.equal(note,notes[0]);events.push(['on',ch,note]);},
    async noteOff(ch) {assert.equal(ch,0);events.push(['off',ch]);},
    async setDspCoefficients(patch) {coefficients.push(patch);events.push(['coefficients',patch]);},
  };
  const args=[async name=>{assert.equal(name,'scsp');return chip;},
    bpm=>{assert.equal(bpm,120);},async(name,prepare)=>{if(!prepared.has(name))prepared.set(name,await prepare());return prepared.get(name);},
    assembleScspDsp,message=>events.push(['log',message]),
    (root,scale,octaves)=>{assert.equal(root,'E3');assert.equal(scale,'minorPentatonic');assert.equal(octaves,2);return notes;},
    (name,loop)=>loops.set(name,loop),array=>array[0],async beats=>events.push(['beat',beats]),
    async(seconds,update)=>{assert.equal(seconds,4);for(const p of [0,.25,.5,.75,1])await update(p);},
  ];
  const run=source=>new AsyncFunction('useSoundChip','setBpm','livePrepare','assembleScspDsp','log','scale','liveLoop','choose','beat','tween',source)(...args);
  return {run,events,loops,coefficients};
}

test('RAM-free DSP performance examples remain editable SCSP Files with exact source bytes', async () => {
  for(let i=0;i<paths.length;i++) {
    assert.equal(EXAMPLE_FILES.find(file=>file.path===paths[i])?.data,sources[i]);
    assert.equal(MODE_EXAMPLE_FILES.scsp.find(file=>file.path===paths[i])?.data,sources[i]);
    assert(!MODE_EXAMPLE_FILES.genesis.some(file=>file.path===paths[i]));
  }
  assert.equal(await buildExampleBundle(),await readFile(new URL('./playground_examples.js',import.meta.url),'utf8'));
  const original={version:1,modeId:'scsp',activePath:'/index.js',runPath:'/index.js',directories:[],
    files:[{path:'/index.js',data:'// my melody'},{path:paths[0],data:'// my gain edit'}]};
  const result=reconcileModeProject(original,{targetModeId:'scsp',codeChoice:'keep',defaults:MODE_DEFAULT_CODES,
    allExampleFiles:EXAMPLE_FILES,targetExampleFiles:MODE_EXAMPLE_FILES.scsp});
  assert.equal(result.files.find(file=>file.path===paths[0]).data,'// my gain edit');
  assert.equal(result.files.find(file=>file.path===paths[1]).data,sources[1]);
  assert.equal(result.files.find(file=>file.path==='/index.js').data,'// my melody');
  assert.equal(original.files.length,2);
});

for(let i=0;i<paths.length;i++)test(`${paths[i]} uses checked words, wet routing and independent beat / coefficient loops`,async()=>{
  const h=harness();await h.run(sources[i]);
  const setupEvents=h.events.slice();assert.equal(h.loops.size,2);
  const program=h.events.find(([type])=>type==='program');assert(program[1] instanceof Uint16Array);assert.equal(program[1].length,512);
  assert.deepEqual(Object.keys(program[2].coefficients),['0','1','2']);
  const canonical=disassembleScspDsp(program[1]);assert.doesNotMatch(canonical,/MRD=|MWT=|ADRL=|ADREB=|MASA=/);
  assert(h.events.findIndex(([type])=>type==='program')<h.events.findIndex(([type])=>type==='pcm'),'unsupported DSP fails before sample allocation');
  // An Apply-style evaluation keeps setup and replaces the same named loops.
  await h.run(sources[i]);assert.equal(h.loops.size,2);assert.deepEqual(h.events,setupEvents);
  const melody=[...h.loops].find(([name])=>name.endsWith('melody'))[1];
  const motion=[...h.loops].find(([name])=>name.endsWith('motion'))[1];
  await melody();assert.deepEqual(h.events.slice(-4).map(([type])=>type),['on','beat','off','beat']);
  assert.deepEqual(h.events.filter(([type])=>type==='beat').map(([,value])=>value),[.375,.125]);
  const notesBefore=h.events.filter(([type])=>type==='on'||type==='off').length;
  await motion();assert.equal(h.coefficients.length,5);
  assert.equal(h.events.filter(([type])=>type==='on'||type==='off').length,notesBefore,'coefficient motion never retriggers the voice');
  if(i===0)assert.deepEqual(h.coefficients.map(patch=>patch[0]),[1024,2048,3072,2048,1024]);
  else for(const patch of h.coefficients)assert.equal(patch[1]+patch[2],4096);
  assert.doesNotMatch(sources[i],/\b(?:sleep|sleepSamples|setTimeout|reset)\s*\(/,'the musical tempo follows beats and setup preserves existing sample banks');
});

let module;
for(let i=0;i<paths.length;i++)test(`${paths[i]} runs its actual setup and live motion through the SCSP WASM`,async t=>{
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const core=await Scsp.create({moduleFactory:()=>module}),synth=new ScspSynth(core);
  t.after(()=>synth.dispose());
  const loops=new Map();
  await new AsyncFunction('useSoundChip','setBpm','livePrepare','assembleScspDsp','log','scale','liveLoop','choose','beat','tween',sources[i])(
    async()=>synth,()=>{},async(_name,prepare)=>prepare(),assembleScspDsp,()=>{},()=>['E3'],
    (name,loop)=>loops.set(name,loop),notes=>notes[0],async()=>{},
    async(_seconds,update)=>{for(const p of [0,.25,.5,.75,1]){await update(p);synth.generateStereo(256);}},
  );
  assert(synth.getDspProgram().configured);
  assert.equal(synth.getState().slots[0].directLevel,0);
  assert.equal(synth.getState().slots[0].dspSend,7);
  synth.noteOn(0,'E3');
  const output=synth.generateStereo(4096).left;
  const peak=output.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
  assert(peak>1e-4&&peak<.3,'quiet sample reaches the hardware DSP return without clipping');
  assert(output.every(Number.isFinite));
  const ram=core.readRam(),state=synth.getState();
  const motion=[...loops].find(([name])=>name.endsWith('motion'))[1];
  await motion();
  assert(synth.getState().slots[0].gate,'live coefficients retain the held note');
  assert.deepEqual(core.readRam(),ram,'coefficient motion never writes sample RAM');
  assert.equal(synth.getState().ramUsedBytes,state.ramUsedBytes);
  synth.setDspCoefficients(i===0?{0:0}:{1:0,2:0});
  assert(synth.generateStereo(256).left.subarray(128).every(value=>value===0),'zero coefficients mute the actual wet path');
});
