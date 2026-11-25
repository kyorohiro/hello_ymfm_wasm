// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDX7} from '../js/msfa_dx7/src/index.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {Fm21290} from './chip.js';
import {createInstrument} from './instrument.js';

for(const engine of ['MSFA','OPS/EGS'])test(engine+' retargets held and releasing OP1 without another note-on',async()=>{
  const core=new Fm21290();
  const chip=createInstrument((address,value)=>core.writeRegister(address,value));
  const msfa=engine==='MSFA'?await createDX7({sampleRate:48000,wasmUrl:new URL('../js/msfa_dx7/wasm/msfa.wasm',import.meta.url)}):null;
  let voice=presetToVoice({algorithm:0,operators:{1:{outputLevel:95,envelope:{rates:[99,99,99,0],levels:[99,99,99,0]}}}});
  function envelope(patch){
    if(msfa)msfa.setOperator(1,{envelope:patch});
    else{
      voice=presetToVoice({operators:{1:{envelope:patch}}},voice);
      chip.setPatch(voiceToPreset(voice));
    }
  }
  function peak(){
    const pcm=msfa?msfa.render(12000):new Float32Array(12000);
    if(!msfa)core.renderInto(pcm);
    return Math.max(...pcm.slice(-1024).map(Math.abs));
  }
  try{
    if(msfa)msfa.setPreset(voiceToPreset(voice));else chip.setPatch(voiceToPreset(voice));
    (msfa??chip).noteOn(60,100);
    const loud=peak();assert(loud>0.01);
    envelope({levels:[99,99,30,0]});assert(peak()<loud*0.1);
    envelope({levels:[99,99,99,0]});assert(peak()>loud*0.9);
    (msfa??chip).noteOff(60);assert(peak()>loud*0.5);
    envelope({rates:[99,99,99,99]});assert(peak()<loud*0.01);
  }finally{msfa?.dispose();}
});
