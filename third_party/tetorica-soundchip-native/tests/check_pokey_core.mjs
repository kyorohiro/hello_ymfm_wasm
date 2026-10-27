// SPDX-License-Identifier: BSD-3-Clause
// Real Native/WASM parity and independently specified POKEY audio checks.
// No AudioContext, ROM, application checkout or audio device is needed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--fixture', '--wasm-dir', '--out'].includes(process.argv[i]), 'Use --fixture FILE --wasm-dir DIR [--out REPORT.json]');
  assert(process.argv[i + 1] && !args[process.argv[i]], 'Missing or duplicate argument');
  args[process.argv[i]] = resolve(process.argv[i + 1]);
}
assert(args['--fixture'] && args['--wasm-dir'], '--fixture and --wasm-dir are required');
const bytes = await readFile(join(args['--wasm-dir'], 'pokey_wasm.wasm'));
const factory = (await import(pathToFileURL(join(args['--wasm-dir'], 'pokey_wasm.js')).href)).default;
const module = await factory({wasmBinary: bytes});
let comparedFrames = 0, specifiedChecks = 0;

class Chip {
  constructor(clock, rate) {
    this.handle = module._pokey_create(clock, rate);
    assert(this.handle, 'Valid core handle');
    this.left = module._malloc(32768 * 4);
    this.right = module._malloc(32768 * 4);
    assert(this.left && this.right);
  }
  apply([op, a, b]) {
    if (op === 'w') module._pokey_write(this.handle, a, b);
    else if (op === 'u') module._pokey_mute(this.handle, a, b);
    else if (op === 'r') module._pokey_reset(this.handle);
    else assert.fail(`Unknown operation ${op}`);
  }
  render(frames) {
    assert(frames <= 32768);
    module._pokey_generate(this.handle, this.left, this.right, frames);
    const h = module.HEAPF32;
    return {left: h.slice(this.left >>> 2, (this.left >>> 2) + frames), right: h.slice(this.right >>> 2, (this.right >>> 2) + frames)};
  }
  read(reg) { return module._pokey_read(this.handle, reg); }
  dispose() {
    if (!this.handle) return;
    module._pokey_destroy(this.handle);
    module._free(this.left); module._free(this.right); this.handle = 0;
  }
}
const init = [['w', 15, 3], ['w', 8, 0]];
const tone = (channel = 0, divisor = 63, control = 0xaf) => [['w', channel * 2, divisor], ['w', channel * 2 + 1, control]];
function scene(name, events, frames = 2048) { return {name, events: events.slice().sort((a, b) => a.frame - b.frame), frames}; }
const at = (frame, commands) => commands.map(command => ({frame, command}));
const scenes = [scene('cold-silence', []), scene('four-tone-write-panless-mono', [
  ...at(0, [...init, ...tone(0, 31), ...tone(1, 47, 0xab), ...tone(2, 63, 0xa9), ...tone(3, 79, 0xa7), ['w', 9, 0]]),
  ...at(317, [['w', 0, 53], ['w', 2, 83]]), ...at(911, [['u', 1, 1]]), ...at(1291, [['u', 1, 0]]),
  ...at(1801, [['w', 1, 0], ['w', 3, 0], ['w', 5, 0], ['w', 7, 0]])
]), scene('reset-and-restart', [...at(0, [...init, ...tone()]), ...at(733, [['r']]), ...at(1133, [...init, ...tone(2, 37)])])];
for (const mode of [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0]) {
  scenes.push(scene(`distortion-${mode.toString(16)}`, [...at(0, [...init, ...tone(0, 17, mode | 15)]),
    ...at(997, [['w', 8, 0x80]]), ...at(1601, [['w', 15, 0]]), ...at(1741, [['w', 15, 3]])]));
}
for (const control of [1, 0x40, 0x20, 0x50, 0x28, 0x06]) {
  scenes.push(scene(`audctl-${control.toString(16)}`, [...at(0, [...init, ...tone(0, 71), ...tone(1, 2), ...tone(2, 37), ...tone(3, 3), ['w', 8, control], ['w', 9, 0]]),
    ...at(701, [['w', 0, 43], ['w', 4, 101]]), ...at(1507, [['w', 9, 0]])]));
}
scenes.push(scene('two-tone-serial-audio', [...at(0, [...init, ...tone(0, 17), ...tone(1, 43), ['w', 15, 0x8b]]), ...at(977, [['w', 15, 3]])]));
scenes.push(scene('volume-only-and-all-mute', [...at(0, [...init, ...tone(0, 0, 0x1f)]), ...at(211, [['u', 0, 1]]),
  ...at(509, [['u', 0, 0]]), ...at(1009, [...tone(1, 0, 0x1f), ...tone(2, 0, 0x1f), ...tone(3, 0, 0x1f)]),
  ...at(1601, [0, 1, 2, 3].map(ch => ['u', ch, 1]))]));

function renderScene(chip, s, layout) {
  const left = new Float32Array(s.frames), right = new Float32Array(s.frames);
  let pos = 0, next = 0, block = 0;
  while (pos < s.frames) {
    while (s.events[next]?.frame === pos) chip.apply(s.events[next++].command);
    const frames = Math.min(layout[block++ % layout.length], s.frames - pos, (s.events[next]?.frame ?? s.frames) - pos);
    assert(frames > 0);
    const pcm = chip.render(frames); left.set(pcm.left, pos); right.set(pcm.right, pos); pos += frames;
  }
  return {left, right, reads: Uint8Array.from({length: 16}, (_, reg) => chip.read(reg))};
}
function nativeScene(s, clock, rate) {
  let position = 0; const lines = [];
  for (const e of s.events) {
    if (e.frame !== position) lines.push(`g ${e.frame - position}`);
    position = e.frame; lines.push(e.command.join(' '));
  }
  if (position < s.frames) lines.push(`g ${s.frames - position}`);
  for (let reg = 0; reg < 16; reg++) lines.push(`q ${reg}`);
  const data = execFileSync(args['--fixture'], [String(clock), String(rate)], {input: lines.join('\n') + '\n', maxBuffer: s.frames * 8 + 65536});
  assert.equal(data.length, s.frames * 8 + 16);
  const left = new Float32Array(s.frames), right = new Float32Array(s.frames);
  for (let i = 0; i < s.frames; i++) { left[i] = data.readFloatLE(i * 8); right[i] = data.readFloatLE(i * 8 + 4); }
  return {left, right, reads: new Uint8Array(data.subarray(s.frames * 8))};
}
function equal(a, b, label) {
  assert.deepEqual(a.left, b.left, `${label}: left`); assert.deepEqual(a.right, b.right, `${label}: right`);
  if (a.reads) assert.deepEqual(a.reads, b.reads, `${label}: read-register map`);
  comparedFrames += a.left.length;
}
for (const [clock, rate] of [[1789790, 44100], [1789773, 48000], [1773447, 32000]]) {
  for (const s of scenes) {
    const native = nativeScene(s, clock, rate);
    for (const layout of [[s.frames], [1, 3, 127, 2, 509, 64]]) {
      const chip = new Chip(clock, rate);
      try {
        const actual = renderScene(chip, s, layout);
        equal(actual, native, `${clock}/${rate}/${s.name}/${layout}`);
        assert.deepEqual(actual.left, actual.right, 'One POKEY is mono');
        for (const value of actual.left) assert(Number.isFinite(value) && value >= 0 && value <= 32767 / 32768);
        if (s.name === 'cold-silence') assert(actual.left.every(v => v === 0));
      } finally { chip.dispose(); }
    }
  }
}

// Independent integer legacy DAC expectations; no shared core reference here.
for (let channels = 1; channels <= 4; channels++) {
  const chip = new Chip(1789790, 48000);
  try {
    for (const command of init) chip.apply(command);
    for (let ch = 0; ch < channels; ch++) chip.apply(['w', ch * 2 + 1, 0x1f]);
    const expected = Math.min(32767, channels * 15 * 744) / 32768;
    assert(chip.render(128).left.subarray(4).every(v => v === expected), 'Legacy DAC scale and per-chip clipping');
    for (let ch = 0; ch < channels; ch++) chip.apply(['u', ch, 1]);
    assert(chip.render(31).left.every(v => v === 0), 'Immediate monitor mute of held DAC');
    specifiedChecks += 2;
  } finally { chip.dispose(); }
}
function frequency(samples, rate) {
  const body = samples.subarray(1000), threshold = body.reduce((a, b) => a + b, 0) / body.length;
  const edges = [];
  for (let i = 1; i < body.length; i++) if (body[i - 1] <= threshold && body[i] > threshold) edges.push(i);
  assert(edges.length > 10, 'Several pure-tone periods');
  return rate * (edges.length - 1) / (edges.at(-1) - edges[0]);
}
for (const [control, divisor, expectedDivisor] of [[0, 63, 28 * 64], [1, 15, 114 * 16], [0x40, 125, 129]]) {
  const chip = new Chip(1789790, 48000);
  try {
    for (const command of [...init, ...tone(0, divisor), ['w', 8, control], ['w', 9, 0]]) chip.apply(command);
    const actual = frequency(chip.render(16000).left, 48000), expected = 1789790 / (2 * expectedDivisor);
    assert(Math.abs(actual / expected - 1) < 0.003, `Pure-tone divider: ${actual} vs ${expected}`);
    specifiedChecks++;
  } finally { chip.dispose(); }
}

// Shared module, independently clocked chips and isolated reference handles.
const a = new Chip(1789790, 48000), b = new Chip(1773447, 48000);
const ar = new Chip(1789790, 48000), br = new Chip(1773447, 48000);
try {
  for (const chip of [a, ar]) for (const cmd of [...init, ...tone(0, 43), ['w', 9, 0]]) chip.apply(cmd);
  for (const chip of [b, br]) for (const cmd of [...init, ...tone(2, 23, 0x8d), ['w', 8, 0x80], ['w', 9, 0]]) chip.apply(cmd);
  for (let block = 0; block < 8; block++) {
    if (block === 2) { a.apply(['u', 0, 1]); ar.apply(['u', 0, 1]); }
    if (block === 3) { a.apply(['r']); ar.apply(['r']); }
    if (block === 5) { a.dispose(); ar.dispose(); }
    if (a.handle) equal(a.render(97 + block), ar.render(97 + block), 'Dual handle A');
    equal(b.render(137 + block), br.render(137 + block), 'Dual handle B survives A mute/reset/destroy');
    assert.equal(b.read(10), br.read(10), 'Independent RANDOM phase');
  }
  specifiedChecks += 16;
} finally { a.dispose(); b.dispose(); ar.dispose(); br.dispose(); }
for (const [clock, rate] of [[0, 44100], [1789790, 0], [100000001, 44100], [1789790, 7999], [1789790, 384001]]) {
  assert.equal(module._pokey_create(clock, rate), 0); specifiedChecks++;
}
const report = {passed: true, cases: scenes.length * 3, layouts: 2, comparedStereoFrames: comparedFrames,
  specifiedChecks, maximumDifference: 0, wasmSha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Native/WASM raw audio parity, block invariance, DAC/dividers, shared-module dual handles; no hardware accuracy claim'};
if (args['--out']) await writeFile(args['--out'], JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
