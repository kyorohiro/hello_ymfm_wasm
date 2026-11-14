// SPDX-License-Identifier: BSD-3-Clause
// Real WASM/timeline, without AudioContext or an audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {createHuc6280SongTimeline} from './song_state.js';
import {createHuc6280SongManual} from './song_manual.js';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const wave=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16)));
const period=(state,ch)=>(state.registers[ch][2]|(state.registers[ch][3]&15)<<8)||4096;
function program(engine,ch,{dda=false,noise=false}={}){
  const write=(register,value)=>engine.writeHuc6280(register,value);
  write(0,ch);write(4,64);write(4,0);for(const value of wave)write(6,value);
  write(2,254);write(3,0);write(5,ch===2?0x73:255);write(7,noise?0x8c:0);write(4,dda?223:159);
}
async function setup(t,{initialize=true}={}){
  const engine=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:HUC6280_CLOCK,outputSampleRate:44100});
  const timeline=createHuc6280SongTimeline(engine),mutations=[];
  if(initialize){engine.writeHuc6280(1,255);engine.writeHuc6280(8,4);engine.writeHuc6280(9,0);for(let ch=0;ch<6;ch++)program(engine,ch);engine.writeHuc6280(0,2);}
  const manual=createHuc6280SongManual({engine,timeline,onMutation:event=>mutations.push(event)});
  t.after(()=>{manual.dispose();timeline.dispose();engine.dispose();});return{engine,timeline,manual,mutations};
}
const peak=pcm=>Math.max(...pcm.left.map(Math.abs),...pcm.right.map(Math.abs));

test('manual sparse fields keep the selector and untouched channels, become heard only at the producer frontier, and match native PCM',async t=>{
  const a=await setup(t),b=await setup(t);
  assert.deepEqual(a.engine.processFrames(256),b.engine.processFrames(256));a.timeline.read(0);
  const before=a.timeline.peek(),result=a.manual.applyEdit({channel:0,changes:{volume:12,'pan.left':7}});
  assert.deepEqual(result,{applied:true,frame:256});assert.equal(a.engine.selectedChannel,2);
  assert.equal(a.timeline.read(128).registers[0][4]&31,31,'prefetched sound/settings stay unchanged');
  const after=a.timeline.read(256);assert.equal(after.registers[0][4]&31,12);assert.equal(after.registers[0][5],0x7f);
  assert.deepEqual(after.registers[1],before.registers[1]);assert.equal(period(after,0),254);assert(after.registers[0][4]&128);
  b.engine.writeHuc6280(0,0);b.engine.writeHuc6280(4,0x8c);b.engine.writeHuc6280(5,0x7f);b.engine.writeHuc6280(0,2);
  const pcm=a.engine.processFrames(2048);assert.deepEqual(pcm,b.engine.processFrames(2048));assert(peak(pcm)>.001);
  assert.deepEqual(a.mutations,[{frame:256}]);
});

test('later VGM gate or Wave writes retire hand owners even for unchanged bytes; stream hooks do not duplicate',async t=>{
  const f=await setup(t),events=[],unsubscribe=f.timeline.onWrite(event=>events.push(event));
  f.manual.noteOn('hand',69,0);f.manual.setPitch(1);assert.equal(f.manual.read().voices.length,1);
  const control=f.timeline.peek().registers[0][4];f.engine.writeHuc6280(0,0);f.engine.writeHuc6280(4,control);f.engine.writeHuc6280(0,2);
  const gate=f.timeline.peek();assert.equal(f.manual.noteOff('hand'),false);f.manual.setPitch(0);assert.deepEqual(f.timeline.peek(),gate);
  f.manual.noteOn('stream-owner',72,0);events.length=0;
  f.engine.writeHuc6280Stream(0,6,22);
  assert.deepEqual(events.map(({register,value,channel})=>[register,value,channel]),[[0,0,2],[6,22,0],[0,2,0]]);
  assert.equal(f.manual.noteOff('stream-owner'),false);assert.equal(f.engine.selectedChannel,2);
  unsubscribe();
});

test('VGM frequency writes survive old Pitch reset while shared LFO parameter writes preserve independent bend ownership',async t=>{
  const f=await setup(t);f.manual.noteOn('pitch',69,0);const base=period(f.timeline.peek(),0);f.manual.setPitch(1);
  f.engine.writeHuc6280(8,12);f.engine.writeHuc6280(9,0x82);f.manual.setPitch(0);
  assert.equal(period(f.timeline.peek(),0),base);assert.equal(f.timeline.peek().globals[8],12);assert.equal(f.timeline.peek().globals[9],0x82);
  f.manual.setPitch(1);f.engine.writeHuc6280(0,0);f.engine.writeHuc6280(2,77);f.engine.writeHuc6280(3,1);f.engine.writeHuc6280(0,2);
  const before=f.timeline.peek(),count=f.mutations.length;f.manual.setPitch(0);
  assert.deepEqual(f.timeline.peek(),before);assert.equal(f.mutations.length,count,'no native restoration can overwrite the later frequency');
  assert.equal(f.manual.noteOff('pitch'),true,'frequency ownership and the hand gate are separate');
  assert.equal(f.timeline.peek().registers[0][4]&128,0);
});

test('patch validation and unknown untouched fields reject before any write or mutation notification',async t=>{
  const f=await setup(t,{initialize:false});f.engine.writeHuc6280(0,0);f.engine.writeHuc6280(4,159);f.engine.writeHuc6280(9,0);
  for(const changes of [{volume:9,'pan.left':5},{volume:99},{wave:[1,2]},{source:'noise'},
    {source:'dda'},{'envelope.enabled':true},{'lfo.mode':'follow'},{'dda.speed':2},JSON.parse('{"__proto__":3}')]){
    const before=f.timeline.peek();assert.throws(()=>f.manual.applyEdit({channel:0,changes}));assert.deepEqual(f.timeline.peek(),before);assert.equal(f.mutations.length,0);
  }
  assert.equal(f.manual.read().channels[0].playable,false);
  f.manual.applyEdit({channel:0,changes:{wave:[...wave],'pan.left':7,'pan.right':15}});
  assert.equal(f.manual.read().channels[0].playable,true,'a deliberate complete RAM replacement creates known data');
  assert.deepEqual(f.timeline.peek().waveforms[0],wave);assert.equal(f.timeline.peek().registers[0][4],159);
});

test('Wave replacement preserves a hand gate; Noise/LFO retain physical routing; DDA never borrows a PCM asset',async t=>{
  const f=await setup(t);f.manual.noteOn('draw',69,0);f.engine.processFrames(128);
  const replacement=Array.from({length:32},(_,i)=>i<16?31:0);f.manual.applyEdit({channel:0,changes:{wave:replacement}});
  assert.deepEqual(f.timeline.peek().waveforms[0],replacement);assert.equal(f.manual.noteOff('draw'),true);
  f.manual.applyEdit({channel:4,changes:{source:'noise','noise.frequency':21}});f.manual.noteOn('noise',12,4);
  assert.equal(f.timeline.peek().registers[4][7],0x95);f.manual.setPitch(2);assert.equal(period(f.timeline.peek(),4),254);
  f.manual.noteOff('noise');
  f.manual.applyEdit({channel:0,changes:{'lfo.enabled':true,'lfo.depth':3,'lfo.reset':true,'lfo.frequency':7,'lfo.modulatorPeriod':333}});
  assert.equal(f.timeline.peek().globals[9],0x83);assert.equal(f.timeline.peek().globals[8],7);
  assert.equal(f.manual.read().channels[1].playable,false);const mod=period(f.timeline.peek(),1);
  f.manual.noteOn('lfo',72,0);f.manual.setPitch(1);assert.equal(period(f.timeline.peek(),1),mod);f.manual.noteOff('lfo');
  program(f.engine,3,{dda:true});const state=f.manual.read().channels[3];assert.equal(state.source,'dda');assert.equal(state.playable,false);assert.match(state.reason,/not a captured PCM/);
  assert.throws(()=>f.manual.noteOn('not-pcm',60,3),/not a captured PCM/);
  f.manual.applyEdit({channel:3,changes:{volume:10,'pan.right':4}});assert.equal(f.timeline.peek().registers[3][4]&64,64);
  assert.equal(f.timeline.peek().registers[3][4]&31,10);
});

test('manual output gates and cleanup cannot release newer VGM gates; reset/disposal retire all leases',async t=>{
  const f=await setup(t);f.engine.writeHuc6280(0,1);f.engine.writeHuc6280(4,31);f.engine.writeHuc6280(0,2);
  f.manual.applyEdit({channel:0,changes:{'lfo.output.enabled':true}});f.manual.releaseKeyboard();assert.equal(f.timeline.peek().registers[1][4]&128,0);
  f.manual.noteOn('old',69,0);f.engine.writeHuc6280(0,0);f.engine.writeHuc6280(4,159);f.engine.writeHuc6280(0,2);
  f.manual.releaseKeyboard();assert.equal(f.timeline.peek().registers[0][4]&128,128);
  f.manual.noteOn('reset',69,0);f.engine.reset();assert.equal(f.manual.read().voices.length,0);assert.equal(f.manual.noteOff('reset'),false);
  f.manual.dispose();assert.equal(f.manual.read().available,false);assert.throws(()=>f.manual.applyEdit({channel:0,changes:{volume:9}}),/disposed/);
});
