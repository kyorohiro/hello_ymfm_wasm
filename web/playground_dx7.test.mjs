import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDx7Client} from './playground_dx7.js';
import {createDx7Audio} from './playground_dx7_audio.js';
import {createDX7, createInitVoice, createVoiceSysex, createBankSysex} from './msfa_dx7/src/index.js';

const wasmBytes = new Uint8Array(await readFile(new URL('./msfa_dx7/wasm/msfa.wasm', import.meta.url)));
const workletSource = (await readFile(new URL('./playground_dx7_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
const settle = () => new Promise(resolve => setImmediate(resolve));
const peak = pcm => pcm.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

function processorClass(port, sampleRate) {
  let Processor;
  vm.runInNewContext(workletSource, {
    createDX7, createInitVoice, createVoiceSysex, sampleRate,
    AudioWorkletProcessor: class { constructor() { this.port = port; } },
    registerProcessor(name, value) { assert.equal(name, 'tetorica-playground-dx7'); Processor = value; },
  });
  return Processor;
}

async function setup(sampleRate = 44100) {
  const main = new MessageChannel();
  const ready = new Promise((resolve, reject) => {
    main.port2.onmessage = ({data}) => {
      if (data.ready) resolve(data);
      else if (data.fatal) reject(new Error(data.error));
    };
  });
  const Processor = processorClass(main.port1, sampleRate);
  const processor = new Processor({processorOptions: {wasmBytes}});
  const metadata = await ready;
  const remote = new MessageChannel();
  main.port2.postMessage({port: remote.port1}, [remote.port1]);
  const client = createDx7Client(remote.port2, metadata);
  await client.getState();
  return {
    client, processor, main,
    render(frames = 128) {
      const channels = [new Float32Array(frames), new Float32Array(frames)];
      const active = processor.process([], [channels]);
      return {channels, active};
    },
    close() {
      client.dispose();
      processor.dispose();
      main.port1.close(); main.port2.close(); remote.port2.close();
    },
  };
}

for (const sampleRate of [44100, 48000]) {
  test(`DX7 direct-port Worklet matches the real WASM core, partitioned stereo at ${sampleRate} Hz`, async t => {
    const instrument = await setup(sampleRate);
    const core = await createDX7({sampleRate, wasmBytes});
    t.after(() => { instrument.close(); core.dispose(); });
    await core.loadSysex(createVoiceSysex(createInitVoice()));
    const {client} = instrument;
    assert.deepEqual(client.voices, [{index: 0, name: 'INIT SINE'}]);
    assert.equal(client.selectedVoice, 0);
    assert.equal(client.sampleRate, sampleRate);
    assert.equal(client.internalSampleRate, 44100);
    client.voices[0].name = 'outside';
    assert.equal(client.voices[0].name, 'INIT SINE');
    client.noteOn(69, 100); core.noteOn(69, 100);
    await client.getState();
    let maximum = 0;
    for (const frames of [128, 1, 63, 128, 17, 257, 128, 4096]) {
      const {channels: [left, right], active} = instrument.render(frames);
      assert.equal(active, true);
      assert.deepEqual(left, core.render(frames));
      assert.deepEqual(right, left);
      maximum = Math.max(maximum, peak(left));
    }
    assert.ok(maximum > .001, 'default voice must be audible');
    client.noteOff(69); core.noteOff(69);
    await client.getState();
    assert.deepEqual(instrument.render(5001).channels[0], core.render(5001));
    client.panic(); await client.getState();
    assert.equal(peak(instrument.render(2051).channels[0]), 0);
  });
}

test('DX7 upload acknowledgement, bank selection and malformed uploads keep usable state', async t => {
  const instrument = await setup();
  t.after(() => instrument.close());
  const {client} = instrument;
  const quiet = createInitVoice('QUIET');
  quiet[121] = 0;
  const voices = [createInitVoice('OUR SINE'), quiet, ...Array.from({length: 30}, (_, i) => createInitVoice(`OUR ${i + 2}`))];
  const bytes = createBankSysex(voices);
  const snapshot = bytes.slice();
  const info = await client.loadSysex(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  assert.deepEqual(bytes, snapshot, 'transfer must not detach or modify caller data');
  assert.equal(info.length, 32);
  assert.equal(info[1].name, 'QUIET');
  assert.equal(client.selectedVoice, 0);
  client.selectVoice(1);
  client.noteOn(60);
  assert.equal((await client.getState()).selectedVoice, 1);
  assert.ok(peak(instrument.render(8192).channels[0]) < .001);
  const bad = createVoiceSysex(createInitVoice('BAD'));
  bad[6] ^= 1;
  await assert.rejects(client.loadSysex(bad), /checksum/);
  assert.equal(client.voices.length, 32);
  assert.equal((await client.getState()).selectedVoice, 1);
  client.panic(); client.selectVoice(0); client.noteOn(60);
  await client.getState();
  assert.ok(peak(instrument.render(8192).channels[0]) > .001);
  client.allNotesOff(); await client.getState();
  assert.ok(peak(instrument.render(44100).channels[0]) > 0, 'allNotesOff releases instead of panic');
  assert.equal(peak(instrument.render(44100).channels[0]), 0);
});

for (const sampleRate of [44100, 48000]) {
  test('DX7 object edits are acknowledged, ordered before notes, and match direct PCM at '+sampleRate+' Hz', async t => {
    const instrument = await setup(sampleRate);
    const core = await createDX7({sampleRate, wasmBytes});
    t.after(() => {instrument.close();core.dispose();});
    const preset = {name:'JS BELL',algorithm:0,operators:{
      1:{coarse:1,outputLevel:90},
      2:{coarse:2,outputLevel:70,envelope:{rates:[99,75,50,80],levels:[99,70,0,0]}},
    }};
    // The following Note On cannot overtake this unawaited edit on the port.
    const applying = instrument.client.setPreset(preset);
    instrument.client.noteOn(60,100);
    preset.operators[2].coarse = 7; // The transmitted request owns its snapshot.
    core.setPreset({...preset,operators:{...preset.operators,2:{...preset.operators[2],coarse:2}}});
    core.noteOn(60,100);
    await applying;await instrument.client.getState();
    assert.equal((await instrument.client.getPreset()).operators[2].coarse,2);
    assert.equal(instrument.client.voices[0].name,'JS BELL');
    for(const frames of [128,17,257,1024]){
      const {channels:[left,right]} = instrument.render(frames);
      assert.deepEqual(left,core.render(frames));
      assert.deepEqual(right,left);
    }
    // Apply edits after Note On, through the actual command/acknowledgement path.
    await instrument.client.setOperators([[1,{outputLevel:65}],[2,{coarse:3}]]);
    core.setOperators([[1,{outputLevel:65}],[2,{coarse:3}]]);
    await instrument.client.setFeedback(5);core.setFeedback(5);
    assert.equal((await instrument.client.getPreset()).feedback,5);
    assert.deepEqual(instrument.render(4096).channels[0],core.render(4096));
    instrument.client.panic();core.panic();await instrument.client.getState();
    const patch = [[1,{outputLevel:82}],[2,{coarse:3}]];
    await instrument.client.setOperators(patch);core.setOperators(patch);
    await instrument.client.setOperator(1,{fine:25});core.setOperator(1,{fine:25});
    assert.deepEqual(await instrument.client.getPreset(),core.getPreset());
    instrument.client.noteOn(67,100);core.noteOn(67,100);await instrument.client.getState();
    assert.deepEqual(instrument.render(4096).channels[0],core.render(4096));
    const before = await instrument.client.getPreset();
    before.operators[1].outputLevel=0;
    assert.equal((await instrument.client.getPreset()).operators[1].outputLevel,82);
    await assert.rejects(instrument.client.setOperators([[1,{outputLevel:0}],[7,{coarse:1}]]),/operator/i);
    await assert.rejects(instrument.client.setPreset({algorithm:NaN}),/algorithm/i);
    assert.equal((await instrument.client.getPreset()).operators[1].outputLevel,82);
    instrument.client.noteOff(67);core.noteOff(67);await instrument.client.getState();
    assert.deepEqual(instrument.render(8192).channels[0],core.render(8192));
  });
}

test('DX7 object edits keep all other SysEx voices and reject nonfatal invalid updates', async t => {
  const instrument=await setup();t.after(()=>instrument.close());
  await instrument.client.loadSysex(createBankSysex(Array.from({length:32},(_,i)=>createInitVoice('VOICE '+i))));
  instrument.client.selectVoice(31);
  await instrument.client.setPreset({name:'EDITED',operators:{1:{coarse:3}}});
  assert.equal(instrument.client.selectedVoice,31);
  assert.equal(instrument.client.voices.length,32);
  instrument.client.selectVoice(0);
  assert.equal((await instrument.client.getPreset()).name,'VOICE 0');
  instrument.client.selectVoice(31);
  assert.equal((await instrument.client.getPreset()).name,'EDITED');
  // Bypass Main validation to verify invalid requests don't kill the Worklet.
  const reply=await new Promise(resolve=>{
    instrument.processor.receive({id:987,method:'setPreset',args:[{algorithm:99}]},{postMessage:resolve});
  });
  assert.match(reply.error,/algorithm/i);
  assert.equal((await instrument.client.getPreset()).name,'EDITED');
  await instrument.client.setOperators([]);
  assert.equal(instrument.client.voices.length,32);
});

test('DX7 notes cannot overtake a delayed SysEx upload on the direct port', async t => {
  const instrument = await setup();
  t.after(() => instrument.close());
  const {client, processor} = instrument;
  const nativeLoad = processor.synth.loadSysex.bind(processor.synth);
  let release, entered;
  const loading = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  processor.synth.loadSysex = async bytes => { entered(); await gate; return nativeLoad(bytes); };
  const quiet = createInitVoice('QUIET'); quiet[121] = 0;
  const upload = client.loadSysex(createVoiceSysex(quiet));
  client.noteOn(69);
  await loading;
  assert.equal(peak(instrument.render(128).channels[0]), 0, 'note stays queued while upload is pending');
  release();
  await upload;
  await client.getState();
  assert.equal(client.voices[0].name, 'QUIET');
  assert.ok(peak(instrument.render(8192).channels[0]) < .001, 'queued note must use uploaded quiet voice');
});

test('DX7 endpoint disposal rejects pending uploads and late completion cannot revive PCM', async t => {
  const instrument = await setup();
  t.after(() => instrument.close());
  const {client, processor, main} = instrument;
  const nativeLoad = processor.synth.loadSysex.bind(processor.synth);
  let release, entered;
  const loading = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  processor.synth.loadSysex = async bytes => { entered(); await gate; return nativeLoad(bytes); };
  const upload = client.loadSysex(createVoiceSysex(createInitVoice('LATE')));
  const rejected = assert.rejects(upload, /disposed/);
  await loading;
  main.port2.postMessage({method: 'dispose'});
  await rejected;
  release(); await processor.commands;
  assert.equal(processor.dead, true);
  assert.equal(processor.synth, null);
  const {channels, active} = instrument.render();
  assert.equal(active, false);
  assert.equal(peak(channels[0]), 0);
  assert.throws(() => client.noteOn(60), /disposed/);
});

test('DX7 render failure silences stereo, rejects requests and calls the current wrapped dispose', async t => {
  const instrument = await setup();
  t.after(() => instrument.close());
  const {client, processor} = instrument;
  let disposed = 0;
  const originalDispose = client.dispose;
  client.dispose = () => { disposed++; originalDispose(); };
  processor.synth.renderInto = () => { throw new Error('simulated WASM render trap'); };
  const state = client.getState();
  const rejected = assert.rejects(state, /render trap/);
  const {channels, active} = instrument.render();
  assert.equal(active, false);
  assert.equal(peak(channels[0]), 0);
  assert.equal(peak(channels[1]), 0);
  await rejected;
  assert.equal(disposed, 1);
  assert.equal(processor.synth, null);
});

test('DX7 client validates MIDI input, rejects pending requests on local disposal and never detaches input', async () => {
  const posts = [];
  const client = createDx7Client({start() {}, close() {}, postMessage(...args) { posts.push(args); }}, {voices: [{index: 0, name: 'INIT'}]});
  for (const note of [-1, 128, .5, NaN, Infinity, 'C4', '60']) {
    assert.throws(() => client.noteOn(note), /MIDI note/);
    assert.throws(() => client.noteOff(note), /MIDI note/);
  }
  for (const velocity of [-1, 128, .5, NaN]) assert.throws(() => client.noteOn(60, velocity), /Velocity/);
  for (const voice of [-1, 1, .5, NaN]) assert.throws(() => client.selectVoice(voice), /Voice index/);
  for (const feedback of [-1,8,.5,NaN,Infinity,'3']) await assert.rejects(client.setFeedback(feedback), /Feedback/);
  await assert.rejects(client.loadSysex('bad'), /ArrayBuffer/);
  assert.equal(posts.length, 0);
  const bytes = createVoiceSysex(createInitVoice());
  const upload = client.loadSysex(bytes);
  assert.notEqual(posts[0][0].args[0].buffer, bytes.buffer);
  const rejected = assert.rejects(upload, /disposed/);
  client.dispose(); client.dispose();
  await rejected;
  await assert.rejects(client.getState(), /disposed/);
  assert.throws(() => client.allNotesOff(), /disposed/);
});

function fakeAudioEnvironment(t, sampleRate = 44100, addModule = async () => {}) {
  const nodes = [];
  const previous = globalThis.AudioWorkletNode;
  const context = new EventTarget();
  Object.assign(context, {sampleRate, state: 'running', audioWorklet: {addModule}});
  globalThis.AudioWorkletNode = class {
    constructor(actualContext, name, options) {
      assert.equal(actualContext, context);
      assert.equal(name, 'tetorica-playground-dx7');
      assert.deepEqual(options.outputChannelCount, [2]);
      const channel = new MessageChannel();
      this.port = channel.port2;
      this.processor = new (processorClass(channel.port1, sampleRate))(options);
      this.disconnected = 0;
      this.connect = target => { this.destination = target; };
      this.disconnect = () => { this.disconnected++; };
      nodes.push(this);
    }
  };
  t.after(() => {
    globalThis.AudioWorkletNode = previous;
    for (const node of nodes) { node.processor.dispose(); node.processor.port.close(); node.port.close(); }
  });
  return {context, nodes};
}

test('DX7 endpoints reuse WASM/module loads but own independent cores and dispose through route wrappers', async t => {
  let moduleLoads = 0, fetches = 0;
  const {context, nodes} = fakeAudioEnvironment(t, 48000, async () => { moduleLoads++; });
  const fetch = async url => {
    assert.match(String(url), /\/msfa_dx7\/wasm\/msfa\.wasm$/);
    fetches++; return new Response(wasmBytes);
  };
  const [a, b] = await Promise.all([createDx7Audio(context, {}, {fetch}), createDx7Audio(context, {}, {fetch})]);
  const first = createDx7Client(a.port, a), second = createDx7Client(b.port, b);
  t.after(() => { first.dispose(); second.dispose(); a.dispose(); b.dispose(); });
  assert.equal(moduleLoads, 1);
  assert.equal(fetches, 1);
  assert.equal(a.sampleRate, 48000);
  assert.equal(b.voices[0].name, 'INIT SINE');
  first.noteOn(69); await first.getState(); await second.getState();
  const firstOutput = [[new Float32Array(128), new Float32Array(128)]];
  const secondOutput = [[new Float32Array(128), new Float32Array(128)]];
  nodes[0].processor.process([], firstOutput);
  nodes[1].processor.process([], secondOutput);
  assert.ok(peak(firstOutput[0][0]) > 0);
  assert.equal(peak(secondOutput[0][0]), 0, 'other instance cannot hear held notes');
  let routeReleased = 0;
  const dispose = a.dispose;
  a.dispose = () => { routeReleased++; dispose(); };
  nodes[0].processor.fail(new Error('fatal DX7 endpoint'));
  for (let i = 0; i < 10 && !routeReleased; i++) await settle();
  assert.equal(routeReleased, 1, 'fatal cleanup must call the runtime route wrapper');
  assert.equal(nodes[0].disconnected, 1);
  assert.throws(() => first.noteOn(60), /disposed/);
});

test('DX7 initialization abort does not create a late node', async t => {
  let resolveFetch;
  const delayed = new Promise(resolve => { resolveFetch = resolve; });
  const {context, nodes} = fakeAudioEnvironment(t);
  const controller = new AbortController();
  const opening = createDx7Audio(context, {}, {signal: controller.signal, fetch: () => delayed});
  controller.abort(new Error('Run stopped'));
  await assert.rejects(opening, /Run stopped/);
  resolveFetch(new Response(wasmBytes));
  await settle();
  assert.equal(nodes.length, 0);
});

test('DX7 failed module loads are evicted so the same context can retry', async t => {
  let attempts = 0;
  const {context} = fakeAudioEnvironment(t, 44100, async () => {
    if (++attempts === 1) throw new Error('module unavailable');
  });
  const fetch = async () => new Response(wasmBytes);
  await assert.rejects(createDx7Audio(context, {}, {fetch}), /module unavailable/);
  const endpoint = await createDx7Audio(context, {}, {fetch});
  const client = createDx7Client(endpoint.port, endpoint);
  assert.equal((await client.getState()).voices[0].name, 'INIT SINE');
  client.dispose(); endpoint.dispose();
  assert.equal(attempts, 2);
});

test('DX7 failed WASM fetches are evicted and context closure disposes current route', async t => {
  const {context, nodes} = fakeAudioEnvironment(t);
  let attempts = 0;
  const fetch = async () => (++attempts === 1 ? new Response('', {status: 404}) : new Response(wasmBytes));
  await assert.rejects(createDx7Audio(context, {}, {fetch}), /404/);
  const endpoint = await createDx7Audio(context, {}, {fetch});
  const client = createDx7Client(endpoint.port, endpoint);
  t.after(() => { client.dispose(); endpoint.dispose(); });
  await client.getState();
  assert.equal(attempts, 2);
  let routeReleased = 0;
  const dispose = endpoint.dispose;
  endpoint.dispose = () => { routeReleased++; client.dispose(); dispose(); };
  context.state = 'closed';
  context.dispatchEvent(new Event('statechange'));
  assert.equal(routeReleased, 1);
  assert.equal(nodes[0].disconnected, 1);
  assert.throws(() => client.noteOn(60), /disposed/);
  await assert.rejects(createDx7Audio(context, {}, {fetch}), /open AudioContext/);
});

test('DX7 unsupported context rates fail before fetching or loading a Worklet', async () => {
  const forbidden = () => { throw new Error('must not run'); };
  for (const sampleRate of [22050, 96000, NaN]) {
    await assert.rejects(createDx7Audio({sampleRate, audioWorklet: {addModule: forbidden}}, {}, {fetch: forbidden}), /sampleRate/);
  }
});

test('DX7 metadata acknowledgements keep newer selection and reads return ordered snapshots', async t => {
  const instrument = await setup(); t.after(() => instrument.close());
  const {client} = instrument;
  await client.loadSysex(createBankSysex(Array.from({length:32}, (_,i)=>createInitVoice('VOICE '+i))));
  const feedback = client.setFeedback(3);
  client.selectVoice(1);
  await feedback;
  assert.equal(client.selectedVoice, 1, 'Earlier feedback reply cannot restore selection 0');
  assert.equal((await client.getPreset()).name, 'VOICE 1', 'The Worklet uses the newer selected slot');
  const reading = client.getState();
  client.selectVoice(31);
  const snapshot = await reading;
  assert.equal(snapshot.selectedVoice, 1, 'getState resolves to its ordered command snapshot');
  assert.equal(client.selectedVoice, 31, 'An older read snapshot cannot overwrite newer client selection');
  const editing = client.setOperator(1, {fine:25});
  client.selectVoice(0);
  await editing;
  assert.equal(client.selectedVoice, 0, 'Operator replies also preserve later selection');
  assert.equal((await client.getPreset()).feedback, 3, 'Feedback affected the originally selected slot');
  client.selectVoice(31);
  assert.equal((await client.getPreset()).operators[1].fine, 25, 'Operator edit used slot 31 before the later selection');
});
