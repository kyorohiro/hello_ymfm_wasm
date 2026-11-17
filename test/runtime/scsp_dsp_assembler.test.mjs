// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assembleScspDsp, disassembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';

test('the reusable DSP codec and declarations retain byte-exact served and Synth compatibility copies', async () => {
  for (const suffix of ['js', 'd.ts']) {
    const runtime = await readFile(new URL(`../../tetorica_src/runtime/scsp_dsp_assembler.${suffix}`, import.meta.url));
    assert.deepEqual(await readFile(new URL(`../../docs/js/scsp_dsp_assembler.${suffix}`, import.meta.url)), runtime);
    assert.deepEqual(await readFile(new URL(`../../docs/synth-scsp/dsp_assembler.${suffix}`, import.meta.url)), runtime);
  }
});

test('public physical-word vectors preserve field values, internal positions and the full 512-word image', () => {
  const source = '003: TRA=37 TWT=1 TWA=12 XSEL=1 YSEL=2 IRA=32 IWT=1 IWA=3 EWT=1 EWA=5 SHIFT=2 ZERO=1 BSEL=1 COEF=63 MASA=31 ADREB=1 NXADR=1';
  const words = assembleScspDsp(source);
  assert(words instanceof Uint16Array);
  assert.equal(words.length, 512);
  assert.deepEqual(Array.from(words.subarray(12, 16)), [0x258c, 0xc823, 0x1523, 0x7e7f]);
  assert(words.subarray(0, 12).every(value => value === 0));
  assert(words.subarray(16).every(value => value === 0));
  const text = disassembleScspDsp(words);
  assert.match(text, /^000:\n001:\n002:\n003:/);
  assert.deepEqual(assembleScspDsp(text), words);
  assert.equal(disassembleScspDsp(words, {includeTrailingZeros: true}).trimEnd().split('\n').length, 128);
});

test('the public codec preserves arbitrary inspection bits without imposing the Synth execution profile', () => {
  const image = new Uint16Array(512);
  for (let index = 0; index < image.length; index++) image[index] = (index * 997 + 0x8000) & 0xffff;
  const before = image.slice();
  const text = disassembleScspDsp(image);
  assert.match(text, /RAW0=0x8000/);
  assert.deepEqual(assembleScspDsp(text), before);
  assert.deepEqual(image, before);
  assert.match(disassembleScspDsp(assembleScspDsp('001: YSEL=1 COEF=63 EWT=1 EWA=15')), /COEF=63/);
  assert.deepEqual(Array.from(assembleScspDsp('000: RAW0=0x8000 RAW1=0x1000 RAW3=0x180').subarray(0, 4)), [0x8000, 0x1000, 0, 0x180]);
});

test('public validation keeps line diagnostics, strict words, owned outputs and explicit full disassembly', () => {
  assert.throws(() => assembleScspDsp('; source line\n\n004: COEF=64'), /Line 3: COEF/);
  assert.throws(() => assembleScspDsp('004:\n003:'), /strictly increasing/);
  assert.throws(() => assembleScspDsp('000: RAW0=1'), /opaque bits/);
  const first = assembleScspDsp('127: NXADR=1'), second = assembleScspDsp('127: NXADR=1');
  first[511] = 0;
  assert.equal(second[511], 1);
  assert.equal(disassembleScspDsp(Object.freeze(Array.from(second))), disassembleScspDsp(second));
  const invalid = Array(512).fill(0); invalid[7] = 0.25;
  assert.throws(() => disassembleScspDsp(invalid), /word 7/);
  assert.equal(invalid[7], 0.25);
  assert.throws(() => disassembleScspDsp(second, {includeTrailingZeros: 1}), /boolean/);
  assert.equal(disassembleScspDsp(new Uint16Array(512)), '');
  assert.equal(disassembleScspDsp(new Uint16Array(512), {includeTrailingZeros: true}).trimEnd().split('\n').length, 128);
});

test('the standalone module can be imported and used without loading a browser or WASM', () => {
  const url = new URL('../../tetorica_src/runtime/scsp_dsp_assembler.js', import.meta.url).href;
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    for (const name of ['window','document','AudioContext','webkitAudioContext','AudioWorkletNode','WebAssembly']) {
      Object.defineProperty(globalThis, name, {configurable:true,get(){throw Error(name + ' must not be read');}});
    }
    globalThis.fetch = () => {throw Error('fetch must not be called');};
    const codec = await import(${JSON.stringify(url)});
    assert.deepEqual(Object.keys(codec).sort(), ['assembleScspDsp','disassembleScspDsp']);
    const words = codec.assembleScspDsp('003: EWT=1 COEF=1');
    assert.equal(words.length, 512);
    assert.match(codec.disassembleScspDsp(words), /EWT=1/);
    console.log('standalone codec: no browser, fetch, audio or WASM');
  `], {encoding: 'utf8', cwd: fileURLToPath(new URL('../../', import.meta.url))});
  assert.match(result, /standalone codec/);
});
