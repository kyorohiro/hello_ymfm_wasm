// Executed from an isolated npm installation. PCM arrays only; no audio device.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import {Rf5c164} from 'tetorica-fm2612/rf5c164.js';
import factory from 'tetorica-fm2612/generated/rf5c164_wasm.js';
import {RF5C164Synth,RF5C164DirectTransport} from 'tetorica-fm2612/rf5c164synth.js';
import {RF5C164Synth as extensionless} from 'tetorica-fm2612/rf5c164synth';
import {rf5c164NoteStep} from 'tetorica-fm2612/rf5c164_notes.js';

assert.equal(RF5C164Synth,extensionless,'package entry paths retain constructor identity');
const rate=48000,clock=12500000,period=256,step=Math.round(440*period*2048/(clock/384));
const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(runtimeAssetUrl('generated/rf5c164_wasm.wasm'))},sampleRate:rate});
const synth=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)});
const frequency=values=>{
  const crossings=[];
  for(let i=1;i<values.length;i++)if(values[i-1]<=0&&values[i]>0)crossings.push(i);
  assert(crossings.length>10,'installed RF5C164 must generate an actual periodic PCM signal');
  return (crossings.length-1)*rate/(crossings.at(-1)-crossings[0]);
};
try {
  const bytes=new Uint8Array(period+64);bytes.fill(255);
  for(let i=0;i<period;i++){
    const value=Math.sin(i*2*Math.PI/period);
    bytes[i]=Math.round(Math.abs(value)*90)|(value>=0?128:0);
  }
  await synth.loadMemory(bytes);
  synth.setRootNote('A4');
  for(let ch=0;ch<8;ch++){
    synth.setChannel(ch,{start:0,loopStart:0,step,volume:64,pan:{left:15,right:0}});
    synth.noteOn(ch,'A4');
    const root=chip.generateStereo(12000);assert(root.right.every(value=>value===0));
    assert(Math.abs(frequency(root.left)-440)<4);
    assert.equal(synth.setNote(ch,'A5'),rf5c164NoteStep('A5',{rootNote:'A4',baseStep:step}));
    const high=chip.generateStereo(12000);assert(Math.abs(frequency(high.left)-880)<7);
    synth.noteOff(ch);assert(chip.generateStereo(1024).left.slice(-256).every(value=>value===0));
    assert.equal(synth.setNote(ch,'A4'),step,'returning to Root must not compound earlier transposition');
  }
  assert.throws(()=>synth.noteOn(8,'A4'),RangeError);
  assert.throws(()=>synth.noteOn(0,128),RangeError);
  synth.reset();assert.throws(()=>synth.noteOn(0,'A4'),/positive raw playback step/);
}finally{chip.dispose();}
console.log('PASS installed RF5C164 note helpers: eight real WASM voices, root/octave, held retune, hard noteOff and entry identities; no device');
