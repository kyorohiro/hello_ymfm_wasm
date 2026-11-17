// Installed SCSP DSP checks used by the npm consumer harness.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const filenames = ['scsp_dsp_assembler.js', 'scsp_dsp_assembler.d.ts'];
const exampleFilenames = ['index.html', 'roundtrip.mjs', 'README.md'].map(name => 'examples/scsp-dsp/' + name);

export function assertScspDspPackageFiles(paths) {
  for (const name of [...filenames, ...exampleFilenames]) {
    assert(paths.has(name), 'SCSP DSP npm payload missing ' + name);
  }
}

export async function checkInstalledScspDspNode(consumer) {
  for (const name of filenames) {
    const installed = await readFile(join(consumer, 'node_modules/tetorica-fm2612', name));
    const authored = await readFile(join(root, 'tetorica_src/runtime', name));
    assert.deepEqual(installed, authored, 'Installed DSP source must retain authored bytes for ' + name);
  }
  for (const name of exampleFilenames) {
    const installed = await readFile(join(consumer, 'node_modules/tetorica-fm2612', name));
    const authored = await readFile(join(root, 'packages/fm2612', name));
    assert.deepEqual(installed, authored, 'Installed DSP example must retain authored bytes for ' + name);
  }
  const destination = join(consumer, 'scsp-dsp-installed-check.mjs');
  await writeFile(destination, String.raw`
import assert from 'node:assert/strict';

const original = Object.fromEntries(['fetch', 'AudioContext', 'webkitAudioContext', 'WebAssembly'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let fetches = 0;
let audioContexts = 0;
let wasmAccesses = 0;
globalThis.fetch = () => {fetches++; throw new Error('Assembler requested network data');};
globalThis.AudioContext = class {constructor() {audioContexts++; throw new Error('Assembler created audio');}};
globalThis.webkitAudioContext = globalThis.AudioContext;
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get() {wasmAccesses++; throw new Error('Assembler accessed WebAssembly');},
});
try {
  const js = await import('tetorica-fm2612/scsp_dsp_assembler.js');
  const bare = await import('tetorica-fm2612/scsp_dsp_assembler');
  assert.equal(js.assembleScspDsp, bare.assembleScspDsp);
  assert.equal(js.disassembleScspDsp, bare.disassembleScspDsp);
  assert.deepEqual(Object.keys(js).sort(), ['assembleScspDsp', 'disassembleScspDsp']);

  const source = '; Field positions are logical MPRO word order.\n003: EWT=1 COEF=1';
  const words = js.assembleScspDsp(source);
  assert(words instanceof Uint16Array);
  assert.equal(words.length, 512);
  assert.deepEqual(Array.from(words.slice(12, 16)), [0, 0, 4096, 512]);
  assert(words.slice(0, 12).every(value => value === 0));
  const before = words.slice();
  assert.deepEqual(bare.assembleScspDsp(js.disassembleScspDsp(words)), before);
  assert.deepEqual(words, before);
  const second = js.assembleScspDsp(source);
  words.fill(65535);
  assert.deepEqual(second, before);
  assert.equal(js.disassembleScspDsp(new Uint16Array(512)), '');
  const full = bare.disassembleScspDsp(new Uint16Array(512), {includeTrailingZeros:true});
  assert.equal(full.trimEnd().split('\n').length, 128);

  const opaque = js.assembleScspDsp('000: RAW0=0x8000 RAW1=0x1000 RAW3=0x0180');
  assert.deepEqual(Array.from(opaque.slice(0, 4)), [32768, 4096, 0, 384]);
  assert.deepEqual(js.assembleScspDsp(bare.disassembleScspDsp(opaque)), opaque);
  const broad = Uint16Array.from({length:512}, (_, index) => (index * 7919 + 65521) & 65535);
  const broadBefore = broad.slice();
  assert.deepEqual(bare.assembleScspDsp(js.disassembleScspDsp(broad)), broadBefore);
  assert.deepEqual(broad, broadBefore);
  assert.equal(js.disassembleScspDsp(Array.from(second)), js.disassembleScspDsp(second));

  assert.throws(() => js.assembleScspDsp('003: UNKNOWN=1'), /Line 1.*unknown field/);
  assert.throws(() => js.assembleScspDsp('000: COEF=64'), /COEF must be 0..63/);
  assert.throws(() => js.assembleScspDsp('128: EWT=1'), /step must be 0..127/);
  assert.throws(() => js.assembleScspDsp('001: EWT=1\n001: COEF=1'), /strictly increasing/);
  assert.throws(() => js.assembleScspDsp('000: RAW0=1'), /opaque bits/);
  assert.throws(() => bare.assembleScspDsp({}), /source must be a string/);
  assert.throws(() => bare.disassembleScspDsp(new Uint16Array(511)), /512 words/);
  const invalid = Array(512).fill(0); invalid[9] = 65536;
  assert.throws(() => js.disassembleScspDsp(invalid), /word 9.*0..65535/);
  assert.throws(() => js.disassembleScspDsp(second, {includeTrailingZeros:'yes'}), /must be a boolean/);
  assert.throws(() => js.disassembleScspDsp(second, {unknown:true}), /Unknown SCSP DSP disassembly option/);
  const example = await import('./node_modules/tetorica-fm2612/examples/scsp-dsp/roundtrip.mjs');
  assert(example.words instanceof Uint16Array);
  assert.equal(example.words.length, 512);
  assert.equal(example.equal, true);
  assert.deepEqual(example.words, js.assembleScspDsp(example.source));
  assert.equal(fetches, 0);
  assert.equal(audioContexts, 0);
  assert.equal(wasmAccesses, 0);
  console.log('Installed SCSP DSP assembler and packaged example verified through both npm subpaths, field vectors, raw round trips and validation.');
} finally {
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
`);
  execFileSync(process.execPath, [destination], {cwd:consumer, stdio:'inherit'});
}
