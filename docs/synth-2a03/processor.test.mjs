import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {OutputClickGuard} from './click_guard.js';

const source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
function fixture() {
  let Constructor, resolve, reject;
  const messages = [], core = {disposed:0,dispose(){this.disposed++;}}, options = [];
  const initialization = new Promise((yes,no) => {resolve = yes; reject = no;});
  class Instrument {
    constructor(chip) { this.chip = chip; this.calls = []; this.preset = {source:'pulse'}; this.voices = new Map(); }
    read() { return {voices:[]}; }
    noteOn(...args) {
      if (args[1] < 0) throw new RangeError('Bad note');
      this.calls.push(args); const stolenId = this.voices.keys().next().value ?? null;
      this.voices.clear(); this.voices.set(args[0], {id:args[0]});
      return {channel:this.preset.source === 'fds' ? 5 : this.preset.source === 'dmc' ? 4 : 0,stolenId};
    }
    noteOff(id) {return this.voices.delete(id);}
    stop() {this.voices.clear();return this.read();}
    setPreset(value) {this.preset = value;return this.read();}
    loadPreset(value) {this.stop();return this.setPreset(value);}
    dispose() { this.chip.dispose(); }
    generateStereo(frames) { return {left:new Float32Array(frames).fill(.1),right:new Float32Array(frames).fill(.2)}; }
  }
  class Processor { constructor(){this.port = {postMessage:value => messages.push(value)};} }
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''), {
    AudioWorkletProcessor:Processor, NesApuWasm:{create:value => {options.push(value);return initialization;}},
    NesInstrument:Instrument, OutputClickGuard, factory:()=>{}, sampleRate:48000, Set,
    registerProcessor(name,value){assert.equal(name,'tetorica-nes-fds-synth');Constructor = value;},
  });
  const processor = new Constructor({processorOptions:{wasmBinary:new Uint8Array([0])}});
  return {processor, core, options, messages, resolve:() => resolve(core), reject};
}
const outputs = () => [[new Float32Array(128).fill(9),new Float32Array(128).fill(9)]];

test('NES + FDS processor starts silent, renders host-rate stereo, preserves command order and rejects unknown methods', async () => {
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

test('Disposing a NES + FDS processor during initialization destroys the eventual core without publishing readiness', async () => {
  const f = fixture(); f.processor.receive({method:'dispose'}); f.resolve(); await f.processor.ready;
  assert.equal(f.core.disposed,1); assert.equal(f.messages.length,0); assert.equal(f.processor.process([],outputs()),false);
});

test('software click guard follows successful FDS / DMC ownership and keeps stale or invalid commands atomic', async () => {
  for (const source of ['fds','dmc']) {
    const f = fixture(); f.resolve(); await f.processor.ready;
    let id = 0;
    const command = async (method, args = []) => {
      const next = ++id; f.processor.receive({id:next,method,args}); await new Promise(resolve => queueMicrotask(resolve));
      return f.messages.find(message => message.id === next);
    };
    await command('loadPreset',[{source}]); await command('noteOn',['owned',60]);
    assert.equal(f.processor.clickGuard.read().phase,'attack');
    for (let block=0;block<3;block++) f.processor.process([],outputs());
    assert.equal(f.processor.clickGuard.read().phase,'bypass');
    assert.equal((await command('noteOff',['stale'])).value,false);
    assert.equal(f.processor.clickGuard.read().phase,'bypass');
    const before=f.processor.clickGuard.read();assert.match((await command('noteOn',['bad',-1])).error,/Bad note/);
    assert.deepEqual(f.processor.clickGuard.read(),before);assert(f.processor.instrument.voices.has('owned'));
    await command('noteOn',['new',64]);const bridge=f.processor.clickGuard.read();
    assert.equal((await command('noteOff',['owned'])).value,false);assert.deepEqual(f.processor.clickGuard.read(),bridge);
    assert.equal((await command('noteOff',['new'])).value,true);
    assert.equal(f.processor.clickGuard.read().phase,'release');
    for (let block=0;block<3;block++) f.processor.process([],outputs());
    const muted=outputs();f.processor.process([],muted);assert(muted[0].every(row=>row.every(value=>value===0)));
    assert.equal(f.processor.clickGuard.read().phase,'muted');
    await command('setClickGuard',[false]);await command('noteOn',['raw',60]);
    const raw=outputs();f.processor.process([],raw);assert(raw[0][0].every(value=>value===Math.fround(.1)));
    assert.equal(f.processor.clickGuard.read().phase,'bypass');
    const calls=[...f.processor.instrument.calls];await command('setClickGuard',[true]);
    assert.deepEqual(f.processor.instrument.calls,calls);assert(f.processor.instrument.voices.has('raw'));
    const enabled=f.processor.clickGuard.read();assert.match((await command('setClickGuard',['false'])).error,/boolean/);
    assert.deepEqual(f.processor.clickGuard.read(),enabled);assert.equal(f.processor.clickGuardEnabled,true);
    await command('read');assert.equal(f.messages.at(-1).value.outputClickGuard.enabled,true);
    await command('stop');assert.equal(f.processor.clickGuard.read().phase,'release');
    f.processor.dispose();
  }
});

test('Pulse / Triangle / Noise bypass click guard at note edges and during preference changes', async () => {
  const f=fixture();f.resolve();await f.processor.ready;
  const command=async(method,args=[])=>{f.processor.receive({method,args});await new Promise(resolve=>queueMicrotask(resolve));};
  for(const source of ['pulse','triangle','noise']) {
    await command('loadPreset',[{source}]);await command('noteOn',['held',60]);
    for(const enabled of [false,true]) {
      await command('setClickGuard',[enabled]);
      const raw=outputs();f.processor.process([],raw);assert(raw[0][0].every(value=>value===Math.fround(.1)));assert(raw[0][1].every(value=>value===Math.fround(.2)));
      assert.equal(f.processor.clickGuard.read().phase,'bypass');
    }
    await command('noteOff',['held']);await command('stop');assert.equal(f.processor.clickGuard.read().phase,'bypass');
  }
  f.processor.dispose();
});

test('NES + FDS initialization/render failures produce one fatal reply and silence rather than throwing out of process', async () => {
  const failed = fixture(); failed.reject(new Error('Broken WASM')); await failed.processor.ready;
  assert.equal(failed.messages.length,1); assert.equal(failed.messages[0].fatal,true); assert.match(failed.messages[0].error,/Broken WASM/);
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.instrument.generateStereo = () => {throw new Error('Render failed');};
  const out = outputs(); assert.equal(f.processor.process([],out),false); assert(out[0].every(row => row.every(value => value === 0)));
  assert.equal(f.core.disposed,1); assert.equal(f.messages.filter(item => item.fatal).length,1);
});

test('Actual NES + FDS worklet imports and renders WASM without URL or Node globals', () => {
  const script = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const {createDefaultPreset,createDemoDpcm}=await import(${JSON.stringify(new URL('./preset.js', import.meta.url).href)});
    const wasmBinary = await readFile(new URL(${JSON.stringify(new URL('../generated/nesapu_wasm.wasm', import.meta.url).href)}));
    let Constructor;
    globalThis.AudioWorkletProcessor = class { constructor(){this.port={postMessage:value => {this.last=value;}};} };
    globalThis.registerProcessor = (name, value) => {assert.equal(name,'tetorica-nes-fds-synth');Constructor=value;};
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
    for(const source of ['fds','dmc']) {
      const preset=createDefaultPreset();preset.source=source;
      if(source==='dmc'){preset.dmc.data=createDemoDpcm();preset.dmc.loop=true;}
      processor.receive({id:2,method:'loadPreset',args:[preset]});
      processor.receive({id:3,method:'noteOn',args:['guarded',60]});
      await new Promise(resolve=>queueMicrotask(resolve));
      assert.equal(processor.last.error,undefined);
      assert.equal(processor.process([],[[left,right]]),true);assert(left.some(value=>Math.abs(value)>.0001));
      processor.receive({id:4,method:'read',args:[]});await new Promise(resolve=>queueMicrotask(resolve));
      assert.equal(processor.last.value.outputClickGuard.enabled,true);assert.equal(processor.last.value.outputClickGuard.phase,'bypass');
      processor.receive({id:5,method:'noteOff',args:['guarded']});await new Promise(resolve=>queueMicrotask(resolve));
      assert.equal(processor.process([],[[left,right]]),true);
      assert(left.subarray(240).every(value=>value===0));assert(right.subarray(240).every(value=>value===0));
      processor.receive({id:6,method:'read',args:[]});await new Promise(resolve=>queueMicrotask(resolve));
      assert.equal(processor.last.value.outputClickGuard.phase,'muted');assert.equal(processor.last.value.voices.length,0);
    }
    processor.receive({method:'dispose'});
    assert.equal(processor.process([],[[left,right]]),false);
  `;
  const child = spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr || child.stdout);
});
