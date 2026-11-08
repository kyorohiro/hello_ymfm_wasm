// SPDX-License-Identifier: BSD-3-Clause
// Original register scenes and authored test programs only; no game or ROM data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captureSidVoices, SNAPSHOT_NOTICE} from '../docs/sid-player/voice_snapshot.js';
import {readPreset, filterModeBits} from '../docs/synth-sid/preset.js';
import {SidPlayerCore} from '../docs/sid-player/core.js';
import {RsidPlayerCore} from '../docs/sid-player/rsid_core.js';
import {Sid8580PlayerCore} from '../docs/sid-player/core8580.js';
import {SidCore} from '../docs/js/sid.js';
import {Sid8580Core} from '../docs/js/sid8580.js';
import {SidInstrument} from '../docs/synth-sid/instrument.js';
import {createSidReferenceFixture} from './fixtures/sid-reference/fixture.mjs';
import {createSid8580MachineFixture} from './helpers/sid8580_machine_fixtures.mjs';

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

test('all four oscillator selections and all eight shared filter masks retain their literal meanings in both models', () => {
  for (const model of ['6581', '8580']) for (const [waveform, code] of [['triangle', 0x10], ['saw', 0x20], ['pulse', 0x40], ['noise', 0x80]]) {
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

test('unsupported modulation, combined or absent waveforms and held TEST keep explicit unavailable candidates', () => {
  for (const [control, reason] of [[1, /No oscillator/], [0x31, /Combined/], [0xf1, /Combined/],
    [0x23, /Sync \/ Ring/], [0x15, /Sync \/ Ring/], [0x27, /Sync \/ Ring/], [0x29, /TEST/]]) {
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
