// SPDX-License-Identifier: BSD-3-Clause
// Compare observable PCM, using a single carrier and the same patch at 48 kHz.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Fm21290} from '../docs/synth-fm21290/chip.js';
import {createInstrument} from '../docs/synth-fm21290/instrument.js';
import {createDX7} from '../docs/js/msfa_dx7/src/index.js';
import {presetToVoice,voiceToPreset} from '../docs/js/msfa_dx7/src/preset.js';

const sampleRate = 48000;
const wasmBytes = await readFile(new URL('../docs/js/msfa_dx7/wasm/msfa.wasm',import.meta.url));
const windowSize = 240; // 5 ms peak windows; low notes can straddle a window boundary.
function peaks(pcm) {
  const result = [];
  for (let i=0; i<pcm.length; i+=windowSize) {
    let peak=0;
    for (let j=i; j<i+windowSize; j++) peak=Math.max(peak,Math.abs(pcm[j]));
    result.push(peak);
  }
  return result;
}

function measure(synth, preset, note, velocity) {
  synth.setPreset(preset);
  synth.noteOn(note,velocity);
  const held=peaks(synth.render(sampleRate*3));
  synth.noteOff(note);
  const released=peaks(synth.render(sampleRate*3));
  const sustain=held.slice(-20).reduce((a,b)=>a+b,0)/20;
  const peak=Math.max(...held);
  const attack=held.findIndex(x=>x>=peak*.9);
  const release=released.findIndex(x=>x<=sustain*.1);
  if (!(sustain>0 && peak>0 && attack>=0 && release>=0)) throw Error('Unmeasurable envelope');
  return {peakDB:+(20*Math.log10(peak)).toFixed(1),attack90ms:attack*5,sustainDB:+(20*Math.log10(sustain/peak)).toFixed(1),release20dBms:release*5};
}

const cases = [40,60,80].map(rate=>({note:69, outputLevel:85, rateScaling:0, rate}));
for (const note of [45,69,93]) {
  for (const outputLevel of [65,85]) cases.push({note,outputLevel,rateScaling:5,rate:40});
}
for (const velocity of [32,64,96,127]) cases.push({note:69,outputLevel:85,rateScaling:0,rate:40,velocity,velocitySensitivity:4});
for(const {note,outputLevel,rateScaling,rate,velocity=127,velocitySensitivity=0} of cases) {
  const core=new Fm21290(sampleRate);
  const instrument=createInstrument((a,d)=>core.writeRegister(a,d));
  const patch=voiceToPreset(presetToVoice({operators:{1:{outputLevel,rateScaling,velocitySensitivity,envelope:{rates:[rate,85,85,rate],levels:[99,80,80,0]}}}}));
  const custom=measure({...instrument,setPreset:instrument.setPatch,render(n){const pcm=new Float32Array(n);core.renderInto(pcm);return pcm;}},patch,note,velocity);
  const msfa=await createDX7({sampleRate,wasmBytes});
  try {
    const reference=measure(msfa,patch,note,velocity);
    console.log(JSON.stringify({note,outputLevel,rateScaling,rate,velocity,velocitySensitivity,custom,msfa:reference}));
    // Attack tolerance is two peak windows. Quiet MSFA release tails have
    // larger threshold-crossing differences at the same nominal decay rate.
    assert.ok(Math.abs(custom.attack90ms-reference.attack90ms)<=10, `note ${note}: attack`);
    assert.ok(Math.abs(custom.release20dBms-reference.release20dBms)<=(velocitySensitivity ? 40 : rateScaling ? 15 : 10),
      `note ${note}, output ${outputLevel}: release`);
    assert.ok(Math.abs(custom.sustainDB-reference.sustainDB)<=(velocitySensitivity ? 1 : 0.5), `rate ${rate}: sustain`);
  }
  finally {msfa.dispose();}
}

// A physical-CH retrigger is observable on the register engine. MSFA's
// public allocator does not guarantee reuse of the releasing slot.
const core=new Fm21290(sampleRate);
const physical=createInstrument((a,d)=>core.writeRegister(a,d));
physical.setPatch(voiceToPreset(presetToVoice({operators:{1:{
  envelope:{rates:[40,85,85,40],levels:[99,80,80,0]}
}}})));
function firstPeak(ch) {
  physical.keyOn(ch,69,127);
  const pcm=new Float32Array(windowSize);
  core.renderInto(pcm);
  return peaks(pcm)[0];
}
const fresh=firstPeak(0);
core.renderInto(new Float32Array(sampleRate*3-windowSize));
physical.keyOff(0);
core.renderInto(new Float32Array(sampleRate/10));
const retriggered=firstPeak(0);
console.log(JSON.stringify({physicalCH:1,releaseGapMs:100,
  freshFirst5msDB:+(20*Math.log10(fresh)).toFixed(1),
  retriggerFirst5msDB:+(20*Math.log10(retriggered)).toFixed(1)}));
assert.ok(retriggered>fresh,'same-CH key-on continues from the remaining envelope level');
