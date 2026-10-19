import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../docs/generated/okim6258_wasm.js';
import {Oki6258AudioEngine} from './okim6258audioengine.js';
import {Oki6258Stream, OKIM6258_CLOCK} from './okim6258synth.js';
import {createOki6258Client} from './playground_okim6258.js';
import {createOki6258Audio} from './playground_okim6258_audio.js';
import {validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';

const sampleRate = 48000;
const peak = samples => samples.reduce((best, value) => Math.max(best, Math.abs(value)), 0);
async function worklet() {
  let Processor, resolveReady, rejectReady, frame = 0;
  const replies = [], ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const source = (await readFile(new URL('./playground_okim6258_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {Oki6258AudioEngine, Oki6258Stream, OKIM6258_CLOCK, validateChipClock, factory, sampleRate,
    createProcessorPerformance:options => createProcessorPerformance({...options, rate:sampleRate, nowFrame:() => frame}),
    AudioWorkletProcessor:class { constructor() { this.port = {postMessage:data => {
      replies.push(data); if (data.ready) resolveReady(); if (data.error) rejectReady(new Error(data.error));
    }}; } }, registerProcessor:(_, Class) => { Processor = Class; },
  });
  const processor = new Processor({processorOptions:{clock:8000000,
    wasmBinary:await readFile(new URL('../docs/generated/okim6258_wasm.wasm', import.meta.url))}});
  await ready;
  return {processor, replies, render(frames) {
    const output = [new Float32Array(frames), new Float32Array(frames)];
    processor.process([], [output]); frame += frames; return output;
  }};
}

test('OKIM6258 real client/worklet uploads PCM, plays, routes pan and stops without losing memory', async () => {
  const device = await worklet(), {processor} = device;
  const port = {postMessage:data => processor.receive(data, {postMessage:reply => port.onmessage?.({data:reply})}), close(){}};
  const client = createOki6258Client(port);
  try {
    const pcm = Float32Array.from({length:2000}, (_, i) => Math.sin(i / 10) * .4);
    const metadata = await client.loadSample({channels:[pcm], sampleRate:15625});
    assert.equal(metadata.bytes, 1000); client.setPan(true, false); client.play();
    const sounding = device.render(2048); assert(peak(sounding[0]) > .1); assert.equal(peak(sounding[1]), 0);
    client.stop(); assert.equal(peak(device.render(128)[0]), 0);
    client.setPan(false, true); client.play({repeat:true}); const right = device.render(2048);
    assert.equal(peak(right[0]), 0); assert(peak(right[1]) > .1);
    await client.setClock(4000000); assert.equal(processor.stream.clock, 4000000); assert.equal(client.playbackRate, 7812.5);
    client.keyOff(); assert.equal(peak(device.render(128)[1]), 0);
    client.dispose(); assert.equal(processor.dead, true);
  } finally { client.dispose(); processor.dispose(); }
});

test('OKIM6258 primary Worker attachment preserves Main memory/clock replies and detach keeps Main usable', async () => {
  const device = await worklet(), {processor} = device;
  const port = () => ({closed:false, replies:[], start(){}, close(){this.closed=true;}, postMessage(data){this.replies.push(data);}});
  const main = port(), worker = port(), replacement = port();
  const send = (remote,data) => remote.onmessage({data});
  const sample = Uint8Array.of(0x10,0xf8,0x32,0x54);
  try {
    processor.port.onmessage({data:{port:main}});
    send(main,{method:'loadMemory',id:'memory',args:[sample]});
    assert.equal(main.replies.at(-1).id,'memory'); assert.deepEqual(processor.stream.bytes,sample);
    send(main,{method:'play',args:[{repeat:true}]}); assert(peak(device.render(128)[0]) > 0);
    processor.port.onmessage({data:{port:worker,primaryWorker:true}});
    assert.equal(main.closed,false); assert.equal(processor.remote,main); assert(processor.stream.playing);
    assert(peak(device.render(128)[0]) > 0,'attaching a Worker does not stop Main playback');
    const mainReplies = main.replies.length;
    send(worker,{method:'clock',id:'clock',args:[4000000]});
    assert.equal(worker.replies.at(-1).id,'clock'); assert.equal(main.replies.length,mainReplies);
    send(main,{method:'clock',id:'clock',args:[8000000]});
    assert.equal(main.replies.at(-1).id,'clock'); assert.equal(worker.replies.length,1); assert.equal(processor.stream.clock,8000000);
    send(worker,{method:'loadMemory',id:'memory',args:[Uint8Array.of(0x21,0x43)]});
    assert.equal(worker.replies.at(-1).id,'memory'); assert.equal(main.replies.length,mainReplies+1);
    send(main,{method:'loadMemory',id:'memory',args:[sample]});
    assert.equal(main.replies.at(-1).id,'memory'); assert.equal(worker.replies.length,2);
    assert.deepEqual(processor.stream.bytes,sample);
    processor.port.onmessage({data:{port:replacement,primaryWorker:true}});
    assert(worker.closed); assert.equal(main.closed,false);
    send(worker,{method:'loadMemory',id:'stale',args:[Uint8Array.of(0xff)]});
    assert.equal(worker.replies.length,2); assert.deepEqual(processor.stream.bytes,sample,'retired Worker cannot replace Main sample');
    processor.port.onmessage({data:{type:'detach-chip-port',primaryWorker:true}});
    assert(replacement.closed); assert.equal(processor.workerRemote,null); assert.equal(main.closed,false);
    send(main,{method:'loadMemory',id:'after-detach',args:[sample]});
    assert.equal(main.replies.at(-1).id,'after-detach');
    send(main,{method:'clock',id:'clock-after-detach',args:[4000000]});
    assert.equal(main.replies.at(-1).id,'clock-after-detach'); assert.equal(processor.stream.clock,4000000);
    send(main,{method:'play',args:[{repeat:true}]}); assert(peak(device.render(128)[0]) > 0);
  } finally { processor.dispose(); }
});

test('performance Stop cancels future playback and immediately releases a looping sample', async () => {
  const device = await worklet(), {processor} = device;
  try {
    processor.receive({method:'loadMemory', args:[Uint8Array.of(0x10, 0xf8)]});
    processor.receive({type:'performance-start',session:1});
    processor.receive({performance:{session:1,owner:'sample',time:.01},commands:[{method:'play',args:[{repeat:true}]}]});
    assert.equal(peak(device.render(480)[0]), 0); assert(peak(device.render(128)[0]) > 0);
    processor.receive({performance:{session:1,owner:'sample',time:.5},commands:[{method:'play',args:[{repeat:true}]}]});
    processor.receive({type:'performance-stop',session:1});
    assert.equal(peak(device.render(sampleRate)[0]), 0);
    processor.receive({type:'performance-start',session:2});
    processor.receive({method:'play',args:[{repeat:true}]}); assert(peak(device.render(128)[0]) > 0);
    processor.receive({type:'performance-stop',session:1});
    assert(peak(device.render(128)[0]) > 0, 'stale Stop cannot release a new run');
  } finally { processor.dispose(); }
});

test('memory upload is immediate, clock acceptance is acknowledged before its reserved frame', async () => {
  const device = await worklet(), {processor, replies} = device;
  try {
    processor.receive({type:'performance-start',session:3});
    processor.receive({performance:{session:3,owner:'script',time:.1},commands:[{method:'loadMemory',id:'upload',args:[Uint8Array.of(0x12)]}]});
    assert.equal(processor.stream.bytes.length, 1); assert(replies.some(reply => reply.id === 'upload'));
    processor.receive({performance:{session:3,owner:'script',time:.1},commands:[{method:'clock',id:'clock',args:[4000000]}]});
    assert(replies.some(reply => reply.id === 'clock')); assert.equal(processor.stream.clock, 8000000);
    device.render(4801); assert.equal(processor.stream.clock, 4000000);
    assert.equal(replies.filter(reply => reply.id === 'clock').length, 1);
  } finally { processor.dispose(); }
});

test('cancelling a loop releases its sample while an older owner cannot stop its replacement', async () => {
  const device = await worklet(), {processor} = device;
  const play = owner => processor.receive({performance:{session:4, owner, time:0},commands:[{method:'play',args:[{repeat:true}]}]});
  try {
    processor.receive({method:'loadMemory', args:[Uint8Array.of(0x10, 0xf8)]}); processor.receive({type:'performance-start',session:4});
    play('first'); assert(peak(device.render(128)[0]) > 0);
    play('second'); assert(peak(device.render(128)[0]) > 0);
    processor.receive({type:'performance-cancel-owner',session:4,owner:'first'});
    assert(peak(device.render(128)[0]) > 0);
    processor.receive({type:'performance-cancel-owner',session:4,owner:'second'});
    assert.equal(peak(device.render(128)[0]), 0);
  } finally { processor.dispose(); }
});

test('audio setup caches module, supports custom URLs and closes both ports on dispose', async () => {
  const previous = {AudioWorkletNode:globalThis.AudioWorkletNode, MessageChannel:globalThis.MessageChannel};
  const nodes = [], modules = [], fetches = [];
  class Port { close() { this.closed = true; } postMessage(data) { this.last = data; } }
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options) {
      this.name = name; this.options = options; this.port = new Port(); nodes.push(this);
      queueMicrotask(() => this.port.onmessage?.({data:{ready:true}}));
    }
    connect(destination) { this.destination = destination; }
    disconnect() { this.disconnected = true; }
  };
  globalThis.MessageChannel = class { port1 = new Port(); port2 = new Port(); };
  const context = {state:'running', audioWorklet:{addModule:async url => { modules.push(url); }}};
  const options = {clock:4000000, wasmUrl:'https://test.invalid/oki.wasm', workletUrl:'https://test.invalid/oki.js',
    fetch:async url => { fetches.push(url); return {ok:true,arrayBuffer:async () => new ArrayBuffer(8)}; }};
  try {
    const destination = {}, audio = await createOki6258Audio(context, destination, options);
    assert.equal(audio.node.name, 'tetorica-okim6258'); assert.equal(audio.clock, 4000000);
    assert.equal(audio.node.destination, destination); assert.deepEqual(modules, [options.workletUrl]); assert.deepEqual(fetches, [options.wasmUrl]);
    audio.dispose(); audio.dispose(); assert(audio.node.port.closed && audio.port.closed && audio.node.disconnected);
    const second = await createOki6258Audio(context, null, options); assert.equal(modules.length, 1); assert.equal(second.node.destination, undefined); second.dispose();
    await assert.rejects(createOki6258Audio(context, null, {...options,fetch:async () => ({ok:false,status:404})}), /HTTP 404/);
    assert.equal(nodes.length, 2);
    const abort = new AbortController();
    const initializing = createOki6258Audio({state:'running',audioWorklet:{addModule:() => new Promise(() => {})}}, null, {...options,signal:abort.signal});
    abort.abort(new Error('cancelled module load')); await assert.rejects(initializing, /cancelled module load/);
    assert.equal(nodes.length, 2);
  } finally { Object.assign(globalThis, previous); }
});
