// Installed SCSP DSP checks used by the npm consumer harness.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const filenames = [
  'scsp_dsp_assembler.js', 'scsp_dsp_assembler.d.ts',
  'scsp_dsp.js', 'scsp_dsp_coefficients.js', 'scsp_dsp_program.js',
  'scspsynth.js', 'scspsynth.d.ts', 'scsp.js', 'scsp.d.ts',
  'playground_scsp.d.ts',
];
const inferredDeclarations = ['scsp_dsp.d.ts', 'scsp_dsp_coefficients.d.ts', 'scsp_dsp_program.d.ts'];
const exampleFilenames = [
  'index.html', 'roundtrip.mjs', 'README.md',
  'execution.mjs', 'execution.html', 'execution-browser.js',
].map(name => 'examples/scsp-dsp/' + name);

export function assertScspDspPackageFiles(paths) {
  for (const name of [...filenames, ...inferredDeclarations, ...exampleFilenames]) {
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
  const executionExample = await import('./node_modules/tetorica-fm2612/examples/scsp-dsp/execution.mjs');
  assert.equal(typeof executionExample.runDspExamples, 'function');
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
  await checkInstalledScspExecutionNode(consumer);
}

async function checkInstalledScspExecutionNode(consumer) {
  const destination = join(consumer, 'scsp-dsp-execution-installed-check.mjs');
  await writeFile(destination, String.raw`
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Scsp} from 'tetorica-fm2612/scsp.js';
import {ScspSynth} from 'tetorica-fm2612/scspsynth.js';
import {ScspSynth as BareScspSynth} from 'tetorica-fm2612/scspsynth';
import {assembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler';
import factory from 'tetorica-fm2612/generated/scsp_wasm.js';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';

assert.equal(ScspSynth, BareScspSynth);
for (const method of ['applyDspProgram','getDspProgram','getDspCoefficients','setDspCoefficients','setDspReturn']) {
  assert.equal(typeof ScspSynth.prototype[method], 'function', method);
}
let deviceRequests = 0;
globalThis.AudioContext = class {constructor() {deviceRequests++; throw Error('Offline DSP opened an audio device');}};
globalThis.webkitAudioContext = globalThis.AudioContext;
globalThis.fetch = () => {throw Error('Offline DSP requested network data');};
const module = factory({wasmBinary:await readFile(runtimeAssetUrl('generated/scsp_wasm.wasm'))});
const instruments = [];
async function instrument(pcm) {
  const core = await Scsp.create({moduleFactory:() => module});
  const synth = new ScspSynth(core);
  instruments.push(synth);
  const sample = synth.loadPCM(pcm, {baseFrequencyHz:44100 / pcm.length, loopStartSamples:0});
  synth.setPreset(0, {sample, frequencyHz:sample.rootFrequencyHz, directLevel:0, dspSend:7});
  return {core, synth, sample};
}
const gain = assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0\n001: EWT=1 ZERO=1');
const iir = assembleScspDsp('000: TRA=1 YSEL=1 ZERO=1 COEF=1\n001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2\n002: TWT=1 EWT=1 ZERO=1');
const reference = (pcm, feedback, input, initial = 0) => {
  let state = initial;
  const left = Float32Array.from(pcm, sample => {
    state = Math.max(-0x800000, Math.min(0x7fffff,
      Math.floor(state * feedback / 4096) + Math.floor(sample * 256 * input / 4096)));
    return Math.floor(state / 256) / 32768;
  });
  return {left, state};
};

try {
  const gainPcm = new Int16Array(64);
  gainPcm.set([0, 4096, -4096, 16384, -16384, 8192, -8192, 0]);
  const a = await instrument(gainPcm);
  const ram = a.core.readRam(), used = a.synth.getState().ramUsedBytes;
  a.synth.applyDspProgram(Object.freeze(Array.from(gain)), {coefficients:{0:2048, 1:0, 2:0}});
  a.synth.setDspReturn({level:7, pan:0});
  a.synth.keyOn(0);
  const output = a.synth.generateStereo(gainPcm.length);
  const expected = Float32Array.from(gainPcm, value => Math.floor(value / 2) / 32768);
  assert.deepEqual(output.left, expected);
  assert.deepEqual(output.right, expected);
  assert.deepEqual(a.core.readRam(), ram);
  assert.equal(a.synth.getState().ramUsedBytes, used);
  assert.equal(a.core.read(0x402), 0);

  a.synth.setDspReturn({pan:31});
  a.synth.setMix(0, {pan:15});
  a.synth.keyOn(0);
  const panned = a.synth.generateStereo(64);
  assert(panned.left.some(value => value !== 0));
  assert(panned.right.every(value => value === 0));
  a.synth.setMix(0, {dspSend:0});
  assert(a.synth.generateStereo(128).left.every(value => value === 0));

  const impulse = new Int16Array(2048);
  impulse[1] = 16384;
  const b = await instrument(impulse);
  b.synth.applyDspProgram(iir, {coefficients:{0:0, 1:3840, 2:256}});
  b.synth.setDspReturn({level:7});
  b.synth.keyOn(0);
  const first = reference(impulse.subarray(0,16), 3840, 256);
  assert.deepEqual(b.synth.generateStereo(16).left, first.left);
  const revision = b.synth.getDspProgram().revision;
  assert.deepEqual(b.synth.setDspCoefficients({1:3072, 2:1024}), {codes:[0,3072,1024]});
  const second = reference(impulse.subarray(16,80), 3072, 1024, first.state);
  const continued = b.synth.generateStereo(64);
  assert.deepEqual(continued.left, second.left);
  assert.deepEqual(continued.right, second.left);
  assert(b.synth.getState().slots[0].gate);
  assert.equal(b.synth.getDspProgram().revision, revision);
  b.synth.applyDspProgram(iir);
  const reapplied = reference(impulse.subarray(80,144), 3072, 1024, second.state);
  assert.deepEqual(b.synth.generateStereo(64).left, reapplied.left);
  assert(b.synth.getState().slots[0].gate);
  assert.deepEqual(b.synth.getDspCoefficients(), {codes:[0,3072,1024]});

  const snapshot = b.synth.getDspProgram();
  snapshot.words.fill(65535);
  snapshot.coefficients.codes.fill(-1);
  snapshot.return.level = 0;
  assert.deepEqual(b.synth.getDspCoefficients(), {codes:[0,3072,1024]});
  assert.deepEqual(b.synth.getDspProgram().words, Array.from(iir));
  const before = b.synth.getState(), beforeRam = b.core.readRam();
  for (const action of [
    () => b.synth.applyDspProgram(new Uint16Array(511)),
    () => b.synth.applyDspProgram(assembleScspDsp('001: MRD=1')),
    () => b.synth.applyDspProgram(assembleScspDsp('000: RAW0=0x8000')),
    () => b.synth.applyDspProgram(iir, {coefficients:{1:3840}}),
    () => b.synth.setDspCoefficients({2:4096}),
    () => b.synth.setDspCoefficients({3:1}),
    () => b.synth.setDspReturn({level:8}),
    () => b.synth.setMix(0, {dspSend:8}),
  ]) assert.throws(action);
  assert.deepEqual(b.synth.getState(), before);
  assert.deepEqual(b.core.readRam(), beforeRam);
  const afterRejection = reference(impulse.subarray(144,208), 3072, 1024, reapplied.state);
  assert.deepEqual(b.synth.generateStereo(64).left, afterRejection.left);
  assert.throws(() => a.synth.setPreset(0, {sample:b.sample}), /another bank/);
  assert.notDeepEqual(a.synth.getDspProgram(), b.synth.getDspProgram());

  const c = await instrument(impulse);
  c.synth.applyDspProgram(iir, {coefficients:{0:0, 1:3840, 2:256}});
  c.synth.setDspReturn({level:7});
  c.synth.keyOn(0);
  const initial = c.synth.generateStereo(32).left, setup = c.synth.getDspProgram();
  c.synth.stopVoices();
  assert.deepEqual(c.synth.getDspProgram(), setup);
  assert(c.synth.generateStereo(128).left.every(value => value === 0));
  c.synth.keyOn(0);
  assert.deepEqual(c.synth.generateStereo(32).left, initial);
  c.synth.reset();
  assert.equal(c.synth.getState().dsp, undefined);
  assert.equal(c.synth.getState().samples[0], c.sample);
  assert.equal(c.synth.getDspProgram().configured, false);
  assert(c.synth.getDspProgram().words.every(value => value === 0));
  c.synth.reset({clearRam:true});
  assert.throws(() => c.synth.setPreset(0, {sample:c.sample}), /another bank/);
  assert.equal(c.synth.getState().ramUsedBytes, 0);

  const {runDspExamples} = await import('./node_modules/tetorica-fm2612/examples/scsp-dsp/execution.mjs');
  const renderedExamples = await runDspExamples();
  assert.equal(renderedExamples.sampleRate, 44100);
  for (const kind of ['gain', 'iir']) {
    const example = renderedExamples[kind];
    assert.equal(example.kind, kind);
    assert.equal(example.frames, 512);
    assert(example.actual instanceof Float32Array);
    assert(example.reference instanceof Float32Array);
    assert.deepEqual(example.actual, example.reference);
    assert.equal(example.exact, true);
    assert.equal(example.maxError, 0);
    assert.equal(example.ramUnchanged, true);
    assert(example.peak > 0 && example.peak < .2);
  }
  assert.equal(deviceRequests, 0);
  console.log('Installed SCSP DSP execution verified through both Synth subpaths, exact Gain/IIR PCM, live history, routing, atomic rejection, ownership and Stop/reset.');
} finally {
  for (const synth of instruments) synth.dispose();
}
`);
  execFileSync(process.execPath, [destination], {cwd:consumer, stdio:'inherit'});
  const output = execFileSync(process.execPath, [join(consumer,
    'node_modules/tetorica-fm2612/examples/scsp-dsp/execution.mjs')], {cwd:consumer, encoding:'utf8'});
  assert.match(output, /SCSP DSP execution: PASS/);
  console.log(output);
}
