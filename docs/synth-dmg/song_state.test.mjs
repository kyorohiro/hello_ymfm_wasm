import test from 'node:test';
import assert from 'node:assert/strict';
import {GameboySynth} from '../js/gameboysynth.js';
import {createGameboyRegisterState,createGameboySongTimeline} from './song_state.js';

test('sent/configured register decoding matches raw GameboySynth writes, including trigger edges and power-off Wave RAM retention',()=>{
  const state=createGameboyRegisterState(),synth=new GameboySynth({transport:{writeRegister(){},reset(){}}});
  const writes=[[22,128],[20,0x33],[21,255],[1,0x80],[2,0xf2],[3,0x43],[4,0xc7],
    [32,0xe1],[47,0xab],[10,128],[12,0x60],[14,0x87],[17,0x78],[18,0x27],[19,0x80],[22,0]];
  for(const [register,value]of writes){
    state.write(register,value);synth.writeRegister(register,value);
    const decoded=state.snapshot(),reference=synth._getState();
    assert.deepEqual(decoded.registers,reference.registers);assert.deepEqual(decoded.voice,reference.voice);
    assert.equal(decoded.activeMask,null);assert.equal(decoded.observation.hardwareEnvelope,false);assert.equal(decoded.observation.hardwareSweep,false);
  }
  assert.equal(state.snapshot().registers[32],0xe1);assert.equal(state.snapshot().registers[47],0xab);
  assert.equal(state.snapshot().initialized,false);
  const before=state.snapshot();for(const [reg,val]of [[48,0],[-1,0],[0,256],[0,NaN]])assert.throws(()=>state.write(reg,val));
  assert.deepEqual(state.snapshot(),before);assert.throws(()=>createGameboyRegisterState(4000000));synth.dispose();
});

test('a snapshot owns frozen arrays and retains its bytes while later native-frame observations move forward',()=>{
  const state=createGameboyRegisterState();state.write(1,64);
  const first=state.snapshot(0),laterSame=state.snapshot(128);
  assert.equal(first.registers,laterSame.registers,'unchanged readings share immutable data instead of copying per frame');
  assert(Object.isFrozen(first.registers));assert(Object.isFrozen(first.observation));
  assert.throws(()=>{first.registers[1]=0;},TypeError);
  state.write(1,192);assert.equal(first.registers[1],64);assert.equal(state.snapshot(256).registers[1],192);
  assert.throws(()=>state.snapshot(NaN));assert.throws(()=>state.snapshot(-1));
});

test('render-ahead writes are stamped at the exact engine boundary; reads are passive and disposal restores the native adapter',()=>{
  const calls=[];
  const engine={writeGameboyApu(...args){calls.push(['write',...args]);},processFrames(frames){calls.push(['process',frames]);return{frames};},reset(){calls.push(['reset']);}};
  const original={...engine},timeline=createGameboySongTimeline(engine);
  engine.writeGameboyApu(1,64);engine.processFrames(100);engine.writeGameboyApu(1,192);engine.processFrames(100);
  const early=timeline.read(99),count=calls.length;assert.equal(early.registers[1],64);assert.equal(timeline.pendingEvents,1);
  assert.equal(timeline.read(100).registers[1],192);assert.equal(calls.length,count,'viewing a frame does not render or write the APU');
  assert.equal(early.registers[1],64);assert.throws(()=>timeline.read(99),/backwards/);
  engine.reset();assert.equal(timeline.generatedFrames,0);assert.equal(timeline.read(0).registers[1],0);
  timeline.dispose();timeline.dispose();
  assert.equal(engine.writeGameboyApu,original.writeGameboyApu);assert.equal(engine.processFrames,original.processFrames);assert.equal(engine.reset,original.reset);
  assert.throws(()=>timeline.read(0),/disposed/);
});

test('a zero-time command burst has a fixed pending-event bound and capacity is released after reading the audible prefix',()=>{
  let nativeWrites=0;
  const engine={writeGameboyApu(){nativeWrites++;},processFrames(){},reset(){}};
  const timeline=createGameboySongTimeline(engine);
  for(let i=0;i<131072;i++)engine.writeGameboyApu(1,i&255);
  assert.equal(timeline.pendingEvents,131072);
  assert.throws(()=>engine.writeGameboyApu(1,0),/event limit/);assert.equal(nativeWrites,131072,'capacity rejection occurs before another native mutation');
  assert.equal(timeline.read(0).registers[1],255);assert.equal(timeline.pendingEvents,0);
  engine.writeGameboyApu(1,64);assert.equal(timeline.read(0).registers[1],64);timeline.dispose();
});
