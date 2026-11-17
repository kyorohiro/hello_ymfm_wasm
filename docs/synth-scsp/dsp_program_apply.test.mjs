import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { Pcm44100Resampler } from '../js/pcm_44100_resampler.js';
import { DspDelay, DSP_RAM_BYTES, delayProgram } from './dsp.js';
import { SynthInstrument } from './instrument.js';

const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
let module;
async function core(t) {
  module ??= factory({ wasmBinary: binary });
  const value = await Scsp.create({ moduleFactory: () => module });
  t.after(() => value.dispose());
  return value;
}
const mpro = core => Array.from({ length: 512 }, (_, index) => core.read(0x800 + index * 2));
function changedProgram() {
  const words = delayProgram();
  words[3 * 4 + 2] &= ~0x1000; // Remove the wet EFREG0 write.
  words[504] = 0x0081; // Nonzero step126 first word also verifies Start preservation.
  return words;
}
function legacyInstall(core, settings) {
  core.write(22, 0, 0xff);
  for (let offset = 0; offset < 1024; offset += 2) core.write(0x800 + offset, 0);
  core.write(0x402, 2 << 7);
  core.write(0x700, 0x7ff8);
  core.write(0x704, 0x7ff8);
  core.write(0x782, 0);
  const words = delayProgram();
  for (let index = 0; index < words.length; index++) {
    if (words[index]) core.write(0x800 + index * 2, words[index]);
  }
  core.write(0xbf0, 0);
  const ring = new Uint8Array(DSP_RAM_BYTES);
  for (let index = 0; index < ring.length; index += 2) ring[index] = 0x60;
  core.loadRam(ring, 0);
  core.write(0x702, Math.floor(settings.feedback * 4096) * 8);
  core.write(0x780, Math.round(settings.timeMs * 44.1));
  core.write(22, settings.enabled ? settings.returnLevel << 5 : 0, 0xff);
}

test('default install keeps the legacy register transaction and exact rendered PCM', async t => {
  const record = () => ({
    operations: [],
    write(...args) { this.operations.push(['write', ...args]); },
    loadRam(bytes, address) { this.operations.push(['loadRam', Array.from(bytes), address]); },
  });
  const first = record(), second = record();
  const effect = new DspDelay(first);
  legacyInstall(second, effect.settings);
  assert.deepEqual(first.operations, second.operations);

  const a = new SynthInstrument(await core(t)), b = new SynthInstrument(await core(t));
  for (const instrument of [a, b]) instrument.setEffect({ enabled: true, timeMs: 20 });
  legacyInstall(b.core, b.config.effect);
  for (const instrument of [a, b]) instrument.noteOn('held', 69);
  assert.deepEqual(a.synth.generateStereo(16384), b.synth.generateStereo(16384));
});

test('Apply changes only the primary DSP, preserving held Code/keyboard state and allocated PCM', async t => {
  const instrument = new SynthInstrument(await core(t));
  instrument.setEffect({ enabled: true, timeMs: 20, returnLevel: 7 });
  const { session } = instrument.beginCode();
  instrument.code(session, 'noteOn', [0, 'A4']);
  instrument.noteOn('keyboard', 60);
  instrument.synth.generateStereo(4096);
  const before = instrument.read(), outside = instrument.core.readRam(DSP_RAM_BYTES);
  const returnBefore = instrument.core.read(22), settings = { ...instrument.effect.settings };
  const registers = [0x402, 0x700, 0x702, 0x704, 0x780, 0x782].map(offset => instrument.core.read(offset));
  const words = changedProgram();
  const result = instrument.applyDspProgram(words);
  assert.equal(result.custom, true);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.words, Array.from(words));
  assert.deepEqual(instrument.read(), before);
  assert.deepEqual(instrument.effect.settings, settings);
  assert.deepEqual(instrument.core.readRam(DSP_RAM_BYTES), outside);
  assert.deepEqual([0x402, 0x700, 0x702, 0x704, 0x780, 0x782].map(offset => instrument.core.read(offset)), registers);
  assert.equal(instrument.core.read(22), returnBefore);
  assert.deepEqual(mpro(instrument.core), Array.from(words));
  assert(instrument.core.readRam(0, DSP_RAM_BYTES).every((value, index) => value === (index % 2 ? 0 : 0x60)));
  assert(instrument.synth.generateStereo(4096).left.some(value => value !== 0));
  assert.deepEqual(instrument.core.readRam(DSP_RAM_BYTES), outside);
  assert.equal(instrument.code(session, 'setNote', [0, 'C5']) > 0, true);
  words[0] = 1;
  result.words[0] = 2;
  assert.equal(instrument.readDspProgram().words[0], 0);
});

test('changed EWT routing changes actual wet audio without replacing the dry voice', async t => {
  const a = new SynthInstrument(await core(t)), b = new SynthInstrument(await core(t));
  for (const instrument of [a, b]) {
    instrument.setEffect({ enabled: true, timeMs: 20, returnLevel: 7 });
    instrument.noteOn('held', 69);
    instrument.synth.generateStereo(4096);
  }
  b.applyDspProgram(changedProgram());
  assert.notDeepEqual(a.synth.generateStereo(4096), b.synth.generateStereo(4096));
  assert.deepEqual(a.read().voiceGroups, b.read().voiceGroups);
});

test('invalid Apply performs zero writes, equal Apply preserves the ring, and caller data is copied', async t => {
  const instrument = new SynthInstrument(await core(t));
  instrument.noteOn('held', 69);
  instrument.synth.generateStereo(4096);
  const hardware = instrument.core, ring = hardware.readRam(0, DSP_RAM_BYTES), metadata = instrument.readDspProgram();
  let writes = 0, loads = 0;
  const write = hardware.write.bind(hardware), load = hardware.loadRam.bind(hardware);
  hardware.write = (...args) => { writes++; return write(...args); };
  hardware.loadRam = (...args) => { loads++; return load(...args); };
  const invalid = delayProgram();
  invalid[4] = 0x8000;
  assert.throws(() => instrument.applyDspProgram(invalid), /RAW0/);
  assert.deepEqual(instrument.applyDspProgram(metadata.words), metadata);
  assert.equal(writes, 0);
  assert.equal(loads, 0);
  assert.deepEqual(hardware.readRam(0, DSP_RAM_BYTES), ring);
  assert.deepEqual(instrument.readDspProgram(), metadata);
  hardware.write = write;
  hardware.loadRam = load;
});

test('one-shot partial write or ring upload failure restores MPRO, ring, return and same-phase PCM', async t => {
  for (const kind of ['write', 'loadRam']) {
    const a = new SynthInstrument(await core(t)), b = new SynthInstrument(await core(t));
    for (const instrument of [a, b]) {
      instrument.setEffect({ enabled: true, timeMs: 20, feedback: .7, returnLevel: 7 });
      instrument.noteOn('held', 69);
      instrument.synth.generateStereo(4096);
    }
    const before = { state: a.read(), program: a.readDspProgram(), ram: a.core.readRam(), words: mpro(a.core), outputReturn: a.core.read(22) };
    const original = a.core[kind].bind(a.core);
    let calls = 0;
    a.core[kind] = (...args) => {
      const result = original(...args);
      if (++calls === (kind === 'write' ? 133 : 1)) throw new Error(`Injected ${kind} failure after mutation`);
      return result;
    };
    assert.throws(() => a.applyDspProgram(changedProgram()), /Injected/);
    a.core[kind] = original;
    assert.deepEqual(a.read(), before.state);
    assert.deepEqual(a.readDspProgram(), before.program);
    assert.deepEqual(a.core.readRam(), before.ram);
    assert.deepEqual(mpro(a.core), before.words);
    assert.equal(a.core.read(22), before.outputReturn);
    assert.deepEqual(a.synth.generateStereo(4096), b.synth.generateStereo(4096));
  }
});

test('Stop, mode changes, preset and idle reloads reinstall the current image including Start word504', async t => {
  const instrument = new SynthInstrument(await core(t)), words = changedProgram();
  instrument.applyDspProgram(words);
  const expected = instrument.readDspProgram(), patch = instrument.exportPatch();
  for (const reload of [
    () => instrument.stopVoices(),
    () => instrument.setConfig({ mode: 'fm2' }),
    () => instrument.loadPatch(patch),
    () => instrument.loadIdleState(instrument.exportIdleState()),
  ]) {
    reload();
    assert.deepEqual(instrument.readDspProgram(), expected);
    assert.deepEqual(mpro(instrument.core), expected.words);
  }
  const legacy = instrument.applyDspProgram(delayProgram());
  assert.equal(legacy.custom, false);
  assert.equal(legacy.revision, 2);
});

async function processor(t) {
  const source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
  let Class;
  const messages = [];
  vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
    factory, Scsp, Pcm44100Resampler, SynthInstrument, Float32Array, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor(_name, value) { Class = value; },
  });
  const value = new Class({ processorOptions: { wasmBinary: binary } });
  await value.ready;
  t.after(() => value.port.onmessage({ data: { method: 'dispose' } }));
  return {
    value, messages,
    async command(method, args = []) {
      value.port.onmessage({ data: { id: 1, method, args } });
      await value.ready;
      await Promise.resolve();
      return messages.at(-1);
    },
  };
}

test('processor revalidates primary-only program commands and leaves audition and Code endpoint independent', async t => {
  const owner = await processor(t), primary = owner.value.instrument, audition = owner.value.audition;
  const before = { state: audition.read(), program: audition.readDspProgram(), ram: audition.core.readRam(), words: mpro(audition.core) };
  const { session } = (await owner.command('beginCode')).value;
  assert(!(await owner.command('code', [session, 'noteOn', [0, 'A4']])).error);
  assert(!(await owner.command('applyDspProgram', [Array.from(changedProgram())])).error);
  assert.equal(primary.codeActive, true);
  assert.equal((await owner.command('readDspProgram')).value.custom, true);
  assert.deepEqual(audition.read(), before.state);
  assert.deepEqual(audition.readDspProgram(), before.program);
  assert.deepEqual(audition.core.readRam(), before.ram);
  assert.deepEqual(mpro(audition.core), before.words);
  assert.match((await owner.command('code', [session, 'applyDspProgram', [Array.from(delayProgram())]])).error, /Unknown SCSP Code method/);
  const invalid = Array.from(delayProgram());
  invalid[4] = 0x8000;
  assert.match((await owner.command('applyDspProgram', [invalid])).error, /RAW0/);
  assert.equal(primary.readDspProgram().custom, true);
});

test('unrecoverable rollback terminates the audio owner with a fatal message and keeps last acknowledged metadata', async t => {
  const owner = await processor(t), instrument = owner.value.instrument;
  const before = instrument.readDspProgram(), write = instrument.core.write.bind(instrument.core);
  instrument.core.write = (...args) => {
    if (args[0] >= 0x800) throw new Error('Persistent injected MPRO write failure');
    return write(...args);
  };
  const result = await owner.command('applyDspProgram', [Array.from(changedProgram())]);
  assert.equal(result.name, 'ScspDspRollbackError');
  assert(owner.messages.some(message => message.fatal && /rollback/.test(message.error)));
  assert.equal(owner.value.dead, true);
  assert.equal(owner.value.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  assert.deepEqual(instrument.readDspProgram(), before);
});
