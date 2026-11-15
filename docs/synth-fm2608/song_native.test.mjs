import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ym2608_wasm.js';
import {Ym2608AudioEngine} from '../js/ym2608audioengine.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createFm2608SongTimeline,captureFm2608SongPreset} from './song_state.js';
import {decodeBase64} from './preset.js';

const wasmBinary=await readFile(new URL('../generated/ym2608_wasm.wasm',import.meta.url));
test('real OPNA core CPU memory upload agrees byte-for-byte with captured preset',async()=>{
  const engine=await Ym2608AudioEngine.create({ym2608ModuleFactory:factory,ym2608ModuleOptions:{wasmBinary}});
  const timeline=createFm2608SongTimeline(engine);
  try {
    const original=new Uint8Array(64).fill(0x55);engine.loadAdpcmBMemory(original,0x100);
    for(const [register,value] of [[1,2],[2,8],[3,0],[4,8],[5,0],[0,0x60]])engine.writeYm2608(1,register,value);
    for(let value=0;value<32;value++)engine.writeYm2608(1,8,value);
    engine.writeYm2608(1,0,0xa0);engine.writeYm2608(1,9,0xff);engine.writeYm2608(1,10,0x7f);
    const preset=captureFm2608SongPreset(timeline.read(0),{section:'adpcm'}),captured=decodeBase64(preset.adpcm.data);
    engine.writeYm2608(1,0,0x20);engine.writeYm2608(1,4,9);engine.ym2608.write(2,8);
    engine.ym2608.read(3);engine.ym2608.read(3);
    const actual=Uint8Array.from({length:32},()=>engine.ym2608.read(3));
    assert.deepEqual(captured,actual);assert.equal(actual[31],0x55);
  } finally {timeline.dispose();engine.dispose();}
});
test('real VGM ADPCM-B data block is rendered and captured without dropping memory',async()=>{
  const engine=await Ym2608AudioEngine.create({ym2608ModuleFactory:factory,ym2608ModuleOptions:{wasmBinary}});
  const timeline=createFm2608SongTimeline(engine);
  try {
    const payload=Uint8Array.from({length:64},(_,index)=>index&1?0x88:0x77);
    const block=new Uint8Array(15+payload.length),bv=new DataView(block.buffer);block.set([0x67,0x66,0x81]);bv.setUint32(3,8+payload.length,true);bv.setUint32(7,0x200000,true);bv.setUint32(11,0x100,true);block.set(payload,15);
    const commands=[...block,0x57,1,0xc2,0x57,2,8,0x57,4,9,0x57,9,255,0x57,10,127,0x57,11,255,0x57,0,0xb0,0x61,0x44,0xac,0x66];
    const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x34,256-0x34,true);view.setUint32(0x48,8000000,true);bytes.set(commands,256);
    const player=new VgmPlayer(engine);player.load(bytes);player.reset();player.play();
    const left=new Float32Array(4096),right=new Float32Array(4096);const frames=player.process(left,right,4096);
    assert.equal(frames,4096);assert.ok(left.some(value=>Math.abs(value)>.0001));
    const snapshot=timeline.read(0),preset=captureFm2608SongPreset(snapshot,{section:'adpcm',referenceNote:60});
    assert.deepEqual(decodeBase64(preset.adpcm.data),payload);assert.equal(preset.adpcm.address,0x100);
    assert.equal(preset.adpcm.repeat,true);assert.equal(preset.adpcm.volume,255);
  } finally {timeline.dispose();engine.dispose();}
});
