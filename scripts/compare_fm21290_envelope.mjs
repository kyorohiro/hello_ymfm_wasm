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
const windowSize = 240; // 5 ms peak windows contain >2 full periods of A4.
function peaks(pcm) {
  const result = [];
  for (let i=0; i<pcm.length; i+=windowSize) {
    let peak=0;
    for (let j=i; j<i+windowSize; j++) peak=Math.max(peak,Math.abs(pcm[j]));
    result.push(peak);
  }
  return result;
}

function measure(synth, preset) {
  synth.setPreset(preset);
  synth.noteOn(69,127);
  const held=peaks(synth.render(sampleRate*3));
  synth.noteOff(69);
  const released=peaks(synth.render(sampleRate*3));
  const sustain=held.slice(-20).reduce((a,b)=>a+b,0)/20;
  const peak=Math.max(...held);
  const attack=held.findIndex(x=>x>=peak*.9);
  const release=released.findIndex(x=>x<=sustain*.1);
  if (!(sustain>0 && peak>0 && attack>=0 && release>=0)) throw Error('Unmeasurable envelope');
  return {attack90ms:attack*5,sustainDB:+(20*Math.log10(sustain/peak)).toFixed(1),release20dBms:release*5};
}

for(const rate of [40,60,80]) {
  const core=new Fm21290(sampleRate);
  const instrument=createInstrument((a,d)=>core.writeRegister(a,d));
  const patch=voiceToPreset(presetToVoice({operators:{1:{envelope:{rates:[rate,85,85,rate],levels:[99,80,80,0]}}}}));
  const custom=measure({...instrument,setPreset:instrument.setPatch,render(n){const pcm=new Float32Array(n);core.renderInto(pcm);return pcm;}},patch);
  const msfa=await createDX7({sampleRate,wasmBytes});
  try {
    const reference=measure(msfa,patch);
    console.log(JSON.stringify({rate,custom,msfa:reference}));
    // Two peak windows allow for phase and block alignment.
    for (const metric of ['attack90ms','release20dBms'])
      assert.ok(Math.abs(custom[metric]-reference[metric])<=10, `rate ${rate}: ${metric}`);
    assert.ok(Math.abs(custom.sustainDB-reference.sustainDB)<=0.5, `rate ${rate}: sustain`);
  }
  finally {msfa.dispose();}
}
