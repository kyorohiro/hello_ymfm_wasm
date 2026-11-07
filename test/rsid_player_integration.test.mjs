// Self-authored interrupt programs through the actual C64 machine/WASM.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRsidFixture, createRsidBasicFixture} from './helpers/rsid_fixtures.mjs';
import {createRsidTestRoms} from './helpers/rsid_test_roms.mjs';
import {validateBrowserRsid} from '../docs/js/sid_rsid.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let RsidPlayerCore, wasmBinary;
before(async () => {
  ({RsidPlayerCore} = await import('../docs/sid-player/rsid_core.js'));
  wasmBinary = await readFile(new URL('../docs/generated/sid-rsid/sid-rsid.wasm', import.meta.url));
});
const create = sampleRate => RsidPlayerCore.create({sampleRate, wasmBinary});
function render(core, frames, chunk) {
  const pcm = new Float32Array(frames);
  for (let at = 0; at < frames; at += chunk) core.renderInto(pcm.subarray(at, Math.min(frames, at + chunk)));
  return pcm;
}
const handlerWrites = core => core.readTrace().writes.filter(write => write.register === 2).slice(1);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const differences = writes => writes.slice(1).map((write, index) => write.cycle - writes[index].cycle);

test('authored RSID fixtures obey reserved fields and their distributed demo regenerates byte for byte', async () => {
  for (const profile of ['cia-irq', 'raster-irq', 'cia-nmi', 'multispeed', 'busy-loop', 'masked-irq', 'no-ack-nmi', 'one-shot-irq', 'rom-required']) {
    const fixture = createRsidFixture(profile), parsed = validateBrowserRsid(fixture.bytes);
    assert.equal(parsed.format, 'RSID'); assert.equal(parsed.headerLoadAddress, 0); assert.equal(parsed.playAddress, 0); assert.equal(parsed.speed, 0);
  }
  const file = await readFile(new URL('../docs/sid-player/demos/rsid/irq.sid', import.meta.url));
  assert.deepEqual(file, Buffer.from(createRsidFixture().bytes));
  const source = await readFile(new URL('./helpers/rsid_fixtures.mjs', import.meta.url));
  assert.deepEqual(await readFile(new URL('../docs/sid-player/demos/rsid/fixture.mjs', import.meta.url)), source);
  const receipt = JSON.parse(await readFile(new URL('../docs/sid-player/demos/rsid/provenance.json', import.meta.url)));
  assert.equal(receipt.generator.sha256, sha(source)); assert.equal(receipt.outputs[0].sha256, sha(file));
  assert.equal(receipt.containsThirdPartyMusic, false); assert.equal(receipt.containsRomDump, false);
});

test('CIA IRQ, VIC IRQ, CIA NMI and variable-rate programs produce chunk-invariant PCM at 44.1/48/96kHz', async () => {
  for (const sampleRate of [44100, 48000, 96000]) for (const profile of ['cia-irq', 'raster-irq', 'cia-nmi', 'multispeed']) {
    const fixture = createRsidFixture(profile); let baseline;
    for (const chunk of [1, 128, 4096]) {
      const core = await create(sampleRate);
      try {
        core.load(fixture.bytes); assert.equal(core.getState().positionFrames, 0);
        const pcm = render(core, sampleRate, chunk), state = core.getState(), trace = core.readTrace();
        assert.equal(state.format, 'RSID'); assert.equal(state.playing, true); assert.equal(state.positionFrames, sampleRate);
        assert(pcm.every(Number.isFinite)); assert(pcm.some(sample => Math.abs(sample) > .0001));
        assert(state.writeCount > 0); assert(Number.isInteger(state.readCount) && state.readCount >= 0); // SID-bus reads, not CIA acknowledgements.
        assert((fixture.nmi ? state.nmiCount : state.irqCount) > 1);
        assert.equal(trace.dropped, 0); assert(handlerWrites(core).length > 1);
        const current = {pcm: sha(new Uint8Array(pcm.buffer)), state, trace, counter: core.readRam(fixture.counterAddress)};
        if (!baseline) baseline = current; else assert.deepEqual(current, baseline, `${profile}/${sampleRate}: render chunk changed CPU/interrupt/audio state`);
      } finally {core.dispose();}
    }
  }
});

test('CIA timer periods drive actual IRQ handlers far faster than a host VBI callback', async () => {
  for (const period of [997, 2503]) {
    const core = await create(48000), fixture = createRsidFixture('cia-irq', {period});
    try {
      core.load(fixture.bytes); render(core, 48000, 128); const state = core.getState(), writes = handlerWrites(core);
      assert(writes.length > 300 && writes.length < 1100); assert(Math.abs(median(differences(writes)) - period) <= 6);
      assert(Math.abs(state.irqCount - writes.length) <= 2);
      for (let i = 0; i < writes.length; ++i) assert.equal(writes[i].value, (i + 1) & 255, 'CPU INC $0330 is copied into SID pulse width');
      assert([writes.length & 255, (writes.length + 1) & 255].includes(core.readRam(fixture.counterAddress)));
    } finally {core.dispose();}
  }
});

test('SEI masks CIA1 IRQ execution but CIA2 NMI runs; unacknowledged NMI is one edge and one-shot IRQ fires once', async () => {
  for (const profile of ['masked-irq', 'cia-nmi', 'no-ack-nmi', 'one-shot-irq']) {
    const core = await create(48000), fixture = createRsidFixture(profile);
    try {
      core.load(fixture.bytes); render(core, 48000, 128); const state = core.getState(), writes = handlerWrites(core);
      if (profile === 'masked-irq') {assert(state.irqCount >= 1); assert.equal(writes.length, 0); assert.equal(core.readRam(fixture.counterAddress), 0);}
      if (profile === 'cia-nmi') {assert(state.nmiCount > 300); assert(writes.length > 300); assert.equal(state.initReturned, false);}
      if (profile === 'no-ack-nmi') {assert.equal(state.nmiCount, 1); assert.equal(writes.length, 1); assert.equal(core.readRam(fixture.counterAddress), 1);}
      if (profile === 'one-shot-irq') {assert.equal(state.irqCount, 1); assert.equal(writes.length, 1); assert.equal(core.readRam(fixture.counterAddress), 1);}
    } finally {core.dispose();}
  }
});

test('VIC raster line controls interrupt phase and repeats once per PAL frame', async () => {
  const first = [];
  for (const rasterLine of [50, 100]) {
    const core = await create(48000);
    try {
      core.load(createRsidFixture('raster-irq', {rasterLine}).bytes); render(core, 48000, 128);
      const writes = handlerWrites(core); assert(writes.length >= 49 && writes.length <= 52);
      assert(Math.abs(median(differences(writes)) - 19656) <= 6); first.push(writes[0].cycle);
    } finally {core.dispose();}
  }
  const shift = ((first[1] - first[0]) % 19656 + 19656) % 19656;
  assert(Math.abs(shift - 50 * 63) <= 6, `raster 50→100 phase shift was ${shift} cycles`);
});

test('a timer reprogrammed inside its IRQ handler changes the machine cadence', async () => {
  const core = await create(48000), fixture = createRsidFixture('multispeed');
  try {
    core.load(fixture.bytes); render(core, 48000, 128); const deltas = differences(handlerWrites(core));
    assert(deltas.length > 30); assert(Math.abs(median(deltas.slice(1, 6)) - fixture.periodCycles) <= 6);
    assert(Math.abs(median(deltas.slice(12, 30)) - fixture.secondPeriodCycles) <= 6);
  } finally {core.dispose();}
});

test('init may remain in a busy loop while hardware interrupts keep playing', async () => {
  const core = await create(48000), fixture = createRsidFixture('busy-loop');
  try {
    core.load(fixture.bytes); assert.equal(core.getState().initReturned, false);
    const initial = core.readRam(fixture.counterAddress), before = core.getState();
    const pcm = render(core, 12000, 128), after = core.getState();
    assert(after.cycles > before.cycles); assert(after.irqCount > before.irqCount); assert.equal(after.initReturned, false);
    assert.notEqual(core.readRam(fixture.counterAddress), initial); assert(pcm.some(sample => Math.abs(sample) > .001));
  } finally {core.dispose();}
});

test('invalid or unsupported candidates keep the old machine, queued PCM and ROM ownership intact', async () => {
  const a = await create(48000), b = await create(48000), fixture = createRsidFixture();
  try {
    a.load(fixture.bytes); b.load(fixture.bytes); render(a, 1200, 128); render(b, 1200, 128);
    for (const [bytes, options] of [[new Uint8Array(20), {}], [fixture.bytes, {subtune: 0}], [createRsidBasicFixture().bytes, {}],
      [createRsidFixture('rom-required').bytes, {}], [fixture.bytes, {environment: 'rom', roms: {}}]]) {
      const before = a.getState(), trace = a.readTrace(); assert.throws(() => a.load(bytes, options));
      assert.deepEqual(a.getState(), before); assert.deepEqual(a.readTrace(), trace); assert.deepEqual(render(a, 257, 17), render(b, 257, 17));
    }
  } finally {a.dispose(); b.dispose();}
});

test('unimplemented mapped ROM data/code and CPU JAM fail at the exact address without replacing the old machine', async () => {
  const core = await create(48000), fixture = createRsidFixture(), prefix = createRsidFixture('rom-required').bytes.subarray(0, 126);
  const program = code => {const bytes = new Uint8Array(126 + code.length); bytes.set(prefix); bytes.set(code, 126); return bytes;};
  try {
    core.load(fixture.bytes); render(core, 2048, 128);
    for (const [code, address] of [
      [[0x78, 0xad, 0x23, 0xa1, 0x60], 0xa123], [[0x78, 0xad, 0x56, 0xe4, 0x60], 0xe456],
      [[0x78, 0x4c, 0x56, 0xe4, 0x60], 0xe456], [[0x78, 0xa9, 0x33, 0x85, 1, 0xad, 0, 0xd0, 0x60], 0xd000],
    ]) {
      const before = core.getState();
      assert.throws(() => core.load(program(code)), error => error.code === 4 && error.address === address);
      assert.deepEqual(core.getState(), before);
    }
    const roms = createRsidTestRoms(); roms.kernal[0] = 0x02;
    const before = core.getState();
    assert.throws(() => core.load(fixture.bytes, {environment: 'rom', roms}), error => error.code === 6 && error.address === 0xe000);
    assert.deepEqual(core.getState(), before);
  } finally {core.dispose();}
});

test('Stop freezes CPU/interrupts and clears PCM; reload deterministically restarts the same program', async () => {
  const core = await create(48000), fixture = createRsidFixture();
  try {
    core.load(fixture.bytes); const expected = render(core, 4096, 128); core.stop(); const stopped = core.getState(), counter = core.readRam(fixture.counterAddress);
    const output = new Float32Array(4096).fill(1); core.renderInto(output);
    assert(output.every(sample => sample === 0)); assert.equal(core.getState().cycles, stopped.cycles);
    assert.equal(core.getState().irqCount, stopped.irqCount); assert.equal(core.readRam(fixture.counterAddress), counter);
    core.load(fixture.bytes); assert.deepEqual(render(core, 4096, 17), expected);
  } finally {core.dispose();}
});

test('caller-supplied synthetic ROMs execute the original BASIC SYS payload and pass one-based songs via $030C', async () => {
  const core = await create(48000), fixture = createRsidBasicFixture(), roms = createRsidTestRoms();
  try {
    for (const subtune of [1, 2]) {
      core.load(fixture.bytes, {subtune, environment: 'rom', roms: {chars: roms.chars, basic: roms.basic, kernal: roms.kernal}});
      const pcm = render(core, 4800, 128), state = core.getState();
      assert.equal(state.environment, 'rom'); assert(state.bootCycles > 0);
      assert.equal(core.readRam(0x030c), subtune - 1); assert.equal(core.readRam(fixture.markerAddress), 0xa5);
      assert.equal(core.readRam(0x00c6), 4); assert.deepEqual([0x277, 0x278, 0x279, 0x27a].map(address => core.readRam(address)), [82, 85, 78, 13]);
      assert.equal(state.registers[0] | state.registers[1] << 8, fixture.frequencies[subtune - 1]);
      assert(pcm.some(sample => Math.abs(sample) > .001));
    }
  } finally {core.dispose();}
});
