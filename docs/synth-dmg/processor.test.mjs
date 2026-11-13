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
    constructor(chip) { this.chip = chip; this.calls = []; this.codeEpoch = 0; this.codeActive = false; this.stopCount = 0; }
    read() { return {voices:[]}; }
    noteOn(...args) { this.calls.push(args); return {channel:0,stolenId:null}; }
    stop() {this.stopCount++;this.codeActive=false;this.codeEpoch++;return this.read();}
    beginCode() {this.stop();this.codeActive=true;return {session:this.codeEpoch,clock:4194304,channels:4,editorSource:'pulse'};}
    applyCodePreset(session,value) {if(!this.codeActive||session!==this.codeEpoch){const error=new Error('stale');error.name='AbortError';throw error;}this.calls.push(['applyCodePreset',value]);return {preset:value};}
    applyCodeEdit(session,value){if(!this.codeActive||session!==this.codeEpoch){const error=new Error('stale');error.name='AbortError';throw error;}this.calls.push(['applyCodeEdit',value]);return {preset:value};}
    releaseKeyboard(){this.calls.push(['releaseKeyboard']);return this.read();}
    observeCode() {return this.codeActive ? {clock:4194304,registers:Array(48).fill(0),voice:Array(48).fill(0)} : null;}
    observeEditor(){return{channelPresets:Array(4).fill(null)};}
    applyChannelEdit(edit){this.calls.push(['applyChannelEdit',edit]);return this.read();}
    loadChannelBank(bank){this.calls.push(['loadChannelBank',bank]);return this.read();}
    code(session,method,args) {
      if (!this.codeActive || session !== this.codeEpoch) {const error = new Error('stale');error.name='AbortError';throw error;}
      return {method,args};
    }
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
  f.resolve(); await f.processor.ready; await f.processor.commands;
  assert.equal(f.options[0].sampleRate,48000); assert.equal(f.options[0].moduleOptions.wasmBinary[0],0);
  assert.equal(f.messages[0].ready,true); assert.deepEqual(f.processor.instrument.calls,[['a',60],['b',64]]);
  const after = outputs(); assert.equal(f.processor.process([],after),true); assert(after[0][0].every(value => value > .09)); assert(after[0][1].every(value => value > .19));
  f.processor.receive({id:3,method:'constructor',args:[]}); await f.processor.commands;
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

test('Stop received during initialization cancels older keyboard/Code work before it can touch the eventual APU', async () => {
  const f = fixture();
  f.processor.receive({id:1,method:'noteOn',args:['old',60]});
  f.processor.receive({id:2,method:'beginCode'});
  f.processor.receive({id:3,method:'stop'});
  f.processor.receive({id:4,method:'noteOn',args:['new',64]});
  f.resolve(); await f.processor.commands;
  for (const id of [1,2]) assert.equal(f.messages.find(message => message.id === id).name,'AbortError');
  assert.deepEqual(f.processor.instrument.calls,[['new',64]]);
  assert.equal(f.processor.instrument.stopCount,1);
  assert(!f.messages.find(message => message.id === 3).error);
});

test('Code leases are monotonic, observations never acquire a lease, and malformed Stop does not retire the current owner', async () => {
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.receive({id:1,method:'observeCode'}); await f.processor.commands;
  assert.equal(f.messages.find(message => message.id === 1).value,null);
  f.processor.receive({id:2,method:'beginCode'}); await f.processor.commands;
  const first = f.messages.find(message => message.id === 2).value;
  f.processor.receive({id:3,method:'stop',args:[1]}); await f.processor.commands;
  assert.equal(f.messages.find(message => message.id === 3).name,'TypeError');
  f.processor.receive({id:4,method:'code',args:[first.session,'pulse.keyOn',[0]]}); await f.processor.commands;
  assert(!f.messages.find(message => message.id === 4).error);
  f.processor.receive({id:5,method:'beginCode'}); await f.processor.commands;
  const next = f.messages.find(message => message.id === 5).value; assert(next.session > first.session);
  f.processor.receive({id:6,method:'code',args:[first.session,'reset',[]]}); await f.processor.commands;
  assert.equal(f.messages.find(message => message.id === 6).name,'AbortError');
  f.processor.receive({method:'dispose'});
});

test('Stop preempts a pending Code result and no stale ACK can claim that the retired owner remains current', async () => {
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.receive({id:1,method:'beginCode'}); await f.processor.commands;
  const metadata = f.messages.find(message => message.id === 1).value;
  let release;
  f.processor.instrument.code = () => new Promise(resolve => {release = resolve;});
  f.processor.receive({id:2,method:'code',args:[metadata.session,'pulse.keyOn',[0]]});
  await Promise.resolve(); assert.equal(typeof release,'function');
  f.processor.receive({id:3,method:'stop'});
  assert.equal(f.processor.instrument.codeActive,false,'physical Stop runs before the pending reply settles');
  release(true); await f.processor.commands;
  assert.equal(f.messages.find(message => message.id === 2).name,'AbortError');
  assert(!f.messages.find(message => message.id === 3).error);
  f.processor.receive({method:'dispose'});
});

test('an immediate physical Stop failure becomes one fatal processor error instead of escaping the message callback', async () => {
  const f = fixture(); f.resolve(); await f.processor.ready;
  f.processor.instrument.stop = () => {throw new Error('Native state restore failed');};
  assert.doesNotThrow(() => f.processor.receive({id:1,method:'stop'}));
  assert.equal(f.messages.filter(message => message.fatal).length,1);
  assert.match(f.messages.find(message => message.fatal).error,/restore failed/);
  assert.equal(f.processor.dead,true);
});

test('preset updates use the current public/native session without retiring its Code owner, and old sessions are rejected',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;f.processor.receive({id:1,method:'beginCode'});await f.processor.commands;
  const session=f.messages.find(message=>message.id===1).value.session,owner=f.processor.codeOwner;
  f.processor.receive({id:2,method:'applyCodePreset',args:[session,{source:'wave'}]});await f.processor.commands;
  assert.equal(f.processor.codeOwner,owner);assert.equal(f.processor.instrument.codeActive,true);assert.deepEqual(f.processor.instrument.calls,[['applyCodePreset',{source:'wave'}]]);
  f.processor.receive({id:3,method:'beginCode'});await f.processor.commands;f.processor.receive({id:4,method:'applyCodePreset',args:[session,{source:'noise'}]});await f.processor.commands;
  assert.equal(f.messages.find(message=>message.id===4).name,'AbortError');assert.equal(f.processor.instrument.calls.length,1);f.processor.dispose();
});

test('Stop preempts a pending live-preset ACK and cannot publish a stale successful owner',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;f.processor.receive({id:1,method:'beginCode'});await f.processor.commands;
  const session=f.messages.find(message=>message.id===1).value.session;let finish;f.processor.instrument.applyCodePreset=()=>new Promise(resolve=>finish=resolve);
  f.processor.receive({id:2,method:'applyCodePreset',args:[session,{}]});await Promise.resolve();assert.equal(typeof finish,'function');
  f.processor.receive({id:3,method:'stop'});finish({});await f.processor.commands;assert.equal(f.messages.find(message=>message.id===2).name,'AbortError');assert.equal(f.processor.codeOwner,null);f.processor.dispose();
});

test('selected channel edits and keyboard-only cleanup use the same Code session and preserve explicit physical channel options',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;f.processor.receive({id:1,method:'beginCode'});await f.processor.commands;
  const owner=f.processor.codeOwner,session=f.messages.find(message=>message.id===1).value.session;
  f.processor.receive({id:2,method:'applyCodeEdit',args:[session,{channel:1,changes:{'pulse.duty':.25}}]});
  f.processor.receive({id:3,method:'noteOn',args:['keyboard',64,{channel:1}]});
  f.processor.receive({id:4,method:'releaseKeyboard',args:[]});await f.processor.commands;
  assert.equal(f.processor.codeOwner,owner);assert(f.processor.instrument.codeActive);
  assert.deepEqual(f.processor.instrument.calls,[['applyCodeEdit',{channel:1,changes:{'pulse.duty':.25}}],['keyboard',64,{channel:1}],['releaseKeyboard']]);
  f.processor.receive({id:5,method:'stop'});f.processor.receive({id:6,method:'applyCodeEdit',args:[session,{channel:0,changes:{'pulse.duty':.5}}]});await f.processor.commands;
  assert.equal(f.messages.find(message=>message.id===6).name,'AbortError');f.processor.dispose();
});

test('idle bank observation/editing is passive and common Code edits pass an explicit replacement policy without retiring the owner',async()=>{
  const f=fixture();f.resolve();await f.processor.ready;
  f.processor.receive({id:1,method:'observeEditor'});f.processor.receive({id:2,method:'applyChannelEdit',args:[{channel:1,changes:{'pulse.duty':.75}}]});f.processor.receive({id:3,method:'loadChannelBank',args:[['bank']]});
  await f.processor.commands;assert.equal(f.processor.instrument.codeActive,false);assert.equal(f.processor.codeOwner,null);assert.equal(f.processor.instrument.stopCount,0);
  assert.equal(f.messages.find(message=>message.id===1).value.channelPresets.length,4);
  assert.deepEqual(f.processor.instrument.calls,[['applyChannelEdit',{channel:1,changes:{'pulse.duty':.75}}],['loadChannelBank',['bank']]]);
  f.processor.receive({id:4,method:'beginCode'});await f.processor.commands;const owner=f.processor.codeOwner,session=f.messages.find(message=>message.id===4).value.session;
  let seen;f.processor.instrument.applyCodePreset=(...args)=>{seen=args;return{};};
  f.processor.receive({id:5,method:'applyCodePreset',args:[session,{name:'preset'},{replace:false}]});await f.processor.commands;
  assert.deepEqual(seen,[owner.token,{name:'preset'},null,false]);assert.equal(f.processor.codeOwner,owner);
  f.processor.receive({id:6,method:'applyCodePreset',args:[session,{}, {replace:0}]});await f.processor.commands;assert.equal(f.messages.find(message=>message.id===6).name,'TypeError');assert.equal(f.processor.codeOwner,owner);
  f.processor.dispose();
});
