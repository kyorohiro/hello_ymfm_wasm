// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {createHuc6280RegisterState} from './song_state.js';
import {prepareHuc6280SongVoice} from './song_voice.js';
import {wave} from './song_test_helpers.mjs';
function fixture(){const state=createHuc6280RegisterState(),write=state.write;
  write(1,255);write(9,0);
  function voice(ch=0,{control=159,pan=255,noise=0,period=254,values=wave}={}){
    write(0,ch);write(4,64);write(4,0);for(const value of values)write(6,value);
    write(2,period&255);write(3,period>>>8&15);write(5,pan);if(ch>=4)write(7,noise);write(4,control);
  }
  return{state,write,voice,read:ch=>prepareHuc6280SongVoice(state.snapshot(1234),ch)};
}

test('ordinary Wave captures complete configured RAM without authored assets or a new song-pitch/root format',()=>{
  const f=fixture();f.voice();let result=f.read(0);
  assert(result.capturable);assert(result.playable);assert.equal(result.source,'wave');assert.deepEqual(result.preset.wave,wave);
  assert.equal(result.preset.envelope.enabled,false);assert.equal(result.preset.dda.data,'');assert.equal(result.preset.lfo.enabled,false);
  assert.equal(result.positionFrames,1234);assert.equal(result.period,254);assert.match(result.description,/keyboard supplies ordinary note pitch/);
  assert.equal(Object.hasOwn(result.preset,'rootNote'),false);
  result.preset.wave.fill(0);assert.deepEqual(f.state.snapshot().waveforms[0],wave,'prepared assets are detached');
});

test('unknown relevant fields reject with a human reason while ordinary Wave period is optional',()=>{
  for(const field of ['control','balance','global','lfo','wave','noise']){
    const f=fixture();f.voice(field==='noise'?4:0);const snapshot=structuredClone(f.state.snapshot(1234)),ch=field==='noise'?4:0;
    if(field==='control')snapshot.registers[ch][4]=null;
    if(field==='balance')snapshot.registers[ch][5]=null;
    if(field==='global')snapshot.globals[1]=null;
    if(field==='lfo')snapshot.globals[9]=null;
    if(field==='wave')snapshot.waveforms[ch][1]=null;
    if(field==='noise')snapshot.registers[ch][7]=null;
    const result=prepareHuc6280SongVoice(snapshot,ch);assert.equal(result.capturable,false,field);assert.equal(result.playable,false,field);assert.equal(result.preset,null);assert(result.reason.length>20);
  }
  const f=fixture();f.voice();const snapshot=structuredClone(f.state.snapshot(1234));snapshot.registers[0][2]=null;snapshot.registers[0][3]=null;
  const result=prepareHuc6280SongVoice(snapshot,0);assert(result.capturable);assert(result.playable);assert.equal(result.period,null);
});

test('Noise priority ignores DDA/LFO and Wave RAM; DDA sample inference is rejected explicitly',()=>{
  const f=fixture();f.voice(4,{control:223,noise:0x91});let snapshot=structuredClone(f.state.snapshot(1234));snapshot.waveforms[4].fill(null);snapshot.globals[9]=null;
  let result=prepareHuc6280SongVoice(snapshot,4);assert(result.capturable);assert(result.playable);assert.equal(result.source,'noise');assert.equal(result.preset.noise.frequency,17);
  assert.match(result.description,/do not transpose the Noise pitch/);assert(result.preset.wave.every(value=>value===0));
  f.write(7,0);result=f.read(4);assert.equal(result.source,'dda');assert.equal(result.capturable,false);assert.equal(result.playable,false);assert.match(result.reason,/not a complete sample/);
});

test('CH1 active LFO captures both normal Wave voices with fixed recorded periods; CH2 rejects and otherCH ignores global LFO',()=>{
  const f=fixture();f.voice(1,{control:151,pan:0x8b,period:19});f.voice(0,{control:158,period:0});f.write(8,7);f.write(9,0x82);
  const result=f.read(0);assert(result.capturable);assert(result.playable);assert.equal(result.source,'lfo');assert.equal(result.pair,true);
  assert.equal(result.preset.lfo.carrierPeriod,4096);assert.equal(result.preset.lfo.modulatorPeriod,19);assert.equal(result.preset.lfo.frequency,7);
  assert.equal(result.preset.lfo.depth,2);assert.equal(result.preset.lfo.reset,true);assert.equal(result.preset.lfo.mode,'recorded');assert.deepEqual(result.preset.lfo.wave,wave);
  assert.deepEqual(result.preset.lfo.output,{enabled:true,volume:23,pan:{left:8,right:11}});assert.match(result.description,/C4 reproduces/);
  assert.match(f.read(1).reason,/Select CH1/);assert.equal(f.read(1).capturable,false);
  f.voice(2);let snapshot=structuredClone(f.state.snapshot(1234));snapshot.globals[9]=null;snapshot.globals[8]=null;snapshot.waveforms[1].fill(null);
  const other=prepareHuc6280SongVoice(snapshot,2);assert(other.capturable);assert(other.playable);assert.equal(other.source,'wave');assert.equal(other.preset.lfo.enabled,false);
});

test('active LFO pairs require known control, pan, both waves, frequency and period bytes even for muted CH2',()=>{
  for(const change of [s=>s.registers[1][4]=null,s=>s.registers[1][4]=64,s=>s.registers[1][5]=null,
    s=>s.registers[1][2]=null,s=>s.registers[0][3]=null,s=>s.globals[8]=null,s=>s.waveforms[1][10]=null]){
    const f=fixture();f.voice(1,{control:0});f.voice(0);f.write(8,7);f.write(9,1);const snapshot=structuredClone(f.state.snapshot(1234));change(snapshot);
    const result=prepareHuc6280SongVoice(snapshot,0);assert.equal(result.capturable,false);assert.match(result.reason,/LFO|CH2/);
  }
});

test('known muted/constant configurations remain capturable but do not audition a misleading or DC-only sound',()=>{
  for(const options of [{control:31},{control:159,pan:0},{control:159,values:Array(32).fill(16)}]){
    const f=fixture();f.voice(0,options);const result=f.read(0);assert(result.capturable);assert.equal(result.playable,false);assert(result.reason);
  }
  const f=fixture();f.voice();f.write(1,0);const muted=f.read(0);assert(muted.capturable);assert.equal(muted.playable,false);assert.match(muted.reason,/mutes both/);
});

test('global hardware balance is folded into canonical levels without making either side louder, including quantization disclosure',()=>{
  let approximate=0;
  for(let i=0;i<256;i++){
    const f=fixture();f.voice(0,{control:128|(i%32),pan:(i*29)&255});f.write(1,i);const result=f.read(0),level=result.level;
    assert(result.capturable);assert(level.attenuation.every((value,index)=>value>=level.targetAttenuation[index]));
    assert(result.preset.volume<=(i%32));assert.equal(result.preset.pan.left,level.pan.left);
    if(i!==255)assert.match(result.warnings.join(' '),/Neither output is made louder/);
    if(level.error){approximate++;assert.match(result.warnings.join(' '),/conservative quantization/);}
  }
  assert(approximate<256,'exact attenuation matches are exercised');
});

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
async function native(){return Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});}
function program(core,global,volume,pan){core.writeHuc6280(1,global);core.writeHuc6280(9,0);core.writeHuc6280(0,0);core.writeHuc6280(4,64);core.writeHuc6280(4,0);for(const value of wave)core.writeHuc6280(6,value);core.writeHuc6280(2,254);core.writeHuc6280(3,0);core.writeHuc6280(5,pan.left<<4|pan.right);core.writeHuc6280(4,128|volume);}
test('native PCM confirms normalized global attenuation never amplifies either output',async()=>{
  for(const global of[0x8d,0x43,0xfe,0x01]){
    const f=fixture();f.voice(0,{control:157,pan:0xd9});f.write(1,global);const result=f.read(0),a=await native(),b=await native();
    try{program(a,global,29,{left:13,right:9});program(b,255,result.preset.volume,result.preset.pan);const original=a.processFrames(2048),normalized=b.processFrames(2048);
      for(const side of['left','right'])for(let i=0;i<2048;i++)assert(Math.abs(normalized[side][i])<=Math.abs(original[side][i])+1e-8,`${global} ${side}`);
    }finally{a.dispose();b.dispose();}
  }
});
