// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {decodeDpcm} from './dmc_decode.js';

test('DAC preview follows LSB-first bits and shows the level before every step', () => {
  assert.deepEqual(decodeDpcm([1]).levels, [64,66,64,62,60,58,56,54,52]);
  assert.deepEqual(decodeDpcm([128]).levels, [64,62,60,58,56,54,52,50,52]);
  assert.deepEqual(decodeDpcm([0xa5]).levels, [64,66,64,66,64,62,64,62,64]);
});

test('DAC limits hold requested steps while preserving even and odd initial levels', () => {
  for (const [level,byte,expected] of [[0,0,0],[1,0,1],[126,255,126],[127,255,127]]) {
    const decoded = decodeDpcm([byte], {level});
    assert(decoded.levels.every(value => value === expected)); assert.equal(decoded.clipped, 8);
  }
  assert.equal(decodeDpcm([1], {level:125}).levels[1], 127);
  assert.equal(decodeDpcm([0], {level:2}).levels[1], 0);
  for (const level of [0,1,64,65,126,127]) {
    const decoded = decodeDpcm([0,255,0x80,0x01], {level,loop:true});
    assert([...decoded.levels,...decoded.nextLevels].every(value => value >= 0 && value <= 127 && value % 2 === level % 2));
  }
});

test('the preview includes generated hardware padding without changing saved bytes', () => {
  const bytes = Array(32).fill(0xff), decoded = decodeDpcm(bytes);
  assert.equal(decoded.hardwareBytes,33); assert.equal(decoded.paddingBytes,1);
  assert.deepEqual(decoded.data,bytes); assert.deepEqual(decoded.paddedData,[...bytes,0xaa]);
  assert.equal(decoded.levels.length,33 * 8 + 1);
  assert.deepEqual(decoded.levels.slice(-8),[124,126,124,126,124,126,124,126]);
  decoded.data[0] = 0; decoded.paddedData[1] = 0; bytes[2] = 0;
  assert.equal(decoded.paddedData[0],255); assert.equal(decoded.data[1],255); assert.equal(decoded.data[2],255);
  const typed = Uint8Array.from([0x80]); assert.deepEqual(decodeDpcm(typed).data,[128]);
  assert.equal(decodeDpcm(Array(4081).fill(0xaa)).hardwareBytes,4081);
});

test('Rate changes time but not DAC levels, and Loop carries the previous ending level', () => {
  const fast = decodeDpcm([255], {rate:15,loop:true}), slow = decodeDpcm([255], {rate:0,loop:true});
  assert.deepEqual(fast.levels,slow.levels); assert.deepEqual(fast.nextLevels,slow.nextLevels);
  assert.equal(fast.levels.at(-1),80); assert.equal(fast.nextLevels[0],80); assert.equal(fast.nextLevels.at(-1),96);
  assert.equal(fast.paddingBytes,0); assert.equal(fast.bitRate,1789773 / 54);
  assert.equal(slow.bitRate,1789773 / 428); assert(slow.durationMs > fast.durationMs * 7);
  assert.equal(fast.durationMs,8 * fast.bitDurationMs);
  assert.equal(decodeDpcm([255]).nextLevels,null);
});

test('empty drafts stay empty and invalid input is rejected before producing a trace', () => {
  const empty = decodeDpcm([], {level:127,loop:true});
  assert.deepEqual(empty.data,[]); assert.deepEqual(empty.paddedData,[]);
  assert.deepEqual(empty.levels,[127]); assert.deepEqual(empty.nextLevels,[127]);
  assert.equal(empty.hardwareBytes,0); assert.equal(empty.durationMs,0);
  for (const bytes of [null,{},'ff',[256],[-1],[1.2],[NaN],Array(4082).fill(0),new Array(1)]) assert.throws(() => decodeDpcm(bytes));
  const extra = [0]; extra.note = 1; assert.throws(() => decodeDpcm(extra));
  for (const level of [-1,128,129,NaN,1.5]) assert.throws(() => decodeDpcm([0],{level}));
  for (const rate of [-1,16,NaN,2.5]) assert.throws(() => decodeDpcm([0],{rate}));
  assert.throws(() => decodeDpcm([0],{loop:1}));
});

test('DAC preview steps match actual WASM output at bit centers, including odd levels and padding', async t => {
  const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
  for (const sampleRate of [44100,48000]) for (const level of [0,1,64,65,126,127]) {
    const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    t.after(() => core.dispose());
    const decoded = decodeDpcm([0x01,0x80], {level,rate:0,loop:true});
    core.loadMemory(Uint8Array.from(decoded.paddedData),0xc000);
    core.writeRegister(0x4010,0x40); core.writeRegister(0x4011,level);
    core.writeRegister(0x4012,0); core.writeRegister(0x4013,(decoded.hardwareBytes - 1) / 16);
    core.setChannelEnabled(4,true);
    assert.equal(core.getState().dmcOutput,level);
    const expected = [...decoded.levels.slice(1),...decoded.nextLevels.slice(1)];
    let generated = 0;
    for (let index = 0; index < expected.length; index++) {
      // Fresh playback begins a bit after one full clock period. Sample halfway
      // to the following bit, leaving a margin for host-rate frame rounding.
      const target = Math.round((index + 1.5) * decoded.bitDurationMs * sampleRate / 1000);
      core.generateStereo(target - generated); generated = target;
      assert.equal(core.getState().dmcOutput,expected[index],`DAC bit ${index}, level ${level}, ${sampleRate} Hz`);
    }
  }
});
