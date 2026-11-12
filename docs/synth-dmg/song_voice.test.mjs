import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGameboySongVoice} from './song_voice.js';
import {readPreset} from './preset.js';
function snapshot(){
  const registers=Array(48).fill(0),voice=Array(48).fill(0);
  registers[22]=voice[22]=128;registers[21]=voice[21]=0xff;
  voice[0]=0x6b;voice[1]=0x80;voice[2]=0x9a;voice[6]=0x40;voice[7]=0xb3;
  voice[10]=128;voice[12]=0x60;voice[17]=0xc9;voice[18]=0x5d;
  for(const base of [0,5,10]){registers[base+3]=0x34;registers[base+4]=2;}
  for(let index=0;index<16;index++)registers[32+index]=(index<<4)|(15-index);
  return {clock:4194304,initialized:true,positionFrames:12345,registers,voice};
}

test('DMG paused voice preparation preserves each physical source and only CH1 Sweep',()=>{
  const state=snapshot(),one=prepareGameboySongVoice(state,0),two=prepareGameboySongVoice(state,1);
  assert(one.playable);assert(two.playable);assert.equal(one.preset.pulse.duty,.5);assert.equal(two.preset.pulse.duty,.25);
  assert.deepEqual(one.preset.pulse.envelope,{direction:'up',period:2});assert.equal(one.preset.pulse.volume,9);
  assert.deepEqual(one.preset.pulse.sweep,{enabled:true,direction:'down',period:6,shift:3});assert.equal(two.preset.pulse.sweep.enabled,false);
  assert.equal(one.period,0x234);assert.equal(one.positionFrames,12345);assert(Number.isFinite(one.midi));
  assert.deepEqual(readPreset(one.preset),one.preset);assert(!Object.hasOwn(one.preset,'midi'));assert(!Object.hasOwn(one.preset,'positionFrames'));
  one.preset.pulse.envelope.period=0;assert.equal(state.voice[2],0x9a);
});

test('DMG Wave uses all 32 nibbles/level/pan and Noise preserves clock without an invented pitch',()=>{
  const state=snapshot();state.registers[21]=0x84;
  const wave=prepareGameboySongVoice(state,2,{name:'Captured Wave'}),noise=prepareGameboySongVoice(state,3);
  assert.equal(wave.preset.name,'Captured Wave');assert.equal(wave.preset.wave.level,.25);
  assert.deepEqual(wave.preset.wave.samples,Array.from({length:32},(_,i)=>i%2?15-(i>>1):i>>1));
  assert.deepEqual(wave.preset.pan,{left:false,right:true});assert.deepEqual(noise.preset.pan,{left:true,right:false});
  assert.deepEqual(noise.preset.noise,{volume:12,envelope:{direction:'up',period:1},divisor:5,shift:5,width:7});
  assert.equal(noise.period,null);assert.equal(noise.frequencyHz,null);assert.equal(noise.midi,null);
  wave.preset.wave.samples[0]=15;assert.equal(state.registers[32],15);
});

test('DMG preparation explains silent configured voices without claiming native gate or envelope readback',()=>{
  for(const[channel,mutate,pattern]of [
    [0,s=>s.registers[22]=0,/powered off/],[0,s=>s.voice[2]=0,/DAC is off/],
    [2,s=>s.voice[10]=0,/Wave DAC/],[2,s=>s.voice[12]=0,/muted/],
    [3,s=>s.registers[21]=0,/neither/],[1,s=>s.voice[7]=8,/zero volume/],
  ]){const state=snapshot();mutate(state);const value=prepareGameboySongVoice(state,channel);assert.equal(value.playable,false);assert.match(value.reason,pattern);}
  const rising=snapshot();rising.voice[7]=9;assert(prepareGameboySongVoice(rising,1).playable);
  const state=snapshot();assert.throws(()=>prepareGameboySongVoice({...state,clock:1},0),/clock/);
  assert.throws(()=>prepareGameboySongVoice({...state,positionFrames:NaN},0),/frame/);
  assert.throws(()=>prepareGameboySongVoice(state,4),/channel/);
});
