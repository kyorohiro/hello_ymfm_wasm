import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidCore, SID_PAL_CLOCK} from '../../tetorica_src/runtime/sid.js';
import {Sid8580Core} from '../../tetorica_src/runtime/sid8580.js';
import {SidSynth,SID_WAVEFORMS,sidWaveformBits,sidWaveformFromBits} from '../../tetorica_src/runtime/sidsynth.js';
import {SidVoiceInspector, receiveSidInspector} from '../../tetorica_src/runtime/playground_sid_inspector.js';

const wasmBinary = await readFile(new URL('../../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url));
const previewBinary = await readFile(new URL('../../docs/generated/sid8580-machine/sid8580-endpoint.wasm', import.meta.url));
const peak = samples => samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
async function setup(t) {
  const core = await SidCore.create({wasmBinary}), synth = new SidSynth({core});
  t.after(() => { synth.dispose(); core.dispose(); }); return {core, synth};
}

test('all sixteen waveform masks have canonical names, accept permutations and reject duplicate/unknown flags',()=>{
  const names=['off','triangle','saw','triangle+saw','pulse','triangle+pulse','saw+pulse','triangle+saw+pulse',
    'noise','triangle+noise','saw+noise','triangle+saw+noise','pulse+noise','triangle+pulse+noise','saw+pulse+noise','triangle+saw+pulse+noise'];
  assert.deepEqual(SID_WAVEFORMS,['triangle','saw','pulse','noise']);assert(Object.isFrozen(SID_WAVEFORMS));
  for(let bits=0;bits<16;bits++){
    assert.equal(sidWaveformFromBits(bits),names[bits]);assert.equal(sidWaveformBits(names[bits]),bits);
    assert.equal(sidWaveformBits(names[bits].split('+').reverse().join('+')),bits);
  }
  for(const value of ['', 'combined','triangle+triangle','noise+pulse+noise','off+triangle','triangle+off','triangle+',
    '+saw','triangle++saw','saw pulse','triangle +saw','Pulse','sine','triangle+sine',null,0,[],{}])assert.throws(()=>sidWaveformBits(value));
  for(const value of [-1,16,.5,NaN,Infinity,'3',null,undefined])assert.throws(()=>sidWaveformFromBits(value));
});

for(const model of ['6581','8580'])test(`all ${model} waveform selections match raw control writes and preserve Gate/Sync/Ring`,async t=>{
  const Core=model==='8580'?Sid8580Core:SidCore,binary=model==='8580'?previewBinary:wasmBinary;
  for(let bits=0;bits<16;bits++){
    const authorCore=await Core.create({sampleRate:48000,wasmBinary:binary}),rawCore=await Core.create({sampleRate:48000,wasmBinary:binary});
    const author=new SidSynth({core:authorCore}),raw=new SidSynth({core:rawCore});
    try{
      for(const synth of [author,raw]){
        synth.initialize();synth.setVoice(0,{waveform:'pulse',attack:0,decay:1,sustain:12,release:8,sync:true,ring:true,test:false});
        synth.setVoice(2,{waveform:'triangle'});synth.setFrequency(2,199);synth.noteOn(0,'C4');
      }
      const before=Array.from(author.getRegisterSnapshot()),cycles=authorCore.getState().cycles;
      author.setVoice(0,{waveform:sidWaveformFromBits(bits)});raw.writeRegister(4,(bits<<4)|7);
      const state=author._getState(),expectedNames=SID_WAVEFORMS.filter((name,index)=>bits&(1<<index));
      assert.equal(state.registers[4],(bits<<4)|7);
      assert.deepEqual(state.registers.filter((value,index)=>index!==4),before.filter((value,index)=>index!==4));
      assert.equal(state.channels[0].gate,true);assert.equal(state.channels[0].sync,true);assert.equal(state.channels[0].ring,true);assert.equal(state.channels[0].test,false);
      assert.equal(state.channels[0].waveformBits,bits);assert.deepEqual(state.channels[0].waveforms,expectedNames);
      assert.equal(state.channels[0].waveform,expectedNames.length===1?expectedNames[0]:bits?'combined':'off');
      assert.equal(authorCore.getState().cycles,cycles+1,'waveform edit is exactly one control-register write');
      const pcm=authorCore.render(4096);assert(pcm.every(Number.isFinite));assert.deepEqual(pcm,rawCore.render(4096),`${model} mask ${bits} PCM`);
      assert.deepEqual(Array.from(authorCore.registers),Array.from(rawCore.registers));
      author.setVoice(0,{test:true});author.setVoice(0,{waveform:'off'});assert.equal(author.getRegisterSnapshot()[4],15,'off leaves Gate/Sync/Ring/TEST untouched');
    }finally{author.dispose();raw.dispose();authorCore.dispose();rawCore.dispose();}
  }
});

for(const model of ['6581','8580'])test(`invalid ${model} combined-wave patches leave all registers and held state unchanged`,async()=>{
  const Core=model==='8580'?Sid8580Core:SidCore,core=await Core.create({wasmBinary:model==='8580'?previewBinary:wasmBinary}),synth=new SidSynth({core});
  try{
    synth.initialize();synth.noteOn(1,'E4');core.render(3000);
    for(const waveform of ['','combined','triangle+triangle','noise+off','pulse+unknown',null,[],{}]){
      const before=synth._getState(),cycles=core.getState().cycles;
      assert.throws(()=>synth.setVoice(1,{attack:15,pulseWidth:1234,waveform}));
      assert.deepEqual(synth._getState(),before);assert.equal(core.getState().cycles,cycles);
    }
  }finally{synth.dispose();core.dispose();}
});

test('SID defaults are silent, helpers address three physical voices, and borrowed cores remain caller-owned', async t => {
  const {core, synth} = await setup(t);
  assert.throws(() => synth.noteOn(0, 'A4'), /initialize/);
  synth.initialize(); const initial = synth._getState();
  assert.equal(initial.model, '6581'); assert.equal(initial.clock, SID_PAL_CLOCK);
  assert.equal(initial.initialized, true); assert.equal(initial.filter.volume, 8);
  assert(initial.channels.every(voice => !voice.gate && voice.waveform === 'saw' && voice.pulseWidth === 2048));
  assert.equal(peak(core.render(256)), 0);
  const quantized = synth.setFrequency(2, 440); assert(Math.abs(quantized - 440) < 0.04);
  synth.noteOn(2, 'A4'); assert(peak(core.render(4096)) > 0.01);
  assert.deepEqual(synth._getState().channels.map(voice => voice.gate), [false, false, true]);
  synth.noteOff(2); assert.equal(synth._getState().channels[2].gate, false);
  synth.dispose(); assert.throws(() => synth.keyOn(0), /disposed/);
  assert.doesNotThrow(() => core.render(128), 'disposing a borrowed synth must not destroy its core');
});

test('SID voice/filter patches validate atomically and preserve unrelated bits and held Gates', async t => {
  const {core, synth} = await setup(t); synth.initialize(); synth.noteOn(0, 'C4');
  for (const [method, args] of [['setVoice', [0, {attack: 15, pulseWidth: 4096}]], ['setVoice', [0, {ring: true, other: 1}]],
    ['setFilter', [{volume: 15, cutoff: -1}]], ['setFilter', [{mode: 'lowpass', voice3off: 1}]],
    ['setFilter', [{volume: 15, mode: 'lowpass+noise'}]], ['noteOn', [0, 127]]]) {
    const before = synth._getState(), cycles = core.getState().cycles;
    assert.throws(() => synth[method](...args)); assert.deepEqual(synth._getState(), before); assert.equal(core.getState().cycles, cycles);
  }
  synth.setVoice(0, {waveform: 'pulse', pulseWidth: 1234, attack: 3, sync: true, ring: true});
  const voice = synth._getState().channels[0]; assert.equal(voice.gate, true); assert.equal(voice.decay, 6); assert.equal(voice.attack, 3);
  assert.equal(voice.pulseWidth, 1234); assert.equal(voice.waveform, 'pulse'); assert(voice.sync && voice.ring);
  synth.writeRegister(23, 8); synth.setFilter({mode: 'notch', cutoff: 1511, resonance: 9, routing: 5, volume: 12, voice3off: true});
  const filter = synth._getState().filter;
  assert.deepEqual(filter, {mode: 'notch', modeBits: 5, cutoff: 1511, resonance: 9, routing: 5, volume: 12, voice3off: true});
  assert.equal(synth.getRegisterSnapshot()[23] & 8, 8, 'the unexposed external-routing bit stays unchanged');
  assert.throws(() => synth.setFrequency(0, 0.00001), /representable/);
  await assert.rejects(synth.setClock(1022727), /new SID instance/); assert.equal(await synth.setClock(SID_PAL_CLOCK), true);
});

test('SID applied shadow represents raw waveform/filter combinations and exposes independent state copies', async t => {
  const {synth} = await setup(t); synth.initialize(); synth.writeRegister(4, 0x71); synth.writeRegister(24, 0xff);
  const state = synth._getState(); assert.equal(state.channels[0].waveform, 'combined');
  assert.deepEqual(state.channels[0].waveforms, ['triangle', 'saw', 'pulse']); assert.equal(state.channels[0].waveformBits, 7);
  assert.equal(state.filter.mode, 'lowpass+bandpass+highpass'); assert.equal(state.filter.modeBits, 7);
  state.channels[0].waveforms.length = 0; state.registers[4] = 0; state.filter.volume = 0;
  assert.equal(synth._getState().registers[4], 0x71); assert.equal(synth._getState().filter.volume, 15);
});

test('all SID filter output combinations match raw mode writes and retain shared settings and Gates', async t => {
  const modes = ['off', 'lowpass', 'bandpass', 'lowpass+bandpass', 'highpass', 'notch',
    'bandpass+highpass', 'lowpass+bandpass+highpass'];
  for (const [bits, mode] of modes.entries()) {
    const authoring = await setup(t), raw = await setup(t);
    for (const {synth} of [authoring, raw]) {
      synth.initialize(); synth.setFilter({cutoff: 699, resonance: 9, routing: 5, volume: 11, voice3off: true});
      synth.noteOn(0, 'C4'); synth.noteOn(2, 'G4');
    }
    authoring.synth.setFilter({mode}); raw.synth.writeRegister(24, 0x8b | (bits << 4));
    const state = authoring.synth._getState();
    assert.deepEqual(state.filter, {mode, modeBits: bits, cutoff: 699, resonance: 9, routing: 5, volume: 11, voice3off: true});
    assert.equal(state.registers[24], 0x8b | (bits << 4));
    assert.deepEqual(state.channels.map(voice => voice.gate), [true, false, true]);
    const pcm = authoring.core.render(4096);
    assert(pcm.every(Number.isFinite)); assert.deepEqual(pcm, raw.core.render(4096), mode);
    assert.equal(authoring.core.getState().cycles, raw.core.getState().cycles);
  }
});

test('SID adoption never replays writes and a blocked owner hook does not mutate local state', () => {
  const calls = [], synth = new SidSynth({transport: {writeRegister: (...args) => calls.push(args), reset() {}}});
  synth.initialize(); const state = synth._getState(), count = calls.length;
  state.registers[4] |= 1; synth._adoptState(state); assert.equal(calls.length, count); assert(synth._getState().channels[0].gate);
  for (const invalid of [{...state, clock: 1022727}, {...state, model: '8580'}, {...state, registers: [...state.registers.slice(0, 31), 256]}]) {
    assert.throws(() => synth._adoptState(invalid)); assert.equal(synth._getState().registers[4], state.registers[4]);
  }
  const observed = []; synth._observe = event => observed.push(event); synth._beforeWrite = register => register !== 4;
  synth.keyOff(0); assert(synth._getState().channels[0].gate); assert.equal(calls.length, count);
  synth.setFrequency(1, 220); assert.equal(observed.length, 2); assert(observed.every(event => event.channel === 1));
  synth.dispose();
});

test('SID filter changes actual WASM output while inspector reads neither clock nor mutate it', async t => {
  const dry = await setup(t), wet = await setup(t);
  for (const {synth} of [dry, wet]) { synth.initialize(); synth.noteOn(0, 'C4'); synth.noteOn(1, 'E4'); synth.noteOn(2, 'G4'); }
  wet.synth.setFilter({mode: 'lowpass', cutoff: 400, resonance: 12, routing: 7});
  const a = dry.core.render(4096), b = wet.core.render(4096);
  assert(peak(a) > .01 && peak(b) > .001); assert(a.some((value, index) => Math.abs(value - b[index]) > .01));
  const inspector = new SidVoiceInspector({synth: wet.synth, sampleRate: 48000}), before = wet.core.getState().cycles;
  const messages = [], port = {postMessage: message => messages.push(message)};
  for (let i = 0; i < 5; ++i) assert(receiveSidInspector({type: 'chip-inspector', action: 'read', id: i}, port, inspector));
  assert.equal(wet.core.getState().cycles, before); assert(messages.every(message => message.value.kind === 'sid' && message.value.readOnly));
  receiveSidInspector({type: 'chip-inspector', action: 'invoke', method: 'auditionOn', id: 6}, port, inspector);
  assert.match(messages.at(-1).error, /read-only/); assert.equal(wet.core.getState().cycles, before);
});
