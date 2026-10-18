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
