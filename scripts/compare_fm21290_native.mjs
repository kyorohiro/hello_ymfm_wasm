// SPDX-License-Identifier: BSD-3-Clause
// Usage: node scripts/compare_fm21290_native.mjs path/to/tetorica_fm21290_fixture
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createSoundChip} from '../tetorica_src/runtime/soundchip.js';

const fixture = process.argv[2];
assert(fixture, 'Pass the compiled native fixture');
let maxError = 0;
for (const sampleRate of [44100, 48000]) {
  const chip = await createSoundChip('fm21290', {sampleRate});
  const commands = [], expected = [];
  function write(address, byte) {
    commands.push([address, byte]);
    chip.writeRegister(address, byte);
  }
  function render(frames) {
    commands.push([-1, frames]);
    const block = new Float32Array(frames);
    chip.renderInto(block);
    expected.push(...block);
  }
  for (let alg = 0; alg < 32; alg++) {
    const ch = alg % 16;
    write(0x2804, 0x20 | ch);
    write(0x2805, (alg << 3) | (alg & 7));
    write(0x3000 + ch * 2, 0x58 + ch % 6);
    write(0x3001 + ch * 2, 0xa8);
    for (let op = 0; op < 6; op++) {
      write(0x3020 + op * 2, 0x23 + op);
      write(0x3021 + op * 2, 0x2c);
      write(0x3030 + op, op);
      write(0x3080 + op * 16 + ch, 40 + op);
      for (let stage = 0; stage < 4; stage++) {
        write(0x3040 + 4 * op + stage, 62);
        write(0x3060 + 4 * op + stage, stage === 3 ? 63 : 2);
      }
    }
    write(0x30f1, (ch << 2) | 1);
    render(137);
    write(0x3076, 15); // change OP1 sustain during the note
    render(713);
    write(0x30f1, (ch << 2) | 2);
    render(179);
  }
  const native = spawnSync(fixture, [String(sampleRate)], {input:commands.map(row=>row.join(' ')).join('\n')});
  assert.equal(native.status, 0, native.stderr?.toString() ?? String(native.error));
  assert.equal(native.stdout.byteLength, expected.length * 4);
  const pcm = new Float32Array(Uint8Array.from(native.stdout).buffer);
  assert(pcm.some(v => Math.abs(v) > .001));
  for (let i = 0; i < pcm.length; i++) maxError = Math.max(maxError, Math.abs(pcm[i] - expected[i]));
}
assert(maxError <= 1e-6, 'Native / JavaScript PCM deviation ' + maxError);
console.log('32 algorithms, 16 slots, 44100/48000 Hz. Maximum absolute PCM difference:', maxError);
