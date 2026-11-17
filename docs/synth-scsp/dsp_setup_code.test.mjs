// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { Pcm44100Resampler } from '../js/pcm_44100_resampler.js';
import { SynthInstrument } from './instrument.js';
import { createScspCodeClient, SCSP_CODE_METHODS } from './code_endpoint.js';
import { createScspDspExample } from './dsp_examples.js';
import { createScspDspSetupCode } from './dsp_setup_code.js';

const wasmBinary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const processorSource = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let compiledModule;

async function instrument(t) {
  compiledModule ??= factory({ wasmBinary });
  const owner = new SynthInstrument(await Scsp.create({ moduleFactory: () => compiledModule }));
  t.after(() => owner.dispose());
  return owner;
}

function client(owner) {
  const metadata = owner.beginCode();
  return createScspCodeClient({
    metadata,
    isCurrent: () => owner.codeActive && owner.codeSession === metadata.session,
    invoke: async (method, args) => owner.code(metadata.session, method, args),
    dispose: async () => owner.endCode(metadata.session),
  });
}

const programOptions = codes => ({ coefficients: { 0: codes[0], 1: codes[1], 2: codes[2] } });
const nativeWords = owner => Array.from({ length: 512 }, (_, index) => owner.core.read(0x800 + index * 2));
const nativeCoefficients = owner => [0, 1, 2].map(index => owner.core.read(0x700 + index * 2));

test('acknowledged DSP setup snapshots are consistent, detached and free of native writes or rendering', async t => {
  const owner = await instrument(t), example = createScspDspExample('iir1-lowpass');
  owner.applyDspProgram(example.words, programOptions([1234, 3500, 596]));
  owner.setEffect({ enabled: true, timeMs: 173, feedback: 3500 / 4096, send: 5, returnLevel: 4 });
  owner.noteOn('keyboard', 60);
  const borrowed = client(owner);
  await borrowed.noteOn(0, 'A4');
  owner.synth.generateStereo(512);
  const before = owner.read(), ram = owner.core.readRam(), words = nativeWords(owner);
  const frames = owner.core.nativeFrames;
  let writes = 0;
  const write = owner.core.write.bind(owner.core);
  owner.core.write = (...args) => { writes++; return write(...args); };
  const snapshot = owner.readDspSetup();
  assert.deepEqual(snapshot.words, Array.from(example.words));
  assert.deepEqual(snapshot.coefficients, { codes: [1234, 3500, 596], feedback: 3500 / 4096 });
  assert.deepEqual(snapshot.effect, before.config.effect);
  assert.equal(writes, 0);
  assert.equal(owner.core.nativeFrames, frames);
  assert.deepEqual(owner.core.readRam(), ram);
  assert.deepEqual(nativeWords(owner), words);
  assert.deepEqual(owner.read(), before);
  assert.throws(() => owner.readDspSetup(1), /takes no arguments/);
  snapshot.words.fill(0);
  snapshot.coefficients.codes.fill(0);
  snapshot.coefficients.feedback = 0;
  snapshot.effect.feedback = 0;
  assert.deepEqual(owner.readDspSetup().words, Array.from(example.words));
  assert.deepEqual(owner.readDspSetup().coefficients.codes, [1234, 3500, 596]);
  assert.equal(owner.readDspSetup().effect.feedback, 3500 / 4096);
  assert(!SCSP_CODE_METHODS.includes('readDspSetup'));
});

test('saved Code round-trips Delay, FIR, IIR and custom programs through the real borrowed API', async t => {
  for (const id of ['delay', 'fir2-lowpass', 'fir2-highpass', 'iir1-lowpass', 'custom']) {
    await t.test(id, async t => {
      const sourceOwner = await instrument(t), target = await instrument(t);
      const example = createScspDspExample(id === 'custom' ? 'iir1-lowpass' : id);
      if (id === 'custom') example.words[0] ^= 0x0100;
      const codes = id === 'custom' ? [-4096, -2048, 3072] : example.codes;
      sourceOwner.applyDspProgram(example.words, programOptions(codes));
      sourceOwner.setEffect({ enabled: true, timeMs: 137, send: 6, returnLevel: 5 });
      const snapshot = sourceOwner.readDspSetup(), before = structuredClone(snapshot);
      const text = createScspDspSetupCode(snapshot);
      assert.equal(text, createScspDspSetupCode(snapshot), 'export is deterministic');
      assert.deepEqual(snapshot, before);
      assert.match(text, /scsp\.compileDsp\(`/);
      assert.match(text, /000: /);
      assert.match(text, /await scsp\.applyDspProgram\(program, \{/);
      assert.match(text, /await scsp\.setEffect\(\{/);
      assert(!/liveLoop|noteOn|loadPCM|fetch\(/.test(text));
      const borrowed = client(target);
      await new AsyncFunction('useSoundChip', text)(async chip => {
        assert.equal(chip, 'scsp');
        return borrowed;
      });
      const restored = target.readDspSetup();
      assert.deepEqual(restored.words, snapshot.words);
      assert.deepEqual(restored.coefficients, snapshot.coefficients);
      assert.deepEqual(restored.effect, snapshot.effect);
      assert.deepEqual(nativeWords(target), nativeWords(sourceOwner));
      assert.deepEqual(nativeCoefficients(target), nativeCoefficients(sourceOwner));
      assert.equal(target.read().voiceGroups.length, 0, 'restoring setup performs no notes');
      for (const owner of [sourceOwner, target]) {
        owner.synth.setMix(0, { directLevel: 0, totalLevel: 0 });
        owner.noteOn('same-input', 69);
      }
      const expected = sourceOwner.synth.generateStereo(8192);
      const actual = target.synth.generateStereo(8192);
      assert.deepEqual(actual, expected);
      assert(actual.left.every(Number.isFinite));
      assert(actual.right.every(Number.isFinite));
      assert(actual.left.some(value => value !== 0));
    });
  }
});

test('saved setup preserves requested Feedback values together with their quantized coefficient words', async t => {
  const sourceOwner = await instrument(t), target = await instrument(t);
  const borrowed = client(target);
  for (const feedback of [0.35, -0.123456, -1, 4095 / 4096]) {
    sourceOwner.setEffect({ feedback });
    const snapshot = sourceOwner.readDspSetup();
    const text = createScspDspSetupCode(snapshot);
    await new AsyncFunction('useSoundChip', text)(async () => borrowed);
    const restored = target.readDspSetup();
    assert.equal(restored.effect.feedback, feedback);
    assert.equal(restored.coefficients.feedback, feedback);
    assert.equal(restored.coefficients.codes[1], Math.floor(feedback * 4096));
    assert.deepEqual(nativeCoefficients(target), nativeCoefficients(sourceOwner));
  }
});

test('two-bus setup Code restores independent returns and inherited versus explicit routing', async t => {
  const sourceOwner = await instrument(t), target = await instrument(t);
  const example = createScspDspExample('routing-gain-iir');
  sourceOwner.applyDspProgram(example.words, programOptions(example.codes));
  sourceOwner.setEffect({enabled:true, send:6, returnLevel:7});
  sourceOwner.setDspSourceSend(0, {input:1,level:5});
  sourceOwner.setDspSend(30, {input:0,level:7});
  sourceOwner.setDspSend(31, {input:1,level:7});
  sourceOwner.setDspReturn(0, {level:7,pan:31});
  sourceOwner.setDspReturn(1, {level:6,pan:15});
  target.setDspSourceSend(5, {input:1,level:2});
  target.setDspSend(29, {input:1,level:1});
  const snapshot = sourceOwner.readDspSetup(), before = structuredClone(snapshot);
  const source = createScspDspSetupCode(snapshot);
  assert.deepEqual(snapshot, before);
  assert.match(source, /setDspSourceSend\(5, null\)/);
  assert.match(source, /setDspSend\(29, null\)/);
  assert.match(source, /setDspReturn\(1, \{"level":6,"pan":15\}\)/);
  const borrowed = client(target);
  await new AsyncFunction('useSoundChip',source)(async()=>borrowed);
  assert.deepEqual(target.readDspSetup(), snapshot);
  for (const owner of [sourceOwner,target]) {
    // Inherited defaults still follow later global Send edits after restore.
    owner.setEffect({send:3});
    for (const slot of [30,31]) {
      owner.physicalNoteOn('same-'+slot,slot,57);
      owner.invokePhysical('setMix',[slot,{directLevel:0}]);
    }
  }
  assert.deepEqual(target.readDspRoutingOverrides(), sourceOwner.readDspRoutingOverrides());
  assert.equal(target.readDspRouting().slots[29].level,3);
  assert.equal(target.readDspRouting().sources[0].level,5);
  const expected=sourceOwner.synth.generateStereo(4096),actual=target.synth.generateStereo(4096);
  assert.deepEqual(actual, expected);
  assert.notDeepEqual(actual.left, actual.right);
  assert(actual.left.some(value=>value!==0));
  assert(actual.right.some(value=>value!==0));
});

test('two-bus setup rejects incomplete, sparse and inconsistent routing before emitting code', async t => {
  const owner=await instrument(t);
  owner.setDspSend(31,{input:1,level:7});owner.setDspReturn(1,{level:7,pan:15});
  const snapshot=owner.readDspSetup(),before=structuredClone(snapshot);
  for (const mutate of [
    value=>delete value.dspReturns,
    value=>value.dspReturns.push({level:0,pan:0}),
    value=>delete value.dspReturns[1],
    value=>value.dspReturns[0].level=0,
    value=>value.dspRoutingOverrides.slots[31].input=0,
    value=>delete value.dspRoutingOverrides.slots[0],
    value=>value.dspRoutingOverrides.sources[0]={input:2,level:7},
    value=>value.dspRouting.slots[0].level=8,
    value=>value.dspRouting.extra=true,
  ]) {
    const invalid=structuredClone(snapshot);mutate(invalid);
    assert.throws(()=>createScspDspSetupCode(invalid));
  }
  assert.deepEqual(owner.readDspSetup(),before);
});

test('invalid or inconsistent setup snapshots fail before generating executable source', async t => {
  const owner = await instrument(t), valid = owner.readDspSetup();
  const unsafeWords = [...valid.words];
  unsafeWords[0] |= 0x8000;
  const cases = [
    null, [], 12,
    { ...valid, words: unsafeWords },
    { ...valid, words: valid.words.slice(1) },
    { ...valid, coefficients: { ...valid.coefficients, codes: [1, 2] } },
    { ...valid, coefficients: { ...valid.coefficients, codes: [1, 2, 4096] } },
    { ...valid, coefficients: { ...valid.coefficients, codes: [1, 2, '3'] } },
    { ...valid, coefficients: { ...valid.coefficients, codes: [1, 2, 3] } },
    { ...valid, coefficients: { ...valid.coefficients, feedback: 0 } },
    { ...valid, effect: { ...valid.effect, feedback: 0 } },
    { ...valid, effect: { ...valid.effect, enabled: 'true' } },
    { ...valid, effect: { ...valid.effect, timeMs: 0 } },
    { ...valid, effect: { ...valid.effect, send: '7;globalThis.unexpected=true' } },
    { ...valid, effect: { ...valid.effect, returnLevel: 8 } },
    { ...valid, effect: { enabled: false } },
    { ...valid, effect: { ...valid.effect, unexpected: true } },
  ];
  for (const value of cases) assert.throws(() => createScspDspSetupCode(value));
  assert.deepEqual(owner.readDspSetup(), valid);
  assert.equal(globalThis.unexpected, undefined);
});

async function processor(t) {
  let Processor;
  const messages = [];
  vm.runInNewContext(processorSource.replace(/^import .*;\n/gm, ''), {
    factory, Scsp, Pcm44100Resampler, SynthInstrument, Float32Array,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: message => messages.push(message) }; }
    },
    registerProcessor(_name, value) { Processor = value; },
  });
  const owner = new Processor({ processorOptions: { wasmBinary } });
  await owner.ready;
  t.after(() => owner.port.onmessage({ data: { method: 'dispose' } }));
  let sequence = 0;
  return {
    owner,
    async command(method, args = []) {
      const id = ++sequence;
      owner.port.onmessage({ data: { id, method, args } });
      await owner.ready;
      await Promise.resolve();
      const reply = messages.find(message => message.id === id);
      assert(reply, 'processor replied to the command');
      return reply;
    },
  };
}

test('processor reads the primary setup in message order with one consistent coefficient and effect snapshot', async t => {
  const f = await processor(t), primary = f.owner.instrument, audition = f.owner.audition;
  const originalAudition = audition.readDspSetup(), auditionRam = audition.core.readRam();
  const example = createScspDspExample('fir2-highpass');
  await f.command('applyDspProgram', [example.words, programOptions(example.codes)]);
  const nativeFrames = primary.core.nativeFrames;
  const replies = await Promise.all([
    f.command('setDspCoefficients', [{ 1: -2048 }]),
    f.command('readDspSetup'),
    f.command('setEffect', [{ feedback: 0.25, send: 3 }]),
    f.command('readDspSetup'),
  ]);
  const first = replies[1].value, second = replies[3].value;
  assert.deepEqual(first.words, Array.from(example.words));
  assert.equal(first.coefficients.codes[1], -2048);
  assert.equal(first.effect.feedback, -0.5);
  assert.equal(first.coefficients.feedback, -0.5);
  assert.equal(second.coefficients.codes[1], 1024);
  assert.equal(second.effect.feedback, 0.25);
  assert.equal(second.coefficients.feedback, 0.25);
  assert.equal(second.effect.send, 3);
  assert.equal(primary.core.nativeFrames, nativeFrames);
  assert.deepEqual(audition.readDspSetup(), originalAudition);
  assert.deepEqual(audition.core.readRam(), auditionRam);
  const invalid = await f.command('readDspSetup', [1]);
  assert.match(invalid.error, /takes no arguments/);
  assert.deepEqual(primary.readDspSetup(), second);
});

test('processor routes new primary send / return commands without changing SSF audition', async t => {
  const f=await processor(t), audition=f.owner.audition;
  const before=audition.readDspSetup(), ram=audition.core.readRam();
  assert.deepEqual((await f.command('setDspSourceSend',[0,{input:1,level:5}])).value,{input:1,level:5});
  assert.deepEqual((await f.command('setDspSend',[31,{input:1,level:7}])).value,{input:1,level:7});
  assert.deepEqual((await f.command('setDspReturn',[1,{level:6,pan:15}])).value,{level:6,pan:15});
  const reply=await f.command('readDspSetup');
  assert.deepEqual(reply.value.dspRoutingOverrides.sources[0],{input:1,level:5});
  assert.deepEqual(reply.value.dspRoutingOverrides.slots[31],{input:1,level:7});
  assert.deepEqual(reply.value.dspReturns[1],{level:6,pan:15});
  assert.deepEqual((await f.command('setDspSend',[31,null])).value,{input:0,level:7});
  assert.deepEqual(audition.readDspSetup(),before);
  assert.deepEqual(audition.core.readRam(),ram);
});

test('processor routing ACKs capture allocation/source fanout atomically and keep legacy replies unchanged', async t => {
  const f=await processor(t);
  const legacy=await f.command('readDspProgram');
  assert.deepEqual(Object.keys(legacy),['id','value']);
  const send=await f.command('setDspSend',[6,{input:1,level:3}]);
  assert.deepEqual(send.value,{input:1,level:3});
  assert.deepEqual(send.dspRoutingState.overrides.slots[6],{input:1,level:3});
  const allocated=await f.command('noteOn',['keyboard',69]);
  assert.deepEqual(allocated.value.slots,[6]);
  assert.equal(allocated.dspRoutingState.overrides.slots[6],null);
  await f.command('setDspSend',[6,{input:1,level:5}]);
  const fanout=await f.command('setDspSourceSend',[0,{input:0,level:4}]);
  assert.deepEqual(fanout.value,{input:0,level:4});
  assert.deepEqual(fanout.dspRoutingState.overrides.sources[0],{input:0,level:4});
  assert.equal(fanout.dspRoutingState.overrides.slots[6],null);
  assert.deepEqual(fanout.dspRoutingState.returns,[{level:6,pan:0},{level:0,pan:0}]);
  const audition=await f.command('readAudition');
  assert.equal(Object.hasOwn(audition,'dspRoutingState'),false);
  const before=structuredClone(fanout.dspRoutingState);
  fanout.dspRoutingState.overrides.sources[0].level=0;
  assert.deepEqual(structuredClone((await f.command('readDspProgram')).dspRoutingState),before,'ACK data is detached');
  const reset=await f.command('loadPatch',[f.owner.instrument.exportPatch()]);
  assert.equal(reset.dspRoutingState,null,'an explicit transition to legacy clears the client memo');
  assert.equal(Object.hasOwn(await f.command('readDspProgram'),'dspRoutingState'),false);
});
