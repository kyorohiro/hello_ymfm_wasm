// Independent program/PCM integration checks. Self-authored data only.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SidCore} from '../tetorica_src/runtime/sid.js';
import {validateBrowserPsid} from '../docs/js/sid_psid.js';
import {createSidReferenceFixture, SID_REFERENCE_FIXTURES} from './fixtures/sid-reference/fixture.mjs';
import {createSidPlayerTestFixture, createSidPlayerBankFixture, SID_PLAYER_TEST_FREQUENCIES,
  createSidPlayerPalFixture, createSidPlayerBankEnvironmentFixture, createSidPlayerJamFixture,
  SID_PLAYER_JAM_OPCODES, createSidPlayerIndexedStoreFixture} from './helpers/sid_player_fixtures.mjs';

const CLOCK = 985248, FRAME_CYCLES = 19656;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let SidPlayerCore, wasmBinary;
before(async () => {
  ({SidPlayerCore} = await import('../docs/sid-player/core.js'));
  wasmBinary = await readFile(new URL('../docs/generated/sid-player/sid-player.wasm', import.meta.url));
});
const create = sampleRate => SidPlayerCore.create({sampleRate, wasmBinary});
const writesOf = core => {
  const result = core.readTrace();
  return Array.isArray(result) ? result : result.writes;
};
function render(core, frames, chunk) {
  const result = new Float32Array(frames);
  for (let at = 0; at < frames; at += chunk) core.renderInto(result.subarray(at, Math.min(frames, at + chunk)));
  return result;
}
function expectedWrites(fixture, writes, calls) {
  const expected = [...fixture.expectedInitWrites];
  for (let call = 0; call < calls; ++call) expected.push(...fixture.expectedPlayWrites(call));
  assert.deepEqual(writes.map(({register, value}) => ({register, value})), expected.map(({register, value}) => ({register, value})));
  for (let i = 1; i < writes.length; ++i) assert(writes[i].cycle > writes[i - 1].cycle, 'one CPU bus write per PHI2 cycle');
  for (let i = 1; i < fixture.expectedInitWrites.length; ++i)
    assert.equal(writes[i].cycle - writes[i - 1].cycle, 6, 'authored LDA immediate / STA absolute pair is six cycles');
  const perCall = fixture.expectedPlayWrites(0).length, first = fixture.expectedInitWrites.length;
  for (let call = 1; call < calls; ++call)
    assert.equal(writes[first + call * perCall].cycle - writes[first + (call - 1) * perCall].cycle, FRAME_CYCLES,
      'direct driver uses an explicit 19656-cycle VBI period, not the full libsidplayfp IRQ driver');
}

test('four authored PSIDs execute real CPU init/play writes and chunk-invariant PCM at 44.1/48/96kHz', async () => {
  for (const sampleRate of [44100, 48000, 96000]) for (const profile of SID_REFERENCE_FIXTURES) {
    const fixture = createSidReferenceFixture(profile); let baseline;
    for (const chunk of [1, 128, 4096]) {
      const core = await create(sampleRate);
      try {
        const loaded = core.load(fixture.bytes), initial = core.getState();
        assert.equal(initial.loaded, true); assert.equal(initial.playing, true); assert.equal(initial.positionFrames, 0);
        assert.equal(initial.subtune, 1); assert(initial.initCycles > 0); assert.equal(loaded.initCycles, initial.initCycles);
        const pcm = render(core, sampleRate, chunk), state = core.getState(), writes = writesOf(core);
        assert(pcm.every(Number.isFinite), `${profile}/${sampleRate}/${chunk}: finite PCM`);
        assert(pcm.some(value => Math.abs(value) > .0001), `${profile}/${sampleRate}/${chunk}: sounding PCM`);
        assert.equal(state.positionFrames, sampleRate); assert.equal(state.cycles, CLOCK);
        assert.equal(state.playCalls, Math.floor(CLOCK / FRAME_CYCLES));
        expectedWrites(fixture, writes, state.playCalls);
        const current = {sha: sha(new Uint8Array(pcm.buffer)), state, writes};
        if (!baseline) baseline = current;
        else { assert.equal(current.sha, baseline.sha, `${profile}/${sampleRate}: split render changed PCM`); assert.deepEqual(current.state, baseline.state); assert.deepEqual(current.writes, baseline.writes); }
      } finally { core.dispose(); }
    }
  }
});

test('subtunes pass one-based selection as init A=subtune-1 and load takes its own program copy', async () => {
  const core = await create(48000), bytes = createSidPlayerTestFixture();
  try {
    core.load(bytes, {subtune: 1}); let state = core.getState();
    assert.equal(state.registers[0] | state.registers[1] << 8, SID_PLAYER_TEST_FREQUENCIES[0]);
    const first = render(core, 4800, 128);
    core.load(bytes, {subtune: 2}); state = core.getState();
    assert.equal(state.subtune, 2); assert.equal(state.registers[0] | state.registers[1] << 8, SID_PLAYER_TEST_FREQUENCIES[1]);
    const second = render(core, 4800, 128); assert.notEqual(sha(new Uint8Array(first.buffer)), sha(new Uint8Array(second.buffer)));
    core.load(bytes, {subtune: 1}); bytes.fill(0);
    assert.deepEqual(render(core, 4800, 128), first, 'mutating caller bytes must not change an already loaded machine');
  } finally { core.dispose(); }
});

test('explicit PAL/6581 choices reach the actual PSID machine without rewriting unknown/either header flags', async () => {
  const original = createSidPlayerTestFixture(), reference = await create(48000);
  try {
    reference.load(original, {subtune: 2}); const expected = render(reference, 4096, 128);
    for (const [flags, options, rawClock, rawModel] of [
      [0, {clock: 'pal', model: '6581'}, 'unknown', 'unknown'],
      [0x3c, {clock: 'pal', model: '6581'}, 'any', 'any'],
      [4, {model: '6581'}, 'pal', 'unknown'], [16, {clock: 'pal'}, 'unknown', '6581'],
    ]) {
      const core = await create(48000), bytes = original.slice(); new DataView(bytes.buffer).setUint16(118, flags);
      try {
        assert.throws(() => core.load(bytes), error => error.code === 'PSID_CHOICE_REQUIRED');
        const parsed = validateBrowserPsid(bytes, {...options, subtune: 2});
        assert.equal(parsed.clock, rawClock); assert.equal(parsed.model, rawModel);
        assert.equal(new DataView(parsed.originalBytes.buffer).getUint16(118), flags);
        core.load(bytes, {...options, subtune: 2}); const state = core.getState();
        assert.equal(state.format, 'PSID'); assert.equal(state.subtune, 2);
        assert.equal(state.declaredClock, rawClock); assert.equal(state.declaredModel, rawModel);
        const selection = {clock: rawClock === 'pal' ? 'header' : 'explicit', model: rawModel === '6581' ? 'header' : 'explicit'};
        assert.deepEqual(state.targetSelection, selection);
        state.targetSelection.clock = 'changed snapshot'; assert.deepEqual(core.getState().targetSelection, selection);
        assert.equal(state.registers[0] | state.registers[1] << 8, SID_PLAYER_TEST_FREQUENCIES[1]);
        assert.deepEqual(render(core, 4096, 17), expected);
        assert.equal(new DataView(bytes.buffer).getUint16(118), flags);
      } finally {core.dispose();}
    }
  } finally {reference.dispose();}
});

test('PSID choice failures and known unsupported declarations preserve the old machine and queued PCM', async () => {
  const a = await create(48000), b = await create(48000), bytes = createSidPlayerTestFixture();
  try {
    a.load(bytes); b.load(bytes); render(a, 1000, 128); render(b, 1000, 128);
    for (const [flags, options, code] of [[0, {}, 'PSID_CHOICE_REQUIRED'],
      [0x18, {clock: 'pal', model: '6581'}, 'PSID_UNSUPPORTED'], [0x24, {clock: 'pal', model: '6581'}, 'PSID_UNSUPPORTED']]) {
      const candidate = bytes.slice(); new DataView(candidate.buffer).setUint16(118, flags);
      const before = a.getState(); assert.throws(() => a.load(candidate, options), error => error.code === code);
      assert.deepEqual(a.getState(), before); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
    }
  } finally {a.dispose(); b.dispose();}
});

test('CPU-recorded absolute writes reproduce its PCM through the unchanged standalone SID core', async () => {
  const player = await create(48000), sid = await SidCore.create({sampleRate: 48000,
    wasmBinary: await readFile(new URL('../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url))});
  try {
    player.load(createSidReferenceFixture('melody-filter').bytes);
    const expected = render(player, 12000, 128), writes = writesOf(player), actual = new Float32Array(expected.length);
    const one = new Float32Array(1), cycles = player.getState().cycles; let event = 0, output = 0;
    for (let cycle = 0; cycle < cycles; ++cycle) {
      if (event < writes.length && writes[event].cycle === cycle) {
        const {register, value} = writes[event++]; sid.writeRegister(register, value);
      } else sid.readRegister(31);
      const ready = Math.floor((cycle + 1) * 48000 / CLOCK);
      if (ready > output) {sid.renderInto(one); actual[output++] = one[0];}
    }
    assert.equal(event, writes.length); assert.equal(output, expected.length); assert.equal(sid.getState().cycles, cycles);
    assert.deepEqual(actual, expected, 'CPU/SID bus cycles, init queue and software DC stage must share the existing core timing');
  } finally {player.dispose(); sid.dispose();}
});

test('CPU OSC3 and ENV3 reads drive later SID writes with the expected bus-cycle value', async () => {
  const player = await create(48000), sid = await SidCore.create({sampleRate: 48000,
    wasmBinary: await readFile(new URL('../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url))});
  try {
    player.load(createSidPlayerTestFixture('sid-reads')); const initWrites = writesOf(player).length;
    const expected = render(player, 4800, 128), writes = writesOf(player), actual = new Float32Array(expected.length), one = new Float32Array(1);
    const reads = new Map(writes.slice(initWrites).map(write => [write.cycle - 4, {write, register: write.register === 0 ? 27 : 28}]));
    assert(reads.size > 4); let event = 0, output = 0; const oscValues = new Set(), envValues = new Set(), cycles = player.getState().cycles;
    for (let cycle = 0; cycle < cycles; ++cycle) {
      const read = reads.get(cycle);
      if (read) {
        const value = sid.readRegister(read.register); assert.equal(read.write.value, value, 'LDA absolute reads SID four cycles before STA absolute commits');
        (read.register === 27 ? oscValues : envValues).add(value);
      } else if (event < writes.length && writes[event].cycle === cycle) {
        const {register, value} = writes[event++]; sid.writeRegister(register, value);
      } else sid.readRegister(31);
      const ready = Math.floor((cycle + 1) * 48000 / CLOCK);
      if (ready > output) {sid.renderInto(one); actual[output++] = one[0];}
    }
    assert.equal(event, writes.length); assert(oscValues.size > 1); assert(envValues.has(255)); assert.deepEqual(actual, expected);
  } finally {player.dispose(); sid.dispose();}
});

test('A000 and BFFF init/play entries select RAM while ordinary mapped ROM reads stay unsupported', async () => {
  for (const high of [0xa000, 0xbfff]) for (const entry of ['init', 'play']) {
    const core = await create(48000);
    try {
      core.load(createSidPlayerBankFixture({initAddress: entry === 'init' ? high : 0x1000, playAddress: entry === 'play' ? high : 0x1100}));
      const pcm = render(core, 4800, 128), state = core.getState();
      assert.equal(state.playing, true); assert(state.playCalls >= 4); assert.equal(state.registers[4], 0x21);
      assert(pcm.some(value => Math.abs(value) > .001));
      const before = core.getState(); assert.throws(() => core.load(createSidPlayerTestFixture('rom-read')), /ROM/);
      assert.deepEqual(core.getState(), before);
    } finally {core.dispose();}
  }
});

test('invalid metadata, subtune and failing CPU preflight preserve the old core and its next PCM', async () => {
  const a = await create(48000), b = await create(48000), bytes = createSidPlayerTestFixture();
  try {
    a.load(bytes); b.load(bytes); render(a, 1000, 128); render(b, 1000, 128);
    for (const [candidate, options] of [[new Uint8Array(10), {}], [bytes, {subtune: 0}], [bytes, {subtune: 3}],
      ...['init-loop', 'rom-read', 'io-write'].map(kind => [createSidPlayerTestFixture(kind), {}])]) {
      const before = a.getState(); assert.throws(() => a.load(candidate, options));
      assert.deepEqual(a.getState(), before, 'candidate failure must not replace the playing machine');
      assert.deepEqual(render(a, 257, 17), render(b, 257, 17), 'candidate failure changed the next audio samples');
    }
  } finally { a.dispose(); b.dispose(); }
});

test('long init keeps more than 4096 preflight samples and skips elapsed VBI boundaries without catch-up', async () => {
  const a = await create(96000), b = await create(96000), bytes = createSidPlayerTestFixture('long-init');
  try {
    a.load(bytes); b.load(bytes); const initial = a.getState();
    assert(initial.initCycles > 60000 && initial.initCycles < 100000);
    assert(Math.floor(initial.initCycles * 96000 / CLOCK) > 4096);
    assert.equal(initial.playCalls, 0);
    assert.equal(initial.skippedVbis, Math.floor(initial.initCycles / FRAME_CYCLES));
    const first = render(a, 4096, 1), second = render(b, 4096, 4096);
    assert.deepEqual(first, second); assert(first.some(value => Math.abs(value) > .001));
    assert.equal(a.getState().cycles, initial.initCycles, 'queued init samples must be returned without extra CPU cycles');
    const firstPlay = (Math.floor(initial.initCycles / FRAME_CYCLES) + 1) * FRAME_CYCLES;
    const beforeFrames = Math.floor((firstPlay - 1) * 96000 / CLOCK);
    render(a, beforeFrames - 4096, 128); assert.equal(a.getState().playCalls, 0);
    render(a, 8, 1); assert.equal(a.getState().playCalls, 1, 'only the next VBI is called; skipped init VBIs are not replayed');
  } finally { a.dispose(); b.dispose(); }
});

test('Stop flushes queued init/audio and reload deterministically restarts; state/trace snapshots are detached', async () => {
  const core = await create(48000), bytes = createSidPlayerTestFixture();
  try {
    core.load(bytes); const first = render(core, 2048, 128), state = core.getState(), writes = writesOf(core);
    state.registers.fill(0); state.voices[0].phase = -1; writes[0].value = -1;
    assert.notEqual(core.getState().voices[0].phase, -1); assert.notEqual(writesOf(core)[0].value, -1);
    core.stop(); assert.equal(core.getState().playing, false);
    const stopped = new Float32Array(4096).fill(1); core.renderInto(stopped); assert(stopped.every(value => value === 0));
    core.load(bytes); assert.equal(core.getState().positionFrames, 0); assert.deepEqual(render(core, 2048, 17), first);
  } finally { core.dispose(); }
});

test('diagnostic trace stays bounded, reports dropped writes and clears without changing the next PCM', async () => {
  const a = await create(48000), b = await create(48000), bytes = createSidPlayerTestFixture('dense-trace');
  try {
    a.load(bytes); b.load(bytes); const before = a.getState(), trace = a.readTrace({clear: true});
    assert.equal(trace.writes.length, 4096); assert(trace.dropped > 900);
    assert.deepEqual(a.readTrace(), {writes: [], dropped: 0}); assert.deepEqual(a.getState(), before);
    assert.deepEqual(render(a, 1024, 17), render(b, 1024, 128));
  } finally {a.dispose(); b.dispose();}
});

test('a bounded play-loop failure zeros the requested output and leaves the machine stopped', async () => {
  const core = await create(48000);
  try {
    core.load(createSidPlayerTestFixture('play-loop'));
    const output = new Float32Array(8192).fill(1);
    assert.throws(() => core.renderInto(output));
    assert(output.every(value => value === 0)); assert.equal(core.getState().playing, false);
    core.load(createSidPlayerTestFixture()); assert(render(core, 4096, 128).some(value => Math.abs(value) > .001));
  } finally { core.dispose(); }
});

test('the real PAL environment byte selects the PAL branch and its audible frequency', async () => {
  const fixture = createSidPlayerPalFixture(), core = await create(48000);
  try {
    core.load(fixture.bytes); const state = core.getState(), pcm = render(core, 4800, 128);
    assert.equal(state.registers[0] | state.registers[1] << 8, fixture.palFrequency);
    assert.notEqual(fixture.palFrequency, fixture.nonPalFrequency); assert(pcm.some(value => Math.abs(value) > .001));
  } finally {core.dispose();}
});

test('each init and play call establishes the specified bank even after the previous call changed $01', async () => {
  for (const [initAddress, playAddress] of [[0x1000, 0x1100], [0xa000, 0x1100], [0xc000, 0x1100], [0x1000, 0xa000], [0x1000, 0xc000], [0xa000, 0xc000]]) {
    for (const returnBank of [0x35, 0x36]) {
      const fixture = createSidPlayerBankEnvironmentFixture({initAddress, playAddress, returnBank}), core = await create(48000);
      try {
        core.load(fixture.bytes); assert.equal(core.getState().registers[2], fixture.initBank);
        const pcm = render(core, 12000, 128), state = core.getState();
        assert(state.playCalls > 10); assert.equal(state.registers[3], fixture.playBank);
        assert(writesOf(core).filter(write => write.register === 3).every(write => write.value === fixture.playBank));
        assert(pcm.some(value => Math.abs(value) > .001));
      } finally {core.dispose();}
    }
  }
});

test('init and play timeouts retain code5 but name their own bounded subroutine phase', async () => {
  const a = await create(48000), b = await create(48000), play = await create(48000);
  try {
    a.load(createSidPlayerTestFixture()); b.load(createSidPlayerTestFixture()); render(a, 2048, 128); render(b, 2048, 128);
    const state = a.getState();
    assert.throws(() => a.load(createSidPlayerTestFixture('init-loop')), error => error.code === 5 && /\binit(?:ialization)?\b/i.test(error.message) && /100000/.test(error.message) && !/\bplay\b/i.test(error.message));
    assert.deepEqual(a.getState(), state); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
    play.load(createSidPlayerTestFixture('play-loop')); const output = new Float32Array(8192).fill(1);
    assert.throws(() => play.renderInto(output), error => error.code === 5 && /\bplay\b/i.test(error.message) && /16000/.test(error.message) && !/\binit(?:ialization)?\b/i.test(error.message));
    assert(output.every(value => value === 0)); assert.equal(play.getState().playing, false);
  } finally {a.dispose(); b.dispose(); play.dispose();}
});

test('all12 CPU JAM/KIL opcodes fail at their own address and never masquerade as ROM or a timeout', async () => {
  const a = await create(48000), b = await create(48000);
  try {
    a.load(createSidPlayerTestFixture()); b.load(createSidPlayerTestFixture()); render(a, 2048, 128); render(b, 2048, 128);
    for (const opcode of SID_PLAYER_JAM_OPCODES) for (const bank of [0x35, 0x37]) {
      const fixture = createSidPlayerJamFixture({opcode, bank}), state = a.getState(), trace = a.readTrace();
      assert.throws(() => a.load(fixture.bytes), error => error.code === 10 && error.address === fixture.address && /JAM|KIL/.test(error.message));
      assert.deepEqual(a.getState(), state); assert.deepEqual(a.readTrace(), trace); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
      const play = await create(48000), playFixture = createSidPlayerJamFixture({opcode, bank, phase: 'play'});
      try {
        play.load(playFixture.bytes); const output = new Float32Array(8192).fill(1);
        assert.throws(() => play.renderInto(output), error => error.code === 10 && error.address === playFixture.address && /JAM|KIL/.test(error.message));
        assert(output.every(value => value === 0)); assert.equal(play.getState().playing, false);
      } finally {play.dispose();}
    }
  } finally {a.dispose(); b.dispose();}
});

test('indexed SID stores retain every bus clock and real OSC3/ENV3 read through all3 ordinary addressing modes', async () => {
  for (const mode of ['absolute-x', 'absolute-y', 'indirect-y']) {
    const fixture = createSidPlayerIndexedStoreFixture({mode}), core = await create(48000);
    const sid = await SidCore.create({sampleRate: 48000, wasmBinary: await readFile(new URL('../tetorica_src/runtime/generated/sid/sid.wasm', import.meta.url))});
    try {
      core.load(fixture.bytes); const initCount = writesOf(core).length, expected = render(core, 12000, 128), events = writesOf(core), state = core.getState();
      assert.equal(events.length, initCount + state.playCalls * 27); assert(state.playCalls > 10);
      const readCycles = new Map();
      for (let at = initCount; at < events.length; at += 27) {
        for (let offset = 0; offset < 25; offset++) {
          assert.equal(events[at + offset].register, 24 - offset); assert.equal(events[at + offset].value, fixture.registers[24 - offset]);
        }
        readCycles.set(events[at + 25].cycle - 4, {register: 27, expected: events[at + 25].value});
        readCycles.set(events[at + 26].cycle - 4, {register: 28, expected: events[at + 26].value});
      }
      const actual = new Float32Array(expected.length), one = new Float32Array(1); let event = 0, output = 0;
      for (let cycle = 0; cycle < state.cycles; cycle++) {
        const read = readCycles.get(cycle);
        if (read) assert.equal(sid.readRegister(read.register), read.expected, 'a real SID read keeps its CPU-visible value');
        else if (event < events.length && events[event].cycle === cycle) {const write = events[event++]; sid.writeRegister(write.register, write.value);}
        else sid.readRegister(31);
        if (Math.floor((cycle + 1) * 48000 / CLOCK) > output) {sid.renderInto(one); actual[output++] = one[0];}
      }
      assert.equal(event, events.length); assert.equal(output, expected.length); assert.deepEqual(actual, expected, mode + ': a dummy bus cycle was skipped or a SID read changed');
    } finally {core.dispose(); sid.dispose();}
  }
});

test('the dummy-read exception never hides a real VIC read or mirrored collision clear-on-read register', async () => {
  const core = await create(48000);
  try {
    assert.throws(() => core.load(createSidPlayerIndexedStoreFixture({realIoRead: true}).bytes), error => error.code === 3 && error.address === 0xd318);
    assert.throws(() => core.load(createSidPlayerTestFixture('rom-read')), error => error.code === 4 && error.address === 0xe000);
    for (const mode of ['absolute-x', 'absolute-y', 'indirect-y']) for (const index of [0x1f, 0x20, 0x5f]) {
      const fixture = createSidPlayerIndexedStoreFixture({mode, singleIndex: index}); core.load(fixture.bytes);
      const output = new Float32Array(8192).fill(1);
      assert.throws(() => core.renderInto(output), error => error.code === 3 && error.address === fixture.dummyAddress);
      assert(output.every(value => value === 0)); assert.equal(core.getState().playing, false);
    }
  } finally {core.dispose();}
});

test('environment and diagnostic fixes preserve the four unaffected VBI fixture PCMs and traces at three rates', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/sid-player/vbi_baseline_005.json', import.meta.url)));
  assert.equal(baseline.wasmSha256, 'a47d619195117e2b4b0a43de06cd99eaa3da05e25364c9b070aa92b48a920491');
  for (const item of baseline.cases) {
    const fixture = createSidReferenceFixture(item.profile), core = await create(item.sampleRate);
    try {
      assert.equal(sha(fixture.bytes), item.fixtureSha256); core.load(fixture.bytes);
      const pcm = render(core, item.frames, 128), state = core.getState();
      assert.equal(sha(new Uint8Array(pcm.buffer)), item.pcmSha256); assert.equal(sha(JSON.stringify(core.readTrace())), item.traceSha256);
      const exact = {}; for (const key of Object.keys(item.state)) exact[key] = state[key]; assert.deepEqual(exact, item.state);
    } finally {core.dispose();}
  }
});
