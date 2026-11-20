// Public Main / Worker clients connected to the canonical Worklets. The chip
// cores are silent spies: app-level tests already cover real WASM / audible PCM.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Worker, MessageChannel} from 'node:worker_threads';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';
import {createSegaPsgClient} from '../../tetorica_src/runtime/playground_segapsg.js';
import {createYm2413Client} from '../../tetorica_src/runtime/playground_ym2413.js';
import {createPsgTimedProcessor, psgTimedCommandCost} from '../../tetorica_src/runtime/segapsg_timed_processor.js';
import {createOpllTimedProcessor, opllTimedCommandCost} from '../../tetorica_src/runtime/ym2413_timed_processor.js';
import {PsgInspectorState, receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
import {Ym2413VoiceInspector} from '../../tetorica_src/runtime/playground_ym2413_inspector.js';
import {CHIP_CLOCKS, ChipClockResampler, validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';
import {createProcessorPerformance, performanceNoteRelease} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {createNativeGenesisMasterSystem} from '../../tetorica_src/runtime/native_genesis_master_system.js';
import {createNativeGenesisYm2413Endpoint} from '../../tetorica_src/runtime/native_genesis_extra_ym2413.js';

const constructors = {segapsg:createSegaPsgClient, ym2413:createYm2413Client};
const operationProcessor = {segapsg:createPsgTimedProcessor, ym2413:createOpllTimedProcessor};
const runtime = new URL('../../tetorica_src/runtime/', import.meta.url);

async function fixture(t, kind, rate = 48000) {
  let Type, frame = 0, ready;
  const coreWrites = [], operationFrames = [], clients = [];
  const chip = {
    reset() {}, dispose() {}, reserveStereoFrames() {}, setMuteMask() {}, setStereo() {},
    sampleRate: () => 49716,
    write(...args) {coreWrites.push(args);},
    generateStereo(frames) {return {left:new Float32Array(frames), right:new Float32Array(frames)};},
    generateStereoView(frames) {return this.generateStereo(frames);},
  };
  const factory = {create:async () => chip};
  const readyPromise = new Promise(resolve => {ready = resolve;});
  const timed = options => operationProcessor[kind]({...options, getState:() => structuredClone(options.getState())});
  const scope = {
    PsgInspectorState, receiveChipInspector, Ym2413VoiceInspector,
    CHIP_CLOCKS, ChipClockResampler, validateChipClock, performanceNoteRelease,
    createPsgTimedProcessor:timed, psgTimedCommandCost,
    createOpllTimedProcessor:timed, opllTimedCommandCost,
    createProcessorPerformance:options => createProcessorPerformance({...options, rate, nowFrame:() => frame}),
    SegaPSG:factory, Ym2413:factory, factory:{}, sampleRate:rate,
    AudioWorkletProcessor:class {constructor() {this.port = {postMessage:ready};}},
    registerProcessor(_name, Processor) {Type = Processor;},
  };
  const source = (await readFile(new URL(`playground_${kind}_worklet.js`, runtime), 'utf8'))
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '');
  vm.runInNewContext(source, scope);
  const processor = new Type({processorOptions:{wasmBinary:new ArrayBuffer(0)}});
  assert.equal((await readyPromise).ready, true);
  const apply = processor.timed.apply.bind(processor.timed);
  processor.timed.apply = (command, port, at, metadata) => {
    operationFrames.push({frame:at, method:command.operation.method, owner:metadata.owner});
    return apply(command, port, at, metadata);
  };
  t.after(() => {for (const api of clients) api.dispose(); if (!processor.dead) processor.dispose();});

  function connect(worker = false) {
    const sent = [], replies = [], listeners = new Set();
    let heldReplies = false;
    // Main uses onmessage and Worker uses addEventListener, as the supported
    // control transport permits either kind of MessagePort host.
    const port = {
      onmessage:null, start() {}, close() {},
      postMessage(message) {sent.push(structuredClone(message)); remote.onmessage({data:structuredClone(message)});},
      ...(worker ? {
        addEventListener(_type, listener) {listeners.add(listener);},
        removeEventListener(_type, listener) {listeners.delete(listener);},
      } : {}),
    };
    const deliver = reply => {
      const event = {data:structuredClone(reply)};
      if (worker) for (const listener of [...listeners]) listener(event);
      else port.onmessage?.(event);
    };
    const remote = {start() {}, close() {}, postMessage(reply) {
      if (heldReplies) replies.push(structuredClone(reply)); else deliver(reply);
    }};
    processor.port.onmessage({data:{port:remote, ...(worker ? {primaryWorker:true} : {})}});
    const api = constructors[kind](port);
    clients.push(api);
    return {api, port, sent,
      holdReplies() {heldReplies = true;},
      flushReplies() {heldReplies = false; for (const reply of replies.splice(0).reverse()) deliver(reply);},
    };
  }
  return {
    processor, coreWrites, operationFrames, connect, frame:() => frame,
    render(frames) {
      while (frames) {
        const count = Math.min(frames, 128);
        processor.process([], [[new Float32Array(count), new Float32Array(count)]]);
        frames -= count; frame += count;
      }
    },
  };
}

function program(api, kind) {
  return api.build(b => {
    b.atSample(0).noteOn(0, 'C4');
    if (kind === 'segapsg') b.atSample(441).setAttenuation(0, 6);
    else b.atSample(441).setUserOperator(0, {ar:10});
    b.atSeconds(0.02).noteOn(1, 'E4');
  });
}

for (const kind of ['segapsg', 'ym2413']) {
  for (const rate of [44100, 48000]) {
    test(`${kind}: serialized Main program executes from Worker at reference-sample offsets (${rate} Hz)`, async t => {
      const f = await fixture(t, kind, rate), main = f.connect(), worker = f.connect(true);
      const before = f.coreWrites.length;
      const operations = program(main.api, kind);
      assert.equal(f.coreWrites.length, before, 'build records without sending chip commands');
      const receipt = await worker.api.schedule(structuredClone(operations), {name:'cross-port'});
      assert.equal(receipt.startFrame, 128);
      f.render(receipt.startFrame);
      assert.equal(f.operationFrames.length, 0, 'reservation does not execute ahead of its anchor');
      f.render(Math.round(.02 * rate) + 1);
      assert.deepEqual(f.operationFrames.map(row => row.frame), [128, 128 + Math.round(.01 * rate), 128 + Math.round(.02 * rate)]);
      assert.deepEqual(f.operationFrames.map(row => row.method), operations.operations.map(row => row.method));
      const captured = await main.api.captureState();
      assert.equal(captured.sampleRate, rate);
      assert.equal(captured.frame, f.frame());
      assert(worker.sent.some(message => message.method === (kind === 'segapsg' ? 'psgTimed' : 'opllTimed') && message.id), 'Worker goes through acknowledged _requestControl transport');
    });
  }

  test(`${kind}: current/reset/reused baselines distinguish renderer and client state without replaying writes`, async t => {
    const f = await fixture(t, kind), {api:main} = f.connect(), {api:worker} = f.connect(true);
    if (kind === 'segapsg') main.setAttenuation(0, 4);
    else main.setUserOperator(0, {ar:6, dr:3});
    const snapshot = await main.captureState(), original = structuredClone(snapshot);
    const operations = main.build(b => kind === 'segapsg' ? b.keyOn(0) : b.setUserOperator(0, {dr:2}));
    const before = f.coreWrites.length;
    const a = await main.compile(operations, {initialState:snapshot});
    const aAgain = await main.compile(operations, {initialState:snapshot});
    assert.deepEqual(a, aAgain);
    assert.deepEqual(snapshot, original);
    assert.equal(f.coreWrites.length, before, 'compilation only updates its temporary state');
    if (kind === 'segapsg') worker.setAttenuation(0, 9);
    else worker.setUserOperator(0, {ar:12});
    const current = await main.compile(operations);
    const reset = await main.compile(operations, {initialState:'reset'});
    assert.notDeepEqual(current, a, 'current compilation observes writes from the other client');
    assert.notDeepEqual(reset, a, 'reset compilation does not inherit edited renderer registers');
    assert.deepEqual(await main.compile(operations, {initialState:snapshot}), a);
    if (kind === 'segapsg') await assert.rejects(main.compile(operations, {initialState:'client'}), /Incomplete PSG client state/);
    else {
      const count = f.coreWrites.length, state = main._getState();
      assert.deepEqual(await main.compile(operations, {initialState:'client'}), a, 'complete authoring shadow remains local rather than following Worker writes');
      assert.deepEqual(main._getState(), state);
      assert.equal(f.coreWrites.length, count);
    }
    // Each public client must establish the identity of its own renderer.
    await assert.rejects(worker.compile(operations, {initialState:snapshot}), /identity is unknown/);
    await worker.captureState();
    assert.deepEqual(await worker.compile(operations, {initialState:snapshot}), a);
    const foreign = {...snapshot, instanceId:`other:${snapshot.instanceId}`};
    await assert.rejects(main.compile(operations, {initialState:foreign}), /identity|different|Incompatible/i);
    const otherKind = {...snapshot, format:kind === 'segapsg' ? 'tetorica-opll-state' : 'tetorica-psg-state'};
    await assert.rejects(main.compile(operations, {initialState:otherKind}));
  });

  test(`${kind}: acknowledgement IDs, rejected replacement, owner cancellation and Stop are fenced`, async t => {
    const f = await fixture(t, kind), main = f.connect(), worker = f.connect(true);
    main.holdReplies();
    let resolved = 0;
    const pending = [main.api.captureState(), main.api.compile(main.api.build(b => b.noteOn(0, 'C4')))].map(p => p.then(value => {resolved++; return value;}));
    await Promise.resolve();
    assert.equal(resolved, 0, 'posting a request is not its acknowledgement');
    assert.equal(new Set(main.sent.filter(m => m.id).map(m => m.id)).size, 2);
    main.flushReplies();
    const [captured, rows] = await Promise.all(pending);
    assert.equal(captured.frame, 0); assert(rows.length > 0);
    const loop = main.api.build(b => b.noteOn(0, 'C4'));
    await main.api._timedOperations.schedule(loop, {name:'loop', repeatSeconds:.01}, {owner:'old'});
    const before = f.processor.performance.getStats();
    const invalid = structuredClone(loop); invalid.operations[0].args[0] = 99;
    await assert.rejects(worker.api.schedule(invalid, {name:'loop', repeatSeconds:.01}));
    assert.equal(f.processor.performance.getStats().patternCount, before.patternCount);
    f.render(129);
    assert.equal(f.operationFrames.length, 1, 'rejected replacement preserved the original reservation');
    await worker.api._timedOperations.cancelOwner('unrelated');
    assert.equal(f.processor.performance.getStats().patternCount, 1);
    await main.api._timedOperations.cancelOwner('old');
    assert.equal(f.processor.performance.getStats().patternCount, 0);
    await worker.api.schedule(loop, {name:'stopped', repeatSeconds:.01});
    await main.api._stopVoices();
    assert.equal(f.processor.performance.getStats().patternCount, 0);
    const operationCount = f.operationFrames.length;
    f.render(1024);
    assert.equal(f.operationFrames.length, operationCount, 'Stop fences reserved future writes from either port');
  });

  test(`${kind}: scheduled operations resolve intervening Main edits and retain same-value writes`, async t => {
    const f = await fixture(t, kind), {api:main} = f.connect(), {api:worker} = f.connect(true);
    const operations = worker.build(b => {
      if (kind === 'segapsg') {
        b.setAttenuation(0, 3).setAttenuation(0, 3).keyOn(1);
      } else {
        b.setUserOperator(0, {dr:4}).setUserOperator(0, {dr:4}).setUserOperator(0, {ar:10});
      }
    });
    const receipt = await worker.schedule(operations, {name:'partial'});
    if (kind === 'segapsg') main.setAttenuation(1, 9);
    else main.setUserOperator(0, {ar:6});
    const expected = await main.compile(operations), before = f.coreWrites.length;
    f.render(receipt.startFrame + 1);
    const applied = f.coreWrites.slice(before);
    if (kind === 'segapsg') {
      assert.deepEqual(applied.map(args => args[0]), expected.map(row => row.value));
      assert.deepEqual(expected.map(row => row.value), [0x93, 0x93, 0xb9]);
    } else {
      const pairs = [];
      for (let index = 0; index < applied.length; index += 2)
        pairs.push([applied[index][1], applied[index + 1][1]]);
      assert.deepEqual(pairs, expected.map(row => [row.register, row.value]));
      assert.deepEqual(pairs, [[4, 0x64], [4, 0x64], [4, 0xa4]]);
    }
    assert.deepEqual(f.operationFrames.map(row => row.frame), [128, 128, 128]);
  });

  test(`${kind}: dispose rejects pending acknowledged requests and retires timed API`, async t => {
    const f = await fixture(t, kind), endpoint = f.connect();
    endpoint.holdReplies();
    const capture = endpoint.api.captureState();
    endpoint.api.dispose();
    await assert.rejects(capture, /disposed|stopped/i);
    await assert.rejects(endpoint.api.compile({}), /disposed|stopped/i);
    endpoint.flushReplies();
  });
}

function nativeFixture(createEndpoint) {
  const commands = [], requests = [];
  let flushes = 0;
  const synth = {session:1, generation:1, clock:{sampleRate:48000}, stopping:false, closing:false,
    isReady:() => true, frameAt:seconds => Math.round(seconds * 48000),
    enqueue(command) {commands.push(command);}, async flush() {flushes++;},
    async nativeRequest(...args) {requests.push(args); throw Error('Unexpected Native state request');},
  };
  const endpoint = createEndpoint(synth);
  return {endpoint, api:endpoint.client, commands, requests, flushes:() => flushes};
}

for (const [label, kind, createEndpoint] of [
  ['Master System PSG', 'segapsg', synth => createNativeGenesisMasterSystem(synth).segapsg],
  ['Master System OPLL', 'ym2413', synth => createNativeGenesisMasterSystem(synth).ym2413],
  ['additional OPLL', 'ym2413', createNativeGenesisYm2413Endpoint],
]) {
  test(`${label}: local compilation works while authoritative operations reject before Native bridge traffic`, async () => {
    const f = nativeFixture(createEndpoint), {api} = f;
    const operations = program(api, kind);
    assert.equal(f.commands.length, 0);
    assert((await api.compile(operations, {initialState:'reset'})).length > 0);
    assert.equal(f.commands.length, 0);
    await f.endpoint.initialize();
    const commandCount = f.commands.length, flushes = f.flushes();
    if (kind === 'segapsg') await assert.rejects(api.compile(operations, {initialState:'client'}), /Incomplete PSG client state/);
    else assert((await api.compile(operations, {initialState:'client'})).length > 0);
    for (const call of [() => api.captureState(), () => api.compile(operations),
      () => api.schedule(operations, {name:'native'}), () => api.clearSchedule('native')])
      await assert.rejects(call(), /AudioWorklet.*Native/);
    assert.equal(f.commands.length, commandCount);
    assert.equal(f.flushes(), flushes);
    assert.deepEqual(f.requests, []);
  });
}

for (const kind of ['segapsg', 'ym2413']) {
  test(`${kind}: Native Worker client retains immediate command metadata without sending timed controls`, async () => {
    const sent = [], api = constructors[kind]({postMessage:data => sent.push(data), start() {}, close() {}}, {native:true});
    try {
      if (kind === 'segapsg') {
        api.tone(0, {period:369, attenuation:5}); api.keyOff(0); api.keyOn(0);
        assert(sent.every(message => message.method === 'write'));
        assert.deepEqual(sent.map(message => message.args[0]), [0x81,0x17,0x95,0x9f,0x95]);
        assert.equal(sent[1].psgRegister, 0, 'Native bridge continuation target remains explicit');
      } else {
        api.setRhythm({enabled:true, bassDrum:true});
        api.setRhythm({hiHat:true});
        assert.deepEqual(sent.filter(message => message.args[0] === 14).map(message => message.intentMask), [16,16,1], 'Native rhythm ownership still identifies only explicitly touched drums');
        assert(sent.every(message => message.method === 'writeRegister'));
      }
      const before = sent.length, operations = program(api, kind);
      assert((await api.compile(operations, {initialState:'reset'})).length > 0);
      await assert.rejects(api.captureState(), /AudioWorklet.*Native/);
      await assert.rejects(api.schedule(operations, {name:'unsupported'}), /AudioWorklet.*Native/);
      assert.equal(sent.length, before, 'Native rejection is local, rather than an unsupported bridge RPC');
    } finally {api.dispose();}
  });
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate, label) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail(`Did not reach ${label}`);
}
const globalName = kind => kind === 'segapsg' ? 'psg' : 'opll';
const score = (kind, note = 'C4') => `
  const instrument = await useSoundChip(${JSON.stringify(kind)});
  await instrument.schedule(instrument.build(b => b.noteOn(0, ${JSON.stringify(note)})), {name:"entry", repeatSeconds:.02});
`;

for (const kind of ['segapsg', 'ym2413']) {
  test(`${kind}: production Main Playground stages Run / Apply, preserves failed Apply and retires on Stop`, async t => {
    const f = await fixture(t, kind), main = f.connect(), previousWindow = globalThis.window;
    globalThis.window = {addEventListener() {}, removeEventListener() {}, setTimeout};
    const media = () => ({stop() {}, stopAll() {}, pause() {}, list:() => [], unload() {}});
    const megaDrive = {
      capabilities:{chip:kind, fmChannels:0, dac:false, psg:kind === 'segapsg'},
      state:'idle', audioContext:{currentTime:0}, fm:{setPreset() {}, noteOff() {}}, psg:{},
      sample:media(), stream:media(), clearFXChain:() => [],
      primaryEndpoints:[{name:kind, globalName:globalName(kind), client:main.api, node:{port:main.port}}],
      async start() {this.state = 'ready';}, async resume() {}, async close() {},
      stopAllNative:() => main.api._stopVoices(),
    };
    const runtime = createPlaygroundRuntime({megaDrive, guardExecution:false});
    t.after(() => {runtime.stop(); globalThis.window = previousWindow;});
    await runtime.playSource(score(kind));
    assert.equal(f.processor.performance.getStats().patternCount, 1);
    assert.equal(runtime.getState().playback, 'running');
    const firstOwner = main.sent.find(message => message.args?.[0]?.action === 'stage').args[0].owner;
    await assert.rejects(runtime.playSource(`${score(kind, 'E4')} throw Error("expected failed Apply");`), /expected failed Apply/);
    assert.equal(f.processor.performance.getStats().patternCount, 1);
    assert.equal(runtime.getState().playback, 'running', 'failed Apply keeps the previous entry available to Stop');
    f.render(129);
    const capture = await main.api.captureState();
    if (kind === 'segapsg') assert.equal(capture.state.periods[0], 428, 'failed E4 Apply did not replace C4');
    else {
      const expected = await main.api.compile(main.api.build(b => b.setNote(0, 'C4')), {initialState:'reset'});
      for (const row of expected) assert.equal(capture.state.registers[row.register] & (row.register >= 32 ? 15 : 255), row.value);
    }
    await runtime.playSource(score(kind, 'G4'));
    assert.equal(f.processor.performance.getStats().patternCount, 1);
    assert(main.sent.some(message => message.args?.[0]?.action === 'commit' && message.args[0].owner === firstOwner), 'Apply commits through the same entry owner');
    await runtime.stopWithFade();
    assert.equal(f.processor.performance.getStats().patternCount, 0);
    const count = f.operationFrames.length;
    f.render(2048); assert.equal(f.operationFrames.length, count, 'Stop fences all later loop repeats');
    await nextTurn();
  });

  test(`${kind}: production Worker Playground carries performance context through Run / failed Apply / Apply / Stop`, async t => {
    const f = await fixture(t, kind), channel = new MessageChannel(), messages = [], commands = [];
    const url = new URL('../../tetorica_src/runtime/playground_logic_worker.js', import.meta.url).href;
    const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`, {eval:true});
    t.after(async () => {channel.port1.close(); channel.port2.close(); await worker.terminate();});
    worker.on('message', message => messages.push(message));
    worker.on('error', error => messages.push({error}));
    channel.port1.on('message', data => {commands.push(data); f.processor.receive(data, channel.port1);});
    // The production PerformanceHost starts the renderer session before Run.
    f.processor.receive({type:'performance-start', session:1}, {postMessage() {}});
    await until(() => messages.some(message => message.readyForTest || message.error), 'Worker import');
    assert(!messages.some(message => message.error), JSON.stringify(messages));
    worker.postMessage({type:'native-primary-ports', endpoints:[{
      id:kind, name:kind, globalName:globalName(kind), clock:3579545, stereoEnabled:true, native:false,
      state:constructors[kind]({postMessage() {}, close() {}})._getState(), port:channel.port2,
    }]}, [channel.port2]);
    const run = async sourceCode => {
      const start = messages.length;
      worker.postMessage({type:'run', sourceCode,
        capabilities:{chip:kind, fmChannels:0, dac:false, psg:kind === 'segapsg'},
        performance:{session:1, audioSeconds:0, performanceEpochMs:performance.timeOrigin + performance.now(), lookaheadSeconds:.1},
      });
      await until(() => messages.slice(start).some(message => ['complete', 'execution-error'].includes(message.type) || message.error), 'Worker evaluation');
      return messages.slice(start).find(message => ['complete', 'execution-error'].includes(message.type) || message.error);
    };
    let result = await run(score(kind));
    assert.equal(result.type, 'complete', JSON.stringify(result));
    assert.equal(result.scheduledReservationCount, 1);
    assert.equal(f.processor.performance.getStats().patternCount, 1);
    result = await run(`${score(kind, 'E4')} throw Error("expected Worker failed Apply");`);
    assert.equal(result.type, 'execution-error', JSON.stringify(result));
    assert.equal(result.scheduledReservationCount, 1);
    assert.equal(f.processor.performance.getStats().patternCount, 1);
    result = await run(score(kind, 'G4'));
    assert.equal(result.type, 'complete', JSON.stringify(result));
    assert.equal(result.scheduledReservationCount, 1);
    const timed = commands.filter(command => command.method === (kind === 'segapsg' ? 'psgTimed' : 'opllTimed'));
    assert(timed.some(command => command.args[0].action === 'stage'));
    assert(timed.some(command => command.args[0].action === 'commit'));
    assert(timed.every(command => command.timedPerformance?.session === 1 && command.timedPerformance?.owner === 'script'), 'every Worker timed RPC retains its performance session, owner and epoch');
    worker.postMessage({type:'stop'});
    await until(() => messages.some(message => message.type === 'stopped'), 'Worker Stop acknowledgement');
    assert.equal(f.processor.performance.getStats().patternCount, 0);
    const count = f.operationFrames.length;
    f.render(8192); assert.equal(f.operationFrames.length, count);
  });
}
