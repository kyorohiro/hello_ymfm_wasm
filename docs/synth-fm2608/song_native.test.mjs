import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ym2608_wasm.js';
import ym2203Factory from '../generated/ym2203_wasm.js';
import {Ym2608AudioEngine} from '../js/ym2608audioengine.js';
import {Ym2203AudioEngine} from '../js/ym2203audioengine.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {createFm2608SongTimeline,captureFm2608SongPreset} from './song_state.js';
import {decodeBase64} from './preset.js';
import {prepareFm2608SongSource} from './song_source.js';

const wasmBinary=await readFile(new URL('../generated/ym2608_wasm.wasm',import.meta.url));
const ym2203Binary=await readFile(new URL('../generated/ym2203_wasm.wasm',import.meta.url));
const calibratedGain = name => SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(value => value.name === name).volume;

async function createOpnPair() {
  const [opn,opna] = await Promise.all([
    Ym2203AudioEngine.create({ym2203ModuleFactory:ym2203Factory,ym2203ModuleOptions:{wasmBinary:ym2203Binary},ym2203Clock:4000000}),
    Ym2608AudioEngine.create({ym2608ModuleFactory:factory,ym2608ModuleOptions:{wasmBinary},ym2608Clock:8000000}),
  ]);
  const write = (register,value) => { opn.writeYm2203(register,value); opna.writeYm2608(0,register,value); };
  return {opn,opna,write,dispose() { opn.dispose(); opna.dispose(); }};
}
function writeSine(write,channel = 0,mask = 8) {
  write(7,0x3f); write(8,0); write(9,0); write(10,0);
  for (const slot of [0,8,4,12]) {
    write(0x30+channel+slot,1); write(0x40+channel+slot,slot === 12 ? 16 : 127);
    write(0x50+channel+slot,31); write(0x60+channel+slot,0);
    write(0x70+channel+slot,0); write(0x80+channel+slot,15); write(0x90+channel+slot,0);
  }
  write(0xb0+channel,7); write(0xa4+channel,0x22); write(0xa0+channel,0xa5);
  write(0x28,mask << 4 | channel);
}
const rms = samples => Math.sqrt(samples.reduce((sum,value) => sum + value * value,0) / samples.length);
function assertScaledSamples(first,second,scale,tolerance = .00025) {
  assert.equal(first.length,second.length);
  for (let index = 0; index < first.length; index++) {
    assert(Math.abs(first[index] * scale - second[index]) <= tolerance,`sample ${index} differs at scale ${scale}`);
  }
}

function ym2203Vgm(writes,samples = 10000) {
  const commands = writes.flatMap(([register,value]) => [0x55,register,value]);
  commands.push(0x61,samples & 255,samples >> 8,0x66);
  const bytes = new Uint8Array(256+commands.length), view = new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x44,4000000,true);bytes.set(commands,256);
  return bytes;
}

test('real YM2203 and doubled-clock OPNA retain FM pitch, envelope and dynamic prescaler timing',async()=>{
  const pair = await createOpnPair();
  try {
    writeSine(pair.write);
    // Sustain decay and Release exercise envelope time as well as oscillator time.
    pair.write(0x6c,10);pair.write(0x7c,5);pair.write(0x8c,0x4a);
    for (const prescale of [0x2d,0x2e,0x2f]) {
      pair.write(prescale,0);
      assertScaledSamples(pair.opn.processFrames(2048).left,pair.opna.processFrames(2048).left,.5);
    }
    pair.write(0x28,0);
    assertScaledSamples(pair.opn.processFrames(2048).left,pair.opna.processFrames(2048).left,.5);
  } finally { pair.dispose(); }
});

test('real YM2203 and doubled-clock OPNA retain SSG tone, noise and envelope timing at all prescalers',async()=>{
  const pair = await createOpnPair();
  try {
    for (const mode of ['tone','noise','envelope']) {
      pair.opn.reset();pair.opna.reset();
      pair.write(7,mode === 'noise' ? 0x37 : 0x3e);
      pair.write(0,119);pair.write(1,0);pair.write(6,7);
      pair.write(8,mode === 'envelope' ? 16 : 10);
      pair.write(11,8);pair.write(12,0);pair.write(13,10);
      for (const prescale of [0x2d,0x2e,0x2f]) {
        pair.write(prescale,0);
        const opn = pair.opn.processFrames(2048).left, opna = pair.opna.processFrames(2048).left;
        assert(rms(opn) > .001,mode + ' must produce audio');
        assertScaledSamples(opn,opna,2/3);
      }
    }
  } finally { pair.dispose(); }
});

function firstTimerFlag(chip,mask) {
  for (let frames=8;frames<=4096;frames+=8) {
    chip.generateStereoView(8);
    if (chip.readStatus() & mask) return frames;
  }
  assert.fail('Timer did not fire within 4096 native samples');
}

test('real Timer A/B and CSM preserve wall-clock timing with unchanged values at every prescaler',async()=>{
  const pair = await createOpnPair();
  try {
    assert.equal(pair.opn.ym2203.sampleRate(4000000),pair.opna.ym2608.sampleRate(8000000));
    for (const [prescale,divider] of [[0x2d,6],[0x2e,3],[0x2f,2]]) {
      // 2E requires a previous 2D selection in both native chips.
      pair.write(0x2d,0);pair.write(prescale,0);
      for (const [mask,control,period] of [[1,5,24],[2,10,64]]) {
        pair.write(0x27,0x30);pair.write(0x24,250);pair.write(0x25,0);pair.write(0x26,252);
        pair.write(0x27,control);
        const first = firstTimerFlag(pair.opn.ym2203,mask), second = firstTimerFlag(pair.opna.ym2608,mask);
        assert.equal(first,second);
        const expected = Math.ceil(period*12*divider/4/8)*8;
        // Timer B's free-running /16 stage can shorten its first interval.
        assert(first <= expected);
        assert(first >= Math.ceil((period-(mask === 2 ? 15 : 0))*12*divider/4/8)*8);
        pair.write(0x27,control | (mask === 1 ? 16 : 32));
        assert.equal(firstTimerFlag(pair.opn.ym2203,mask),expected);
        assert.equal(firstTimerFlag(pair.opna.ym2608,mask),expected);
      }
      pair.write(0x27,0x30);
    }
    pair.opn.reset();pair.opna.reset();writeSine(pair.write,2);
    pair.write(0x28,2);pair.write(0x24,250);pair.write(0x25,0);
    for (const [high,low,fnum] of [[0xad,0xa9,256],[0xae,0xaa,512],[0xac,0xa8,768]]) {
      pair.write(high,0x20 | fnum >> 8);pair.write(low,fnum & 255);
    }
    pair.write(0x27,0x81);
    const opn = pair.opn.processFrames(4096).left,opna = pair.opna.processFrames(4096).left;
    assert(rms(opn) > .001);assertScaledSamples(opn,opna,.5);
  } finally { pair.dispose(); }
});

function positiveCrossingHz(samples,rate) {
  const crossings = [];
  for (let index=513;index<samples.length;index++) {
    if (samples[index-1] <= 0 && samples[index] > 0) crossings.push(index-1-samples[index-1]/(samples[index]-samples[index-1]));
  }
  assert(crossings.length > 3,'Expected several complete oscillator periods');
  return (crossings.length-1)*rate/(crossings.at(-1)-crossings[0]);
}

test('real special CH3 retains every independent operator frequency and partial Key On mask',async()=>{
  const pair = await createOpnPair();
  try {
    writeSine(pair.write,2);
    for (const slot of [0,8,4,12]) pair.write(0x42+slot,16);
    for (const [high,low,fnum] of [[0xad,0xa9,256],[0xae,0xaa,512],[0xac,0xa8,768],[0xa6,0xa2,1024]]) {
      pair.write(high,0x20 | fnum >> 8);pair.write(low,fnum & 255);
    }
    pair.write(0x27,0x40);
    for (let operator=0;operator<4;operator++) {
      pair.write(0x28,2);pair.write(0x28,2 | 1 << (operator+4));
      const opn = pair.opn.processFrames(4096).left,opna = pair.opna.processFrames(4096).left;
      assertScaledSamples(opn,opna,.5);
      const measured = positiveCrossingHz(opn,pair.opn.sampleRate());
      const expected = (operator+1)*256*4000000*8/(72*2**20);
      assert(Math.abs(measured/expected-1) < .005,`OP${operator+1} frequency differs`);
    }
    pair.write(0x28,2);pair.write(0x28,0x52);
    assertScaledSamples(pair.opn.processFrames(4096).left,pair.opna.processFrames(4096).left,.5);
  } finally { pair.dispose(); }
});

test('calibrated OPNA gain already compensates FM and retains a distinct SSG listening balance',async context=>{
  const pair = await createOpnPair();
  try {
    writeSine(pair.write);
    const fm2203 = rms(pair.opn.processFrames(4096).left),fm2608 = rms(pair.opna.processFrames(4096).left);
    pair.opn.reset();pair.opna.reset();pair.write(7,0x3e);pair.write(0,119);pair.write(1,0);pair.write(8,10);
    const ssg2203 = rms(pair.opn.processFrames(4096).left),ssg2608 = rms(pair.opna.processFrames(4096).left);
    const gainRatio = calibratedGain('ym2608') / calibratedGain('ym2203');
    assert(Math.abs(fm2608/fm2203 - .5) < .001);
    assert(Math.abs(ssg2608/ssg2203 - 2/3) < .001);
    context.diagnostic(JSON.stringify({gain2203:calibratedGain('ym2203'),gain2608:calibratedGain('ym2608'),
      fmRawRatio:fm2608/fm2203,fmCalibratedRatio:fm2608/fm2203*gainRatio,
      ssgRawRatio:ssg2608/ssg2203,ssgCalibratedRatio:ssg2608/ssg2203*gainRatio}));
  } finally { pair.dispose(); }
});

test('real converted YM2203 VGM preserves partial operator Gates and sanitizes OPNA-only registers',async()=>{
  const writes = [];writeSine((register,value) => writes.push([register,value]));
  writes.push([0x28,0],[0x6c,0x80],[0xb4,0],[0x10,63],[0x22,15],[0x29,0],[0x28,0x84],[0x28,0xff]);
  const source = ym2203Vgm(writes),converted = await prepareFm2608SongSource(source);
  assert.equal(converted.header.ym2608Clock,8000000);
  const pair = await createOpnPair(),timeline = createFm2608SongTimeline(pair.opna);
  try {
    const pcm = [];
    for (const [engine,bytes] of [[pair.opn,source],[pair.opna,converted.bytes]]) {
      const player = new VgmPlayer(engine);player.load(bytes);player.reset();player.play();
      const left = new Float32Array(2048),right = new Float32Array(2048);
      assert.equal(player.process(left,right,left.length),left.length);
      pcm.push(left);
    }
    assert(rms(pcm[0]) > .001);
    assertScaledSamples(pcm[0],pcm[1],.5);
    const snapshot = timeline.read(0);
    assert.equal(snapshot.fm.channels[0].keyMask,8);
    assert.equal(snapshot.fm.channels[3].keyMask,0);
    assert.deepEqual(snapshot.fm.channels[0].preset.pan,{left:true,right:true});
    assert.equal(snapshot.fm.channels[0].preset.operators[4].am,false);
    assert.equal(snapshot.lfo.enabled,false);
    assert.equal(snapshot.rhythm.voices.some(voice => voice.gate),false);
  } finally { timeline.dispose();pair.dispose(); }
});
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
