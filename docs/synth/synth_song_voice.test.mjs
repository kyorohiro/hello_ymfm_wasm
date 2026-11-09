import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import createModule from '../generated/ym2612_wasm.js';
import {Ym2612} from '../js/ym2612.js';
import {YM2612Synth, YM2612DirectTransport} from '../js/ym2612synth.js';
import {createYm2612RegisterState} from './synth_song_state.js';
import {createSynthSongVoice, describeSynthSongVoice} from './synth_song_voice.js';

function makeSnapshot(channel=0, {keyMask=8, special=false, csm=false, dac=false, baseFnum=1200}={}) {
  const shadow = createYm2612RegisterState(), port=channel >= 3 ? 1 : 0, offset=channel % 3;
  shadow.write(port, 0xb0+offset, 7);
  shadow.write(port, 0xb4+offset, 0xc0);
  for (const [operator, slot] of [0,8,4,12].entries()) {
    shadow.write(port, 0x30+offset+slot, 1);
    shadow.write(port, 0x40+offset+slot, operator === 3 ? 16 : 127);
    shadow.write(port, 0x50+offset+slot, 31);
    shadow.write(port, 0x80+offset+slot, 15);
  }
  shadow.write(port, 0xa4+offset, (4<<3)|(baseFnum>>8));
  shadow.write(port, 0xa0+offset, baseFnum&255);
  if (special) {
    shadow.write(0, 0x27, csm ? 0x80 : 0x40);
    for (const [low, high, block, fnum] of [[0xa9,0xad,3,1200],[0xaa,0xae,4,1800],[0xa8,0xac,5,1200]]) {
      shadow.write(0, high, (block<<3)|(fnum>>8));
      shadow.write(0, low, fnum&255);
    }
  }
  shadow.write(0, 0x2b, dac ? 0x80 : 0);
  const keyChannel=(channel % 3)|(channel >= 3 ? 4 : 0);
  shadow.write(0, 0x28, (keyMask<<4)|keyChannel);
  shadow.write(0, 0x28, keyChannel); // Pause may fall in a release / between notes.
  return shadow.snapshot(1024);
}

function captureSynth() {
  const writes=[];
  let resets=0;
  const synth=new YM2612Synth({transport:{
    write(port,register,value){writes.push({port,register,value});},
    reset(){resets++; writes.length=0;},
  }});
  return {synth,writes,get resets(){return resets;}};
}

test('paused audition routes the selected hardware channel and last nonzero logical key mask', () => {
  for (let channel=0;channel<6;channel++) {
    const snapshot=makeSnapshot(channel,{keyMask:10}), original=JSON.stringify(snapshot), capture=captureSynth();
    assert.equal(snapshot.channels[channel].keyMask,0);
    assert.equal(snapshot.channels[channel].lastKeyMask,10);
    const voice=createSynthSongVoice(capture.synth,snapshot,channel);
    voice.noteOn(0,4,1000); // Caller-provided channel must not redirect selection.
    const keyChannel=channel % 3|(channel >= 3 ? 4 : 0);
    assert.deepEqual(capture.writes.at(-1),{port:0,register:0x28,value:0xa0|keyChannel});
    const actual=capture.synth.channels[channel];
    assert.equal(actual.algorithm,7);
    assert.equal(actual.operators[3].tl,16);
    assert.equal(actual.operators[1].tl,127);
    assert.equal(actual.fnum,1000);
    voice.noteOff(0);
    assert.deepEqual(capture.writes.at(-1),{port:0,register:0x28,value:keyChannel});
    assert.equal(JSON.stringify(snapshot),original,'audition never edits the observed snapshot');
  }
});

test('CH3 keyboard tuning and subsequent bend preserve all four special-frequency ratios', () => {
  const snapshot=makeSnapshot(2,{special:true}), capture=captureSynth();
  const voice=createSynthSongVoice(capture.synth,snapshot,2);
  voice.noteOn(0,4,1000);
  const frequencies=()=>capture.synth.channels[2].specialFrequencies.map(pitch=>pitch.fnum*2**pitch.block);
  assert.deepEqual(frequencies(),[8000,24000,32000,16000]);
  voice.setFrequency(0,4,1120);
  assert.deepEqual(frequencies(),[8960,26880,35840,17920]);
  voice.setFrequency(0,4,1000);
  assert.deepEqual(frequencies(),[8000,24000,32000,16000],'bend uses frozen ratios without accumulating error');
  assert.equal(capture.synth._modeRegister,0x40,'manual special mode only; no timer/CSM state is copied');
});

test('DAC, CSM and missing CH3 base pitch reject audition before resetting the keyboard chip', () => {
  const capture=captureSynth(), initial=capture.resets;
  for (const [snapshot,channel,reason] of [
    [makeSnapshot(5,{dac:true}),5,/DAC \/ PCM/],
    [makeSnapshot(2,{special:true,csm:true}),2,/CSM/],
    [makeSnapshot(2,{special:true,baseFnum:0}),2,/OP4 base pitch/],
    [null,0,/No YM2612/],
  ]) {
    const description=describeSynthSongVoice(snapshot,channel);
    assert.equal(description.playable,false);assert.match(description.reason,reason);
    assert.throws(()=>createSynthSongVoice(capture.synth,snapshot,channel),reason);
  }
  assert.equal(capture.resets,initial,'unsupported preview cannot discard an existing keyboard sound');
  assert.equal(describeSynthSongVoice(makeSnapshot(0,{dac:true}),0).playable,true,'other FM channels remain playable with DAC on');
});

test('real WASM plays the frozen released CH6 carrier with its partial key mask', async () => {
  const chip=await Ym2612.create({moduleFactory:createModule,
    moduleOptions:{wasmBinary:await readFile(new URL('../generated/ym2612_wasm.wasm',import.meta.url))}});
  try {
    const synth=new YM2612Synth({transport:new YM2612DirectTransport(chip)});
    const voice=createSynthSongVoice(synth,makeSnapshot(5),5);
    voice.noteOn(5,4,1088);
    const acRms=samples=>{
      const mean=samples.reduce((sum,value)=>sum+value,0)/samples.length;
      return Math.sqrt(samples.reduce((sum,value)=>sum+(value-mean)**2,0)/samples.length);
    };
    const sounding=chip.generateStereo(5000);
    assert(acRms(sounding.left.subarray(1000))>.02,'released source gate does not prevent a fresh keyboard attack');
    voice.noteOff(5);
    chip.generateStereo(10000);
    const released=chip.generateStereo(4000);
    assert(acRms(released.left)<1e-5,'keyboard key-off releases the actual chosen channel');
  } finally {chip.dispose();}
});
