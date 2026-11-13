import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSynthSongInteraction} from './synth_song_interaction.js';
import {createYm2612SongTimeline} from './synth_song_state.js';
import {installSynthSongOutputMix} from './synth_song_output_mix.js';
import {GenesisAudioEngine} from '../js/genesisaudioengine.js';
import ymFactory from '../generated/ym2612_wasm.js';
import psgFactory from '../generated/segapsg_wasm.js';

function fake() {
  const writes=[];let resets=0;
  const engine={writeYm2612(...args){writes.push(args);},processFrames(frames){return frames;},reset(){resets++;}};
  const timeline=createYm2612SongTimeline(engine),interaction=createSynthSongInteraction(engine);
  return {engine,timeline,interaction,writes,get resets(){return resets;},dispose(){interaction.dispose();timeline.dispose();}};
}
const edit=(interaction,changes,channel=0)=>interaction.applyEdit({channel,changes});
const latest=(host,channel=0)=>host.interaction.read().channels[channel];

test('construction and hand edits never reset the reference or initialize unrelated registers',()=>{
  const host=fake();try{
    assert.equal(host.resets,0);assert.deepEqual(host.writes,[]);
    edit(host.interaction,{'operators.1.multi':5});
    assert.deepEqual(host.writes,[[0,0x30,5]]);assert.equal(host.resets,0);
    assert.equal(host.interaction.releaseKeyboard(),false);assert.equal(edit(host.interaction,{}),false);
  }finally{host.dispose();}
});

test('partial edits preserve generation-head packed fields, not a stale audible view',()=>{
  const host=fake();try{
    host.engine.writeYm2612(0,0x30,0x12);host.engine.writeYm2612(0,0x50,0x41);host.engine.writeYm2612(0,0xb0,0x13);
    const frozen=host.timeline.read(0);host.engine.processFrames(100);
    host.engine.writeYm2612(0,0x30,0x75);host.engine.writeYm2612(0,0x50,0x9a);host.engine.writeYm2612(0,0xb0,0x27);
    const changes={'operators.1.multi':3,'operators.1.ar':12,feedback:7};edit(host.interaction,changes);
    assert.deepEqual(host.writes.slice(-3),[[0,0x30,0x73],[0,0x50,0x8c],[0,0xb0,0x3f]]);
    const shown=host.interaction.readSnapshot(frozen,0);
    assert.equal(shown.channels[0].preset.operators[1].multi,3);
    assert.equal(shown.channels[0].preset.operators[1].dt,1,'untouched observation stays frozen');
    assert.equal(host.interaction.readSnapshot(host.timeline.read(100),100).channels[0].preset.operators[1].dt,7);
    assert.deepEqual(Object.fromEntries(Object.entries(latest(host).preset.operators[1]).filter(([key])=>['dt','multi','rs','ar'].includes(key))),{dt:7,multi:3,rs:2,ar:12});
  }finally{host.dispose();}
});

test('validation is atomic for a multi-field edit or preset',()=>{
  const host=fake();try{
    for(const changes of [{algorithm:4,'operators.4.ar':32},{feedback:2,'pan.left':1},{algorithm:1,'operators.0.tl':2},{algorithm:1,keyMask:16}]){
      assert.throws(()=>edit(host.interaction,changes));assert.deepEqual(host.writes,[]);
    }
    assert.throws(()=>host.interaction.applyPreset(0,{algorithm:3,operators:[{multi:2},{ar:32}]}));assert.deepEqual(host.writes,[]);
  }finally{host.dispose();}
});

test('all logical OP slots, both ports, packed pan and shared LFO are preserved',()=>{
  const host=fake();try{
    host.engine.writeYm2612(1,0xb5,0xed);host.engine.writeYm2612(0,0x22,0xf5);
    edit(host.interaction,{'operators.1.tl':11,'operators.2.tl':22,'operators.3.tl':33,'operators.4.tl':44,'pan.left':false,'lfo.enabled':true},4);
    assert.deepEqual(host.writes.slice(-6),[[1,0x41,11],[1,0x49,22],[1,0x45,33],[1,0x4d,44],[1,0xb5,0x6d],[0,0x22,0xfd]]);
    const snapshot=host.interaction.readSnapshot(host.timeline.read(0),-1);
    assert(snapshot.channels.every(channel=>channel.preset.lfo.enabled));
    assert.deepEqual(latest(host,4).preset.pan,{left:false,right:true});
    assert.equal(latest(host,4).preset.ams,2);assert.equal(latest(host,4).preset.pms,5);
  }finally{host.dispose();}
});

test('repeated edits stay bounded and a frozen view changes only touched fields',()=>{
  const host=fake();try{
    host.engine.writeYm2612(0,0xb0,0x15);const frozen=host.timeline.read(0);host.engine.processFrames(100);
    for(let index=0;index<1000;index++)edit(host.interaction,{'operators.1.tl':index%128});
    assert.equal(host.interaction.read().pendingDisplayEdits,1);
    host.engine.processFrames(100);const current=host.timeline.read(200);
    assert.equal(host.interaction.readSnapshot(current,200),current,'consumed edits use the timeline itself');
    const shown=host.interaction.readSnapshot(frozen,200,{frozen:true});
    assert.equal(shown.channels[0].preset.operators[1].tl,103);assert.equal(shown.channels[0].preset.algorithm,5);
    assert.equal(frozen.channels[0].preset.operators[1].tl,0,'original immutable view is untouched');
  }finally{host.dispose();}
});

test('a later VGM key command retires the old manual key and bend cleanup',()=>{
  const host=fake();try{
    host.engine.writeYm2612(0,0x28,0x50);host.interaction.noteOn('a',60,{channel:0});
    assert.equal(host.writes.at(-1)[2],0x50,'manual trigger keeps partial OP1/OP3 mask');
    host.engine.writeYm2612(0,0x28,0x90);const count=host.writes.length;
    assert.equal(host.interaction.noteOff('a'),false);host.interaction.setPitch(0);host.interaction.releaseKeyboard();
    assert.equal(host.writes.length,count);assert.equal(latest(host).keyMask,9);
  }finally{host.dispose();}
});

test('one gate button changes only its latest-head bit and an idle selection does not trigger sound',()=>{
  const host=fake();try{
    host.engine.writeYm2612(0,0x28,0x50);const frozen=host.timeline.read(0);host.engine.processFrames(100);
    host.engine.writeYm2612(0,0x28,0x90);edit(host.interaction,{'gates.2':true});
    assert.equal(latest(host).keyMask,11,'preserves latest OP1/OP4 and enables OP2');
    assert.deepEqual(host.writes.at(-1),[0,0x28,0xb0]);
    host.engine.writeYm2612(0,0x28,0);const count=host.writes.length;
    edit(host.interaction,{'gates.3':true});assert.equal(host.writes.length,count,'idle selection remains KEY OFF');
    assert.equal(host.interaction.read().channels[0].selectedKeyMask,15);
    const displayed=host.interaction.readSnapshot(frozen,100,{frozen:true});
    assert.equal(displayed.channels[0].selectedKeyMask,15);
    host.interaction.noteOn('a',60,{channel:0});assert.equal(latest(host).keyMask,15);
    host.interaction.noteOff('a');const off=host.timeline.read(100);
    assert.equal(host.interaction.readSnapshot(off,100).channels[0].selectedKeyMask,15,'selection survives its own audible KEY OFF');
  }finally{host.dispose();}
});

test('a stolen manual key cannot release its replacement',()=>{
  const host=fake();try{
    host.interaction.noteOn('old',60,{channel:4});const note=host.interaction.noteOn('new',64,{channel:4});
    assert.equal(note.stolenId,'old');const count=host.writes.length;
    assert.equal(host.interaction.noteOff('old'),false);assert.equal(host.writes.length,count);
    assert.equal(host.interaction.noteOff('new'),true);assert.deepEqual(host.writes.at(-1),[0,0x28,5]);
  }finally{host.dispose();}
});

test('a later VGM frequency commit prevents stale wheel writes without losing manual key ownership',()=>{
  const host=fake();try{
    host.interaction.noteOn('a',60,{channel:0});host.interaction.setPitch(2);
    host.engine.writeYm2612(0,0xa4,0x24);host.engine.writeYm2612(0,0xa0,0x88);const count=host.writes.length;
    host.interaction.setPitch(0);assert.equal(host.writes.length,count);
    assert.equal(host.interaction.noteOff('a'),true);
  }finally{host.dispose();}
});

test('new raw keyboard notes respect an already-held bend and return to their base pitch',()=>{
  const host=fake();try{
    host.interaction.setPitch(2);host.interaction.noteOn('a',{block:4,fnum:1200},{channel:0});
    const raised=latest(host);assert(Math.abs(raised.fnum*2**raised.block/(1200*16)-2**(2/12))<.001);
    host.interaction.setPitch(0);assert.equal(latest(host).block,4);assert.equal(latest(host).fnum,1200);
  }finally{host.dispose();}
});

test('CH3 special transposition retains four OP ratios and never changes timer mode',()=>{
  const host=fake();try{
    for(const [low,high,fnum]of [[0xa9,0xad,500],[0xaa,0xae,1000],[0xa8,0xac,1500],[0xa2,0xa6,1000]]){
      host.engine.writeYm2612(0,high,0x20|(fnum>>8));host.engine.writeYm2612(0,low,fnum&255);
    }
    host.engine.writeYm2612(0,0x27,0x45);host.engine.writeYm2612(0,0x28,0xa2);const count=host.writes.length;
    host.interaction.noteOn('ch3',{block:3,fnum:1100},{channel:2});
    const actual=latest(host,2).specialFrequencies.map(({block,fnum})=>fnum*2**block);
    assert.deepEqual(actual,[4400,8800,13200,8800]);assert.equal(latest(host,2).keyMask,10);
    assert(!host.writes.slice(count).some(([,register])=>register===0x27));assert.equal(host.interaction.read().modeRegister,0x45);
  }finally{host.dispose();}
});

test('CSM CH3 and DAC CH6 reject keyboard input before changing registers',()=>{
  const host=fake();try{
    host.engine.writeYm2612(0,0x27,0x80);host.engine.writeYm2612(0,0x2b,0x80);const count=host.writes.length;
    assert.match(host.interaction.describe(2).reason,/CSM/);assert.match(host.interaction.describe(5).reason,/DAC/);
    assert.throws(()=>host.interaction.noteOn('ch3',60,{channel:2}),/CSM/);assert.throws(()=>host.interaction.noteOn('dac',60,{channel:5}),/DAC/);
    assert.equal(host.writes.length,count);
  }finally{host.dispose();}
});

test('timer-only CH3 mode writes retain key-up; special-mode changes retire only pitch; CSM takes the gate',()=>{
  const host=fake();try{
    host.interaction.noteOn('timer',60,{channel:2});host.engine.writeYm2612(0,0x27,5);
    assert.equal(host.interaction.noteOff('timer'),true,'timer start alone does not take the manual gate');
    host.interaction.noteOn('special',60,{channel:2});host.interaction.setPitch(2);
    host.engine.writeYm2612(0,0x27,0x45);let count=host.writes.length;
    host.interaction.setPitch(0);assert.equal(host.writes.length,count,'old ratio/bend cannot overwrite a changed special mode');
    assert.equal(host.interaction.noteOff('special'),true,'mode change still lets the physical key release its own gate');
    host.engine.writeYm2612(0,0x27,5);host.interaction.noteOn('csm',60,{channel:2});
    host.engine.writeYm2612(0,0x27,0x85);count=host.writes.length;
    assert.equal(host.interaction.noteOff('csm'),false);host.interaction.releaseKeyboard();host.interaction.setPitch(0);
    assert.equal(host.writes.length,count,'CSM gate ownership prevents stale key-up and bend cleanup');
  }finally{host.dispose();}
});

test('checkpoint restore replaces decoder and retires owners without output writes',()=>{
  const host=fake();try{
    host.engine.writeYm2612(0,0x30,0x71);host.engine.processFrames(123);const saved=host.interaction.saveState();
    host.interaction.noteOn('a',60,{channel:0});edit(host.interaction,{'operators.1.multi':9});host.engine.processFrames(100);
    const count=host.writes.length;host.interaction.loadState(saved);
    assert.equal(host.writes.length,count);assert.equal(host.interaction.generatedFrames,123);assert.equal(latest(host).preset.operators[1].multi,1);
    assert.equal(host.interaction.noteOff('a'),false);assert.equal(host.interaction.read().pendingDisplayEdits,0);
    assert.throws(()=>host.interaction.loadState({...saved,decoder:{}}));assert.equal(latest(host).preset.operators[1].dt,7);
  }finally{host.dispose();}
});

test('disposal restores wrappers without a reset and rejects later manual writes',()=>{
  const host=fake(),previous=host.timeline;
  host.interaction.dispose();assert.equal(host.resets,0);assert.throws(()=>edit(host.interaction,{algorithm:2}),/disposed/);
  host.engine.writeYm2612(0,0xb0,7);assert.equal(previous.read(0).channels[0].preset.algorithm,7);host.dispose();
});

test('actual WASM hand edits share one native chip, honor mute and match independent direct-register PCM',async()=>{
  const wasm=Object.fromEntries(await Promise.all(['ym2612','segapsg'].map(async name=>[name,await readFile(new URL(`../generated/${name}_wasm.wasm`,import.meta.url))])));
  const create=()=>GenesisAudioEngine.create({ym2612ModuleFactory:ymFactory,ym2612ModuleOptions:{wasmBinary:wasm.ym2612},segaPsgModuleFactory:psgFactory,segaPsgModuleOptions:{wasmBinary:wasm.segapsg}});
  const actual=await create(),oracle=await create(),actualMix=installSynthSongOutputMix(actual),oracleMix=installSynthSongOutputMix(oracle);
  const timeline=createYm2612SongTimeline(actual),hand=createSynthSongInteraction(actual);
  try{
    for(const engine of [actual,oracle]){
      for(const slot of SLOT){for(const [register,value]of [[0x30,1],[0x40,slot===12?20:127],[0x50,31],[0x60,0],[0x70,0],[0x80,15]])engine.writeYm2612(0,register+slot,value);}
      engine.writeYm2612(0,0xb0,7);engine.writeYm2612(0,0xb4,0xc0);engine.writeYm2612(0,0xa4,0x24);engine.writeYm2612(0,0xa0,0x40);engine.writeYm2612(0,0x28,0xf0);
    }
    const check=()=>{const a=actual.processFrames(1024),b=oracle.processFrames(1024);assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);return a;};
    assert(check().left.some(value=>Math.abs(value)>.001));
    hand.applyEdit({channel:0,changes:{'operators.4.tl':40}});oracle.writeYm2612(0,0x4c,40);check();
    const allMuted=new Set(Array.from({length:6},(_,index)=>'ym2612:'+index));
    actualMix.setMutedChannels(allMuted);oracleMix.setMutedChannels(allMuted);
    hand.applyEdit({channel:0,changes:{'pan.left':true}});oracle.writeYm2612(0,0xb4,0xc0);const muted=check();
    assert(muted.left.every(value=>value===0)&&muted.right.every(value=>value===0));
    assert.equal(hand.read().channels[0].preset.pan.left,true,'unmuted desired pan stays observable');
  }finally{hand.dispose();timeline.dispose();actualMix.dispose();oracleMix.dispose();actual.dispose();oracle.dispose();}
});

const SLOT=[0,8,4,12];
