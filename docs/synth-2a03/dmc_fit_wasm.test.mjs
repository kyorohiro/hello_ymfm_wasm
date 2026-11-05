// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {fitDmcTargets} from './dmc_fit.js';
import {applyDmcTargets} from './dmc_draw.js';
import {decodeDpcm} from './dmc_decode.js';
import {createDefaultPreset, createDemoDpcm, MAX_DPCM_BYTES, readPreset} from './preset.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
const bitAt = (data,bit) => data[bit >> 3] >> (bit & 7) & 1;

async function assertWasmSteps(t,data,level,label) {
  const decoded = decodeDpcm(data,{level,rate:0});
  for (const sampleRate of [44100,48000]) {
    const core = await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    t.after(() => core.dispose());
    core.loadMemory(Uint8Array.from(decoded.paddedData),0xc000);
    core.writeRegister(0x4010,0); core.writeRegister(0x4011,level);
    core.writeRegister(0x4012,0); core.writeRegister(0x4013,(decoded.hardwareBytes - 1) / 16);
    core.setChannelEnabled(4,true);
    assert.equal(core.getState().dmcOutput,level);
    let generated = 0;
    for (let bit = 0; bit < decoded.paddedData.length * 8; bit++) {
      // Rate 0 leaves many host frames between bit centers. Fresh playback's
      // first output step follows one full DMC clock period.
      const target = Math.round((bit + 1.5) * decoded.bitDurationMs * sampleRate / 1000);
      const pcm = core.generateStereo(target - generated); generated = target;
      assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite));
      assert.equal(core.getState().dmcOutput,decoded.levels[bit + 1],`${label}, bit ${bit}, ${sampleRate} Hz`);
    }
  }
  return decoded;
}

test('fitted middle clicks reach the cursor and real WASM follows every original and generated-padding bit',async t => {
  for (const level of [64,65]) {
    const source = Object.freeze(Array(18).fill(0xaa)), target = level + 46;
    const targets = [{bit:48,level:target}];
    const old = decodeDpcm(applyDmcTargets(source,targets,{level}),{level});
    assert.equal(old.levels[49],level + 2,'changing only the touched bit cannot reach this cursor height');
    const result = fitDmcTargets(source,targets,{level});
    const decoded = await assertWasmSteps(t,result.data,level,`fitted click from DAC ${level}`);
    assert(Math.abs(decoded.levels[49] - target) <= 2,'a nearby physical DAC step approaches the cursor without a phase-fixing detour');
    assert.equal(result.cursor.actual,decoded.levels[49]); assert.equal(result.cursor.error,Math.abs(decoded.levels[49] - target));
    assert(result.changedBefore > 0 && result.changedAfter > 0,'the fitted climb and return use surrounding bits');
    assert.equal(result.rejoined,true);
    const original = decodeDpcm(source,{level});
    assert.deepEqual(decoded.levels.slice(result.range.endBit + 1),original.levels.slice(result.range.endBit + 1),
      'after rejoining, the untouched suffix and generated padding retain the original DAC waveform');
    assert.equal(result.data.length,18); assert.equal(decoded.hardwareBytes,33); assert.equal(decoded.paddingBytes,15);
    assert.deepEqual(source,Array(18).fill(0xaa));
  }
});

test('fitted boundary holds retain both DAC parities in the actual WASM core',async t => {
  for (const [level,target,original] of [[0,0,255],[1,0,255],[126,127,0],[127,127,0]]) {
    const targets = Array.from({length:16},(_,bit) => ({bit,level:target}));
    const result = fitDmcTargets([original,original],targets,{level});
    const decoded = await assertWasmSteps(t,result.data,level,`fitted boundary DAC ${level}`);
    const originalBits = decoded.levels.slice(0,17);
    assert(originalBits.every(value => Math.abs(value - level) <= 2),'boundary targets stay within one physical DAC step');
    assert(originalBits.some((value,index) => index > 0 && value === originalBits[index - 1]),'outward instructions genuinely hold at the boundary');
    assert(decoded.levels.every(value => (value & 1) === (level & 1)));
    assert.equal(result.data.length,2); assert.equal(decoded.paddingBytes,15);
  }
});

test('a fitted dense hand-drawn curve produces real hardware DAC steps at both host rates',async t => {
  const source = Array(32).fill(0xaa);
  const targets = Array.from({length:256},(_,bit) => ({bit,level:64 + 30 * Math.sin(2 * Math.PI * (bit + 1) / 256)}));
  const result = fitDmcTargets(source,targets,{priorityBit:127});
  const decoded = await assertWasmSteps(t,result.data,64,'dense fitted curve');
  assert.equal(result.cursor.bit,127);
  assert(Math.abs(decoded.levels[128] - targets[127].level) <= 2,'the priority cursor stays within one physical DAC step');
  assert(result.changedBits > 0);
  assert.equal(result.data.length,source.length); assert.equal(decoded.hardwareBytes,33);
});

test('fitting preserves bit boundaries and keeps only owned bytes in raw and preset saves',() => {
  const source = Uint8Array.from(Array(33).fill(0xaa));
  const result = fitDmcTargets(source,[{bit:130,level:110}]);
  assert.deepEqual(result.range,{startBit:68,endBit:193});
  for (let bit = 0; bit < source.length * 8; bit++) if (bit < result.range.startBit || bit > result.range.endBit) {
    assert.equal(bitAt(result.data,bit),bitAt(source,bit),`untouched bit ${bit}, including the partial boundary bytes`);
  }
  assert.equal(result.rejoined,true);
  const decoded = decodeDpcm(result.data), original = decodeDpcm(source);
  assert.deepEqual(decoded.levels.slice(result.range.endBit + 1),original.levels.slice(result.range.endBit + 1));
  const raw = Uint8Array.from(result.data);
  assert.equal(raw.byteLength,source.byteLength); assert.deepEqual([...raw],result.data);
  const preset = createDefaultPreset(); preset.source = 'dmc'; preset.dmc.data = [...result.data];
  const restored = readPreset(JSON.parse(JSON.stringify(preset)));
  assert.deepEqual(restored.dmc.data,result.data); assert.equal(restored.dmc.data.length,33);
  assert.deepEqual(source,Uint8Array.from(Array(33).fill(0xaa)));
});

test('maximum-size owned samples stay bounded without rendering seconds of slow-rate PCM',() => {
  const source = Array(MAX_DPCM_BYTES).fill(0xaa), finalBit = source.length * 8 - 1;
  const result = fitDmcTargets(source,[{bit:finalBit - 31,level:22}]);
  assert.equal(result.data.length,MAX_DPCM_BYTES); assert.equal(Uint8Array.from(result.data).byteLength,MAX_DPCM_BYTES);
  assert.equal(result.range.endBit,finalBit); assert(result.range.startBit >= 0);
  const decoded = decodeDpcm(result.data);
  assert.equal(decoded.paddingBytes,0); assert.equal(decoded.hardwareBytes,MAX_DPCM_BYTES);
  assert(Math.abs(decoded.levels[finalBit - 30] - 22) <= 2);
  assert(decoded.levels.every(value => Number.isInteger(value) && value >= 0 && value <= 126 && value % 2 === 0));
  assert.deepEqual(source,Array(MAX_DPCM_BYTES).fill(0xaa));
});

test('near-center fitted clicks do not visit a DAC boundary just to change step-count parity',async t => {
  const cases = [
    {level:64,bit:128,target:64}, {level:64,bit:129,target:62},
    {level:65,bit:128,target:65},
    {level:64,bit:128,target:80}, {level:64,bit:129,target:80},
    {level:64,bit:128,target:96}, {level:64,bit:129,target:96},
  ];
  for (const {level,bit,target} of cases) {
    const source = Array(33).fill(0xaa), original = decodeDpcm(source,{level});
    const result = fitDmcTargets(source,[{bit,level:target}],{level});
    const decoded = await assertWasmSteps(t,result.data,level,`no parity spike, DAC ${level}, bit ${bit}, target ${target}`);
    const from = result.range.startBit, to = result.range.endBit + 2;
    const levels = decoded.levels.slice(from,to), baseline = original.levels.slice(from,to);
    assert(Math.abs(result.cursor.actual - target) <= 2);
    assert(Math.min(...levels) >= Math.min(target,...baseline) - 2,'the lead-in and return do not undershoot the requested region');
    assert(Math.max(...levels) <= Math.max(target,...baseline) + 2,'one-step cursor precision does not require an upper-boundary excursion');
    assert.equal(result.rejoined,true);
    assert.deepEqual(decoded.levels.slice(result.range.endBit + 1),original.levels.slice(result.range.endBit + 1));
  }
});

test('exact and fractional nearby clicks remain stable when repeated instead of growing a boundary spike',() => {
  const source = Array(33).fill(0xaa);
  for (const [level,bit,target] of [[64,128,62],[64,129,64],[65,128,63]]) {
    const result = fitDmcTargets(source,[{bit,level:target}],{level});
    assert.deepEqual(result.data,source,'clicking the existing DAC height is a no-op');
  }
  for (const [level,bit,target] of [[64,128,64.00001],[64,129,61.99999],[65,128,65.00001]]) {
    const result = fitDmcTargets(source,[{bit,level:target}],{level});
    const repeated = fitDmcTargets(result.data,[{bit,level:target}],{level});
    assert(Math.abs(result.cursor.actual - target) <= 2);
    assert.deepEqual(repeated.data,result.data,'the same pointer height does not keep changing adjacent bits');
    const levels = decodeDpcm(result.data,{level}).levels;
    assert(Math.min(...levels) >= level - 4 && Math.max(...levels) <= level + 4,'fractional pixel heights stay near the original center');
  }
});

test('fitting a demo sample follows the requested region without an unrelated trough or peak',() => {
  const source = createDemoDpcm(), original = decodeDpcm(source);
  for (const [bit,target] of [[62,24],[62,40],[62,48],[62,64],[62,80],[69,24]]) {
    const result = fitDmcTargets(source,[{bit,level:target}]);
    const decoded = decodeDpcm(result.data), from = result.range.startBit, to = result.range.endBit + 2;
    const levels = decoded.levels.slice(from,to), baseline = original.levels.slice(from,to);
    assert(Math.abs(result.cursor.actual - target) <= 2);
    assert(Math.min(...levels) >= Math.min(target,...baseline) - 2,`demo bit ${bit}, target ${target}: no unrelated undershoot`);
    assert(Math.max(...levels) <= Math.max(target,...baseline) + 2,`demo bit ${bit}, target ${target}: no unrelated peak`);
    assert.equal(result.rejoined,true);
  }
});

test('returning near an original endpoint does not force an unrelated boundary detour',async t => {
  const source = Array(16).fill(0);
  for (let bit = 0; bit < 128; bit++) {
    const value = bit < 32 || bit >= 63 && bit <= 125 && (bit - 63) % 2 === 0;
    if (value) source[bit >> 3] |= 1 << (bit & 7);
  }
  const original = decodeDpcm(source), result = fitDmcTargets(source,[{bit:62,level:64}]);
  assert.equal(original.levels[63],64); assert.equal(original.levels[126],66);
  const decoded = await assertWasmSteps(t,result.data,64,'endpoint parity tolerance');
  const levels = decoded.levels.slice(result.range.startBit,result.range.endBit + 2);
  assert(Math.min(...levels) >= 62 && Math.max(...levels) <= 68,'a return within one step avoids visiting 0 or 126');
  assert(Math.abs(result.cursor.actual - 64) <= 2);
  assert(Math.abs(decoded.levels[result.range.endBit + 1] - original.levels[result.range.endBit + 1]) <= 2);
});
