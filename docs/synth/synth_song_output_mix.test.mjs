import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ymFactory from '../generated/ym2612_wasm.js';
import psgFactory from '../generated/segapsg_wasm.js';
import pcmFactory from '../generated/rf5c164_wasm.js';
import {GenesisAudioEngine} from '../js/genesisaudioengine.js';
import {PWM32X} from '../js/pwm32x.js';
import {installSynthSongOutputMix} from './synth_song_output_mix.js';

const bytes = Object.fromEntries(await Promise.all(['ym2612','segapsg','rf5c164'].map(async id =>
  [id, await readFile(new URL(`../generated/${id}_wasm.wasm`, import.meta.url))])));
const createEngine = () => GenesisAudioEngine.create({
  ym2612ModuleFactory:ymFactory, ym2612ModuleOptions:{wasmBinary:bytes.ym2612},
  segaPsgModuleFactory:psgFactory, segaPsgModuleOptions:{wasmBinary:bytes.segapsg},
  rf5c164Clock:12500000, rf5c164ModuleFactory:pcmFactory, rf5c164ModuleOptions:{wasmBinary:bytes.rf5c164},
});
const fm = (engine, channel=0, {pan=0xc0, csm=false}={}) => {
  const port = channel >= 3 ? 1 : 0, offset = channel % 3;
  for (const slot of [0,8,4,12]) {
    for (const [register,value] of [[0x30,1],[0x40,slot === 12 ? 24 : 16],[0x50,31],[0x60,3],[0x70,1],[0x80,0x26]]) {
      engine.writeYm2612(port, register+slot+offset, value);
    }
  }
  for (const [register,value] of [[0xb0,0x38],[0xb4,pan],[0xa4,0x22],[0xa0,0x69]]) engine.writeYm2612(port,register+offset,value);
  if (csm) {
    for (const [register,value] of [[0x24,254],[0x25,3],[0x27,0x85]]) engine.writeYm2612(0,register,value);
  } else engine.writeYm2612(0,0x28,0xf0 | (channel >= 3 ? 4 : 0) | offset);
};
const acRms = array => {
  const mean = array.reduce((sum,value)=>sum+value,0)/array.length;
  return Math.sqrt(array.reduce((sum,value)=>sum+(value-mean)**2,0)/array.length);
};
const nearStereo = (actual,expected,start=0) => {
  assert.deepEqual(actual.left.subarray(start),expected.left.subarray(start));
  assert.deepEqual(actual.right.subarray(start),expected.right.subarray(start));
};

test('default output is byte-exact; muted FM keeps feedback, EG, pitch and source pan writes advancing', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) {fm(e);fm(e,4,{pan:0x80});}
    nearStereo(engine.processFrames(999),reference.processFrames(999));
    mix.setMutedChannels(['ym2612:0']);
    const muted=engine.processFrames(2000), audible=reference.processFrames(2000);
    assert(acRms(muted.right)<1e-7, 'CH1 pan output is suppressed; CH5 is left only');
    assert(acRms(audible.right)>0.001);
    for (const e of [engine,reference]) {
      e.writeYm2612(0,0xb4,0x47); // Changed pan + PMS must survive mute.
      e.writeYm2612(0,0xa4,0x24);e.writeYm2612(0,0xa0,0x69);
      e.processFrames(777);
    }
    mix.setMutedChannels([]);
    nearStereo(engine.processFrames(4000),reference.processFrames(4000));
    const saved=reference.saveState();
    mix.dispose();
    nearStereo(engine.processFrames(111),reference.processFrames(111));
    assert(saved.byteLength>0);
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('CSM timers and manual source gates are not changed by output mute', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) fm(e,2,{csm:true});
    nearStereo(engine.processFrames(800),reference.processFrames(800));
    mix.setMutedChannels(['ym2612:2']);
    const muted=engine.processFrames(3000);reference.processFrames(3000);
    assert(acRms(muted.left)<1e-7);
    assert.equal(engine.ym2612.readStatus(),reference.ym2612.readStatus());
    mix.setMutedChannels([]);
    nearStereo(engine.processFrames(4000),reference.processFrames(4000));
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('CH6 DAC writes continue while muted and complete YM mute removes DC without stopping clocks', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) {e.writeYm2612(1,0xb6,0xc0);e.writeYm2612(0,0x2b,0x80);}
    mix.setMutedChannels(Array.from({length:6},(_,channel)=>`ym2612:${channel}`));
    for (const value of [4,200,81,240]) {
      for (const e of [engine,reference]) e.writeYm2612(0,0x2a,value);
      const muted=engine.processFrames(200);reference.processFrames(200);
      assert(muted.left.every(value=>value===0));assert(muted.right.every(value=>value===0));
    }
    mix.setMutedChannels([]);
    nearStereo(engine.processFrames(1000),reference.processFrames(1000));
    assert(engine.processFrames(10).left[0]>.1,'latest source DAC value is restored, not silence/midpoint');
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

function pcm(engine) {
  engine.pcm.loadMemory(Uint8Array.from([0x91,0xb0,0x40,0x65,0xff]),0);
  engine.pcm.loadMemory(Uint8Array.from([0xd0,0x20,0xf0,0x70,0xff]),256);
  for (const [channel,start,pan] of [[0,0,0x0f],[3,1,0xf0]]) {
    for (const [register,value] of [[7,0xc0|channel],[0,160],[1,pan],[2,0x71],[3,3],[4,0],[5,start],[6,start]]) engine.writeRf5c164(register,value);
  }
  engine.writeRf5c164(8,0xf6); // CH1 and CH4 enabled.
  engine.writeRf5c164(7,0x81); // Source leaves memory bank1 and channel4 selected.
}

test('RF channel mute retains sample positions, pan changes, selected channel and independent RAM bank', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) pcm(e);
    nearStereo(engine.processFrames(700),reference.processFrames(700));
    mix.setMutedChannels(['pcm:3']);
    assert.equal(engine.pcm.api.bank(engine.pcm.handle),4096);
    for (const e of [engine,reference]) {
      // Both writes must still target channel4, despite the last source control
      // write selecting the independently banked memory window.
      e.writeRf5c164(1,0x80);e.writeRf5c164(0,140);
      e.writeRf5c164Memory(2,0x55);
    }
    const muted=engine.processFrames(2000), audible=reference.processFrames(2000);
    assert(acRms(muted.right.subarray(3))<1e-7);
    assert(acRms(audible.right)>0.001);
    assert.equal(engine.pcm.readMemory(4098),0x55);
    assert.equal(engine.pcm.readMemory(2),0x40);
    for (let address=0;address<16;address++) assert.equal(engine.pcm.read(address),reference.pcm.read(address));
    mix.setMutedChannels([]);
    // RF resampling holds one native output sample until the next chip tick.
    nearStereo(engine.processFrames(3000),reference.processFrames(3000),3);
    mix.dispose();
    nearStereo(engine.processFrames(2000),reference.processFrames(2000));
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('PSG noise keeps Tone3 timing and PWM left/right output is independent; input validation is atomic', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) {
      for (const value of [0xc4,0x13,0xd0,0xe7,0xf2]) e.writePsg(value);
      e.writePwm(1,100);e.writePwm(2,75);e.writePwm(3,25);
    }
    nearStereo(engine.processFrames(500),reference.processFrames(500));
    mix.setMutedChannels(['psg:2','psg:3','pwm:0']);
    const output=engine.processFrames(1000);reference.processFrames(1000);
    assert(acRms(output.left)<1e-7);
    assert.equal(engine.pwm.output()[0],0);
    assert.equal(engine.pwm.output()[1],reference.pwm.output()[1]);
    assert.throws(()=>mix.setMutedChannels(['pwm:1','ym2612:6']),/Invalid/);
    assert.equal(engine.pwm.output()[0],0,'invalid list does not partially apply');
    assert.notEqual(engine.pwm.output()[1],0);
    mix.setMutedChannels([]);
    nearStereo(engine.processFrames(3000),reference.processFrames(3000));
    assert.throws(()=>mix.setMutedChannels(['pcm:-1']),/Invalid/);
  } finally {mix.dispose();engine.dispose();reference.dispose();}
  assert.throws(()=>mix.setMutedChannels([]),/disposed/);
});

test('fake/optional chip engines and reset retain host masks without source-observation writes', () => {
  const writes=[], engine={writeYm2612:(...args)=>writes.push(args),reset:()=>writes.push(['reset'])};
  const original=engine.writeYm2612,mix=installSynthSongOutputMix(engine);
  mix.setMutedChannels([]);
  mix.setMutedChannels(['ym2612:0']);
  engine.writeYm2612(0,0xb4,0xf7);assert.deepEqual(writes.at(-1),[0,0xb4,0x37]);
  engine.reset();engine.writeYm2612(0,0xb4,0xc0);assert.deepEqual(writes.at(-1),[0,0xb4,0]);
  mix.setMutedChannels([]);assert.deepEqual(writes.findLast(value=>value[0]===0&&value[1]===0xb4),[0,0xb4,0xc0]);
  mix.dispose();assert.equal(engine.writeYm2612,original);
});

test('real WASM PWM stereo output masks preserve FIFO, timer phase and continuation', async () => {
  const pwm=await PWM32X.create({sampleRate:53267,outputMode:'duty',gain:1}),
    reference=await PWM32X.create({sampleRate:53267,outputMode:'duty',gain:1});
  const engine={pwm,reset:()=>pwm.reset()},mix=installSynthSongOutputMix(engine);
  try {
    assert.equal(pwm.backend,'wasm');
    for (const chip of [pwm,reference]) {chip.writeRegister(0,5);chip.writeRegister(1,100);}
    for (let frame=0;frame<600;frame++) {
      if (frame===100) mix.setMutedChannels(['pwm:0']);
      if (frame===300) mix.setMutedChannels(['pwm:1']);
      if (frame===400) mix.setMutedChannels([]);
      for (const chip of [pwm,reference]) {
        chip.writeRegister(2,frame&8 ? 75 : 25);chip.writeRegister(3,frame&16 ? 80 : 20);
      }
      const actual=pwm.generateStereo(3),expected=reference.generateStereo(3);
      if (frame>=100&&frame<300) {
        assert(actual.left.every(value=>value===0));assert.deepEqual(actual.right,expected.right);
      } else if (frame>=300&&frame<400) {
        assert(actual.right.every(value=>value===0));assert.deepEqual(actual.left,expected.left);
      } else nearStereo(actual,expected);
      assert.equal(pwm.timerTick,reference.timerTick);
      assert.equal(pwm.interruptCount,reference.interruptCount);
      assert.equal(pwm.untilTick,reference.untilTick);
    }
    mix.dispose();
    nearStereo(pwm.generateStereo(1000),reference.generateStereo(1000));
  } finally {mix.dispose();pwm.dispose();reference.dispose();}
});
