import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let Constructor, resolve, reject, resolveEdit;
  const messages = [], options = [], core = {disposed: 0, dispose() { this.disposed++; }};
  const loading = new Promise((yes, no) => { resolve = yes; reject = no; });
  class Instrument {
    constructor(chip) { this.core = chip; this.calls = []; this.preset = {value: 0}; }
    read() { return {preset: {...this.preset}, voices: []}; }
    noteOn(...args) { this.calls.push(['noteOn', ...args]); return {channel: 0, stolenId: null}; }
    setPreset(value) {
      if (!value || !Number.isInteger(value.value)) throw new RangeError('Invalid preset');
      this.calls.push(['setPreset', value.value]);
      if (value.value === 8) return new Promise(resolve => { resolveEdit = () => { this.preset = value; resolve(this.read()); }; });
      this.preset = value; return this.read();
    }
    loadPreset(value) { this.calls.push(['loadPreset', value.value]); return this.setPreset(value); }
    stop() { this.calls.push(['stop']); return true; }
    renderInto(output) { output.fill(.125); }
    dispose() { this.core.dispose(); }
  }
  vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
    SidCore: {create: value => { options.push(value); return loading; }}, SidInstrument: Instrument, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: value => messages.push(value)}; } },
    registerProcessor(name, value) { assert.equal(name, 'tetorica-sid-synth'); Constructor = value; },
  });
  const binary = new Uint8Array([1, 2]), processor = new Constructor({processorOptions: {wasmBinary: binary}});
  return {processor, core, options, messages, binary, resolve: () => resolve(core), reject, releaseEdit: () => resolveEdit()};
}
const outputs = () => [[new Float32Array(128).fill(9), new Float32Array(128).fill(9)]];

test('SID processor starts silent, fixes PAL/6581 and preserves commands received during WASM loading', async () => {
  const f = fixture(), before = outputs(); assert.equal(f.processor.process([], before), true); assert(before[0].every(channel => channel.every(value => value === 0)));
  f.processor.receive({id: 1, method: 'noteOn', args: ['first', 60]}); f.processor.receive({id: 2, method: 'noteOn', args: ['second', 64]});
  f.resolve(); await f.processor.ready; await f.processor.commands;
  assert.equal(f.options[0].sampleRate, 48000); assert.equal(f.options[0].clockHz, 985248); assert.equal(f.options[0].wasmBinary, f.binary);
  assert.equal(f.messages[0].ready, true); assert.deepEqual(f.processor.instrument.calls, [['noteOn', 'first', 60], ['noteOn', 'second', 64]]);
  assert.deepEqual(f.messages.filter(message => message.id).map(message => message.id), [1, 2]);
  const pcm = outputs(); assert.equal(f.processor.process([], pcm), true); assert(pcm[0][0].every(value => value === .125)); assert.deepEqual(pcm[0][0], pcm[0][1]);
  f.processor.dispose(); assert.equal(f.core.disposed, 1); const silent = outputs(); assert.equal(f.processor.process([], silent), false); assert(silent[0].every(channel => channel.every(value => value === 0)));
});

test('SID preset changes and their ACKs stay FIFO even if a mutation becomes asynchronous; invalid edits preserve state', async () => {
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.receive({id: 1, method: 'setPreset', args: [{value: 8}]});
  f.processor.receive({id: 2, method: 'loadPreset', args: [{value: 9}]});
  f.processor.receive({id: 3, method: 'read'}); await flush();
  assert.equal(f.messages.filter(message => message.id).length, 0); assert.equal(f.processor.instrument.preset.value, 0);
  f.releaseEdit(); await f.processor.commands;
  assert.deepEqual(f.messages.filter(message => message.id).map(message => [message.id, message.value.preset.value]), [[1, 8], [2, 9], [3, 9]]);
  f.processor.receive({id: 4, method: 'setPreset', args: [{}]}); f.processor.receive({id: 5, method: 'read'});
  f.processor.receive({id: 6, method: 'constructor'}); f.processor.receive({id: 7, method: 'noteOn', args: {bad: true}}); await f.processor.commands;
  assert.equal(f.messages.find(message => message.id === 4).name, 'RangeError'); assert.equal(f.messages.find(message => message.id === 5).value.preset.value, 9);
  assert.match(f.messages.find(message => message.id === 6).error, /Unknown/); assert.match(f.messages.find(message => message.id === 7).error, /arguments must be an array/);
  assert.equal(f.processor.dead, false); f.processor.dispose();
});

test('SID disposal during startup destroys the eventual core without publishing readiness or playing queued notes', async () => {
  const f = fixture(); f.processor.receive({id: 1, method: 'noteOn', args: ['stale', 60]}); f.processor.receive({method: 'dispose'});
  f.resolve(); await f.processor.ready; await f.processor.commands;
  assert.equal(f.core.disposed, 1); assert.equal(f.messages.length, 0); assert.equal(f.processor.instrument, null);
});

test('SID startup/render failures produce one fatal reply and clear both output channels', async () => {
  const failed = fixture(); failed.reject(new Error('Bad WASM')); await failed.processor.ready;
  assert.equal(failed.messages.length, 1); assert.equal(failed.messages[0].fatal, true);
  const f = fixture(); f.resolve(); await f.processor.ready; f.processor.instrument.renderInto = () => { throw new Error('Broken render'); };
  const pcm = outputs(); assert.equal(f.processor.process([], pcm), false); assert(pcm[0].every(channel => channel.every(value => value === 0)));
  f.processor.fail(new Error('Second error')); assert.equal(f.messages.filter(message => message.fatal).length, 1); assert.equal(f.core.disposed, 1);
});

test('real SID Synth processor imports and renders WASM without Node, URL or base64 globals', () => {
  const script = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const wasmBinary=await readFile(new URL(${JSON.stringify(new URL('../generated/sid/sid.wasm', import.meta.url).href)}));
    let Constructor;
    globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:value=>{this.last=value;}};}};
    globalThis.registerProcessor=(name,value)=>{assert.equal(name,'tetorica-sid-synth');Constructor=value;};
    globalThis.sampleRate=48000;globalThis.URL=undefined;globalThis.process=undefined;globalThis.atob=undefined;globalThis.btoa=undefined;
    await import(${JSON.stringify(new URL('./processor.js', import.meta.url).href)});
    const processor=new Constructor({processorOptions:{wasmBinary}});await processor.ready;assert.equal(processor.last.ready,true);
    processor.receive({id:1,method:'noteOn',args:['real',60]});await processor.commands;assert.equal(processor.last.error,undefined);
    const left=new Float32Array(4096),right=new Float32Array(4096);assert.equal(processor.process([],[[left,right]]),true);
    assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));assert.deepEqual(left,right);
    processor.receive({id:2,method:'read'});await processor.commands;assert.equal(processor.last.value.voices.length,1);
    const before=processor.last.value.preset;
    processor.receive({id:3,method:'setPreset',args:[{waveform:'invalid'}]});await processor.commands;assert(processor.last.error);
    processor.receive({id:4,method:'read'});await processor.commands;assert.deepEqual(processor.last.value.preset,before);
    processor.receive({id:5,method:'stop'});await processor.commands;left.fill(9);right.fill(9);processor.process([],[[left,right]]);
    assert(left.every(value=>value===0));assert(right.every(value=>value===0));processor.receive({method:'dispose'});
    assert.equal(processor.process([],[[left,right]]),false);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', timeout: 20000});
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
