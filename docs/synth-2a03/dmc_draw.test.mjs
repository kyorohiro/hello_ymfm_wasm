// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {applyDmcTargets} from './dmc_draw.js';
import {decodeDpcm} from './dmc_decode.js';

test('drawn reachable levels choose LSB-first steps while keeping untargeted byte bits', () => {
  const source = [0xaa], targets = [66,68,66,64].map((level,bit) => ({bit,level}));
  const result = applyDmcTargets(source,targets);
  assert.deepEqual(result,[0xa3]);
  assert.deepEqual(decodeDpcm(result).levels.slice(0,5),[64,66,68,66,64]);
  assert.equal(result[0] & 0xf0,source[0] & 0xf0);
  assert.deepEqual(source,[0xaa]);
  assert.deepEqual(applyDmcTargets(result,targets),result,'drawing the same targets again is stable');
});

test('unreachable jumps take the nearest legal step rather than drawing arbitrary PCM heights', () => {
  const result = applyDmcTargets([0],[{bit:0,level:127},{bit:1,level:0}]);
  assert.deepEqual(decodeDpcm(result).levels.slice(0,3),[64,66,64]);
  assert.equal(result[0],1);
  assert.equal(applyDmcTargets([0],[{bit:0,level:64}])[0],0,'an equal-error choice keeps the original down bit');
  assert.equal(applyDmcTargets([1],[{bit:0,level:64}])[0],1,'an equal-error choice keeps the original up bit');
  assert.equal(applyDmcTargets([0],[{bit:0,level:64.01}])[0],1,'fractional mouse targets are not rounded before choosing a step');
});

test('drawn endpoints hold at the DAC boundaries without changing even or odd parity', () => {
  for (const [level,target,original,byte] of [[0,0,255,0],[1,0,255,0],[126,127,0,255],[127,127,0,255]]) {
    const targets = Array.from({length:8},(_,bit) => ({bit,level:target}));
    const result = applyDmcTargets([original],targets,{level});
    assert.deepEqual(result,[byte]);
    assert(decodeDpcm(result,{level}).levels.every(value => value === level));
  }
  const odd = applyDmcTargets([255],Array.from({length:8},(_,bit) => ({bit,level:100})),{level:127});
  const levels = decodeDpcm(odd,{level:127}).levels;
  assert.equal(levels[1],125); assert(levels.every(value => value % 2 === 1));
});

test('sparse unsorted and repeated targets use the latest target and the real preceding DAC state', () => {
  const source = Object.freeze([0,4,0x55]);
  const targets = Object.freeze([{bit:10,level:100},{bit:0,level:66},{bit:10,level:0}].map(Object.freeze));
  const result = applyDmcTargets(source,targets);
  assert.deepEqual(result,[1,0,0x55]);
  const levels = decodeDpcm(result).levels;
  assert.equal(levels[10],48); assert.equal(levels[11],46);
  assert.deepEqual(source,[0,4,0x55]);
  const sorted = applyDmcTargets(source,[{bit:0,level:66},{bit:10,level:0}]);
  assert.deepEqual(result,sorted);
});

test('drawing preserves source length, isolated prefix and suffix bits, and detached byte ownership', () => {
  const source = Uint8Array.from([0x81,0xaa,0x7e]);
  const result = applyDmcTargets(source,[{bit:10,level:127},{bit:11,level:127}]);
  assert.equal(result.length,source.length); assert.equal(result[0],source[0]); assert.equal(result[2],source[2]);
  assert.equal(result[1] & ~0x0c,source[1] & ~0x0c);
  result[0] = 0; assert.equal(source[0],0x81);
  assert.deepEqual(applyDmcTargets([],[]),[]);
  const copy = applyDmcTargets(source,[]); copy[0] = 0; assert.equal(source[0],0x81);
  const maximum = Array(4081).fill(0xaa), final = applyDmcTargets(maximum,[{bit:4081 * 8 - 1,level:0}]);
  assert.equal(final.length,4081); assert.equal(final.at(-1),0x2a);
  assert.deepEqual(final.slice(0,-1),maximum.slice(0,-1));
});

test('invalid data or targets cannot mutate original data or target padding bits', () => {
  for (const source of [null,{},'ff',[256],[-1],[NaN],[1.5],new Array(1),Array(4082).fill(0),new Uint16Array(1)]) assert.throws(() => applyDmcTargets(source,[]));
  const extra = [0]; extra.note = 1; assert.throws(() => applyDmcTargets(extra,[]));
  const source = [0x55,0xaa], original = [...source];
  for (const targets of [null,{},'x',[null],[{bit:0}],[{bit:-1,level:64}],[{bit:1.5,level:64}],[{bit:16,level:64}],
    [{bit:0,level:-1}],[{bit:0,level:128}],[{bit:0,level:NaN}],[{bit:0,level:Infinity}],[{bit:'0',level:64}],
    [{bit:0,level:100},{bit:1,level:'64'}]]) {
    assert.throws(() => applyDmcTargets(source,targets)); assert.deepEqual(source,original);
  }
  for (const level of [-1,128,NaN,1.5]) assert.throws(() => applyDmcTargets(source,[],{level}));
  function* excessive() {for (let count = 0; count <= 4081 * 8; count++) yield {bit:0,level:64};}
  assert.throws(() => applyDmcTargets(source,excessive()),/target points/);
  assert.deepEqual(source,original);
});

test('drawn bytes decode to the actual WASM DAC steps and render finite audible PCM', async t => {
  const targets = Array.from({length:16},(_,bit) => ({bit,level:bit < 8 ? 80 : 48}));
  const data = applyDmcTargets([0xaa,0x55],targets,{level:65});
  const decoded = decodeDpcm(data,{level:65,rate:0});
  const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
  for (const sampleRate of [44100,48000]) {
    const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    t.after(() => core.dispose());
    core.loadMemory(Uint8Array.from(decoded.paddedData),0xc000);
    core.writeRegister(0x4010,0); core.writeRegister(0x4011,65);
    core.writeRegister(0x4012,0); core.writeRegister(0x4013,(decoded.hardwareBytes - 1) / 16); core.setChannelEnabled(4,true);
    let generated = 0, audible = false;
    for (let bit = 0; bit < decoded.levels.length - 1; bit++) {
      const target = Math.round((bit + 1.5) * decoded.bitDurationMs * sampleRate / 1000);
      const pcm = core.generateStereo(target - generated); generated = target;
      assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
      audible ||= pcm.left.some(value => Math.abs(value) > .0001);
      assert.equal(core.getState().dmcOutput,decoded.levels[bit + 1],`drawn DAC bit ${bit}, ${sampleRate} Hz`);
    }
    assert(audible,`drawn data sounds at ${sampleRate} Hz`);
  }
});
