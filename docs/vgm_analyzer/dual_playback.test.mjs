// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createPlaybackEngine,createPlaybackPlayer} from './playback_core.js';
import {parseTfi} from '../js/tfi.js';
import {createVgmPresetFiles} from '../playground/playground_vgm_presets.js';

async function getFactory(kind) {
  const url = new URL('../generated/'+kind+'_wasm.js',import.meta.url);
  const {default:factory} = await import(url);
  const wasmBinary = await readFile(new URL(kind+'_wasm.wasm',url));
  return options => factory({...options,wasmBinary});
}

for (const chip of ['ym2612','ym2608','ym2610','dmg']) test(chip+' dual register streams render and mute independently',async()=>{
  const bytes = await readFile(new URL('../../test/fixtures/dual-'+chip+'.vgm',import.meta.url));
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
  const id = chip==='dmg'?'gameBoyDmg':chip;
  try {
    assert.deepEqual([...engine.playbackMixer.strips.keys()],[id,id+':2']);
    if (chip!=='dmg') {
      const files=createVgmPresetFiles(bytes,'dual.vgm');
      assert.equal(files.length,2);
      assert.deepEqual(files.map(file=>parseTfi(file.data).operators[4].multi),[1,2]);
    }
    for (const muted of [null,id,id+':2']) {
      for(const strip of [id,id+':2']) engine.playbackMixer.set(strip,{muted:strip===muted});
      const player=createPlaybackPlayer(engine,bytes);
      player.reset();player.setPrefetchFactor(1);player.play();
      const audible=[];
      for(let phrase=0;phrase<3;phrase++){
        const left=new Float32Array(44100),right=new Float32Array(44100);
        player.process(left,right,left.length);
        const middle = left.subarray(11025,33075);
        audible.push(Math.max(...middle)-Math.min(...middle) > .001);
      }
      assert.deepEqual(audible,[muted!==id,muted!==id+':2',true],String(muted));
    }
  } finally {engine.dispose();}
});

test('OPN port 1 and embedded sample memory reach the addressed instance', async () => {
  const source = await readFile(new URL('../../test/fixtures/dual-ym2608.vgm',import.meta.url));
  const commands = [0xa3,0xb6,0xff,0xa7,0xb6,0xee,0xa9,0xb6,0xdd];
  for (const type of [0x81,0x82,0x83]) {
    commands.push(0x67,0x66,type,9,0,0,0x80,1,0,0,0,0,0,0,0,type);
  }
  const bytes = Buffer.concat([source.subarray(0,256),Buffer.from([...commands,0x66])]);
  bytes.writeUInt32LE(bytes.length-4,4);
  const parser = new Ym2612VGM(bytes);
  const received = [];
  const targets = {resolveChip(chip,index) {
    assert.equal(index,1);
    return {
      writeRegister:(r,v,port)=>received.push([chip,r,v,port]),
      loadAdpcmBMemory:(data,offset,size)=>received.push([chip,data[0],offset,size]),
      loadAdpcmRom:(type,data,offset,size)=>received.push([chip,type,data[0],offset,size]),
    };
  }};
  while (parser.playStep(targets).type !== 'end') {}
  assert.deepEqual(received,[
    ['ym2612',0xb6,0xff,1],['ym2608',0xb6,0xee,1],['ym2610',0xb6,0xdd,1],
    ['ym2608',0x81,0,1],['ym2610',0,0x82,0,1],['ym2610',1,0x83,0,1],
  ]);
});

test('muting CH2 on YM2612 2 preserves YM2612 1 through reset and unmute', async () => {
  const bytes = await readFile(new URL('../../test/fixtures/dual-ym2612.vgm',import.meta.url));
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
  try {
    const player = createPlaybackPlayer(engine,bytes);
    for (const muted of [true,false]) {
      engine.setFmChannelMuted(1,1,muted);
      player.reset();
      player.setPrefetchFactor(1);
      player.play();
      for (const expected of [true,!muted,true]) {
        const left = new Float32Array(44100), right = new Float32Array(44100);
        player.process(left,right,left.length);
        const phrase = left.subarray(11025,33075);
        assert.equal(Math.max(...phrase)-Math.min(...phrase) > .001,expected);
      }
    }
  } finally {engine.dispose();}
});
