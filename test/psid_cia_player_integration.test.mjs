// Original PSID timer programs through the actual continuous C64 machine.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateBrowserPsid} from '../docs/js/sid_psid.js';
import {createPsidCiaFixture} from './helpers/psid_cia_fixtures.mjs';
import {createRsidFixture} from './helpers/rsid_fixtures.mjs';
import {createRsidTestRoms} from './helpers/rsid_test_roms.mjs';

const sha = input => createHash('sha256').update(input).digest('hex');
let RsidPlayerCore, SidPlayerCore, wasmBinary, vbiBinary;
before(async () => {
  ({RsidPlayerCore} = await import('../docs/sid-player/rsid_core.js'));
  ({SidPlayerCore} = await import('../docs/sid-player/core.js'));
  wasmBinary = await readFile(new URL('../docs/generated/sid-rsid/sid-rsid.wasm', import.meta.url));
  vbiBinary = await readFile(new URL('../docs/generated/sid-player/sid-player.wasm', import.meta.url));
});
const create = sampleRate => RsidPlayerCore.create({sampleRate, wasmBinary});
const vbi = sampleRate => SidPlayerCore.create({sampleRate, wasmBinary: vbiBinary});
function render(core, frames, chunk) {
  const pcm = new Float32Array(frames);
  for (let at = 0; at < frames; at += chunk) core.renderInto(pcm.subarray(at, Math.min(frames, at + chunk)));
  return pcm;
}
const writes = core => core.readTrace().writes.filter(write => write.register === 2).slice(1);
const deltas = writes => writes.slice(1).map((write, index) => write.cycle - writes[index].cycle);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('one mixed-speed PSID selects a VBI or CIA backend by song, including speed bit31 for every song above32', async () => {
  for (const bit31 of [false, true]) {
    const fixture = createPsidCiaFixture({bit31});
    for (const subtune of bit31 ? [1, 31, 32, 33, 34] : [1, 2]) {
      const parsed = validateBrowserPsid(fixture.bytes, {subtune});
      const expected = subtune >= fixture.ciaSubtune ? 'cia' : 'vbi';
      assert.equal(parsed.timing, expected); assert.equal(parsed.songSpeeds[subtune - 1], expected);
      const core = await (expected === 'cia' ? create(48000) : vbi(48000));
      try {
        core.load(fixture.bytes, {subtune}); const pcm = render(core, 4800, 128), state = core.getState();
        assert.equal(state.format, 'PSID'); assert.equal(state.timing, expected); assert.equal(state.subtune, subtune);
        assert.equal(state.registers[0] | state.registers[1] << 8, fixture.frequencies[(subtune - 1) & 1]);
        assert(pcm.some(value => Math.abs(value) > .001));
      } finally {core.dispose();}
    }
  }
  const wrong = await vbi(48000);
  try {assert.throws(() => wrong.load(createPsidCiaFixture().bytes, {subtune: 2}), /CIA|timing|backend/i);}
  finally {wrong.dispose();}
});

test('PSID CIA init/play, retained preflight PCM and CPU state are invariant to render chunks at three rates', async () => {
  for (const sampleRate of [44100, 48000, 96000]) for (const variable of [false, true]) {
    const fixture = createPsidCiaFixture({variable}); let baseline;
    for (const chunk of [1, 128, 4096]) {
      const core = await create(sampleRate);
      try {
        core.load(fixture.bytes, {subtune: 2}); const initial = core.getState();
        assert.equal(initial.positionFrames, 0); assert.equal(initial.format, 'PSID'); assert.equal(initial.timing, 'cia');
        const pcm = render(core, sampleRate, chunk), state = core.getState(), trace = core.readTrace();
        assert(pcm.every(Number.isFinite)); assert(pcm.some(value => Math.abs(value) > .001));
        assert.equal(state.positionFrames, sampleRate); assert(state.irqCount > 300); assert.equal(state.nmiCount, 0);
        assert.equal(trace.dropped, 0); assert(writes(core).length > 300);
        const current = {pcm: sha(new Uint8Array(pcm.buffer)), state, trace, counter: core.readRam(fixture.counterAddress)};
        if (!baseline) baseline = current; else assert.deepEqual(current, baseline, `${sampleRate}/${variable}: split rendering changed the machine`);
      } finally {core.dispose();}
    }
  }
});

test('the real CIA timer preserves its init latch, defaults to $4025 and can be reprogrammed by play', async () => {
  for (const options of [{period: null}, {period: 997}, {period: 2503}, {period: 997, variable: true}]) {
    const fixture = createPsidCiaFixture(options), core = await create(48000);
    try {
      core.load(fixture.bytes, {subtune: 2}); render(core, 48000, 128);
      const events = writes(core), intervals = deltas(events), state = core.getState();
      assert(events.length > 45); assert(Math.abs(median(intervals.slice(1, 6)) - fixture.periodCycles) <= 6,
        `init period ${fixture.periodCycles} was replaced: ${intervals.slice(0, 8)}`);
      if (options.variable) assert(Math.abs(median(intervals.slice(12, 30)) - fixture.secondPeriodCycles) <= 6);
      else assert(Math.abs(median(intervals) - fixture.periodCycles) <= 6);
      for (let i = 0; i < events.length; ++i) assert.equal(events[i].value, (i + 1) & 255);
      assert(Math.abs(state.playCalls - events.length) <= 1, 'CPU IRQ driver counts real JSR play calls');
      assert(Math.abs(state.irqCount - events.length) <= 2);
    } finally {core.dispose();}
  }
});

test('CIA play IRQs keep working when init or play leaves KERNAL banked out', async () => {
  for (const bankAfterInit of [0x35, 0x36, 0x37]) for (const bankAfterPlay of [0x35, 0x36]) {
    const fixture = createPsidCiaFixture({bankAfterInit, bankAfterPlay}), core = await create(48000);
    try {
      core.load(fixture.bytes, {subtune: 2}); render(core, 12000, 128);
      assert(writes(core).length > 150); assert.equal(core.getState().playing, true);
      assert(core.readRam(fixture.bankAddress) & 4, 'IRQ driver enters play with I/O visible');
      assert(core.readRam(fixture.counterAddress) > 100);
    } finally {core.dispose();}
  }
});

test('init can mask CIA IRQs or stop its timer without a host scheduler continuing to call play', async () => {
  for (const options of [{irqEnabled: false}, {timerRunning: false}]) {
    const fixture = createPsidCiaFixture(options), core = await create(48000);
    try {
      core.load(fixture.bytes, {subtune: 2}); const pcm = render(core, 12000, 128), state = core.getState();
      assert.equal(state.playCalls, 0); assert.equal(writes(core).length, 0); assert.equal(core.readRam(fixture.counterAddress), 0);
      assert.equal(state.irqCount, 0); assert.equal(state.playing, true); assert(pcm.some(value => Math.abs(value) > .001));
    } finally {core.dispose();}
  }
});

test('the play routine can observe and acknowledge its CIA interrupt before the driver fallback acknowledgement', async () => {
  const fixture = createPsidCiaFixture({observeIcr: true}), core = await create(48000);
  try {
    core.load(fixture.bytes, {subtune: 2}); render(core, 12000, 128); const state = core.getState();
    assert(state.playCalls > 100); assert.equal(core.readRam(fixture.icrAddress) & 0x81, 0x81,
      'the driver must not consume CIA ICR before invoking the tune play routine');
    assert(Math.abs(state.irqCount - state.playCalls) <= 1); assert(Math.abs(median(deltas(writes(core))) - fixture.periodCycles) <= 6);
  } finally {core.dispose();}
});

test('synthetic user ROMs with the original IRQ-vector convention execute CIA play without claiming real firmware compatibility', async () => {
  const roms = createRsidTestRoms();
  // Make the synthetic boot leave non-default stopped timer values. The
  // PSID bootstrap must establish its documented environment before init,
  // then preserve the tune's own changes made by that init routine.
  const boot = [0x78, 0xd8, 0xa2, 0xff, 0x9a, 0xa9, 0x37, 0x85, 1, 0xa9, 0x2f, 0x85, 0];
  for (const [address, value] of [[0xdc0f, 0], [0xdd0e, 0], [0xdd0f, 0],
    [0xdc06, 0x34], [0xdc07, 0x12], [0xdd04, 0x34], [0xdd05, 0x12], [0xdd06, 0x34], [0xdd07, 0x12]]) {
    boot.push(0xa9, value, 0x8d, address & 255, address >>> 8);
  }
  const idle = 0xe000 + boot.length; boot.push(0x4c, idle & 255, idle >>> 8); roms.kernal.set(boot);
  // These bytes and vectors are independently authored test firmware. They
  // model only the documented register-save/JMP($0314) IRQ calling convention.
  roms.kernal.set([0x48, 0x8a, 0x48, 0x98, 0x48, 0x6c, 0x14, 0x03], 0xff48 - 0xe000);
  roms.kernal[0x1ffe] = 0x48; roms.kernal[0x1fff] = 0xff;
  const core = await create(48000), fixture = createPsidCiaFixture({variable: true, observeDefaults: true});
  try {
    core.load(fixture.bytes, {subtune: 2, environment: 'rom', roms});
    const pcm = render(core, 12000, 128), state = core.getState(), intervals = deltas(writes(core));
    assert.equal(state.format, 'PSID'); assert.equal(state.timing, 'cia'); assert.equal(state.environment, 'rom');
    assert.equal(state.bootCycles, 2000000); assert(state.playCalls > 100); assert(pcm.some(value => Math.abs(value) > .001));
    assert.deepEqual(Array.from({length: 6}, (_, index) => core.readRam(fixture.timerDefaultsAddress + index)), Array(6).fill(255));
    assert(Math.abs(median(intervals.slice(12, 30)) - fixture.secondPeriodCycles) <= 6);
  } finally {core.dispose();}
});

test('failed PSID CIA candidates preserve the accepted format, CPU, trace and next PCM', async () => {
  const a = await create(48000), b = await create(48000), fixture = createPsidCiaFixture();
  try {
    a.load(fixture.bytes, {subtune: 2}); b.load(fixture.bytes, {subtune: 2}); render(a, 2048, 128); render(b, 2048, 128);
    for (const [bytes, options, expected] of [[new Uint8Array(8), {}, null], [fixture.bytes, {subtune: 3}, null],
      [createPsidCiaFixture({fault: 'init-rom'}).bytes, {subtune: 2}, {code: 4, address: 0xe456}],
      [createPsidCiaFixture({fault: 'play-rom'}).bytes, {subtune: 2}, {code: 4, address: 0xe456}],
      [createPsidCiaFixture({fault: 'init-loop'}).bytes, {subtune: 2}, {code: 11}],
      [createPsidCiaFixture({fault: 'play-loop'}).bytes, {subtune: 2}, {code: 12}]]) {
      const before = a.getState(), trace = a.readTrace();
      assert.throws(() => a.load(bytes, options), error => expected === null || error.code === expected.code && (expected.address === undefined || error.address === expected.address));
      assert.deepEqual(a.getState(), before); assert.deepEqual(a.readTrace(), trace); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
    }
  } finally {a.dispose(); b.dispose();}
});

test('PSID CIA Stop freezes CPU/timers and clears queued samples; reload starts deterministically', async () => {
  const fixture = createPsidCiaFixture({variable: true}), core = await create(96000);
  try {
    core.load(fixture.bytes, {subtune: 2}); const expected = render(core, 12000, 128);
    core.stop(); const state = core.getState(), counter = core.readRam(fixture.counterAddress);
    assert(render(core, 8192, 4096).every(value => value === 0)); assert.deepEqual(core.getState(), state);
    assert.equal(core.readRam(fixture.counterAddress), counter);
    core.load(fixture.bytes, {subtune: 2}); assert.deepEqual(render(core, 12000, 17), expected);
  } finally {core.dispose();}
});

test('adding PSID CIA playback preserves existing RSID PCM, trace, counters and voice state from the 0.0.3 native binary', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/sid-player/rsid_baseline_003.json', import.meta.url)));
  assert.equal(baseline.wasmSha256, '496f32f4bbdf2d788f42124c385da033861852b738147f59b61a338580b91a18');
  for (const item of baseline.cases) {
    const fixture = createRsidFixture(item.profile), core = await create(item.sampleRate);
    try {
      assert.equal(sha(fixture.bytes), item.fixtureSha256); core.load(fixture.bytes);
      const pcm = render(core, item.frames, 128), state = core.getState();
      assert.equal(sha(new Uint8Array(pcm.buffer)), item.pcmSha256, item.profile + ': RSID PCM changed');
      assert.equal(sha(JSON.stringify(core.readTrace())), item.traceSha256, item.profile + ': RSID bus trace changed');
      const exact = {}; for (const key of Object.keys(item.state)) exact[key] = state[key];
      assert.deepEqual(exact, item.state); assert.equal(core.readRam(fixture.counterAddress), item.counter);
    } finally {core.dispose();}
  }
});
