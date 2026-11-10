// Silent source-state checks. Native samples are numeric arrays only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPcmRegisterState,createPcmSongTimeline} from './synth_song_pcm_state.js';
import {createPsgSongTimeline} from './synth_song_psg_state.js';
import {createYm2612SongTimeline} from './synth_song_state.js';
import factory from '../generated/rf5c164_wasm.js';
import {Rf5c164} from '../js/rf5c164.js';

const writes=[[7,0xc3],[0,92],[1,0xa5],[2,0x34],[3,0x12],[4,0x78],[5,0x56],[6,0x9a],[8,0xf7]];
test('PCM source decoder retains 8 channels, global enable, bank selection and immutable RAM only when written',()=>{
  const state=createPcmRegisterState(),cold=state.snapshot();
  assert.equal(cold.kind,'rf5c164');assert.equal(cold.channels.length,8);
  assert.equal(cold.enabled,false);assert.equal(cold.channelMask,255);assert.equal(cold.known[0],0);
  for(const args of writes)state.write(...args);
  const first=state.snapshot(100),voice=first.channels[3];
  assert.deepEqual(voice,{channel:3,volume:92,panLeft:5,panRight:10,step:0x1234,start:0x9a00,loopStart:0x5678,
    keyOn:true,active:true,sampleRateHz:12500000/384*0x1234/2048});
  state.write(7,0x85);assert.equal(state.snapshot().selectedChannel,3);assert.equal(state.snapshot().bank,0x5000);
  state.writeMemory(3,0xa1);state.loadBankedMemory(Uint8Array.of(0x11,0x22,255),0x1004);
  const ram=state.snapshot();assert.equal(ram.ram[0x5003],0xa1);assert.equal(ram.ram[0x5004],0x11,'banked load uses OR, not addition');
  assert.equal(ram.ram[0x5005],0x22);assert.equal(ram.ram[0x5006],255);
  assert.equal(ram.known[0x5006],1);assert.equal(ram.known[0x5007],0);
  assert.equal(cold.ram[0x5003],0);assert.equal(cold.known[0x5003],0,'earlier snapshots never change');
  assert(Object.isFrozen(ram.ram)&&Object.isFrozen(ram.known)&&Object.isFrozen(voice));
  assert.throws(()=>{ram.ram[0]=2;});
  state.write(0,93);const scalar=state.snapshot();assert.equal(scalar.ram,ram.ram,'register writes reuse immutable RAM');
  assert.equal(state.snapshot(101).ram,ram.ram,'audio-clock frames do not copy sample RAM');
  state.writeMemory(3,0xa1);assert.equal(state.snapshot().ram,ram.ram,'identical known writes do not recopy RAM');
  state.write(7,0x43);assert.equal(state.snapshot().channels[3].keyOn,true);assert.equal(state.snapshot().channels[3].active,false);
  state.reset();const reset=state.snapshot();assert(reset.channels.every(ch=>!ch.keyOn&&!ch.active&&ch.volume===0));
  assert.equal(reset.bank,0);assert.equal(reset.ram[0x5006],255);assert.equal(reset.known[0x5006],1,'native reset preserves RAM');
  assert.equal(reset.ram,ram.ram);
});

test('PCM source checkpoints detach state and reject malformed input without mutation',()=>{
  const state=createPcmRegisterState(12000000);for(const args of writes)state.write(...args);
  state.write(7,0x8f);state.writeMemory(4095,255);
  const saved=state.saveState(),view=state.snapshot();state.reset();state.loadState(structuredClone(saved));assert.deepEqual(state.snapshot(),view);
  for(const patch of [{version:2},{clockHz:1},{enabled:1},{channelMask:256},{bank:4097},{bank:65536},{selectedChannel:8},
    {registers:[]},{known:new Uint8Array(65536).fill(2)},{ram:[]},{revision:0}]) {
    assert.throws(()=>state.loadState({...saved,...patch}));assert.deepEqual(state.saveState(),saved);
  }
  for(const action of [()=>state.write(9,0),()=>state.write(7,256),()=>state.writeMemory(4096,2),
    ()=>state.writeMemory(0,-1),()=>state.loadBankedMemory([2]),()=>state.loadBankedMemory(Uint8Array.of(1,2),0xffff)]) {
    assert.throws(action);assert.deepEqual(state.saveState(),saved);
  }
  saved.ram.fill(42);saved.known.fill(0);saved.registers.fill(255);assert.deepEqual(state.snapshot(),view);
});

function engine() {
  return {writes:[],resets:0,writeRf5c164(...args){this.writes.push(['pcm',...args]);},
    writeRf5c164Memory(...args){this.writes.push(['window',...args]);},loadRf5c164Memory(...args){this.writes.push(['load',...args]);},
    writePsg(){},writeYm2612(){},processFrames(frames){return {left:new Float32Array(frames),right:new Float32Array(frames)};},reset(){this.resets++;}};
}
test('PCM timeline reveals audible source RAM/registers only, coalesces adjacent bytes and restores future source events',()=>{
  const host=engine(),timeline=createPcmSongTimeline(host);
  try {
    for(const args of writes)host.writeRf5c164(...args);
    host.writeRf5c164(7,0x82);host.loadRf5c164Memory(Uint8Array.of(0x81,0x82,255),0x100);
    host.processFrames(32);
    host.writeRf5c164Memory(0x100,0x83);host.writeRf5c164Memory(0x101,0x84);
    host.writeRf5c164(7,0xc3);host.writeRf5c164(0,40);host.processFrames(32);
    const first=timeline.read(1);assert.equal(first.ram[0x2100],0x81);assert.equal(first.channels[3].volume,92);
    host.loadRf5c164Memory(new Uint8Array(),0);
    const saved=timeline.saveState();assert.equal(saved.events.length,3,'adjacent per-byte writes share one pending chunk; empty loads are no-ops');
    const next=timeline.read(32);assert.equal(next.ram[0x2100],0x83);assert.equal(next.ram[0x2101],0x84);assert.equal(next.channels[3].volume,40);
    assert.equal(first.ram[0x2100],0x81);assert.equal(timeline.pendingEvents,0);assert.throws(()=>timeline.read(1),/backwards/);
    timeline.loadState(structuredClone(saved));assert.equal(timeline.read(1).ram[0x2100],0x81);assert.deepEqual(timeline.read(64).channels,next.channels);
    // A source reset is observed after rendering, so its preserved RAM includes
    // writes from the render-ahead tail, matching what native reset retains.
    host.writeRf5c164(7,0x8f);host.loadRf5c164Memory(Uint8Array.of(12,255),5);host.reset();
    const reset=timeline.read(0);assert.equal(reset.ram[0xf005],12);assert.equal(reset.known[0xf005],1);
    assert.equal(reset.ram[0x2100],0x83);assert.equal(reset.channels[3].volume,0);assert.equal(reset.enabled,false);
  } finally {timeline.dispose();}
});

test('PCM timeline validates pending RAM/bank events atomically and discards consumed streaming traffic',()=>{
  const host=engine(),timeline=createPcmSongTimeline(host);
  try {
    host.writeRf5c164(7,0x8f);host.processFrames(10);host.writeRf5c164Memory(2,20);host.processFrames(10);timeline.read(1);
    const saved=timeline.saveState();
    for(const patch of [{version:2},{generatedFrames:0},{lastReadFrame:30},{events:[{type:'bad',frame:10}]},
      {events:[{type:'register',frame:21,register:0,value:1}]},{events:[{type:'window',frame:10,offset:4095,bytes:[1,2]}]},
      {events:[{type:'banked',frame:10,offset:65535,bytes:[1,2]}]},
      {decoder:{...saved.decoder,enabled:2}}]) {
      assert.throws(()=>timeline.loadState({...saved,...patch}));assert.deepEqual(timeline.saveState(),saved);
    }
    timeline.read(20);
    for(let i=0;i<500;i++){host.writeRf5c164Memory(i%4096,i&255);host.processFrames(10);timeline.read(30+i*10);}
    assert.equal(timeline.pendingEvents,0);assert.throws(()=>timeline.read(NaN));
  } finally {timeline.dispose();}
  assert.throws(()=>timeline.saveState(),/disposed/);
});

test('PCM, PSG and YM observers share generated time and unwind native methods in reverse install order',()=>{
  const host=engine(),original={writePsg:host.writePsg,writeYm2612:host.writeYm2612,writeRf5c164:host.writeRf5c164,
    writeRf5c164Memory:host.writeRf5c164Memory,loadRf5c164Memory:host.loadRf5c164Memory,processFrames:host.processFrames,reset:host.reset};
  const ym=createYm2612SongTimeline(host),psg=createPsgSongTimeline(host),pcm=createPcmSongTimeline(host);
  host.writeYm2612(0,0xb0,4);host.writePsg(0x93);for(const args of writes)host.writeRf5c164(...args);host.processFrames(50);
  assert.equal(ym.read(50).channels[0].preset.algorithm,4);assert.equal(psg.read(50).channels[0].attenuation,3);
  assert.equal(pcm.read(50).channels[3].volume,92);
  pcm.dispose();psg.dispose();ym.dispose();for(const [name,value]of Object.entries(original))assert.equal(host[name],value,name);
});

test('actual RF5C164 WASM and source shadow agree on bank OR, live memory and preserved reset RAM',async()=>{
  const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:44100});
  const host={writeRf5c164:(...a)=>chip.writeRegister(...a),writeRf5c164Memory:(...a)=>chip.writeMemory(...a),
    loadRf5c164Memory:(...a)=>chip.loadBankedMemory(...a),processFrames:n=>chip.generateStereo(n),reset:()=>chip.reset()};
  const timeline=createPcmSongTimeline(host);
  try {
    host.writeRf5c164(7,0x85);host.loadRf5c164Memory(Uint8Array.of(0x91,0x92,255),0x1000);
    host.writeRf5c164Memory(4,0x93);host.processFrames(32);
    let snapshot=timeline.read(32);for(const address of [0x5000,0x5001,0x5002,0x5004])assert.equal(snapshot.ram[address],chip.readMemory(address));
    assert.equal(snapshot.ram[0x5000],0x91);
    host.writeRf5c164Memory(0,0xa1);host.processFrames(32);host.reset();snapshot=timeline.read(0);
    assert.equal(snapshot.ram[0x5000],chip.readMemory(0x5000));assert.equal(snapshot.ram[0x5000],0xa1);
    assert.equal(snapshot.known[0x5000],1);assert.equal(snapshot.bank,0);
  } finally {timeline.dispose();chip.dispose();}
});
