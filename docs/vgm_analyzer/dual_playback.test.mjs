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

for (const chip of ['ym2612','ym2608','ym2610']) test(chip+' second FM CH2 mute survives reset and unmute', async () => {
  const bytes = await readFile(new URL('../../test/fixtures/dual-'+chip+'.vgm',import.meta.url));
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

test('dual OPNA SSG A outputs retain distinct pitches and independent masks',async () => {
  const bytes = await readFile(new URL('../../test/fixtures/dual-ym2608-ssg.vgm',import.meta.url));
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
  try {
    const player = createPlaybackPlayer(engine,bytes);
    for (const mask of [0,1,2,3,0]) {
      for (const chip of [0,1]) engine.setInstanceSsgChannelMuted(chip,0,Boolean(mask & (1<<chip)));
      player.reset(); player.setPrefetchFactor(1); player.play();
      const edges = [];
      for (const sources of [1,2,3]) {
        const left = new Float32Array(44100), right = new Float32Array(44100);
        player.process(left,right,left.length);
        const signal = left.subarray(11025,33075);
        const min = Math.min(...signal), max = Math.max(...signal);
        assert.equal(max-min > .001,Boolean(sources & ~mask));
        const mid = (min+max)/2;
        edges.push(signal.reduce((n,v,i) => n + (i>0 && signal[i-1]<mid && v>=mid),0));
      }
      if (!mask) assert(Math.abs(edges[1]-2*edges[0]) <= 2,edges.join(','));
    }
  } finally {engine.dispose();}
});

for (const chipKind of ['ym2608','ym2610','ym2610b']) test(chipKind+' dual sample mutes isolate chip, channel and source across reset',async () => {
  const opna = chipKind === 'ym2608';
  const file = opna ? 'dual-ym2608-rhythm-delta' : 'dual-'+chipKind+'-adpcm';
  const bytes = await readFile(new URL('../../test/fixtures/'+file+'.vgm',import.meta.url));
  const rom = await readFile(new URL('../js/tetorica_ym2608_adpcm_rom.bin',import.meta.url));
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory,roms:opna ? {ym2608AdpcmA:rom} : {}});
  try {
    const player = createPlaybackPlayer(engine,bytes);
    for (const [sampleA,delta] of [[-1,-1],[0,1],[1,0],[-1,-1]]) {
      engine.fmInstances.forEach(({engine:chip},i) => {
        chip.setAdpcmAChannelMuted(opna ? 0 : 1,true); // Mute a silent sibling channel.
        chip.setAdpcmAChannelMuted(opna ? 1 : 0,i===sampleA);
        chip.setAdpcmBMuted(i===delta);
      });
      player.reset(); player.setPrefetchFactor(1); player.play();
      for (const muted of [sampleA,delta]) {
        const left = new Float32Array(44100), right = new Float32Array(44100);
        player.process(left,right,left.length);
        const audible = [left,right].map(side => side.subarray(32,4096).some(v => Math.abs(v)>.0001));
        assert.deepEqual(audible,[muted!==0,muted!==1]);
      }
    }
  } finally {engine.dispose();}
});

test('overwriting chip 2 sample ROMs leaves chip 1 PCM identical',async () => {
  const original = await readFile(new URL('../../test/fixtures/dual-ym2610-adpcm.vgm',import.meta.url));
  const modified = Buffer.from(original);
  for (let pos=256;modified[pos]===0x67;) {
    const length = modified.readUInt32LE(pos+3);
    const end = pos+7+(length & 0x7fffffff);
    if (length & 0x80000000) modified.fill(0,pos+15,end);
    pos = end;
  }
  async function render(bytes) {
    const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
    try {
      const player = createPlaybackPlayer(engine,bytes);
      player.reset(); player.setPrefetchFactor(1); player.play();
      const left = new Float32Array(88200), right = new Float32Array(88200);
      player.process(left,right,left.length);
      return {left,right};
    } finally {engine.dispose();}
  }
  const before = await render(original), after = await render(modified);
  assert.deepEqual(before.left,after.left);
  for (const start of [0,44100]) assert.notDeepEqual(before.right.subarray(start,start+4096),after.right.subarray(start,start+4096));
});

for (const variant of ['ym2610','ym2610b']) test(variant+' second SSG A can be muted independently',async () => {
  const bytes = await readFile(new URL('../../test/fixtures/dual-'+variant+'-adpcm.vgm',import.meta.url));
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
  try {
    engine.reset();
    for (const i of [0,1]) {
      const target = engine.getVgmTarget('ym2610',i);
      for (const [reg,val] of [[0,i?96:192],[1,0],[7,0x3e],[8,12]]) target.writeRegister(reg,val,0);
    }
    for (const [a,b] of [[true,true],[false,true],[true,false]]) {
      engine.setInstanceSsgChannelMuted(0,0,a);
      engine.setInstanceSsgChannelMuted(1,0,b);
      const {left} = engine.processFrames(4096);
      const signal = left.subarray(64);
      assert.equal(Math.max(...signal)-Math.min(...signal)>.001,!a || !b);
    }
  } finally {engine.dispose();}
});

for (const ch of [0,1,2,3]) test('dual DMG CH'+(ch+1)+' independent left/right PCM mute and reset',async () => {
  const wave = await readFile(new URL('../../test/fixtures/dual-dmg-wave.vgm',import.meta.url));
  let bytes = wave;
  if (ch !== 2) {
    const data = [];
    for (const chip of [0,1]) {
      const write = (r,v) => data.push(0xb3,r | chip<<7,v);
      write(22,128); write(20,0x77); write(21,(chip?1:16)<<ch);
      const base = ch*5;
      write(base+1,0x80); write(base+2,0xa0);
      write(base+3,ch===3?0x23:96); write(base+4,0x86);
    }
    bytes = Buffer.concat([wave.subarray(0,256),Buffer.from([...data,0x61,0x44,0xac,0x66])]);
    bytes.writeUInt32LE(bytes.length-4,4); bytes.writeUInt32LE(44100,0x18);
  }
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
  try {
    const player = createPlaybackPlayer(engine,bytes);
    let reference;
    for (const mask of [0,2,1,3,0]) {
      for (const [index,id] of ['gameBoyDmg','gameBoyDmg-2'].entries()) {
        engine.entries.get(id+':0').engine.setChannelMuted(ch,Boolean(mask & (1<<index)));
      }
      player.reset(); player.setPrefetchFactor(1); player.play();
      const left=new Float32Array(8192),right=new Float32Array(8192);
      player.process(left,right,left.length);
      const audible = [left,right].map(side => {
        const signal = side.subarray(2048);
        return Math.max(...signal)-Math.min(...signal) > .001;
      });
      assert.deepEqual(audible,[!(mask&1),!(mask&2)]);
      reference ??= [left,right];
      if (!(mask&1)) assert.deepEqual(left,reference[0]);
      if (!(mask&2)) assert.deepEqual(right,reference[1]);
    }
  } finally {engine.dispose();}
});

test('dual Sega PSG preserves each latch and the first chip PCM when muting chip 2 CH1',async () => {
  const bytes = await readFile(new URL('../../test/fixtures/dual-psg.vgm',import.meta.url));
  async function render(mode) {
    const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
    try {
      assert.deepEqual([...engine.playbackMixer.strips.keys()],['psg','psg:2']);
      const part = engine.entries.get('psg-2:0').engine;
      const player = createPlaybackPlayer(engine,bytes);
      if (mode === 'source') engine.setChipMuted('psg-2',0,true);
      if (mode === 'channel') part.setPsgChannelMuted(0,true);
      player.reset();
      player.setPrefetchFactor(1);
      player.play();
      const result = [];
      for (let i=0;i<3;i++) {
        const left = new Float32Array(44100);
        player.process(left,new Float32Array(44100),44100);
        result.push(left.slice(10000,30000));
      }
      return result;
    } finally {engine.dispose();}
  }
  const duet = await render('both'), solo = await render('channel');
  const reference = await render('source');
  for (let i=0;i<3;i++) assert.ok(solo[i].every((x,j) => x === reference[i][j]),'source and channel isolation in phrase '+i);
  assert.ok(duet[0].every((x,j) => x === solo[0][j]));
  assert.ok(Math.max(...solo[0]) - Math.min(...solo[0]) > .001);
  assert.ok(Math.max(...duet[1]) - Math.min(...duet[1]) > .001);
  assert.ok(solo[1].every(x => x === 0));
  assert.ok(duet[2].some((x,j) => x !== solo[2][j]));
});

test('dual Sega PSG keeps all four CH masks independent alongside YM2612', async () => {
  const bytes = await readFile(new URL('../../test/fixtures/dual-psg.vgm',import.meta.url));
  bytes.writeUInt32LE(7670454,0x2c);
  const engine = await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory});
  try {
    assert.equal(engine.fmInstances.length,0);
    assert.deepEqual([...engine.playbackMixer.strips.keys()].sort(),['psg','psg:2','ym2612']);
    const parts = ['psg:0','psg-2:0'].map(key => engine.entries.get(key).engine);
    for (const ch of [0,1,2,3]) {
      parts.forEach((part,index) => {
        part.reset();
        part.setPsgChannelMuted(ch,index === 1);
        const target = engine.getVgmTarget('psg',index);
        target.write(ch === 3 ? 0xe4 : 0x83+(ch<<5));
        if (ch !== 3) target.write(12);
        target.write(0x92+(ch<<5));
      });
      const [first,second] = parts.map(part => part.processFrames(4096).left);
      assert.ok(first.some(sample => sample !== 0),'first PSG CH'+(ch+1));
      assert.ok(second.every(sample => sample === 0),'second PSG CH'+(ch+1));
      parts[1].setPsgChannelMuted(ch,false);
      assert.ok(parts[1].processFrames(4096).left.some(sample => sample !== 0));
    }
  } finally {engine.dispose();}
});
