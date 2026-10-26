import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwan} from './wonderswan.js';
import {WonderSwanSynth, WonderSwanDirectTransport, WONDERSWAN_CLOCK} from './wonderswansynth.js';

const rate = 48000;
const square = Array.from({length:32}, (_, index) => index < 16 ? 0 : 15);
const peak = audio => Math.max(...audio.map(Math.abs));
const wasmBinary = await readFile(new URL('../docs/generated/wonderswan_wasm.wasm', import.meta.url));
async function setup(clock = WONDERSWAN_CLOCK) {
  const chip = await WonderSwan.create({moduleFactory:factory, moduleOptions:{wasmBinary}, clock, sampleRate:rate});
  const synth = new WonderSwanSynth({clock, transport:new WonderSwanDirectTransport(chip)});
  synth.initialize(); return {chip, synth, dispose() { synth.dispose(); chip.dispose(); }};
}
function mock() {
  const commands = [];
  const synth = new WonderSwanSynth({transport:{writeRegister:(...args) => commands.push(['writeRegister', ...args]), writeMemory:(...args) => commands.push(['writeMemory', ...args]), reset:() => commands.push(['reset'])}});
  return {commands, synth};
}

test('WonderSwan four voices render quantized pitch, stereo and retained waveforms on real WASM', async () => {
  const device = await setup(); const {chip, synth} = device;
  try {
    assert.equal(peak(chip.generateStereo(128).left), 0, 'initialize is silent');
    for (let channel = 0; channel < 4; channel++) {
      synth.setWaveform(channel, square); synth.setVolume(channel, 15);
      const actual = synth.setNote(channel, 'A4'); synth.keyOn(channel);
      const audio = chip.generateStereo(rate); assert.deepEqual(audio.left, audio.right);
      assert(peak(audio.left) > .1); let rises = 0;
      for (let index = 1; index < audio.left.length; index++) if (!audio.left[index - 1] && audio.left[index] > 0) rises++;
      assert(Math.abs(rises - actual) < 2, `ch ${channel}: ${rises} vs ${actual}`);
      synth.keyOff(channel); chip.generateStereo(8); assert.equal(peak(chip.generateStereo(128).left), 0);
      synth.keyOn(channel); assert(peak(chip.generateStereo(1024).left) > .1, 'wave and volume survive release');
      synth.allNotesOff(); chip.generateStereo(8);
    }
    synth.setPan(2, 15, 0); synth.noteOn(2, 'E4');
    let audio = chip.generateStereo(2048); assert(peak(audio.left) > .1); assert.equal(peak(audio.right), 0);
    synth.setPan(2, 0, 15); chip.generateStereo(8); audio = chip.generateStereo(2048); assert.equal(peak(audio.left), 0); assert(peak(audio.right) > .1);
    synth.setWaveform(2, new Uint8Array(32).fill(3)); chip.generateStereo(8);
    assert.equal(peak(chip.generateStereo(128).right), 0, 'wave upload stops its channel');
    synth.keyOn(2); chip.generateStereo(256); audio = chip.generateStereo(1024); assert(audio.right.every(value => value === 45 / 1024));
    synth.dispose(); assert.doesNotThrow(() => chip.generateStereo(32), 'direct transport borrows core');
  } finally { device.dispose(); }
});

test('WonderSwan RAM uses current bank and low-first four-bit samples; allNotesOff preserves modes', () => {
  const {commands, synth} = mock(); synth.initialize();
  synth.writeRegister(0x8f, 255); synth.setWaveform(3, Array.from({length:32}, (_, index) => index & 15));
  assert.deepEqual(commands.slice(-16).map(command => command.slice(0,3)), Array.from({length:16}, (_, index) => ['writeMemory',0x3ff0 + index, ((index * 2 + 1) & 15) << 4 | ((index * 2) & 15)]));
  synth.setNoise({enabled:true, type:7, reset:true}); synth.setSweep({enabled:true, step:-8,time:31}); synth.setVoiceMode(true);
  for (let channel = 0; channel < 4; channel++) synth.keyOn(channel);
  synth.allNotesOff(); assert.equal(synth._getState().registers[16], 0xe0);
  assert.deepEqual(commands.slice(-4), [
    ['writeRegister',0x90,0xee,0,1], ['writeRegister',0x90,0xec,1,2],
    ['writeRegister',0x90,0xe8,2,4], ['writeRegister',0x90,0xe0,3,8],
  ]);
  assert.equal(synth._getState().registers[12], 248); assert.equal(synth._getState().registers[13],31);
  synth.loadMemory(Uint8Array.of(1,2),0x3ffe); assert.deepEqual(synth._getState().memory.slice(-2),[1,2]);
  synth.dispose();
});

test('WonderSwan noise, sweep and unsigned PCM drive their physical channels', async () => {
  const device = await setup(); const {chip, synth} = device;
  try {
    synth.setNoise({enabled:true,type:4,reset:true}); synth.noteOn(3, 'C4');
    const noise = chip.generateStereo(4800).left; assert(peak(noise) > .05); assert(new Set(noise).size > 1);
    synth.allNotesOff(); chip.generateStereo(8);
    const render = enabled => {
      synth.initialize(); synth.setSweep({enabled,step:24,time:0}); synth.noteOn(2,'C4'); return [...chip.generateStereo(4800).left];
    };
    assert.notDeepEqual(render(true), render(false)); assert.deepEqual(render(true), render(true), 'cold initialization resets sweep phase');
    synth.initialize(); assert.throws(() => synth.writeVoice(128), /Enable voice/);
    synth.setVoiceMode(true); synth.writeVoice(200); synth.keyOn(1); chip.generateStereo(8);
    let audio = chip.generateStereo(128); assert(audio.left.every(value => value === 200 / 1024)); assert.deepEqual(audio.left,audio.right);
    synth.writeVoice(0); chip.generateStereo(8); assert.equal(peak(chip.generateStereo(128).left),0);
    synth.keyOff(1); synth.setVoiceMode(false); synth.setVolume(1,9); synth.noteOn(1,'C4'); assert(peak(chip.generateStereo(1024).left) > .05);
  } finally { device.dispose(); }
});

test('WonderSwan frequency uses effective integer core rate and rejects unrepresentable periods', async () => {
  const clock = 4000001, device = await setup(clock); const {chip, synth} = device;
  try {
    const effective = Math.floor(clock / 128) * 128;
    assert.equal(synth.setFrequency(0,effective/(32*2048)),effective/(32*2048));
    assert.equal(chip.readRegister(0x80),0); assert.equal(chip.readRegister(0x81),0);
    const actual = synth.setNote(0,69); assert.equal(actual,effective/(32*Math.round(effective/(32*440))));
    synth.setWaveform(0,square); synth.keyOn(0); const audio = chip.generateStereo(rate).left;
    let rises=0; for(let i=1;i<audio.length;i++)if(!audio[i-1]&&audio[i]>0)rises++;
    assert(Math.abs(rises-actual)<2);
  } finally { device.dispose(); }
});

test('WonderSwan validates complete high-level calls before sending and adopts state without replay', () => {
  const {commands, synth} = mock(); synth.initialize();
  const invalid = [
    () => synth.setWaveform(0,[...square.slice(0,31),16]), () => synth.setWaveform(4,square),
    () => synth.setVolume(0,9,16), () => synth.setFrequency(0,1), () => synth.setFrequency(0,Infinity), () => synth.setNote(0,'A440'),
    () => synth.setNoise({enabled:1}), () => synth.setNoise({enabled:true,type:8}), () => synth.setNoise({enabled:true,reset:1}), () => synth.setNoise({enabled:true,hz:440}),
    () => synth.setSweep({enabled:true,step:-129}), () => synth.setSweep({enabled:true,time:32}), () => synth.setVoiceMode(1), () => synth.writeVoice(256),
    () => synth.writeMemory(0x4000,0), () => synth.writeMemory(0,256), () => synth.loadMemory(Uint8Array.of(1,2),0x3fff), () => synth.loadMemory([1]),
    () => synth.writeRegister(0x7f,0), () => synth.writeRegister(0x80,256),
  ];
  const count=commands.length;
  for(const call of invalid){assert.throws(call);assert.equal(commands.length,count);}
  synth.noteOn(2,'E4'); const state=synth._getState(); const other=mock();
  other.synth._adoptState(state); assert.deepEqual(other.commands,[]); assert.deepEqual(other.synth._getState(),state);
  other.synth.keyOn(0); assert.equal(other.commands.at(-1)[2],5,'adopted state retains CH2');
  const observations=[]; synth._observe=command=>observations.push(command); synth._beforeWrite=(address,value,channel,mask)=>mask!==4;
  synth.keyOff(2); assert.equal(observations.length,0); assert(synth._getState().registers[16]&4);
  const copy=synth._getState();copy.memory[0]=256;assert.throws(()=>synth._adoptState(copy));assert.deepEqual(synth._getState(),state);
  synth.reset();assert.throws(()=>synth.keyOn(0),/initialize/);synth.dispose();other.synth.dispose();assert.throws(()=>synth.reset(),/disposed/);
});
