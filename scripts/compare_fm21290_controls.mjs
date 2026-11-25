// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDX7} from '../docs/js/msfa_dx7/src/index.js';
import {presetToVoice,voiceToPreset} from '../docs/js/msfa_dx7/src/preset.js';
import {EVENT,Fm21290,PM} from '../docs/synth-fm21290/chip.js';
import {createInstrument} from '../docs/synth-fm21290/instrument.js';
import {ModulatedChip} from '../docs/synth-fm21290/modulation.js';
import {createPartPlayer} from '../docs/synth-fm21290/midi_part.js';
import {createMsfaNotes} from '../docs/synth-fm21290/msfa_notes.js';

const wasmBytes=await readFile(new URL('../docs/js/msfa_dx7/wasm/msfa.wasm',import.meta.url));
const preset=voiceToPreset(presetToVoice({operators:{1:{outputLevel:85,
  envelope:{rates:[99,99,99,99],levels:[99,99,99,0]}}}}));
function frequency(pcm,rate){
  const edges=[];
  for(let i=Math.floor(pcm.length/2);i<pcm.length;i++){
    if(pcm[i-1]<=0 && pcm[i]>0)edges.push(i-1-pcm[i-1]/(pcm[i]-pcm[i-1]));
  }
  assert.ok(edges.length>40,'measurable steady tone');
  return (edges.length-1)*rate/(edges.at(-1)-edges[0]);
}
function rms(pcm){
  let sum=0;
  for(let i=pcm.length/2;i<pcm.length;i++)sum+=pcm[i]**2;
  return Math.sqrt(sum/(pcm.length/2));
}

for(const sampleRate of [44100,48000]){
  for(const engine of ['chip','msfa']){
    let controls,render,pmWord,dx;
    const gates=[];
    if(engine==='chip'){
      const chip=new Fm21290(sampleRate),cpu=new ModulatedChip(chip);
      cpu.configure(preset.lfo);cpu.pitchEnvelope.configure(preset.pitchEnvelope);
      const keys=createInstrument((a,v)=>{
        chip.writeRegister(a,v);if(a===EVENT)gates.push(v);
      },(ch,p)=>cpu.keyOn(ch,p),ch=>cpu.pitchEnvelope.keyOff(ch));
      keys.setPatch(preset);
      controls={...keys,setBend:v=>cpu.setBend(v),stop:()=>keys.stopOwner(undefined)};
      render=n=>{const pcm=new Float32Array(n);cpu.renderInto(pcm);return pcm;};
      pmWord=()=>(chip.reg[PM&255]<<8)|chip.reg[(PM+1)&255];
    }else{
      dx=await createDX7({sampleRate,wasmBytes});
      dx.setPreset(preset);
      const notes=createMsfaNotes(dx);
      controls={...notes,stop:()=>notes.stopOwner(undefined)};
      render=n=>dx.render(n);
    }
    try{
      const part=createPartPlayer(controls);
      part.noteOn(69,127);
      for(const [bend,semitones,word] of [[0,-2,0xfd55],[8192,0,0],[16383,2,0x02ab],[8192,0,0]]){
        part.pitchBend(bend);
        if(pmWord)assert.equal(pmWord(),word);
        const hz=frequency(render(sampleRate/2),sampleRate);
        const expected=440*2**((engine==='chip'?semitones:0)/12);
        const cents=1200*Math.log2(hz/expected);
        console.log(JSON.stringify({sampleRate,engine,bend,pmWord:pmWord?.(),hz:+hz.toFixed(3),errorCents:+cents.toFixed(3)}));
        assert.ok(Math.abs(cents)<2,'A4 pitch within two cents');
      }
      part.noteOff(69);render(sampleRate/2);
      for(const cc64 of [0,1,63,64,127]){
        part.noteOn(69,127);
        const held=rms(render(sampleRate/2));
        assert.ok(held>0.001);
        const keyOffByte=(gates.at(-1)&0x3c)|2;
        gates.length=0;
        part.sustain(cc64);part.noteOff(69);
        if(pmWord)assert.deepEqual(gates.splice(0),cc64===0?[keyOffByte]:[]);
        const afterOff=rms(render(sampleRate/2))/held;
        part.sustain(0);
        if(pmWord)assert.deepEqual(gates.splice(0),cc64===0?[]:[keyOffByte]);
        const afterPedalUp=rms(render(sampleRate/2))/held;
        console.log(JSON.stringify({sampleRate,engine,cc64,afterOff:+afterOff.toFixed(5),afterPedalUp:+afterPedalUp.toFixed(5)}));
        if(cc64>=(engine==='chip'?1:64))assert.ok(Math.abs(afterOff-1)<0.02);
        else assert.ok(afterOff<0.001);
        assert.ok(afterPedalUp<0.001);
      }
      part.finish();
    }finally{dx?.dispose();}
  }
}
