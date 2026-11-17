// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';

const capabilities = {chip: 'scsp', fmChannels: 0, psg: false, dac: false};

// Evaluate the same checks through each production source-evaluation entry.
// This function deliberately depends only on the supplied public bindings.
function inspectCodec(assembleScspDsp, disassembleScspDsp, pg) {
  const check = (value, message) => {if (!value) throw Error(message);};
  const fails = (callback, pattern) => {
    let error;
    try {callback();} catch (caught) {error = caught;}
    check(error && pattern.test(error.message), 'Missing codec diagnostic');
  };
  check(assembleScspDsp === pg.assembleScspDsp, 'Different global/pg assembler');
  check(disassembleScspDsp === pg.disassembleScspDsp, 'Different global/pg disassembler');

  const source = '003: TRA=37 TWT=1 TWA=12 XSEL=1 YSEL=2 IRA=32 IWT=1 IWA=3 EWT=1 EWA=5 SHIFT=2 ZERO=1 BSEL=1 COEF=63 MASA=31 ADREB=1 NXADR=1';
  const words = assembleScspDsp(source);
  check(words instanceof Uint16Array && words.length === 512, 'Expected synchronous 512-word image');
  const vector = Array.from(words.subarray(12, 16));
  check(JSON.stringify(vector) === JSON.stringify([0x258c, 0xc823, 0x1523, 0x7e7f]), 'Physical word positions changed');
  check(words.subarray(0, 12).every(word => word === 0), 'Leading positions changed');
  check(words.subarray(16).every(word => word === 0), 'Trailing positions changed');
  const text = disassembleScspDsp(words);
  check(typeof text === 'string' && text.startsWith('000:\n001:\n002:\n003:'), 'Instruction positions changed');
  check(assembleScspDsp(text).every((word, index) => word === words[index]), 'Position round trip changed');

  const fullText = disassembleScspDsp(words, {includeTrailingZeros: true});
  check(fullText.trimEnd().split('\n').length === 128, 'Full image lost instructions');
  const raw = Uint16Array.from({length: 512}, (_, index) => (index * 997 + 0x8000) & 0xffff);
  const before = raw.slice();
  const rawText = disassembleScspDsp(raw);
  check(rawText.includes('RAW0=0x8000'), 'Opaque bits lost');
  check(assembleScspDsp(rawText).every((word, index) => word === before[index]), 'RAW round trip changed');
  check(raw.every((word, index) => word === before[index]), 'Input words mutated');
  check(disassembleScspDsp(Object.freeze(Array.from(raw))) === rawText, 'Readonly word input changed');
  const owned = assembleScspDsp('127: NXADR=1');
  const again = assembleScspDsp('127: NXADR=1');
  owned[511] = 0;
  check(again[511] === 1, 'Assembler returned shared storage');
  fails(() => assembleScspDsp('; header\n\n004: COEF=64'), /Line 3: COEF/);
  fails(() => assembleScspDsp('004:\n003:'), /strictly increasing/);
  fails(() => disassembleScspDsp(new Uint16Array(511)), /512/);
  fails(() => disassembleScspDsp(words, {includeTrailingZeros: 1}), /boolean/);
  return {wordCount: words.length, vector, fullInstructions: 128, rawRoundTrip: true};
}

const inspectSource = `
  context.assemble = assembleScspDsp;
  context.disassemble = disassembleScspDsp;
  context.report = (${inspectCodec.toString()})(assembleScspDsp, disassembleScspDsp, pg);
`;
const expectedReport = {wordCount: 512, vector: [0x258c, 0xc823, 0x1523, 0x7e7f], fullInstructions: 128, rawRoundTrip: true};

function createMainFixture(t, createPlaygroundRuntime) {
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = {addEventListener() {}, removeEventListener() {}, setTimeout};
  const media = () => ({stop() {}, stopAll() {}, pause() {}, list: () => [], unload() {}});
  const synth = {
    capabilities, state: 'idle', audioContext: {currentTime: 0}, primaryEndpoints: [],
    fm: {setPreset() {calls.push('setPreset');}, noteOff() {calls.push('noteOff');}}, psg: {},
    sample: media(), stream: media(), clearFXChain: () => [],
    async start() {calls.push('start'); this.state = 'ready';},
    async resume() {calls.push('resume');}, async close() {calls.push('close');},
    stopAllNative() {calls.push('stopAllNative');},
  };
  const runtime = createPlaygroundRuntime({synth, guardExecution: false});
  t.after(async () => {
    await runtime.finalize();
    globalThis.window = previousWindow;
  });
  return {runtime, calls};
}

// Adapt only WorkerGlobalScope plumbing and a test-owned retained reference.
// Runtime guards, source evaluation and all production messaging stay active.
async function createWorkerFixture(t, url) {
  const worker = new Worker(`
    const {parentPort} = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
    import(${JSON.stringify(url.href)}).then(() => {
      parentPort.on('message', data => {
        if (data.testRetained) {
          const words = globalThis.testRetainedAssembler('127: NXADR=1');
          parentPort.postMessage({testRetained: {words: words.length, last: words[511]}});
        } else self.onmessage({data});
      });
      parentPort.postMessage({testReady: true});
    });
  `, {eval: true});
  const messages = [];
  const waiters = new Set();
  let failure;
  worker.on('message', message => {
    messages.push(message);
    for (const notify of waiters) notify();
  });
  worker.on('error', error => {
    failure = error;
    for (const notify of waiters) notify();
  });
  t.after(() => worker.terminate());
  const waitFor = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('Worker result timed out')), 10000);
    const finish = error => {
      clearTimeout(timer);
      waiters.delete(notify);
      if (error) reject(error); else resolve(messages.find(predicate));
    };
    const notify = () => {
      const error = messages.find(message => message.type === 'execution-error');
      if (failure || error) finish(failure ?? Error(error.message));
      else if (messages.some(predicate)) finish();
    };
    waiters.add(notify);
    notify();
  });
  await waitFor(message => message.testReady);
  return {worker, messages, waitFor};
}

for (const directory of ['tetorica_src/runtime', 'docs/js']) {
  const moduleUrl = name => new URL(`../../${directory}/${name}`, import.meta.url);

  test(`${directory} Main exposes direct SCSP DSP helpers and retains pure calls after Stop`, async t => {
    const {createPlaygroundRuntime} = await import(moduleUrl('playground_runtime.js'));
    const codec = await import(moduleUrl('scsp_dsp_assembler.js'));
    const {runtime, calls} = createMainFixture(t, createPlaygroundRuntime);
    await runtime.playSource(inspectSource);
    assert.deepEqual(runtime.context.report, expectedReport);
    assert.equal(runtime.context.assemble, codec.assembleScspDsp);
    assert.equal(runtime.context.disassemble, codec.disassembleScspDsp);
    assert.equal(calls.filter(call => call === 'start').length, 1, 'Run retains existing audio preparation');
    const retainedAssembler = runtime.context.assemble;
    const retainedDisassembler = runtime.context.disassemble;
    await runtime.stopWithFade();
    const afterStop = calls.slice();
    assert.deepEqual(inspectCodec(retainedAssembler, retainedDisassembler, codec), expectedReport);
    assert.deepEqual(calls, afterStop, 'Pure helper calls must not access audio or chip transport');
  });

  test(`${directory} shared Code exposes direct SCSP DSP helpers without chip access`, async t => {
    const {createPlaygroundCodeRuntime} = await import(moduleUrl('playground_code_runtime.js'));
    const codec = await import(moduleUrl('scsp_dsp_assembler.js'));
    let preparations = 0, chipLookups = 0;
    const runtime = createPlaygroundCodeRuntime({
      ensureReady: async () => {preparations++;}, now: () => 0,
      useSoundChip: async () => {chipLookups++; throw Error('Unexpected chip lookup');},
      supportedSoundChips: ['scsp'], guardExecution: false, createTaskChannel: () => null,
    });
    t.after(() => runtime.stop());
    await runtime.run(inspectSource);
    const context = runtime.getContext();
    assert.deepEqual(context.report, expectedReport);
    assert.equal(context.assemble, codec.assembleScspDsp);
    assert.equal(context.disassemble, codec.disassembleScspDsp);
    assert.equal(preparations, 1, 'Run retains existing ensureReady policy');
    const retainedAssembler = context.assemble, retainedDisassembler = context.disassemble;
    await runtime.stop();
    const stoppedState = runtime.getState();
    assert.deepEqual(inspectCodec(retainedAssembler, retainedDisassembler, codec), expectedReport);
    assert.deepEqual(runtime.getState(), stoppedState, 'Pure helpers must not alter lifecycle state');
    assert.equal(preparations, 1);
    assert.equal(chipLookups, 0);
  });

  test(`${directory} actual logic Worker evaluates SCSP DSP helpers without RPC or audio commands`, async t => {
    const {worker, messages, waitFor} = await createWorkerFixture(t, moduleUrl('playground_logic_worker.js'));
    worker.postMessage({type: 'run', capabilities, sourceCode: `${inspectSource}
      globalThis.testRetainedAssembler = assembleScspDsp;
      console.log(JSON.stringify(context.report));
    `});
    await waitFor(message => message.type === 'complete');
    const log = messages.find(message => message.type === 'command' && message.command === 'log');
    assert.deepEqual(JSON.parse(log.args[0]), expectedReport);
    assert.deepEqual(messages.filter(message => message.type === 'request'), []);
    assert.deepEqual(messages.filter(message => message.type === 'command').map(message => message.command), ['log']);
    assert.equal(messages.find(message => message.type === 'complete').scheduledReservationCount, 0);
    worker.postMessage({type: 'stop'});
    await waitFor(message => message.type === 'stopped');
    const afterStop = messages.length;
    worker.postMessage({testRetained: true});
    const retained = await waitFor(message => message.testRetained);
    assert.deepEqual(retained.testRetained, {words: 512, last: 1});
    assert.deepEqual(messages.slice(afterStop), [retained], 'Retained helper adds no transport or lifecycle messages');
  });
}
