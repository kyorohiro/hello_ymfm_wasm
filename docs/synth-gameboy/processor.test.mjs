import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
function fixture() {
  let Constructor, resolve, reject;
  const messages = [], core = {disposed:0,dispose(){this.disposed++;}}, options = [];
  const initialization = new Promise((yes,no) => {resolve = yes; reject = no;});
  class Instrument {
    constructor(chip) { this.chip = chip; this.calls = []; }
    read() { return {voices:[]}; }
    noteOn(...args) { this.calls.push(args); return {channel:0,stolenId:null}; }
    dispose() { this.chip.dispose(); }
    generateStereo(frames) { return {left:new Float32Array(frames).fill(.1),right:new Float32Array(frames).fill(.2)}; }
  }
  class Processor { constructor(){this.port = {postMessage:value => messages.push(value)};} }
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''), {
    AudioWorkletProcessor:Processor, GameboyApu:{create:value => {options.push(value);return initialization;}},
    GameboyInstrument:Instrument, factory:()=>{}, sampleRate:48000, Set,
    registerProcessor(name,value){assert.equal(name,'tetorica-gameboy-synth');Constructor = value;},
  });
  const processor = new Constructor({processorOptions:{wasmBinary:new Uint8Array([0])}});
  return {processor, core, options, messages, resolve:() => resolve(core), reject};
}
const outputs = () => [[new Float32Array(128).fill(9),new Float32Array(128).fill(9)]];

test('Game Boy processor starts silent, renders host-rate stereo, preserves command order and rejects unknown methods', async () => {
  const f = fixture(), before = outputs();
  assert.equal(f.processor.process([],before),true); assert(before[0].every(row => row.every(value => value === 0)));
  f.processor.receive({id:1,method:'noteOn',args:['a',60]});
  f.processor.receive({id:2,method:'noteOn',args:['b',64]});
  f.resolve(); await f.processor.ready; await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(f.options[0].sampleRate,48000); assert.equal(f.options[0].moduleOptions.wasmBinary[0],0);
  assert.equal(f.messages[0].ready,true); assert.deepEqual(f.processor.instrument.calls,[['a',60],['b',64]]);
  const after = outputs(); assert.equal(f.processor.process([],after),true); assert(after[0][0].every(value => value > .09)); assert(after[0][1].every(value => value > .19));
  f.processor.receive({id:3,method:'constructor',args:[]}); await new Promise(resolve => queueMicrotask(resolve));
  assert.match(f.messages.find(item => item.id === 3).error,/Unknown/); assert.equal(f.processor.dead,false);
  f.processor.receive({method:'dispose'}); assert.equal(f.core.disposed,1); assert.equal(f.processor.process([],outputs()),false);
});

test('Disposing a Game Boy processor during initialization destroys the eventual core without publishing readiness', async () => {
  const f = fixture(); f.processor.receive({method:'dispose'}); f.resolve(); await f.processor.ready;
  assert.equal(f.core.disposed,1); assert.equal(f.messages.length,0); assert.equal(f.processor.process([],outputs()),false);
});

test('Game Boy initialization/render failures produce one fatal reply and silence rather than throwing out of process', async () => {
  const failed = fixture(); failed.reject(new Error('Broken WASM')); await failed.processor.ready;
  assert.equal(failed.messages.length,1); assert.equal(failed.messages[0].fatal,true); assert.match(failed.messages[0].error,/Broken WASM/);
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.instrument.generateStereo = () => {throw new Error('Render failed');};
  const out = outputs(); assert.equal(f.processor.process([],out),false); assert(out[0].every(row => row.every(value => value === 0)));
  assert.equal(f.core.disposed,1); assert.equal(f.messages.filter(item => item.fatal).length,1);
});

test('Actual Game Boy worklet imports and renders WASM without URL or Node globals', () => {
  const script = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const wasmBinary = await readFile(new URL(${JSON.stringify(new URL('../generated/gameboy_apu_wasm.wasm', import.meta.url).href)}));
    let Constructor;
    globalThis.AudioWorkletProcessor = class { constructor(){this.port={postMessage:value => {this.last=value;}};} };
    globalThis.registerProcessor = (name, value) => {assert.equal(name,'tetorica-gameboy-synth');Constructor=value;};
    globalThis.sampleRate=48000;
    globalThis.URL=undefined; globalThis.process=undefined;
    await import(${JSON.stringify(new URL('./processor.js', import.meta.url).href)});
    const processor = new Constructor({processorOptions:{wasmBinary}});
    await processor.ready;
    assert.equal(processor.last.ready,true);
    processor.receive({id:1,method:'noteOn',args:['actual',60]});
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(processor.last.id,1); assert.equal(processor.last.error,undefined);
    const left=new Float32Array(2048), right=new Float32Array(2048);
    assert.equal(processor.process([],[[left,right]]),true);
    assert(left.every(Number.isFinite)); assert(left.some(value => Math.abs(value)>.0001));
    processor.receive({method:'dispose'});
    assert.equal(processor.process([],[[left,right]]),false);
  `;
  const child = spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr || child.stdout);
});
