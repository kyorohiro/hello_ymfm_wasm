// SPDX-License-Identifier: BSD-3-Clause
// Original register scenes and authored test programs only; no game or ROM data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captureSidVoices, SNAPSHOT_NOTICE} from '../docs/sid-player/voice_snapshot.js';
import {readPreset, filterModeBits, presetToCode, waveformFromBits} from '../docs/synth-sid/preset.js';
import {SidPlayerCore} from '../docs/sid-player/core.js';
import {RsidPlayerCore} from '../docs/sid-player/rsid_core.js';
import {Sid8580PlayerCore} from '../docs/sid-player/core8580.js';
import {SidCore} from '../docs/js/sid.js';
import {Sid8580Core} from '../docs/js/sid8580.js';
import {SidInstrument} from '../docs/synth-sid/instrument.js';
import {SidSynth} from '../docs/js/sidsynth.js';
import {sidFrequency} from '../docs/js/sid.js';
import {createSidReferenceFixture} from './fixtures/sid-reference/fixture.mjs';
import {createSid8580MachineFixture} from './helpers/sid8580_machine_fixtures.mjs';
import {createSidPairFixture} from './helpers/sid_voice_pair_fixtures.mjs';

function scene({model = '6581', mask = 3, route = 5, gate = true} = {}) {
  const registers = Array(32).fill(0);
  for (let voice = 0; voice < 3; voice++) {
    const base = voice * 7;
    registers[base] = 0x45 + voice; registers[base + 1] = 0x1d;
    registers[base + 2] = 0xbc; registers[base + 3] = 0xfa;
    registers[base + 4] = 0x20 | Number(gate);
    registers[base + 5] = 0x4e; registers[base + 6] = 0xb7;
  }
  registers[21] = 0xfd; registers[22] = 0xab; registers[23] = 0xc0 | route; registers[24] = mask << 4 | 9;
  return {model, clockHz: 985248, positionFrames: 123456, sampleRate: 48000, registers,
    declaredModel: model === '6581' ? '8580' : '6581', voices: Array.from({length: 3}, (_, index) => ({envelope: model === '8580' ? null : index * 127, phase: index * 500}))};
}
const pcm = value => Buffer.from(value.buffer, value.byteOffset, value.byteLength);

test('snapshot preserves applied model, exact voice codes and the selected voice filter route without source mutation', () => {
  const state = scene(), original = structuredClone(state), result = captureSidVoices(state, {name: 'Authored tune', subtune: 2});
  assert.equal(result.model, '6581', 'never use the conflicting header declaration instead of the running model');
  assert.equal(result.positionFrames, 123456); assert.equal(result.sampleRate, 48000);
  assert.deepEqual(result.voices.map(row => row.voice), [0, 1, 2]);
  for (const row of result.voices) {
    assert.equal(row.available, true); assert.equal(row.reason, null); assert.equal(row.gate, true);
    assert.equal(row.pair, null);
    assert.equal(row.envelope, row.voice * 127); assert.equal(row.frequencyHz, (0x1d45 + row.voice) * 985248 / 16777216);
    assert.equal(row.preset.name, `Authored tune · Song 2 · Voice ${row.voice + 1}`);
    assert.deepEqual(row.preset.voice, {waveform: 'saw', pulseWidth: 0xabc, attack: 4, decay: 14, sustain: 11, release: 7, test: false});
    assert.deepEqual(row.preset.modulation, {sync: false, ring: false, ratio: 1});
    assert.deepEqual(row.preset.filter, {enabled: row.voice !== 1, mode: 'lowpass+bandpass', cutoff: 0x55d, resonance: 12, volume: 9});
    assert.deepEqual(readPreset(row.preset), row.preset);
  }
  assert.deepEqual(state, original);
  result.voices[0].preset.voice.attack = 15; result.voices[0].warnings.push('local');
  assert.equal(result.voices[1].preset.voice.attack, 4); assert.equal(state.registers[5], 0x4e);
  assert.deepEqual(captureSidVoices(state), captureSidVoices(original));
});

test('all fifteen nonzero oscillator masks and all eight shared filter masks retain their literal meanings in both models', () => {
  for (const model of ['6581', '8580']) for (let bits = 1; bits < 16; bits++) {
    const waveform = waveformFromBits(bits), code = bits << 4;
    for (let mask = 0; mask < 8; mask++) for (const routed of [false, true]) {
      const state = scene({model, mask, route: Number(routed)}); state.registers[4] = code | 1;
      const row = captureSidVoices(state).voices[0];
      if (!mask && routed) {assert.equal(row.available, false); assert.equal(row.preset, null); assert.match(row.reason, /no enabled outputs/); continue;}
      assert.equal(row.available, true); assert.equal(row.preset.model, model); assert.equal(row.preset.version, 2);
      assert.equal(row.preset.voice.waveform, waveform); assert.equal(row.preset.filter.enabled, routed && Boolean(mask));
      assert.equal(filterModeBits(row.preset.filter.mode), mask); assert.equal(row.preset.filter.cutoff, 0x55d);
      assert.equal(row.preset.filter.resonance, 12); assert.equal(row.preset.filter.volume, 9);
      assert.equal(row.envelope, model === '8580' ? null : 0, 'an unavailable observation is not synthesized as zero');
    }
  }
});

test('absent carrier waveforms and held TEST keep explicit unavailable candidates even when other wave flags are selected', () => {
  for (const [control, reason] of [[1, /No oscillator/], [0x39, /TEST/], [0xf9, /TEST/], [0x29, /TEST/]]) {
    const state = scene(); state.registers[4] = control;
    const row = captureSidVoices(state).voices[0];
    assert.equal(row.available, false); assert.equal(row.preset, null); assert.match(row.reason, reason);
    assert.equal(captureSidVoices(state).voices[1].available, true, 'an unsupported sibling does not block an independent voice');
  }
});

test('Voice 3 off mutes only its dry branch and never silently changes filtered or inactive routing', () => {
  for (const mask of [0, 1, 3, 7]) for (const routed of [false, true]) {
    const state = scene({mask, route: routed ? 4 : 0}); state.registers[24] |= 0x80;
    const result = captureSidVoices(state), row = result.voices[2];
    assert.equal(result.voices[0].available, true, 'voice3off never mutes voice1');
    if (!routed) {assert.equal(row.available, false); assert.match(row.reason, /Voice 3 dry output/);}
    else if (!mask) {assert.equal(row.available, false); assert.match(row.reason, /no enabled outputs/);}
    else {assert.equal(row.available, true); assert.equal(row.preset.filter.enabled, true); assert.equal(filterModeBits(row.preset.filter.mode), mask);}
  }
});

test('released Gate, zero frequency/volume and unavailable Envelope are disclosed without inventing elapsed state', () => {
  const state = scene({model: '8580', gate: false}); state.registers[0] = state.registers[1] = 0; state.registers[24] &= 0xf0;
  const row = captureSidVoices(state).voices[0];
  assert.equal(row.available, true); assert.equal(row.envelope, null); assert.equal(row.gate, false); assert.equal(row.frequencyHz, 0);
  assert.equal(row.preset.filter.volume, 0); assert.equal(row.preset.voice.attack, 4);
  for (const pattern of [/Gate is off/, /Envelope is unavailable/, /frequency is zero/, /Chip volume is zero/]) assert(row.warnings.some(text => pattern.test(text)));
  assert.match(SNAPSHOT_NOTICE, /Instantaneous/); assert.match(SNAPSHOT_NOTICE, /keyboard pitch/); assert.match(SNAPSHOT_NOTICE, /elapsed Envelope/); assert.match(SNAPSHOT_NOTICE, /oscillator phase/); assert.match(SNAPSHOT_NOTICE, /song automation/);
  assert(!Object.hasOwn(row.preset, 'frequencyHz')); assert(!Object.hasOwn(row.preset, 'envelope'));
});

test('snapshot labels sanitize controls, retain a short tune/song/voice identity and fit strict preset names', () => {
  for (const name of ['', 'A\nB\tC\u0085D\u2028E\u2029F', '😀'.repeat(100), 'x'.repeat(300)]) {
    for (const row of captureSidVoices(scene(), {name, subtune: 65535}).voices) {
      assert(row.preset.name.length <= 80); assert.match(row.preset.name, /Song 65535 · Voice [123]$/);
      assert(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(row.preset.name));
      assert.doesNotThrow(() => readPreset(JSON.stringify(row.preset)));
    }
  }
});

test('invalid applied metadata or register vectors reject before returning partially converted voices', () => {
  const good = scene();
  for (const update of [{model: 'auto'}, {model: 8580}, {clockHz: 1022727}, {positionFrames: -1}, {positionFrames: 1.5},
    {sampleRate: 7999}, {sampleRate: NaN}, {registers: Array(31).fill(0)}, {registers: Array(33).fill(0)}, {registers: 'x'.repeat(32)},
    {registers: new Float32Array(32)}, ...[-1, 256, 0.5, NaN, true, '10'].map(value => ({registers: [...good.registers.slice(0, 31), value]}))]) {
    const state = {...good, ...update}, before = structuredClone(state);
    assert.throws(() => captureSidVoices(state)); assert.deepEqual(state, before);
  }
  assert.throws(() => captureSidVoices(null)); assert.throws(() => captureSidVoices([]));
  for (const options of [{name: {}}, {subtune: 0}, {subtune: 1.5}, {subtune: 65536}]) assert.throws(() => captureSidVoices(good, options));
  const typed = {...good, registers: new Uint8Array(good.registers)};
  assert.deepEqual(captureSidVoices(typed), captureSidVoices(good));
});

function pairScene(options = {}) {
  const fixture = createSidPairFixture(options);
  return {fixture, state: {...scene({model: fixture.model}), registers: fixture.registers.slice()}};
}
const modulationModes = [{sync: true, ring: false}, {sync: false, ring: true}, {sync: true, ring: true}];

test('independent Sync/Ring/Both pairs retain all three physical source positions and either model', () => {
  for (const model of ['6581', '8580']) for (let carrier = 0; carrier < 3; carrier++) for (const flags of modulationModes) {
    for (let sourceWave = 0; sourceWave < 16; sourceWave++) for (const sourceGate of [false, true]) for (const carrierGate of [false, true]) {
      const source = (carrier + 2) % 3;
      const {state} = pairScene({model, carrier, ...flags, carrierGate, sourceControl: sourceWave << 4 | Number(sourceGate),
        overrides: [[source * 7 + 5, sourceWave * 17], [source * 7 + 6, sourceGate ? 0xff : 0]]});
      const before = structuredClone(state), row = captureSidVoices(state).voices[carrier];
      assert.equal(row.available, true); assert.equal(row.reason, null); assert.equal(row.gate, carrierGate);
      assert.deepEqual(row.pair, {carrierVoice: carrier, sourceVoice: source, sourceFrequencyRegister: 0x2400,
        carrierFrequencyRegister: 0x1800, sourceFrequencyHz: 0x2400 * 985248 / 16777216, ratio: 1.5, ...flags});
      assert.deepEqual(row.preset.modulation, {...flags, ratio: 1.5}); assert.equal(row.preset.model, model);
      assert.deepEqual(row.preset.voice, {waveform: 'triangle', pulseWidth: 0x734, attack: 0, decay: 0, sustain: 12, release: 7, test: false});
      assert.deepEqual(row.preset.filter, {enabled: true, mode: 'lowpass+bandpass', cutoff: 700, resonance: 6, volume: 8});
      assert(row.warnings.some(text => text.includes(`Voice ${source + 1} → Voice ${carrier + 1}`)));
      assert(row.warnings.some(text => /silent Triangle source.*Gate\/ADSR.*audible source/.test(text)));
      assert.deepEqual(readPreset(JSON.stringify(row.preset)), row.preset);
      assert.deepEqual(state, before, 'source waveform and Gate/ADSR are observations, never rewritten to silence it');
    }
  }
});

test('pair ratios use literal nonzero frequency-register division and reject only values outside the existing range', () => {
  for (const [carrierFrequency, sourceFrequency, available] of [
    [8, 1, true], [4096, 32768, true], [8192, 65535, true], [12007, 19013, true], [65535, 65535, true], [1, 1, true],
    [65535, 8191, false], [8191, 65535, false], [65535, 1, false], [1, 65535, false],
  ]) {
    const {state} = pairScene({carrierFrequency, sourceFrequency}), row = captureSidVoices(state).voices[0];
    assert.equal(row.pair.ratio, sourceFrequency / carrierFrequency); assert.equal(row.available, available);
    if (available) assert.equal(row.preset.modulation.ratio, sourceFrequency / carrierFrequency);
    else {assert.equal(row.preset, null); assert.match(row.reason, /ratio.*0\.125 to 8/);}
  }
  for (const [carrierFrequency, sourceFrequency] of [[0, 1], [1, 0], [0, 0]]) {
    const {state} = pairScene({carrierFrequency, sourceFrequency}), row = captureSidVoices(state).voices[0];
    assert.equal(row.available, false); assert.equal(row.preset, null); assert.equal(row.pair, null); assert.match(row.reason, /nonzero carrier and source/);
  }
  const single = pairScene({sync: false, ring: false, carrierFrequency: 0});
  assert.equal(captureSidVoices(single.state).voices[0].available, true, 'the earlier single-voice zero-pitch disclosure remains available');
});

test('additional source/third modulation dependencies and carrier/source TEST never masquerade as independent pairs', () => {
  for (let carrier = 0; carrier < 3; carrier++) for (const flags of modulationModes) {
    for (const control of [0x02, 0x04, 0x06, 0x13, 0x15, 0x1f]) for (const which of ['sourceControl', 'thirdControl']) {
      const {state} = pairScene({carrier, ...flags, [which]: control}), row = captureSidVoices(state).voices[carrier];
      assert.equal(row.available, false); assert.equal(row.preset, null); assert.match(row.reason, /three-voice dependency/);
    }
    for (const extra of [{carrierTest: true}, {sourceControl: 0x18}]) {
      const {state} = pairScene({carrier, ...flags, ...extra}), row = captureSidVoices(state).voices[carrier];
      assert.equal(row.available, false); assert.equal(row.preset, null); assert.match(row.reason, /TEST/);
    }
    const unrelated = pairScene({carrier, ...flags, thirdControl: 0x18});
    assert.equal(captureSidVoices(unrelated.state).voices[carrier].available, true, 'an unconnected third oscillator TEST does not change the source pair');
  }
});

test('paired carriers retain every combined waveform, Triangle Ring semantics and selected-voice routing', () => {
  for (let carrier = 0; carrier < 3; carrier++) for (let bits = 1; bits < 16; bits++) {
    const waveform = waveformFromBits(bits);
    for (const flags of modulationModes) {
      const {state} = pairScene({carrier, ...flags});state.registers[carrier * 7 + 4] = bits << 4 | 1 | Number(flags.sync) << 1 | Number(flags.ring) << 2;
      const row = captureSidVoices(state).voices[carrier];
      assert.equal(row.available, true); assert.equal(row.preset.voice.waveform, waveform); assert.equal(row.preset.modulation.ring, flags.ring);
      assert.equal(row.warnings.some(text => /Ring affects Triangle only/.test(text)), flags.ring && !(bits & 1));
    }
    for (let mask = 0; mask < 8; mask++) for (const routed of [false, true]) for (const voice3off of [false, true]) {
      const {state} = pairScene({carrier, sync: true, ring: true, filterModeMask: mask, filterRouting: routed ? 1 << carrier : 0, voice3off});
      state.registers[carrier * 7 + 4] = bits << 4 | 7;
      const row = captureSidVoices(state).voices[carrier], silent = routed && !mask || carrier === 2 && !routed && voice3off;
      assert.equal(row.available, !silent);
      if (silent) {assert.equal(row.preset, null); assert.match(row.reason, /no enabled outputs|Voice 3 dry output/);}
      else {assert.equal(row.preset.filter.enabled, routed); assert.equal(filterModeBits(row.preset.filter.mode), mask);}
    }
  }
  for (const control of [0x03, 0x3b, 0xfb]) {
    const {state} = pairScene({overrides: [[4, control]]}), row = captureSidVoices(state).voices[0];
    assert.equal(row.available, false); assert.match(row.reason, /No oscillator|TEST/);
  }
});

test('single snapshots stay independent of unrelated modulation flags and pair metadata is detached', () => {
  const {state} = pairScene({sync: false, ring: false, sourceControl: 0x16, thirdControl: 0x16});
  const first = captureSidVoices(state).voices[0];assert.equal(first.available, true);assert.equal(first.pair, null);
  assert.deepEqual(first.preset.modulation, {sync: false, ring: false, ratio: 1});
  const paired = pairScene(), captured = captureSidVoices(paired.state);captured.voices[0].pair.ratio = 7;
  assert.equal(captureSidVoices(paired.state).voices[0].pair.ratio, 1.5);
});

const binaries = Object.fromEntries(await Promise.all([
  ['direct', 'sid-player/sid-player.wasm'], ['c64', 'sid-rsid/sid-rsid.wasm'], ['sid', 'sid/sid.wasm'],
  ['endpoint', 'sid8580-machine/sid8580-endpoint.wasm'], ['machine', 'sid8580-machine/sid8580-machine.wasm'],
].map(async ([key, path]) => [key, await readFile(new URL('../docs/generated/' + path, import.meta.url))])));

test('capturing actual Direct6581, C646581 and8580 states neither advances the machine nor changes its next PCM', async () => {
  for (const backend of ['direct6581', 'c646581', 'c648580']) {
    const model = backend === 'c648580' ? '8580' : '6581', Core = model === '8580' ? Sid8580PlayerCore : backend === 'direct6581' ? SidPlayerCore : RsidPlayerCore;
    const options = model === '8580' ? {endpointBinary: binaries.endpoint, machineBinary: binaries.machine} : {wasmBinary: backend === 'direct6581' ? binaries.direct : binaries.c64};
    const current = await Core.create({sampleRate: 48000, ...options}), control = await Core.create({sampleRate: 48000, ...options});
    const fixture = model === '8580' ? createSid8580MachineFixture('bus-immediate', {filter: true}) : createSidReferenceFixture('melody-filter');
    const bytes = fixture.bytes, load = {vbiBackend: backend === 'direct6581' ? 'direct' : 'c64'};
    try {
      current.load(bytes, load); control.load(bytes, load);
      const first = current.render(12000); assert.deepEqual(pcm(first), pcm(control.render(12000))); assert(first.some(value => value !== 0));
      const before = current.getState(), captured = captureSidVoices(before, {name: 'Authored ' + backend});
      assert.deepEqual(current.getState(), before, 'a passive read/conversion never clocks CPU/SID');
      assert.equal(captured.model, model); assert.equal(captured.positionFrames, 12000);
      const row = captured.voices[0]; assert.equal(row.available, true); assert.equal(row.preset.model, model); assert.equal(row.preset.filter.enabled, true);
      assert.equal(row.preset.voice.pulseWidth, before.registers[2] | (before.registers[3] & 15) << 8);
      assert.equal(row.preset.filter.cutoff, before.registers[22] << 3 | before.registers[21] & 7);
      assert.equal(row.envelope, model === '8580' ? null : before.voices[0].envelope);
      assert.deepEqual(pcm(current.render(4096)), pcm(control.render(4096)), 'snapshot extraction preserves the next real PCM');
      // The captured portable preset is executable by the real matching Synth,
      // without retaining the source program or an elapsed machine observation.
      const AudioCore = model === '8580' ? Sid8580Core : SidCore;
      const core = await AudioCore.create({sampleRate: 48000, wasmBinary: model === '8580' ? binaries.endpoint : binaries.sid});
      const instrument = new SidInstrument(core);
      try {
        instrument.loadPreset(row.preset); instrument.noteOn('snapshot', 60);
        const audition = new Float32Array(16000); instrument.renderInto(audition);
        assert(audition.every(Number.isFinite)); assert(audition.some(value => Math.abs(value) > .00001), `${backend}: captured preset produces actual Synth PCM`);
        assert.equal(instrument.read().preset.model, model);
      } finally {instrument.dispose();}
    } finally {current.dispose(); control.dispose();}
  }
});

function playerOptions(backend) {
  return backend === 'c648580' ? {Core: Sid8580PlayerCore, model: '8580', options: {endpointBinary: binaries.endpoint, machineBinary: binaries.machine}}
    : backend === 'direct6581' ? {Core: SidPlayerCore, model: '6581', options: {wasmBinary: binaries.direct}}
      : {Core: RsidPlayerCore, model: '6581', options: {wasmBinary: binaries.c64}};
}
const registerFrequency = (registers, voice) => registers[voice * 7] | registers[voice * 7 + 1] << 8;
const noteHz = midi => 440 * 2 ** ((midi - 69) / 12);

test('real CPU combined-waveform snapshots remain passive and execute in the matching Synth and exported code', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  for (const backend of ['direct6581', 'c646581', 'c648580']) for (const bits of [3, 7, 15]) {
    const {Core, model, options} = playerOptions(backend), fixture = createSidPairFixture({model, sync: false, ring: false, overrides: [[4, bits << 4 | 1]]});
    const player = await Core.create({sampleRate: 48000, ...options});
    let instrument, copied, copyCore;
    try {
      player.load(fixture.bytes, {vbiBackend: backend === 'direct6581' ? 'direct' : 'c64'});player.render(12000);
      const before = player.getState(), row = captureSidVoices(before, {name: `Authored combined ${bits}`}).voices[0];
      assert.equal(before.registers[4] & 0xf0, bits << 4);assert.equal(row.available, true);
      assert.equal(row.preset.voice.waveform, waveformFromBits(bits));assert.deepEqual(player.getState(), before);
      const AudioCore = model === '8580' ? Sid8580Core : SidCore, audioOptions = {sampleRate: 48000, wasmBinary: model === '8580' ? binaries.endpoint : binaries.sid};
      instrument = new SidInstrument(await AudioCore.create(audioOptions));instrument.loadPreset(row.preset);instrument.noteOn('combined snapshot', 60);
      copyCore = await AudioCore.create(audioOptions);copied = new SidSynth({core: copyCore});
      await new AsyncFunction('sid', 'createSoundChip', presetToCode(row.preset))(copied, async () => copied);
      assert.equal(instrument.read().registers[4] & 0xf0, bits << 4);assert.equal(copied._getState().registers[4] & 0xf0, bits << 4);
      const audition = instrument.renderInto(new Float32Array(2048));assert(audition.every(Number.isFinite));
      assert.deepEqual(pcm(audition), pcm(copyCore.render(2048)), `${backend}: the imported combination uses the same real chip output as Copy JavaScript`);
    } finally {player.dispose();instrument?.dispose();copied?.dispose();copyCore?.dispose();}
  }
});

test('real CPU pair snapshots retain every source/carrier position without advancing playback; Synth and Copy JavaScript use the same mono tuning', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  for (const backend of ['direct6581', 'c646581', 'c648580']) for (let carrier = 0; carrier < 3; carrier++) for (const flags of modulationModes) {
    const {Core, model, options} = playerOptions(backend), fixture = createSidPairFixture({model, carrier, ...flags,
      carrierFrequency: 0x1801, sourceFrequency: 0x2407});
    const current = await Core.create({sampleRate: 48000, ...options}), control = await Core.create({sampleRate: 48000, ...options});
    const load = {vbiBackend: backend === 'direct6581' ? 'direct' : 'c64'};
    let instrument, copyCore, copied;
    try {
      current.load(fixture.bytes, load); control.load(fixture.bytes, load);
      const first = current.render(12000); assert.deepEqual(pcm(first), pcm(control.render(12000))); assert(first.every(Number.isFinite)); assert(first.some(value => Math.abs(value) > .00001));
      const before = current.getState(); assert.deepEqual(before.registers.slice(0, 25), fixture.registers.slice(0, 25), `${backend}: the real CPU applied every authored pair register`);
      const captured = captureSidVoices(before, {name: 'Authored pair'}), row = captured.voices[carrier];
      assert.equal(row.available, true); assert.equal(row.pair.sourceVoice, fixture.source); assert.equal(row.pair.carrierVoice, carrier);
      assert.equal(row.pair.sourceFrequencyRegister, 0x2407); assert.equal(row.pair.carrierFrequencyRegister, 0x1801);
      assert.deepEqual(row.preset.modulation, {...flags, ratio: 0x2407 / 0x1801});
      assert.deepEqual(current.getState(), before, 'reading and converting does not advance CPU, envelope, phase or PCM');
      assert.deepEqual(pcm(current.render(2048)), pcm(control.render(2048)), 'capture preserves the next original playback PCM');

      const AudioCore = model === '8580' ? Sid8580Core : SidCore, audioOptions = {sampleRate: 48000, wasmBinary: model === '8580' ? binaries.endpoint : binaries.sid};
      instrument = new SidInstrument(await AudioCore.create(audioOptions));
      instrument.loadPreset(row.preset); instrument.noteOn('C4', 60);
      const played = instrument.read(), carrierRegister = sidFrequency(noteHz(60), 985248), sourceRegister = sidFrequency(noteHz(60) * row.pair.ratio, 985248);
      assert.equal(played.capacity, 1); assert.equal(played.voices.length, 1); assert.equal(played.voices[0].channel, 0);
      assert.equal(registerFrequency(played.registers, 0), carrierRegister); assert.equal(registerFrequency(played.registers, 2), sourceRegister);
      assert.equal(played.registers[4] & 6, (Number(flags.sync) << 1) | (Number(flags.ring) << 2));
      assert.equal(played.registers[18], 0x10, 'the remapped source is Triangle with Gate/Sync/Ring/TEST off');
      assert.equal(played.registers[19], 0); assert.equal(played.registers[20], 0, 'the source envelope remains silent');
      assert.equal(played.registers[23] & 7, 1, 'only the remapped carrier is routed to the shared filter');
      assert.equal(played.registers[24] & 0x80, 0x80, 'the source dry output is also muted');

      copyCore = await AudioCore.create(audioOptions); copied = new SidSynth({core: copyCore});
      const calls = [], code = presetToCode(row.preset);
      const primary = model === '6581' ? copied : new Proxy({}, {get() {throw Error('The copied8580 pair cannot modify the6581 primary');}});
      await new AsyncFunction('sid', 'createSoundChip', code)(primary, async (name, settings) => {calls.push({name, settings});return copied;});
      assert.deepEqual(copied._getState().registers, played.registers, 'Copy JavaScript uses the same carrier flags/filter and literal ratio');
      assert.equal(calls.length, model === '8580' ? 1 : 0);
      if (calls.length) {assert.equal(calls[0].name, 'sid'); assert.equal(calls[0].settings.model, '8580');}
      const audition = new Float32Array(8192); instrument.renderInto(audition);
      assert(audition.every(Number.isFinite)); assert(audition.some(value => Math.abs(value) > .00001));
      assert.deepEqual(pcm(audition), pcm(copyCore.render(8192)), 'fresh Synth and exported code are deterministic; this does not restore the original tune phase or pitch');

      instrument.noteOn('E4', 64); assert.equal(instrument.read().voices.length, 1); assert.equal(instrument.noteOff('C4'), false, 'the old mono owner cannot release its replacement');
      const next = instrument.read();assert.equal(registerFrequency(next.registers, 0), sidFrequency(noteHz(64), 985248));
      assert.equal(registerFrequency(next.registers, 2), sidFrequency(noteHz(64) * row.pair.ratio, 985248));
      instrument.noteOff('E4');instrument.stop();const stopped = new Float32Array(512);instrument.renderInto(stopped);assert(stopped.every(value => value === 0));
    } finally {instrument?.dispose();copied?.dispose();copyCore?.dispose();current.dispose();control.dispose();}
  }
});

test('supported real source waveforms, Gate and ADSR do not change isolated Sync/Ring carrier PCM', async () => {
  for (const backend of ['direct6581', 'c648580']) for (const flags of modulationModes) {
    const {Core, model, options} = playerOptions(backend);let expected, expectedPreset;
    const controls = Array.from({length: 16}, (_, waveform) => [waveform << 4, waveform << 4 | 1]).flat();
    for (const [index, sourceControl] of controls.entries()) {
      // The original source dry branch is muted so the comparison isolates
      // its oscillator phase dependency rather than an audible second voice.
      const fixture = createSidPairFixture({model, ...flags, sourceControl, voice3off: true,
        overrides: [[19, index * 43 & 255], [20, 255 - (index * 41 & 255)]]});
      const core = await Core.create({sampleRate: 48000, ...options});
      try {
        core.load(fixture.bytes, {vbiBackend: backend === 'direct6581' ? 'direct' : 'c64'});
        const output = core.render(16384), row = captureSidVoices(core.getState()).voices[0];
        assert.equal(row.available, true); assert.equal(row.pair.ratio, 1.5);
        assert(output.every(Number.isFinite)); assert(output.some(value => Math.abs(value) > .00001));
        if (!expected) {expected = Buffer.from(pcm(output));expectedPreset = row.preset;}
        else {assert(pcm(output).equals(expected), `${backend}: source control ${sourceControl.toString(16)} / ADSR variation changed a carrier phase dependency`); assert.deepEqual(row.preset, expectedPreset);}
      } finally {core.dispose();}
    }
  }
});

test('6581 and8580 keep no-wave source phase running and capture it without changing playback', async () => {
  for (const backend of ['direct6581', 'c646581', 'c648580']) for (const flags of modulationModes) {
    const {Core, model, options} = playerOptions(backend), results = [];
    for (const sourceControl of [0x10, 0x00, 0x01]) {
      const fixture = createSidPairFixture({model, ...flags, sourceControl, voice3off: true});
      const current = await Core.create({sampleRate: 48000, ...options}), reference = await Core.create({sampleRate: 48000, ...options});
      try {
        const load = {vbiBackend: backend === 'direct6581' ? 'direct' : 'c64'};
        current.load(fixture.bytes, load);reference.load(fixture.bytes, load);
        const output = current.render(16384);assert(pcm(output).equals(pcm(reference.render(16384))));
        const before = current.getState(), row = captureSidVoices(before).voices[0];
        assert.deepEqual(current.getState(), before);assert(pcm(current.render(2048)).equals(pcm(reference.render(2048))), 'capturing a no-wave source never changes playback');
        results.push(Buffer.from(pcm(output)));
        assert.equal(row.available, true);assert.equal(row.reason, null);assert.equal(row.pair.ratio, 1.5);
      } finally {current.dispose();reference.dispose();}
    }
    for (const noWave of results.slice(1)) {
      assert(noWave.equals(results[0]), `${backend}: an unselected source waveform must not change oscillator phase or isolated carrier PCM`);
    }
  }
});
