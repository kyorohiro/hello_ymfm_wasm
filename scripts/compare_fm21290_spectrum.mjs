// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Fm21290} from '../docs/synth-fm21290/chip.js';
import {createInstrument} from '../docs/synth-fm21290/instrument.js';
import {createDX7} from '../docs/js/msfa_dx7/src/index.js';
import {presetToVoice,voiceToPreset} from '../docs/js/msfa_dx7/src/preset.js';

const rate=48000;
const wasmBytes=await readFile(new URL('../docs/js/msfa_dx7/wasm/msfa.wasm',import.meta.url));

// Project the settled final 250 ms onto a Hann-windowed sinusoid.
function magnitude(pcm,hz) {
  const start=rate/4, count=rate/4;
  let re=0, im=0;
  for(let i=0;i<count;i++){
    const window=.5-.5*Math.cos(2*Math.PI*i/count);
    const phase=2*Math.PI*hz*i/rate;
    re+=pcm[start+i]*window*Math.cos(phase);
    im+=pcm[start+i]*window*Math.sin(phase);
  }
  return Math.hypot(re,im);
}

function makePreset(algorithm,levels,ratios) {
  return voiceToPreset(presetToVoice({algorithm:algorithm-1,feedback:0,oscillatorSync:true,
    operators:Object.fromEntries(levels.map((outputLevel,i)=>[i+1,{
      outputLevel,coarse:ratios[i],detune:7,velocitySensitivity:0,
      envelope:{rates:[99,99,99,99],levels:[99,99,99,0]}}]))}));
}

function twoOperators(algorithm,carrier,modulator,level,ratio=1,carrierRatio=1) {
  const levels=Array(6).fill(0), ratios=Array(6).fill(1);
  levels[carrier-1]=78;levels[modulator-1]=level;
  ratios[carrier-1]=carrierRatio;ratios[modulator-1]=ratio;
  return makePreset(algorithm,levels,ratios);
}

async function renderPair(preset) {
  const core=new Fm21290(rate),keys=createInstrument((a,d)=>core.writeRegister(a,d));
  keys.setPatch(preset);keys.noteOn(69,127);
  const pcm=new Float32Array(rate/2);core.renderInto(pcm);

  const msfa=await createDX7({sampleRate:rate,wasmBytes});
  try{
    msfa.setPreset(preset);msfa.noteOn(69,127);
    return [pcm,msfa.render(pcm.length)];
  }finally{msfa.dispose();}
}


// Measure the entire output path with isolated carriers at 1x through 8x.
// This separates MSFA's output filtering/resampling from inter-operator gain.
const response=[];
for(let h=1;h<=8;h++){
  const pair=await renderPair(twoOperators(32,1,2,0,1,h));
  response.push(pair.map(pcm=>magnitude(pcm,440*h)));
}
const db=ratio=>20*Math.log10(Math.max(1e-10,ratio));
async function compare(preset,label,pure=false){
  const pair=await renderPair(preset);
  const spectra=pair.map(pcm=>{
    const fundamental=magnitude(pcm,440);
    assert.ok(fundamental>0.01,'missing A4 fundamental');
    return response.map((_,i)=>db(magnitude(pcm,440*(i+1))/fundamental));
  });
  let maxError=0;
  for(let i=1;i<response.length;i++){
    const [custom,msfa]=spectra.map(values=>values[i]);
    if(pure || msfa < -70){
      assert.ok(custom < -65 && msfa < -65,'unexpected harmonic '+(i+1));
      continue;
    }
    const correction=db(response[i][0]/response[0][0])-db(response[i][1]/response[0][1]);
    maxError=Math.max(maxError,Math.abs(custom-msfa-correction));
  }
  const rounded=values=>values.map(v=>+v.toFixed(1));
  console.log(JSON.stringify({label,customDB:rounded(spectra[0]),
    msfaDB:rounded(spectra[1]),correctedMaxErrorDB:+maxError.toFixed(2)}));
  assert.ok(maxError<1,'corrected partials differ by '+maxError+' dB');
}
await compare(twoOperators(32,1,2,0),'single carrier',true);
await compare(twoOperators(32,1,2,75),'parallel carriers at 1:1',true);
for(const level of [60,75,88,99])
  await compare(twoOperators(1,1,2,level),'OP2 to OP1, OL'+level);
await compare(twoOperators(31,5,6,75,2),'OP6 to OP5, 2:1');

// Use unequal levels and ratios to distinguish routing changes across operators.
for(let algorithm=1;algorithm<=32;algorithm++){
  const preset=makePreset(algorithm,[77,69,64,74,66,61],[1,2,1,4,2,1]);
  await compare(preset,'six operators, algorithm '+algorithm);
}
