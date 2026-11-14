// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import checker from '../../scripts/check_huc6280_synth_cdrom2_browser.cjs';
import {prepareMSM5205Sample} from '../js/msm5205_sample.js';
import {createMSM5205PCM} from '../js/msm5205_pcm.js';

function amplitude(channel,hz,rate){
  let sine=0,cosine=0;
  for(let i=0;i<channel.length;i++){const phase=i*2*Math.PI*hz/rate;sine+=channel[i]*Math.sin(phase);cosine+=channel[i]*Math.cos(phase);}
  return 2*Math.hypot(sine,cosine)/channel.length;
}
function pair(level,gain=.5,master=.7){
  const input={left:[.1,level,.15,.002],right:[.1,level,.003,.13]};
  return{muted:true,startFrame:48000,frames:9600,input,output:{left:input.left.map(x=>x*gain*master),right:input.right.map(x=>x*gain*master)}};
}

test('actual looping ADPCM changes amplitude across decoder laps; same-frame FX comparison remains valid',async t=>{
  const sample=await prepareMSM5205Sample({sampleRate:8000,channels:[Float32Array.from({length:8000},(_,i)=>.25*Math.sin(i*2*Math.PI*440/8000))]},{rate:12});
  const core=await createMSM5205PCM({sampleRate:48000,wasmBinary:await readFile(new URL('../generated/msm5205_wasm.wasm',import.meta.url))});
  t.after(()=>core.dispose());core.prepare(sample.data);core.play({loop:true,rate:12});
  const levels=[],steps=[];
  for(let block=0;block<7;block++){
    const left=new Float32Array(9600),right=new Float32Array(9600);core.render(left,right);
    assert.deepEqual(left,right);assert(left.every(Number.isFinite));
    levels.push(amplitude(left,440,48000));steps.push(core.readState().step);
  }
  const first=levels[0],later=levels[6],unpairedHalfRatio=.5*later/first;
  assert(first>.2&&first<.3);assert(later>first*3);assert.notEqual(steps[0],steps[6]);
  assert(unpairedHalfRatio>2,'separate first/later-lap windows falsely fail a real half-gain route');
  for(const level of[first,later])for(const gain of[1,.5]){
    const measured=checker.assertSharedFxPair(pair(level,gain),gain,.7);
    for(const value of Object.values(measured))assert(Math.abs(value-gain)<1e-12);
  }
  t.diagnostic(JSON.stringify({firstLapAmplitude:first,laterLapAmplitude:later,unpairedHalfRatio,firstStep:steps[0],laterStep:steps[6]}));
});

test('paired FX checks still reject a source bypass, missing source and incorrect Master scaling',()=>{
  const bypass=pair(.25);bypass.output.left[1]=bypass.input.left[1]*.7;
  assert.throws(()=>checker.assertSharedFxPair(bypass,.5,.7),/shared liveFx/);
  const missing=pair(.25);missing.input.right[3]=0;
  assert.throws(()=>checker.assertSharedFxPair(missing,.5,.7),/real input/);
  assert.throws(()=>checker.assertSharedFxPair(pair(.25),.5,.35),/shared liveFx/);
});

test('paired capture requires a real shared render frame and muted physical output',()=>{
  for(const change of[value=>value.startFrame=undefined,value=>value.muted=false,value=>value.frames=128]){
    const value=pair(.25);change(value);assert.throws(()=>checker.assertSharedFxPair(value,.5,.7));
  }
});
