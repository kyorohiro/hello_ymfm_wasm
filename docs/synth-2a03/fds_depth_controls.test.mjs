// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {prepareFdsDepthComparison, describeFdsDepthEnvelope} from './fds_depth_controls.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
const metric = (samples, rate) => {
  const crossings = [];
  for (let n=1;n<samples.length;n++) if (samples[n-1]<=0 && samples[n]>0) crossings.push(n-1-samples[n-1]/(samples[n]-samples[n-1]));
  const frequencies = crossings.slice(1).map((value,index)=>rate/(value-crossings[index]));
  const mean = frequencies.reduce((sum,value)=>sum+value,0)/frequencies.length;
  return Math.sqrt(frequencies.reduce((sum,value)=>sum+(value-mean)**2,0)/frequencies.length);
};

test('explicit depth comparison keeps authored sound data and direction in detached validated preset data', () => {
  const source = createDefaultPreset(); source.name = 'Imported FDS voice'; source.source = 'dmc';
  source.fds.wave = Array.from({length:64},(_,index)=>(index*7)%64);
  source.fds.volume = 13; source.fds.master = 2;
  source.fds.envelope = {enabled:true,increase:false,period:17,initialGain:23};
  source.fds.modulation.envelope = {enabled:false,increase:false,period:2,initialGain:63};
  source.fds.modulation.depth = 51; source.fds.envelopeClock = {masterSpeed:0,halt:true};
  source.dmc.data = Array(17).fill(0xa5);
  const before = structuredClone(source), copy = prepareFdsDepthComparison(source);
  assert.deepEqual(source,before,'preparing a comparison never rewrites the imported sound');
  assert.deepEqual(readPreset(JSON.parse(JSON.stringify(copy))),copy);
  assert.equal(copy.source,'fds');assert.equal(copy.name,source.name);
  for(const property of ['wave','volume','master','envelope']) assert.deepEqual(copy.fds[property],source.fds[property]);
  for(const property of ['pulse','triangle','noise','dmc']) assert.deepEqual(copy[property],source[property]);
  assert.equal(copy.fds.modulation.depth,51);assert.equal(copy.fds.modulation.envelope.increase,false);
  assert.deepEqual(copy.fds.modulation.envelope,{enabled:true,increase:false,period:31,initialGain:16});
  assert.deepEqual(copy.fds.envelopeClock,{masterSpeed:232,halt:false});
  assert.equal(copy.fds.modulation.enabled,true);assert.equal(copy.fds.modulation.rate,8);assert.equal(copy.fds.modulation.bias,0);
  assert.deepEqual(copy.fds.modulation.table,[...Array(8).fill(1),...Array(16).fill(7),...Array(8).fill(1)]);
  copy.fds.wave[0]=63;copy.fds.modulation.table[0]=7;copy.dmc.data[0]=0;copy.pulse.envelope.enabled=true;
  assert.deepEqual(source,before,'all table, envelope and sample storage remains independent');
});

test('next-note depth descriptions disclose endpoints and shared clock / table clock conditions', () => {
  const preset = prepareFdsDepthComparison(createDefaultPreset());
  let description = describeFdsDepthEnvelope(preset);
  assert.equal(description.warning,false);assert.match(description.text,/Next note: Increase Depth 16 → 32/);assert.match(description.text,/0\.53 s/);assert.match(description.text,/modulation amount/);
  preset.fds.modulation.envelope.increase=false;
  description=describeFdsDepthEnvelope(preset);assert.equal(description.warning,false);assert.match(description.text,/Decrease Depth 16 → 0/);assert.match(description.text,/0\.53 s/);
  for(const [increase,initialGain] of [[true,32],[true,63],[false,0]]) {
    Object.assign(preset.fds.modulation.envelope,{increase,initialGain});description=describeFdsDepthEnvelope(preset);
    assert.equal(description.warning,true);assert.match(description.text,/no depth change/);
    if(initialGain===63)assert.match(description.text,/63 → 63/);
  }
  Object.assign(preset.fds.modulation.envelope,{increase:true,initialGain:16});
  for(const clock of [{masterSpeed:232,halt:true},{masterSpeed:0,halt:false}]) {
    preset.fds.envelopeClock=clock;description=describeFdsDepthEnvelope(preset);
    assert.equal(description.warning,true);assert.match(description.text,/Next note: Increase Depth 16 → 16/);assert.match(description.text,/Depth stays at 16/);assert.doesNotMatch(description.text,/reaches/);
  }
  preset.fds.envelopeClock={masterSpeed:232,halt:false};
  for(const modulation of [{enabled:false,rate:8},{enabled:true,rate:0}]) {
    Object.assign(preset.fds.modulation,modulation);description=describeFdsDepthEnvelope(preset);
    assert.equal(description.warning,true);assert.match(description.text,/table clock is stopped/);assert.match(description.text,/retained counter/);
    assert.doesNotMatch(description.text,/silent|inaudible|no sound/);
  }
  preset.fds.modulation.envelope.enabled=false;description=describeFdsDepthEnvelope(preset);
  assert.equal(description.warning,true);assert.match(description.text,/Next note: Depth Envelope is off/);
});

test('comparison directions really reach separate hardware gains and audible modulation ranges at both host rates', async t => {
  for(const rate of [44100,48000]) {
    const outcomes=[];
    for(const increase of [true,false]) {
      const core=await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate,fds:true});
      const instrument=new NesInstrument(core);t.after(()=>instrument.dispose());
      const draft=createDefaultPreset();draft.fds.modulation.envelope.increase=increase;
      const preset=prepareFdsDepthComparison(draft);instrument.loadPreset(preset);instrument.noteOn('audition',60);
      assert.equal(core.getState().fdsSweepGain,16);
      instrument.generateStereo(Math.round(.2*rate));assert.equal(core.getState().fdsSweepGain,increase?22:10);
      instrument.generateStereo(Math.round(.6*rate));assert.equal(core.getState().fdsSweepGain,increase?32:0);
      const pcm=instrument.generateStereo(Math.round(.2*rate));
      assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
      outcomes.push({gain:core.getState().fdsSweepGain,spread:metric(pcm.left,rate),preset:instrument.read().preset});
      assert.deepEqual(instrument.read().preset,preset);
    }
    assert(outcomes[0].spread>40,'raised depth gives strong frequency variation in actual PCM');
    assert(outcomes[1].spread<2,'decreased depth reaches an essentially unmodulated pitch');
  }
});

test('comparison helpers reject malformed authored settings without mutating the original', () => {
  const preset=createDefaultPreset();preset.fds.modulation.envelope.increase='false';const before=structuredClone(preset);
  assert.throws(()=>prepareFdsDepthComparison(preset));assert.throws(()=>describeFdsDepthEnvelope(preset));assert.deepEqual(preset,before);
});
