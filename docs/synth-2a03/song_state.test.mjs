import test from 'node:test';
import assert from 'node:assert/strict';
import {createNesRegisterState,createNesSongSnapshot,captureNesSongPreset,createNesSongTimeline} from './song_state.js';
import {createNesSongEngine} from './song_engine.js';

test('register snapshots distinguish both pulses and preserve hardware envelope/counter controls',()=>{
  const state=createNesRegisterState();
  for(const [address,value]of[[0x4015,15],[0x4000,0xab],[0x4001,0x8a],[0x4002,0x40],[0x4003,0x19],
    [0x4004,0x79],[0x4007,8],[0x4008,0x90],[0x400b,24],[0x400c,0x2b],[0x400e,0x83],[0x400f,32]])state.write(address,value);
  const snapshot=state.snapshot(),first=captureNesSongPreset(snapshot,{channel:0}),second=captureNesSongPreset(snapshot,{channel:1});
  assert.equal(first.pulse.duty,.5);assert.equal(first.pulse.envelope.enabled,true);assert.equal(first.pulse.envelope.period,11);
  assert.equal(first.pulse.lengthIndex,3);assert.equal(first.pulse.sweep.shift,2);assert.equal(second.pulse.duty,.25);assert.equal(second.pulse.volume,9);
  assert.deepEqual(captureNesSongPreset(snapshot,{channel:2}).triangle,{control:true,linearReload:16,lengthIndex:3});
  assert.equal(captureNesSongPreset(snapshot,{channel:3}).noise.shortMode,true);
});
test('DMC capture requires complete recorded memory and follows FFFF to 8000 wrapping',()=>{
  const state=createNesRegisterState();
  for(const [address,value]of[[0x4010,0x4f],[0x4011,55],[0x4012,255],[0x4013,4]])state.write(address,value);
  state.loadMemory(new Uint8Array(64).fill(0x55),0xffc0);
  assert.throws(()=>captureNesSongPreset(state.snapshot(),{channel:4}),/complete DMC/);
  state.loadMemory(new Uint8Array([0xa7]),0x8000);
  const preset=captureNesSongPreset(state.snapshot(),{channel:4});assert.equal(preset.dmc.data.length,65);assert.equal(preset.dmc.data.at(-1),0xa7);assert.equal(preset.dmc.level,55);assert.equal(preset.dmc.loop,true);
});
test('FDS incomplete wave/modulation remain visible while capture waits for complete RAM',()=>{
  const state=createNesRegisterState();
  for(const [address,value]of[[0x4023,2],[0x4089,128],[0x4080,0x98],[0x4082,0x80],[0x4083,1],[0x4087,128]])state.write(address,value);
  for(let index=0;index<63;index++)state.write(0x4040+index,index);
  assert.equal(state.snapshot().channels[5].canCapture,false);state.write(0x407f,63);state.write(0x4087,0);
  assert.throws(()=>captureNesSongPreset(state.snapshot(),{channel:5}),/modulation table/);
  state.write(0x4087,128);for(let index=0;index<32;index++)state.write(0x4088,index%8);state.write(0x4087,0);
  const preset=captureNesSongPreset(state.snapshot(),{channel:5});assert.deepEqual(preset.fds.wave,Array.from({length:64},(_,i)=>i));assert.equal(preset.fds.modulation.enabled,true);
});
test('audible timeline excludes lookahead/manualwrites from original song controls',()=>{
  const engine={manualWrite:false,writeRegister(){},loadMemory(){},reset(){},getCoreState:()=>null,
    processFrames:frames=>({left:new Float32Array(frames),right:new Float32Array(frames)})};
  const timeline=createNesSongTimeline(engine);engine.writeRegister(0x4000,0xbf);engine.writeRegister(0x4003,8);engine.processFrames(20);
  engine.writeRegister(0x4000,0xb3);assert.equal(timeline.read(19).channels[0].preset.pulse.volume,15);
  engine.manualWrite=true;engine.writeRegister(0x4000,0xb7);engine.manualWrite=false;
  assert.equal(timeline.read(20).channels[0].preset.pulse.volume,7);assert.equal(timeline.readSong(20).channels[0].preset.pulse.volume,3);timeline.dispose();
});
test('native observation can be captured through the same Code read shape',async()=>{
  const engine=await createNesSongEngine({nesApuClock:1789773});
  try{
    const read=engine.instrument.read(),snapshot=createNesSongSnapshot(read);
    assert.equal(snapshot.channels.length,6);assert.equal(snapshot.channels[5].source,'fds');assert.equal(snapshot.channels[5].canCapture,true);
    const captured=captureNesSongPreset(snapshot,{channel:5});assert.equal(captured.fds.wave.length,64);
  }finally{engine.dispose();}
});
