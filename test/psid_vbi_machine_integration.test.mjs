// Self-authored VBI programs through the actual C64 machine, without ROM dumps.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateBrowserPsid} from '../docs/js/sid_psid.js';
import {createPsidVbiMachineFixture} from './helpers/psid_vbi_machine_fixtures.mjs';
import {createPsidCiaFixture} from './helpers/psid_cia_fixtures.mjs';
import {loadSidWaveoffC64Baseline} from './helpers/sid_waveoff_c64_baselines.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
let RsidPlayerCore, SidPlayerCore, wasmBinary, directBinary;
before(async () => {
  ({RsidPlayerCore} = await import('../docs/sid-player/rsid_core.js'));
  ({SidPlayerCore} = await import('../docs/sid-player/core.js'));
  wasmBinary = await readFile(new URL('../docs/generated/sid-rsid/sid-rsid.wasm', import.meta.url));
  directBinary = await readFile(new URL('../docs/generated/sid-player/sid-player.wasm', import.meta.url));
});
const create = sampleRate => RsidPlayerCore.create({sampleRate, wasmBinary});
const direct = sampleRate => SidPlayerCore.create({sampleRate, wasmBinary: directBinary});
function render(core, frames, chunk = 128) {
  const pcm = new Float32Array(frames);
  for (let at = 0; at < frames; at += chunk) core.renderInto(pcm.subarray(at, Math.min(frames, at + chunk)));
  return pcm;
}
const pulseWrites = core => core.readTrace().writes.filter(write => write.register === 2).slice(1);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const intervals = writes => writes.slice(1).map((write, index) => write.cycle - writes[index].cycle);

test('direct metadata/API defaults remain explicit while the C64 wrapper selects real machine VBI', async () => {
  const fixture = createPsidVbiMachineFixture({delayBlocks: 0}), machine = await create(48000), legacy = await direct(48000);
  try {
    assert.equal(validateBrowserPsid(fixture.bytes).playbackBackend, 'direct');
    assert.equal(validateBrowserPsid(fixture.bytes, {vbiBackend: 'c64'}).playbackBackend, 'c64');
    assert.equal(machine.load(fixture.bytes).backend, 'c64'); assert.equal(machine.getState().timing, 'vbi');
    // This diagnostic intentionally reads CIA registers, so the direct runner
    // still rejects it rather than pretending to provide machine I/O.
    assert.throws(() => legacy.load(fixture.bytes), error => error.code === 3);
    assert.throws(() => legacy.load(fixture.bytes, {vbiBackend: 'c64'}), /C64|direct|backend/i);
    assert.throws(() => machine.load(fixture.bytes, {vbiBackend: 'direct'}), /direct/i);
  } finally {machine.dispose(); legacy.dispose();}
});

test('an init longer than100k retains initial PCM and cannot run play before its real RTS', async () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const fixture = createPsidVbiMachineFixture(), core = await create(sampleRate);
    try {
      core.load(fixture.bytes); const initial = core.getState();
      assert.equal(initial.backend, 'c64'); assert.equal(initial.initPending, true); assert.equal(initial.initReturned, false);
      assert.equal(initial.initCycleLimit, 2000000); assert.equal(initial.playCalls, 0); assert.equal(core.readRam(fixture.counterAddress), 0);
      const first = render(core, 4096, 1); assert(first.some(value => Math.abs(value) > .001));
      assert.equal(core.getState().cycles, initial.cycles, 'retained preflight samples must be drained without extra CPU ticks');
      assert.equal(core.getState().initPending, true); assert.equal(core.getState().playCalls, 0);
      render(core, sampleRate / 2, 128); const state = core.getState();
      assert.equal(state.initPending, false); assert.equal(state.initReturned, true); assert(state.initCycles > 100000 && state.initCycles < 200000);
      assert.equal(core.readRam(fixture.initMarkerAddress), 0xa5); assert.equal(core.readRam(fixture.initCounterAddress), 0);
      assert(state.playCalls > 10); assert(pulseWrites(core).every(write => write.cycle >= state.initReturnCycle));
      assert.equal(core.readRam(fixture.initIcrAddress) & 0x80, 0, 'CIA timer IRQ is masked during VBI initialization');
    } finally {core.dispose();}
  }
});

test('machine VBI pending-init, real I/O, audio and CPU state are invariant to render chunks at three rates', async () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const fixture = createPsidVbiMachineFixture({timerPeriod: 997}); let baseline;
    for (const chunk of [1, 128, 4096]) {
      const core = await create(sampleRate);
      try {
        core.load(fixture.bytes); const pcm = render(core, sampleRate, chunk), state = core.getState();
        assert(pcm.every(Number.isFinite)); assert(pcm.some(value => Math.abs(value) > .001));
        assert.equal(state.positionFrames, sampleRate); assert.equal(state.initReturned, true); assert.equal(state.initPending, false);
        assert(state.playCalls > 30 && state.playCalls < 55); assert.equal(state.nmiCount, 0);
        assert.equal(core.readRam(fixture.playIcrAddress) & 0x80, 0);
        const current = {pcm: sha(new Uint8Array(pcm.buffer)), state, trace: core.readTrace(), counter: core.readRam(fixture.counterAddress)};
        if (!baseline) baseline = current; else assert.deepEqual(current, baseline, `${sampleRate}: rendering changed machine time or initial PCM`);
      } finally {core.dispose();}
    }
  }
});

test('actual VIC frames call VBI about50Hz while the same program uses CIA about60Hz', async () => {
  const fixture = createPsidVbiMachineFixture({delayBlocks: 0}), ciaBytes = fixture.bytes.slice(); new DataView(ciaBytes.buffer).setUint32(18, 1);
  for (const [bytes, timing, minCalls, maxCalls, period] of [[fixture.bytes, 'vbi', 98, 102, 19656], [ciaBytes, 'cia', 118, 122, 0x4026]]) {
    const core = await create(48000);
    try {
      core.load(bytes); render(core, 96000); const state = core.getState(), events = pulseWrites(core);
      assert.equal(state.timing, timing); assert(state.playCalls >= minCalls && state.playCalls <= maxCalls);
      assert(Math.abs(median(intervals(events)) - period) <= 6); assert(Math.abs(state.irqCount - state.playCalls) <= 2);
      const initialTimer = core.readRam(fixture.initialTimerAddress) | core.readRam(fixture.initialTimerAddress + 1) << 8;
      assert(initialTimer > 0 && initialTimer <= 0x4025, 'real CIA timer was already counting down at init');
      if (timing === 'vbi') {
        assert.equal(core.readRam(fixture.playIcrAddress) & 0x80, 0); assert.equal(core.readRam(fixture.playVicAddress) & 0x81, 0x81);
      } else assert.equal(core.readRam(fixture.playIcrAddress) & 0x81, 0x81);
    } finally {core.dispose();}
  }
  const fastTimer = await create(48000);
  try {
    const f = createPsidVbiMachineFixture({delayBlocks: 0, timerPeriod: 997}); fastTimer.load(f.bytes); render(fastTimer, 96000);
    assert(fastTimer.getState().playCalls >= 98 && fastTimer.getState().playCalls <= 102, 'a running unmasked-source timer must not replace VIC timing');
    assert.equal(fastTimer.readRam(f.playIcrAddress) & 0x81, 1);
  } finally {fastTimer.dispose();}
});

test('Stop during pending init freezes CPU and discards its retained samples; reload starts exactly again', async () => {
  const fixture = createPsidVbiMachineFixture({delayBlocks: 10}), core = await create(96000);
  try {
    core.load(fixture.bytes); const initial = render(core, 4096); assert.equal(core.getState().initPending, true);
    core.stop(); const stopped = core.getState(), counter = core.readRam(fixture.counterAddress), output = new Float32Array(8192).fill(1);
    core.renderInto(output); assert(output.every(value => value === 0)); assert.deepEqual(core.getState(), stopped);
    assert.equal(core.readRam(fixture.counterAddress), counter); assert.equal(stopped.initPending, false);
    core.load(fixture.bytes); assert.deepEqual(render(core, 4096, 17), initial);
  } finally {core.dispose();}
});

test('faults after the first100k pending-init window zero output and leave other accepted machines and PCM intact', async () => {
  const valid = createPsidVbiMachineFixture({delayBlocks: 0}), a = await create(48000), b = await create(48000);
  try {
    a.load(valid.bytes); b.load(valid.bytes); render(a, 2048); render(b, 2048);
    for (const [fault, code, address] of [['late-rom', 4, 0xe456], ['late-jam', 6, null], ['expansion-io', 3, 0xde00], ['play-loop', 12, null]]) {
      const fixture = createPsidVbiMachineFixture({fault}), candidate = await create(48000), state = a.getState(), trace = a.readTrace();
      try {
        candidate.load(fixture.bytes); assert.equal(candidate.getState().initPending, true);
        const output = new Float32Array(12000).fill(1);
        assert.throws(() => candidate.renderInto(output), error => error.code === code && (address === null || error.address === address) && (fault !== 'late-jam' || error.address === fixture.jamAddress));
        assert(output.every(value => value === 0)); assert.equal(candidate.getState().playing, false);
      } finally {candidate.dispose();}
      assert.deepEqual(a.getState(), state); assert.deepEqual(a.readTrace(), trace); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
    }
  } finally {a.dispose(); b.dispose();}
});

test('an init that never returns is pending at two seconds but reaches the separate two-million-cycle limit', async () => {
  const fixture = createPsidVbiMachineFixture({fault: 'init-loop'}), core = await create(48000);
  try {
    core.load(fixture.bytes); render(core, 96000); let state = core.getState();
    assert.equal(state.initPending, true); assert.equal(state.initReturned, false); assert.equal(state.playCalls, 0); assert(state.initCycles < 2000000);
    const output = new Float32Array(8192).fill(1);
    assert.throws(() => core.renderInto(output), error => error.code === 11 && /2000000/.test(error.message));
    assert(output.every(value => value === 0)); state = core.getState(); assert.equal(state.initCycles, 2000000); assert.equal(state.playing, false);
  } finally {core.dispose();}
});

test('machine VBI uses a bounded declared driver page at04 orCF and never silently falls back fromFF0', async () => {
  for (const page of [4, 0xcf]) {
    const fixture = createPsidVbiMachineFixture({driverRange: [page, 1], protectLegacy: page === 0xcf}), core = await create(48000);
    try {
      core.load(fixture.bytes); const pcm = render(core, 24000), state = core.getState();
      assert.equal(state.driverAddress, page * 256); assert.deepEqual(state.relocation, {startPage: page, pageLength: 1});
      assert(state.initReturned); assert(state.playCalls > 10); assert(pcm.some(value => Math.abs(value) > .001));
      for (const [address, value] of fixture.sentinels) assert.equal(core.readRam(address), value);
    } finally {core.dispose();}
  }
  const noFree = createPsidVbiMachineFixture({delayBlocks: 0, driverRange: [255, 0]}), core = await create(48000);
  try {assert.throws(() => core.load(noFree.bytes), error => error.code === 'PSID_UNSUPPORTED' && /free.*page|Direct/i.test(error.message)); assert.equal(core.getState().loaded, false);}
  finally {core.dispose();}
});

test('missing machine-VBI exports fail before allocation and preserve a previous accepted machine', async () => {
  const fixture = createPsidVbiMachineFixture({delayBlocks: 0}), a = await create(48000), b = await create(48000);
  try {
    a.load(fixture.bytes); b.load(fixture.bytes); render(a, 2048); render(b, 2048); const original = a.exports;
    for (const name of ['sidr_load_psid_vbi', 'sidr_init_pending', 'sidr_init_limit']) {
      let creates = 0; const state = a.getState(), api = {...original, sidr_create(...args) {creates++; return original.sidr_create(...args);}}; delete api[name];
      try {a.exports = api; assert.throws(() => a.load(fixture.bytes), /updated C64 WASM/);} finally {a.exports = original;}
      assert.equal(creates, 0); assert.deepEqual(a.getState(), state); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
    }
  } finally {a.dispose(); b.dispose();}
});

test('relocated CIA preserves historical CPU trace/RAM while no-wave startup follows the corrected Native/WASM PCM and phase', async () => {
  const {historical, baseline} = await loadSidWaveoffC64Baseline('relocated');
  assert.equal(historical.wasmSha256, 'ef6ae771513cea3ec2f6bd6af90c2074c96ac733c5466fdc165a0b5c3480dc4e');
  assert.equal(baseline.cases.length, historical.cases.length);
  const nonPhase = state => ({...state, voices: state.voices.map(({phase, ...voice}) => voice)});
  for (const [index, item] of baseline.cases.entries()) {
    const original = historical.cases[index];assert.deepEqual(nonPhase(item.state), nonPhase(original.state));
    assert.equal(item.traceSha256, original.traceSha256);assert.equal(item.fixtureSha256, original.fixtureSha256);assert.deepEqual(item.sentinels, original.sentinels);
    const fixture = createPsidCiaFixture(item.options), core = await create(item.sampleRate);
    try {
      assert.equal(sha(fixture.bytes), item.fixtureSha256); core.load(fixture.bytes, {subtune: 2});
      const pcm = render(core, item.frames), state = core.getState(); assert.equal(sha(new Uint8Array(pcm.buffer)), item.pcmSha256);
      assert.equal(sha(JSON.stringify(core.readTrace())), item.traceSha256); const exact = {}; for (const key of Object.keys(item.state)) exact[key] = state[key]; assert.deepEqual(exact, item.state);
      for (const [address, value] of item.sentinels) assert.equal(core.readRam(address), value);
    } finally {core.dispose();}
  }
});
