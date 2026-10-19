import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as immediate} from 'node:timers/promises';
import {NativeRuntimeSynth} from './native_runtime_synth.js';
import {SnesSynth} from './snessynth.js';
import {borrowNativeApi, createNativePrimaryClient} from './playground_native_primary.js';

const deferred = () => { let resolve; return {promise:new Promise(done => { resolve = done; }), resolve:() => resolve()}; };
async function until(predicate) {
  for (let iteration = 0; iteration < 200; iteration++) { if (predicate()) return; await immediate(); }
  assert.fail('Async initialization boundary not reached');
}

/** Real client MessageChannels, with deterministic device/module boundaries. */
function harness(t, chip, {stage = '', target = chip === 'x68000' ? 'okim6258' : chip} = {}) {
  const previous = globalThis.AudioWorkletNode;
  const gate = deferred(), nodes = [], fetches = [], moduleLoads = [], ports = new Set();
  let reached = false, contextCloses = 0;
  const graphNode = () => ({connections:[], connect(node) { this.connections.push(node); }, disconnect() { this.connections.length = 0; }});
  const context = {state:'running', currentTime:0, destination:graphNode(),
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; }, async close() { contextCloses++; this.state = 'closed'; },
    createGain:() => ({...graphNode(), gain:{value:1, cancelScheduledValues(){}, setValueAtTime(value){this.value=value;}, linearRampToValueAtTime(value){this.value=value;}}}),
    createChannelSplitter:graphNode, createChannelMerger:graphNode,
    audioWorklet:{addModule:async url => { moduleLoads.push(String(url)); if (stage === 'module' && String(url).includes(target)) { reached = true; await gate.promise; } }},
  };
  const fetchBytes = async url => {
    fetches.push(String(url));
    if (stage === 'fetch' && String(url).includes(target === 'snes' ? 'spc' : target)) { reached = true; await gate.promise; }
    return {ok:true, arrayBuffer:async () => new ArrayBuffer(1)};
  };
  globalThis.AudioWorkletNode = class {
    constructor(audioContext, name, options) {
      this.context = audioContext; this.name = name; this.options = options; this.messages = []; this.connections = [];
      this.loadedMemory = null;
      this.validation = name.includes('snes') ? new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}}) : null;
      this.port = {closed:false, close:() => { this.port.closed = true; this.remote?.close(); }, postMessage:data => {
        this.messages.push(data);
        if (data.port) {
          this.remote = data.port; ports.add(data.port);
          data.port.onmessage = event => this.receive(event.data, data.port); data.port.start();
        }
      }};
      nodes.push(this);
      if (stage === 'ready' && name.includes(target)) { reached = true; gate.promise.then(() => this.ready()); }
      else queueMicrotask(() => this.ready());
    }
    ready() { this.port.onmessage?.({data:{ready:true,sampleRate:48000}}); }
    receive(data, port) {
      this.messages.push(data);
      if (data.method === 'dispose') { port.close(); return; }
      let value = true;
      if (this.validation && typeof this.validation[data.method] === 'function') value = this.validation[data.method](...(data.args ?? []));
      if (data.method === 'loadMemory') this.loadedMemory = data.args[0].slice();
      if (data.id !== undefined) port.postMessage({id:data.id,value});
    }
    connect(node) { this.connections.push(node); }
    disconnect() { this.connections.length = 0; }
  };
  const synth = new NativeRuntimeSynth({chip, audioContext:context, fetch:fetchBytes, extraOki:{fetch:fetchBytes}});
  t.after(async () => {
    gate.resolve(); await synth.close(); for (const port of ports) port.close(); globalThis.AudioWorkletNode = previous;
  });
  return {synth, context, nodes, fetches, moduleLoads, gate, reached:() => reached, contextCloses:() => contextCloses};
}

for (const chip of ['nes','snes','huc6280','x68000']) test(`${chip} primary is lazy, starts once, routes only native devices, and restarts`, async t => {
  const device = harness(t, chip); const {synth,nodes} = device;
  assert.equal(nodes.length, 0); assert.equal(device.fetches.length, 0); assert.equal(device.moduleLoads.length, 0);
  assert.equal(synth.fm, null); assert.equal(synth.psg, null); assert.equal(synth.isReady(), false);
  await Promise.all([synth.start(),synth.start()]);
  assert.equal(synth.isReady(), true); assert.equal(nodes.length, chip === 'x68000' ? 2 : 1);
  assert.deepEqual(synth.capabilities, {chip,fmChannels:0,psg:false,dac:false,recorder:false});
  assert.equal(typeof synth.sample.load, 'function'); assert.equal(typeof synth.stream.load, 'function');
  assert(nodes.every(node => node.connections.length === 1), 'each device connects once through mixer, with no direct duplicate output');
  const names = chip === 'x68000' ? ['ym2151','okim6258'] : [chip];
  assert.deepEqual(synth.primaryEndpoints.map(endpoint => endpoint.name), names);
  assert.deepEqual(synth.mixer.list().filter(row => row.connected).map(row => row.id), names);
  if (chip === 'nes') { assert(synth.nes.fdsEnabled); assert.equal(nodes[0].options.processorOptions.fds,true); }
  if (chip === 'huc6280') assert.equal(synth.pce._getState().initialized, true);
  if (chip === 'x68000') {
    assert.equal(synth.opm.clock, 4000000); assert.equal(synth.adpcm.clock, 8000000);
    assert.notEqual(synth.primaryEndpoints[0].node, synth.primaryEndpoints[1].node);
    assert.notEqual(synth.primaryEndpoints[0].port, synth.primaryEndpoints[1].port);
  }
  const apis = synth.primaryApis; await synth.start(); assert.equal(synth.primaryApis, apis);
  await synth.close(); assert.equal(synth.state,'closed'); assert.equal(device.contextCloses(), 0, 'caller owns supplied context');
  assert(nodes.every(node => node.port.closed && node.connections.length === 0)); assert.equal(synth.primaryEndpoints.length,0);
  assert.deepEqual(synth.primaryApis, {});
  await synth.start(); assert.equal(synth.isReady(),true); assert.equal(nodes.length, chip === 'x68000' ? 4 : 2);
});

test('native Stop preserves SNES BRR allocation, sample assignment and per-voice parameters', async t => {
  const {synth,nodes} = harness(t, 'snes'); await synth.start();
  const bytes = new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]);
  const sample = await synth.snes.loadBRR(bytes, {baseFrequencyHz:2000,loopStartSamples:0});
  synth.snes.setPreset(0, {sample,volumeLeft:70,volumeRight:50}); synth.snes.noteOn(0,'C4');
  const before = synth.snes._getState(); synth.stopAllNative();
  assert.deepEqual(synth.snes._getState(), before);
  await until(() => nodes[0].messages.some(data => data.method === 'allNotesOff'));
  assert.equal(nodes[0].validation.getState().samples.length,1);
  synth.snes.noteOn(0,'E4'); assert.equal(synth.snes._getState().samples[0].id,sample.id);
});

test('native Stop retains X68000 OPM patch and OKIM6258 sample metadata, and borrows hide disposal', async t => {
  const {synth,nodes} = harness(t, 'x68000'); await synth.start();
  synth.opm.setAlgo(0,7); synth.opm.setOperator(0,3,{mul:1,tl:30,ar:31,rr:0});
  await synth.adpcm.loadMemory(Uint8Array.of(0x10,0x32,0x54,0x76)); synth.adpcm.play({repeat:true});
  const patch = synth.opm._getState().registers.slice(0x20), sample = synth.adpcm._getState();
  synth.stopAllNative(); assert.deepEqual(synth.opm._getState().registers.slice(0x20),patch); assert.deepEqual(synth.adpcm._getState(),sample);
  await until(() => nodes[1].messages.some(data => data.method === 'stop'));
  assert.deepEqual(nodes[1].loadedMemory,Uint8Array.of(0x10,0x32,0x54,0x76));
  const borrowed = borrowNativeApi(synth.adpcm,'okim6258');
  assert.equal(borrowed.dispose,undefined); assert.equal(borrowed.transport,undefined); assert.equal(borrowed._getState,undefined); assert.equal(borrowed.id,'okim6258');
  borrowed.play(); await until(() => nodes[1].messages.filter(data => data.method === 'play').length >= 2);
});

test('PCE state handoff preserves initialized waveform, volume and clock without replaying writes', async t => {
  const {synth} = harness(t, 'huc6280'); await synth.start();
  const wave = Array.from({length:32},(_,index) => index); synth.pce.setWaveform(3,wave); synth.pce.setVolume(3,19);
  await synth.pce.setClock(4000000); synth.pce.noteOn(3,'A4');
  const state = synth.pce._getState(), channel = new MessageChannel(); let writes = 0;
  channel.port1.onmessage = () => writes++; channel.port1.start();
  const worker = createNativePrimaryClient('huc6280',channel.port2,{clock:state.clock,state});
  t.after(() => { worker.dispose(); channel.port1.close(); });
  await immediate(); assert.equal(writes,0); assert.deepEqual(worker._getState(),state);
  synth.stopAllNative(); assert.deepEqual(synth.pce._getState().waveforms[3],wave); assert.equal(synth.pce.clock,4000000);
  assert.equal(synth.pce._getState().registers[3][4],19);
});

test('NES Worker handoff adopts FDS and pulse configuration without resetting the primary chip', async t => {
  const {synth} = harness(t,'nes'); await synth.start();
  synth.nes.pulse.setVoice(1,{duty:.25,volume:6});
  synth.nes.fds.setWave(Array.from({length:64},(_,index) => index));
  synth.nes.fds.setVolume(19); await synth.nes.setClock(1800000);
  const state = synth.nes._getState(), channel = new MessageChannel(), messages = [];
  channel.port1.onmessage = ({data}) => messages.push(data); channel.port1.start();
  const worker = createNativePrimaryClient('nes',channel.port2,{clock:synth.nes.clock,fdsEnabled:true,state});
  t.after(() => {worker.dispose();channel.port1.close();});
  await immediate(); assert.equal(messages.length,0,'constructing Worker authoring state must not write reset/defaults');
  assert.deepEqual(worker._getState(),state); assert.equal(worker.fdsEnabled,true);
  worker.fds.noteOn('C4'); await until(() => messages.length > 0);
  assert(!messages.some(data => data.method === 'reset'));
});

for (const chip of ['nes','snes','huc6280','x68000']) test(`${chip} close during ${chip === 'x68000' ? 'second device' : 'device'} initialization aborts and permits restart`, async t => {
  const {synth,nodes,gate,reached} = harness(t,chip,{stage:'ready'});
  const canceled = assert.rejects(synth.start(),{name:'AbortError'});
  await until(reached); if (chip === 'x68000') assert.equal(synth.primaryEndpoints.length,1,'OPM ready before second device');
  await synth.close(); await canceled; gate.resolve(); await immediate();
  assert.equal(synth.state,'closed'); assert.equal(synth.primaryEndpoints.length,0); assert.deepEqual(synth.primaryApis,{});
  assert(nodes.every(node => node.port.closed && node.connections.length === 0));
  await synth.start(); assert(synth.isReady()); assert.equal(nodes.length,chip === 'x68000' ? 4 : 2);
});

for (const stage of ['module','fetch']) test(`PCE close cancels pending ${stage} loading without allocating a node`, async t => {
  const {synth,nodes,gate,reached} = harness(t,'huc6280',{stage});
  const canceled = assert.rejects(synth.start(),{name:'AbortError'}); await until(reached);
  await synth.close(); await canceled; assert.equal(nodes.length,0);
  gate.resolve(); await synth.start(); assert.equal(nodes.length,1); assert(synth.isReady());
});
