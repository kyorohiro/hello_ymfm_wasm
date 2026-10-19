import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';
import {HUC6280_CLOCK} from './huc6280synth.js';
import {createHuc6280Client, createPrimaryHuc6280Api} from './playground_huc6280.js';
import {createHuc6280Audio} from './playground_huc6280_audio.js';
import {ChipClockResampler, validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';

const sampleRate = 48000;
const peak = audio => audio.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
async function createWorklet(clock = HUC6280_CLOCK) {
  let Processor, resolveReady, rejectReady, frame = 0; const replies = [];
  const ready = new Promise((resolve,reject) => { resolveReady = resolve; rejectReady = reject; });
  const source = (await readFile(new URL('./playground_huc6280_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {Huc6280AudioEngine, HUC6280_CLOCK, factory, sampleRate, ChipClockResampler, validateChipClock,
    createProcessorPerformance:options => createProcessorPerformance({...options, rate:sampleRate, nowFrame:() => frame}),
    AudioWorkletProcessor:class { constructor() { this.port = {postMessage:data => { replies.push(data); if (data.ready) resolveReady(); if (data.error) rejectReady(new Error(data.error)); }}; } },
    registerProcessor:(_, value) => { Processor = value; },
  });
  const processor = new Processor({processorOptions:{clock, wasmBinary:await readFile(new URL('../docs/generated/huc6280_wasm.wasm', import.meta.url))}});
  await ready;
  return {processor, replies, render(frames) {
    const output = [new Float32Array(frames),new Float32Array(frames)]; processor.process([], [output]); frame += frames; return output;
  }};
}

test('HuC6280 client drives real WASM worklet, supports waveform/noise, and disposes idempotently', async () => {
  const device = await createWorklet(); const {processor} = device; let closed = 0;
  const client = createHuc6280Client({postMessage:data => processor.receive(data), close() { closed++; }});
  const primary = createPrimaryHuc6280Api(client);
  try {
    assert.equal(primary.id, 'huc6280'); assert.equal(primary.clock, HUC6280_CLOCK); assert.equal(primary.dispose, undefined);
    client.initialize(); client.noteOn(0, 'C4'); assert(peak(device.render(2048)[0]) > .01);
    client.setWaveform(0, new Uint8Array(32).fill(16)); assert.equal(peak(device.render(128)[0]), 0);
    client.keyOn(0); assert.equal(peak(device.render(128)[0]), 0);
    client.setNoise(5, {enabled:true, frequency:25}); client.keyOn(5); assert(peak(device.render(2048)[0]) > .01);
    primary.allNotesOff(); assert.equal(peak(device.render(128)[0]), 0);
    primary.noteOn(1, 'E4'); assert(peak(device.render(2048)[0]) > .01);
    client.dispose(); client.dispose(); assert.equal(closed, 1); assert.equal(processor.dead, true);
    assert.throws(() => client.reset(), /disposed/);
  } finally { client.dispose(); processor.dispose(); }
});

test('HuC6280 primary Worker attachment preserves Main clock replies and detach keeps Main usable', async () => {
  const device = await createWorklet(), {processor} = device;
  const port = () => ({closed:false, replies:[], start(){}, close(){this.closed=true;}, postMessage(data){this.replies.push(data);}});
  const main = port(), worker = port(), replacement = port();
  const send = (remote, data) => remote.onmessage({data});
  const client = createHuc6280Client({postMessage:data => send(main,data),close(){}});
  try {
    processor.port.onmessage({data:{port:main}});
    client.initialize(); client.noteOn(0,'C4'); assert(peak(device.render(1024)[0]) > .01);
    send(main,{method:'clock',id:'clock',args:[4000000]});
    assert.equal(main.replies.at(-1).id,'clock'); assert.equal(processor.clockResampler.ratio,4000000/HUC6280_CLOCK);
    processor.port.onmessage({data:{port:worker,primaryWorker:true}});
    assert.equal(main.closed,false); assert.equal(processor.remote,main);
    assert(peak(device.render(1024)[0]) > .01,'attaching a Worker does not retire the Main device or stop its voice');
    const mainReplies = main.replies.length;
    send(worker,{method:'clock',id:'clock',args:[3000000]});
    assert.equal(main.replies.length,mainReplies,'same RPC id on Worker must reply only to Worker');
    assert.equal(worker.replies.at(-1).id,'clock'); assert.equal(processor.clockResampler.ratio,3000000/HUC6280_CLOCK);
    send(main,{method:'clock',id:'clock',args:[5000000]});
    assert.equal(main.replies.length,mainReplies+1); assert.equal(worker.replies.length,1);
    assert.equal(processor.clockResampler.ratio,5000000/HUC6280_CLOCK);
    processor.port.onmessage({data:{port:replacement,primaryWorker:true}});
    assert(worker.closed); assert.equal(main.closed,false);
    send(worker,{method:'clock',id:'stale',args:[2000000]});
    assert.equal(worker.replies.length,1); assert.equal(processor.clockResampler.ratio,5000000/HUC6280_CLOCK,'retired Worker messages are ignored');
    processor.port.onmessage({data:{type:'detach-chip-port',primaryWorker:true}});
    assert(replacement.closed); assert.equal(processor.workerRemote,null); assert.equal(main.closed,false);
    send(main,{method:'clock',id:'after-detach',args:[HUC6280_CLOCK]});
    assert.equal(main.replies.at(-1).id,'after-detach'); assert.equal(processor.clockResampler.ratio,1);
    client.keyOff(0); assert.equal(peak(device.render(128)[0]),0);
    client.noteOn(0,'E4'); assert(peak(device.render(1024)[0]) > .01);
  } finally { client.dispose(); processor.dispose(); }
});

test('HuC6280 clock RPC changes core advancement and pitch generation together', async () => {
  const device = await createWorklet(4000000); const {processor} = device;
  let client;
  const port = {postMessage:data => processor.receive(data, {postMessage:reply => port.onmessage({data:reply})}), close() {}};
  client = createHuc6280Client(port, {clock:4000000});
  try {
    client.initialize(); await client.setClock(2000000);
    assert.equal(client.clock, 2000000); assert.equal(processor.clockResampler.ratio, .5);
    client.setWaveform(0, Array.from({length:32}, (_,index) => index < 16 ? 31 : 0));
    client.setVolume(0, 31); const actual = client.setNote(0, 'A4'); client.keyOn(0);
    const [audio] = device.render(sampleRate); let rises = 0;
    for (let index = 1; index < audio.length; index++) if (audio[index-1] < 0 && audio[index] >= 0) rises++;
    assert(Math.abs(rises - actual) <= 2, `custom clock note expected ${actual}, got ${rises}`);
    await assert.rejects(client.setClock(0), /clock/); assert.equal(client.clock, 2000000);
  } finally { client.dispose(); processor.dispose(); }
});

test('HuC6280 primary and independent clocks acknowledge acceptance but wait for scheduled frame', async () => {
  const device = await createWorklet(); const {processor, replies} = device;
  try {
    processor.receive({type:'performance-start',session:1});
    processor.receive({performance:{session:1, owner:'script', time:.1}, commands:[{method:'clock',id:'independent',args:[2000000]}]});
    processor.receive({performance:{session:1, owner:'script', time:.2}, commands:[{type:'chip-clock',id:'primary',clock:3000000}]});
    assert(replies.some(data => data.id === 'independent' && data.value === true));
    assert(replies.some(data => data.id === 'primary' && data.type === 'chip-clock-result'));
    assert.equal(processor.clockResampler, undefined);
    device.render(4801); assert.equal(processor.clockResampler.ratio, 2000000 / HUC6280_CLOCK);
    device.render(4800); assert.equal(processor.clockResampler.ratio, 3000000 / HUC6280_CLOCK);
    assert.equal(replies.filter(data => ['primary','independent'].includes(data.id)).length, 2);
  } finally { processor.dispose(); }
});

test('HuC6280 performance Stop releases active channels and cancels future notes without losing waveforms', async () => {
  const device = await createWorklet(); const {processor} = device; let commands = null;
  const client = createHuc6280Client({postMessage:data => commands ? commands.push(data) : processor.receive(data), close() {}});
  try {
    client.initialize(); processor.receive({type:'performance-start',session:7});
    commands = []; client.noteOn(2, 'C4'); processor.receive({performance:{session:7,owner:'melody',time:0},commands});
    commands = []; client.noteOn(5, 'G4'); processor.receive({performance:{session:7,owner:'melody',time:1},commands}); commands = null;
    assert(peak(device.render(1024)[0]) > .01);
    processor.receive({type:'performance-stop',session:7});
    assert.equal(peak(device.render(1024)[0]), 0, 'held note stops immediately');
    assert.equal(peak(device.render(sampleRate)[0]), 0, 'cancelled reservation stays silent');
    processor.receive({type:'performance-start',session:8});
    commands = []; client.noteOn(2, 'E4'); processor.receive({performance:{session:8,owner:'melody',time:0},commands}); commands = null;
    assert(peak(device.render(2048)[0]) > .01, 'next run retains waveform and volume');
  } finally { client.dispose(); processor.dispose(); }
});

test('HuC6280 loop cancellation releases its owned channel without cutting a replacement voice', async () => {
  const device = await createWorklet(); const {processor} = device; let commands = null;
  const client = createHuc6280Client({postMessage:data => commands ? commands.push(data) : processor.receive(data), close() {}});
  try {
    client.initialize(); processor.receive({type:'performance-start',session:1});
    const note = (owner, channel, pitch) => {
      commands = []; client.noteOn(channel, pitch);
      processor.receive({performance:{session:1,owner,time:0},commands}); commands = null;
    };
    note('old-loop', 2, 'C4'); device.render(128);
    note('new-loop', 2, 'E4'); device.render(128);
    processor.receive({type:'performance-cancel-owner',session:1,owner:'old-loop'});
    assert(peak(device.render(128)[0]) > .01);
    processor.receive({type:'performance-cancel-owner',session:1,owner:'new-loop'});
    assert.equal(peak(device.render(128)[0]), 0);
  } finally { client.dispose(); processor.dispose(); }
});

test('HuC6280 audio setup passes URLs/clock, caches module, and releases resources on ready or abort', async () => {
  const previous = {AudioWorkletNode:globalThis.AudioWorkletNode, MessageChannel:globalThis.MessageChannel};
  const nodes = [], fetches = [], loads = [];
  class Port { closed = false; close() { this.closed = true; } postMessage(data) { this.last = data; } }
  class Node {
    constructor(context, name, options) {
      this.context = context; this.name = name; this.options = options; this.port = new Port(); nodes.push(this);
      queueMicrotask(() => this.port.onmessage?.({data:{ready:true}}));
    }
    connect(destination) { this.destination = destination; }
    disconnect() { this.disconnected = true; }
  }
  globalThis.AudioWorkletNode = Node;
  globalThis.MessageChannel = class { port1 = new Port(); port2 = new Port(); };
  const context = {state:'running', audioWorklet:{addModule:async url => loads.push(url)}};
  const options = {clock:4000000, workletUrl:'https://test.invalid/pce-worklet.js', wasmUrl:'https://test.invalid/pce.wasm',
    fetch:async (url, init) => { fetches.push([String(url),init]); return {ok:true,arrayBuffer:async () => new ArrayBuffer(8)}; }};
  try {
    const destination = {};
    const audio = await createHuc6280Audio(context, destination, options);
    assert.equal(audio.clock, 4000000); assert.equal(audio.node.name, 'tetorica-huc6280');
    assert.equal(audio.node.options.processorOptions.clock, 4000000); assert.equal(audio.node.destination, destination);
    assert.deepEqual(loads, [options.workletUrl]); assert.equal(fetches[0][0], options.wasmUrl);
    audio.dispose(); audio.dispose(); assert(audio.node.disconnected && audio.node.port.closed && audio.port.closed);
    const second = await createHuc6280Audio(context, null, options); assert.equal(loads.length, 1); assert.equal(second.node.destination, undefined); second.dispose();
    const abort = new AbortController(); abort.abort(new Error('cancelled before setup'));
    await assert.rejects(createHuc6280Audio(context, null, {...options,signal:abort.signal}), /cancelled before setup/);
    assert.equal(nodes.length, 2);
    await assert.rejects(createHuc6280Audio(context, null, {...options,fetch:async () => ({ok:false,status:404})}), /HTTP 404/);
    assert.equal(nodes.length, 2);
    const loadingAbort = new AbortController();
    const initializing = createHuc6280Audio({state:'running',audioWorklet:{addModule:() => new Promise(() => {})}}, null, {...options,signal:loadingAbort.signal});
    loadingAbort.abort(new Error('cancelled module load'));
    await assert.rejects(initializing, /cancelled module load/); assert.equal(nodes.length, 2);
    await assert.rejects(createHuc6280Audio({...context,state:'closed'}, null, options), /open AudioContext/);
  } finally { globalThis.AudioWorkletNode = previous.AudioWorkletNode; globalThis.MessageChannel = previous.MessageChannel; }
});
