import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/spc_wasm.js';
import {SpcCore, SnesDspCore, prepareSpcTimeline} from './spc.js';
import {createSyntheticSpc} from './spc_test_fixture.mjs';

const wasmBinary = await readFile(new URL('../docs/generated/spc_wasm.wasm', import.meta.url));
const module = await factory({wasmBinary});
const options = {moduleFactory:async () => module};
const frames = 3200;
function dynamicSpc(parameters = {}) {
  const bytes = createSyntheticSpc(parameters), ram = bytes.subarray(0x100, 0x10100);
  // Exercise the optimized MOV dp writes, general absolute writes, DSP writes,
  // PUSH/POP and CALL/RET stack writes. The song then mutates BRR while playing.
  ram.set([0xe8, 0x73, 0xc5, 0x01, 0x20, // MOV A,#$73 / MOV $2001,A
    0x8f, 0x02, 0xf2, 0x8f, 0x7d, 0xf3, // PITCH low
    0x8f, 0x03, 0xf2, 0x8f, 0x0b, 0xf3, // PITCH high
    0x2d, 0xae, 0x3f, 0x00, 0x04, // PUSH A / POP A / CALL $0400
    0x8f, 0x80, 0xf1, 0x8f, 0x00, 0xf1, // IPL overlay on/off
    0xac, 0x01, 0x20, 0x2f, 0xfb], 0x200); // INC $2001 / BRA
  ram[0x400] = 0x6f; // RET
  return bytes;
}
function render(core, count, segments = [1024]) {
  const left = new Float32Array(count), right = new Float32Array(count);
  let offset = 0, step = 0;
  while (offset < count) {const size = Math.min(segments[step++ % segments.length], count - offset); core.renderInto(left, right, size, offset); offset += size;}
  return [left, right];
}
async function capture(t, bytes, count = frames, segments) {
  const core = await SpcCore.create(options); t.after(() => core.dispose()); core.load(bytes); core.beginTrace();
  const pcm = render(core, count, segments), trace = core.endTrace();
  return {core, trace, pcm};
}
async function replay(t, trace, segments) {
  const core = await SnesDspCore.create(options); t.after(() => core.dispose()); core.loadTimeline(trace);
  return {core, pcm:render(core, trace.durationClocks / 32, segments)};
}
async function filteredCapture(t, bytes, count = frames, {maxEvents = 1000000} = {}) {
  const core = await SpcCore.create(options); t.after(() => core.dispose()); core.load(bytes);
  core.beginRamReadTracking(); const discoveredPcm = render(core, count, [128]), mask = core.endRamReadTracking();
  core.restart(); core.beginTrace({maxEvents, ramReadMask:mask});
  const pcm = render(core, count, [128]), trace = core.endTrace();
  assert.deepEqual(pcm, discoveredPcm, 'RAM discovery and filtering do not affect original emulation');
  return {core, mask, pcm, trace};
}
function records(trace) {
  return Array.from({length:trace.events.length / 4}, (_, index) => Array.from(trace.events.subarray(index * 4, index * 4 + 4)));
}

for (const [name, parameters] of [['dry', {}], ['echo', {echo:true}], ['noise', {noise:true}], ['pitch modulation', {voices:3,pmon:true}], ['echo+noise+PMON', {voices:3,echo:true,noise:true,pmon:true}]]) {
  test(`SPC trace/replay is bit-exact with static material, ${name}`, async t => {
    const bytes = createSyntheticSpc(parameters), baseline = await SpcCore.create(options); t.after(() => baseline.dispose()); baseline.load(bytes);
    const expected = render(baseline, frames), result = await capture(t, bytes);
    assert.deepEqual(result.pcm, expected, 'capturing never changes the original PCM');
    const output = await replay(t, result.trace, [1, 7, 31, 128, 1024]);
    assert.deepEqual(output.pcm, expected, 'DSP-only output preserves the original initial FIFO, DSP phase and state');
    assert.deepEqual(output.core.getTimelineState(), {loaded:true,positionFrames:frames,totalFrames:frames,ended:true});
  });
  test(`SPC trace/replay is bit-exact with live RAM and DSP changes, ${name}`, async t => {
    const bytes = dynamicSpc(parameters), baseline = await SpcCore.create(options); t.after(() => baseline.dispose()); baseline.load(bytes);
    const expected = render(baseline, frames), result = await capture(t, bytes);
    assert.deepEqual(result.pcm, expected);
    assert.ok(Array.from({length:result.trace.events.length / 4}, (_, i) => result.trace.events[i * 4 + 1]).includes(0));
    assert.ok(Array.from({length:result.trace.events.length / 4}, (_, i) => result.trace.events[i * 4 + 2]).includes(0x2001));
    assert.ok(result.trace.events.some((value, index) => index % 4 === 0 && value % 32 !== 0), 'writes retain sub-sample clock positions');
    const output = await replay(t, result.trace, [3, 8, 64, 1024]);
    assert.deepEqual(output.pcm, expected);
    output.core.restartTimeline();
    assert.deepEqual(render(output.core, frames, [41, 127]), expected, 'restart retains exact playback independent of render partition');
  });
}

test('trace coalesces only unobserved RAM updates and captures stack writes and ROM overlays', async t => {
  const {trace} = await capture(t, dynamicSpc(), 2048);
  const events = [];
  for (let i = 0; i < trace.events.length; i += 4) events.push(Array.from(trace.events.subarray(i, i + 4)));
  assert.ok(events.some(([, kind, address]) => kind === 1 && address >= 0x1ec && address <= 0x1ef), 'stack memory writes retained');
  assert.ok(events.some(([, kind, address]) => kind === 1 && address >= 0xffc0), 'IPL overlay changes retained');
  const plain = await capture(t, createSyntheticSpc(), 2048);
  assert.ok(plain.trace.events.length < 2048, 'busy CPU counter loop coalesces RAM values between DSP advances');
});

test('capture preserves the source core even when upstream active-BRR writes depend on its render partition', async t => {
  const bytes = createSyntheticSpc(), ram = bytes.subarray(0x100, 0x10100);
  // Delayed BRR mutation exposes upstream's deferred DSP catch-up. Recording
  // must not change the source renderer to make other render partitions match.
  ram.set([0xcd,160,0x8d,255,0xfe,0xfe,0x1d,0xd0,0xf9,
    0xe8,0x72,0xc5,1,0x20,0x8f,3,0xf2,0x8f,8,0xf3,0x2f,0xfe], 0x200);
  const canonical = await SpcCore.create(options), other = await SpcCore.create(options);
  t.after(() => {canonical.dispose(); other.dispose();}); canonical.load(bytes); other.load(bytes);
  const count = 12000, expected = render(canonical, count, [128]), differing = render(other, count, [509]);
  assert.notDeepEqual(expected, differing, 'the original core itself has deferred RAM/DSP synchronization');
  const captured = await capture(t, bytes, count, [128]); assert.deepEqual(captured.pcm, expected);
  const replayed = await replay(t, captured.trace, [127]); assert.deepEqual(replayed.pcm, expected);
});

test('independent cores and returned trace arrays have no shared mutable ownership', async t => {
  const a = await capture(t, dynamicSpc({echo:true})), b = await capture(t, dynamicSpc({noise:true}));
  const first = await replay(t, a.trace), second = await replay(t, b.trace);
  assert.notDeepEqual(first.pcm, second.pcm);
  a.trace.events.fill(0); a.trace.initialState.ram.fill(0); a.trace.initialState.dsp.fill(0);
  first.core.restartTimeline(); assert.deepEqual(render(first.core, frames), a.pcm, 'native timeline owns its data');
  second.core.restartTimeline(); assert.deepEqual(render(second.core, frames), b.pcm, 'other core remains isolated');
});

test('capture limits reject a partial trace and permit a fresh retry', async t => {
  const core = await SpcCore.create(options); t.after(() => core.dispose());
  core.load(dynamicSpc()); core.beginTrace({maxEvents:2});
  assert.throws(() => render(core, 128), /trace limit exceeded/);
  assert.throws(() => core.endTrace(), /trace limit exceeded/);
  core.restart(); core.beginTrace(); render(core, 128); const trace = core.endTrace(); assert.ok(trace.events.length > 8);
  assert.throws(() => core.beginTrace(), /freshly loaded/);
  assert.throws(() => core.endTrace(), /No SPC trace/);
  assert.throws(() => core.beginTrace({maxEvents:1000001}), /maxEvents/);
});

test('empty or output-muted captures are explicitly rejected rather than producing a different-sounding trace', async t => {
  const core = await SpcCore.create(options); t.after(() => core.dispose()); core.load(dynamicSpc());
  core.beginTrace(); assert.throws(() => core.endTrace(), /at least one/);
  core.setMuteMask(1); assert.throws(() => core.beginTrace(), /unmuted/);
  core.setMuteMask(0); core.beginTrace(); core.setMuteMask(1);
  assert.throws(() => render(core, 128), /unmuted/); assert.throws(() => core.endTrace(), /unmuted/);
});

test('timeline validation rejects malformed edits before native state changes', async t => {
  const {trace} = await capture(t, dynamicSpc(), 128), core = await SnesDspCore.create(options); t.after(() => core.dispose());
  core.loadTimeline(trace); const before = core.getTimelineState();
  for (const patch of [{version:2}, {clockRate:32000}, {durationClocks:33}, {durationClocks:614400032},
    {initialState:{...trace.initialState,outputDelayFrames:0}}, {initialState:{...trace.initialState,ram:new Uint8Array(3)}},
    {events:[0,2,0,0]}, {events:[0,0,128,0]}, {events:[0,1,65536,0]}, {events:[0,0,1,256]},
    {events:[9,0,0,1,8,0,0,2]}, {events:[trace.durationClocks + 1,0,0,1]}, {events:[0,0,0]}, {events:[NaN,0,0,0]}]) {
    assert.throws(() => core.loadTimeline({...trace,...patch})); assert.deepEqual(core.getTimelineState(), before);
  }
  const copied = prepareSpcTimeline(trace); assert.deepEqual(copied, trace); assert.notEqual(copied.events, trace.events);
});

test('timeline completes with silence and normal reset leaves raw timeline mode', async t => {
  const {trace} = await capture(t, dynamicSpc(), 128), {core} = await replay(t, trace);
  assert.ok(render(core, 100).every(channel => channel.every(value => value === 0)));
  assert.equal(core.nativeFrames, 128);
  core.reset(); assert.equal(core.getTimelineState().loaded, false);
  assert.throws(() => core.restartTimeline(), /Load a SNES timeline/);
});

for (const [name, parameters] of [['dry', {}], ['echo', {echo:true}], ['noise', {noise:true}], ['pitch modulation', {voices:3,pmon:true}], ['echo+noise+PMON', {voices:3,echo:true,noise:true,pmon:true}]]) {
  test(`DSP RAM read-set filtering preserves exact ${name} PCM and every DSP write`, async t => {
    const bytes = dynamicSpc(parameters), baseline = await capture(t, bytes, frames, [128]);
    const filtered = await filteredCapture(t, bytes);
    assert.deepEqual(filtered.pcm, baseline.pcm);
    assert.deepEqual(records(filtered.trace).filter(([, kind]) => kind === 0), records(baseline.trace).filter(([, kind]) => kind === 0));
    assert.ok(records(filtered.trace).some(([, kind, address]) => kind === 1 && address === 0x2001), 'modified BRR is kept');
    const replayed = await replay(t, filtered.trace, [1, 7, 127]); assert.deepEqual(replayed.pcm, baseline.pcm);
  });
}

test('DSP-unread working RAM is filtered before event limits, not after recording', async t => {
  const bytes = createSyntheticSpc(), baseline = await capture(t, bytes, frames, [128]);
  assert.ok(records(baseline.trace).some(([, kind, address]) => kind === 1 && address === 0x30));
  const filtered = await filteredCapture(t, bytes, frames, {maxEvents:1});
  assert.equal(filtered.mask[0x30], 0); assert.equal(filtered.trace.events.length, 0);
  const replayed = await replay(t, filtered.trace); assert.deepEqual(replayed.pcm, baseline.pcm);
  const limited = await SpcCore.create(options); t.after(() => limited.dispose()); limited.load(bytes); limited.beginTrace({maxEvents:1});
  assert.throws(() => render(limited, frames, [128]), /trace limit exceeded/);
});

test('directory, silent-voice directory and disabled-echo reads remain conservative dependencies', async t => {
  const bytes = createSyntheticSpc(), dsp = bytes.subarray(0x10100, 0x10180);
  dsp[0x14] = 11; // Unkeyed/silent Voice 2 still reads its sample directory.
  const {mask} = await filteredCapture(t, bytes);
  for (const address of [0x1000, 0x1001, 0x1002, 0x1003, 0x102e, 0x102f, 0x2000, 0x2001, 0x2008,
    0x6000, 0x6001, 0x6002, 0x6003]) assert.equal(mask[address], 1, `DSP read $${address.toString(16)} is retained`);
});

test('the complete first pass retains writes before a later DIR/SRCN change starts reading those addresses', async t => {
  const bytes = createSyntheticSpc({echo:true}), ram = bytes.subarray(0x100, 0x10100);
  // Build directory page $11 and sample $3000 before the driver selects either.
  ram.set([0xc3, 0x13, 0x57, 0x75, 0x31, 0xfd, 0xb9, 0x9b, 0xdf], 0x3000);
  ram.set([0xe8,0x30,0xc5,1,0x11,0xc5,3,0x11,
    0xe8,0x72,0xc5,1,0x30,
    0xcd,160,0x8d,255,0xfe,0xfe,0x1d,0xd0,0xf9,
    0x8f,0x5d,0xf2,0x8f,0x11,0xf3,0x8f,0x4c,0xf2,0x8f,1,0xf3,0x2f,0xfe], 0x200);
  const baseline = await capture(t, bytes, 16000, [128]), filtered = await filteredCapture(t, bytes, 16000);
  for (const address of [0x1101, 0x1103, 0x3001]) {
    assert.equal(filtered.mask[address], 1);
    assert.ok(records(filtered.trace).some(([, kind, at]) => kind === 1 && at === address), `early write to future DSP input $${address.toString(16)} is kept`);
  }
  const replayed = await replay(t, filtered.trace, [127]); assert.deepEqual(replayed.pcm, baseline.pcm);
});

test('BRR reads wrapping through $ffff keep low-RAM CPU mutations', async t => {
  const bytes = createSyntheticSpc(), ram = bytes.subarray(0x100, 0x10100);
  ram.set([0xfc, 0xff, 0xfc, 0xff], 0x1000);
  const brr = [0xc3, 0x13, 0x57, 0x75, 0x31, 0xfd, 0xb9, 0x9b, 0xdf];
  for (let index = 0; index < brr.length; index++) ram[(0xfffc + index) & 65535] = brr[index];
  ram.set([0xac, 1, 0, 0x2f, 0xfb], 0x200); // mutate wrapped BRR byte at $0001
  const baseline = await capture(t, bytes, frames, [128]), filtered = await filteredCapture(t, bytes);
  for (const address of [0xfffc, 0xfffd, 0xfffe, 0xffff, 0, 1, 2, 3, 4]) assert.equal(filtered.mask[address], 1);
  assert.ok(records(filtered.trace).some(([, kind, address]) => kind === 1 && address === 1));
  assert.deepEqual((await replay(t, filtered.trace, [127])).pcm, baseline.pcm);
});

test('CPU echo-RAM writes and a wrapped sample-directory address remain in the exact trace', async t => {
  const echoBytes = createSyntheticSpc({echo:true}), echoRam = echoBytes.subarray(0x100,0x10100);
  echoRam.set([0xac,1,0x60,0x2f,0xfb],0x200);
  const echoBaseline = await capture(t,echoBytes,frames,[128]), echoFiltered = await filteredCapture(t,echoBytes);
  assert.ok(records(echoFiltered.trace).some(([,kind,address]) => kind === 1 && address === 0x6001));
  assert.deepEqual((await replay(t,echoFiltered.trace,[127])).pcm,echoBaseline.pcm);
  const dirBytes = createSyntheticSpc(), dirRam = dirBytes.subarray(0x100,0x10100), dirDsp = dirBytes.subarray(0x10100,0x10180);
  dirDsp[0x5d] = 255; dirDsp[4] = 255; // $ff00 + $ff*4 wraps to $02fc.
  dirRam.set([0,0x20,0,0x20],0x2fc);
  const dirBaseline = await capture(t,dirBytes,frames,[128]), dirFiltered = await filteredCapture(t,dirBytes);
  for (const address of [0x2fc,0x2fd,0x2fe,0x2ff]) assert.equal(dirFiltered.mask[address],1);
  assert.deepEqual((await replay(t,dirFiltered.trace,[127])).pcm,dirBaseline.pcm);
});

test('RAM discovery is instance-local, copied, fresh-only and cancelled by reload/disposal', async t => {
  const a = await SpcCore.create(options), b = await SpcCore.create(options); t.after(() => {a.dispose(); b.dispose();});
  const aBytes = createSyntheticSpc(), bBytes = createSyntheticSpc(), bRam = bBytes.subarray(0x100,0x10100), bDsp = bBytes.subarray(0x10100,0x10180);
  bRam.set([0,0x30,0,0x30],0x1000); bRam.set(bRam.subarray(0x2000,0x2009),0x3000); bDsp[0x5d] = 0x10;
  a.load(aBytes); b.load(bBytes); a.beginRamReadTracking(); b.beginRamReadTracking();
  render(a, 256, [128]); render(b, 256, [128]); const first = a.endRamReadTracking(), second = b.endRamReadTracking();
  assert.equal(first[0x2001],1); assert.equal(first[0x3001],0); assert.equal(second[0x3001],1); assert.equal(second[0x2001],0);
  a.restart(); a.beginTrace({ramReadMask:first}); first.fill(0); render(a,128,[128]); a.endTrace();
  assert.throws(() => a.beginRamReadTracking(), /freshly loaded/);
  b.restart(); b.beginRamReadTracking(); b.load(bBytes); assert.throws(() => b.endRamReadTracking(), /No DSP RAM discovery/);
  a.restart(); a.beginRamReadTracking(); assert.throws(() => a.beginTrace(), /freshly loaded/);
  a.setMuteMask(1); a.setMuteMask(0); render(a,128,[128]); assert.throws(() => a.endRamReadTracking(), /unmuted/);
  a.restart(); a.beginRamReadTracking(); assert.throws(() => a.endRamReadTracking(), /at least one/);
  a.restart(); a.beginRamReadTracking(); const malformed = aBytes.slice(); malformed[0] = 0;
  assert.throws(() => a.load(malformed), /header/); render(a,128,[128]); assert.equal(a.endRamReadTracking()[0x2001],1);
  for (const mask of [new Uint8Array(1), new Uint8Array(65536).fill(2), new Uint16Array(65536)]) assert.throws(() => a.beginTrace({ramReadMask:mask}), /mask/);
  a.restart(); a.beginRamReadTracking(); a.dispose(); assert.throws(() => a.endRamReadTracking(), /disposed/);
});
