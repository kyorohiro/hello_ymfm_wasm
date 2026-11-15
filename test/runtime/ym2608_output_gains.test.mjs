import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ym2608,normalizeYm2608OutputGains} from '../../tetorica_src/runtime/ym2608.js';
import {Ym2608AudioEngine} from '../../tetorica_src/runtime/ym2608audioengine.js';
import {createPerformanceQueue,createPerformanceChipOwnership} from '../../tetorica_src/runtime/playground_performance_queue.js';
import {createChipPortReceiver} from '../../tetorica_src/runtime/playground_chip_port.js';
import {createOpnAuditionGuard,receiveOpnAuditionCommand} from '../../tetorica_src/runtime/playground_audition_guard.js';
import {validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';

test('YM2608 output gain validation merges partial edits atomically and returns detached values',() => {
  const writes = [];
  const chip = new Ym2608({},1,{setOutputGains(...args) {writes.push(args);return 1;}});
  assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:1});
  assert.deepEqual(chip.setOutputGains({ssg:.75}),{fm:1,ssg:.75});
  assert.deepEqual(chip.setOutputGains({fm:3.8}),{fm:3.8,ssg:.75});
  const accepted = chip.getOutputGains();accepted.ssg = 99;
  assert.equal(chip.getOutputGains().ssg,.75);
  for (const invalid of [null,[],{ssg:NaN},{fm:-1},{fm:Infinity},{ssg:1024.01},{fm:.5,ssg:undefined},{volume:1}]) {
    assert.throws(() => chip.setOutputGains(invalid));
    assert.deepEqual(chip.getOutputGains(),{fm:3.8,ssg:.75});
  }
  assert.equal(writes.length,2);
  assert.deepEqual(chip.setOutputGains({fm:0,ssg:1024}),{fm:0,ssg:1024});
});

test('YM2608 rejected native output gains preserve the last accepted state and legacy defaults still work',() => {
  const chip = new Ym2608({},1,{setOutputGains:() => 0});
  assert.throws(() => chip.setOutputGains({ssg:.75}),/rejected/);
  assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:1});
  const legacy = new Ym2608({},1,{});
  assert.deepEqual(legacy.setOutputGains({fm:1,ssg:1}),{fm:1,ssg:1});
  assert.throws(() => legacy.setOutputGains({ssg:.75}),/Reload/);
  legacy.handle = 0;
  assert.throws(() => legacy.setOutputGains({fm:1}),/disposed/);
});

test('YM2608 engine state keys follow bus gains and can recover when the same mixer settings return',() => {
  let gains = {fm:1,ssg:1}, restored = 0;
  const chip = {
    supportsState:() => true,saveState:() => ({byteLength:16}),validateState() {},loadState() {restored++;},
    getOutputGains:() => ({...gains}),setOutputGains:patch => gains=normalizeYm2608OutputGains(patch,gains),
  };
  const engine = new Ym2608AudioEngine(chip,1000000,44100);
  const saved = engine.saveState();
  engine.setOutputGains({ssg:.75});
  assert.throws(() => engine.loadState(saved),/Incompatible/);
  assert.equal(restored,0);
  engine.setOutputGains({ssg:1});
  engine.loadState(saved);
  assert.equal(restored,1);
});

test('YM2608 primary worklet retains pre-initialization gains and validates live mixer messages',async () => {
  let Processor;
  const replies = [], writes = [];
  const scope = {
    currentFrame:0,sampleRate:48000,Uint8Array,Uint32Array,Float32Array,Error,
    createPerformanceQueue,createPerformanceChipOwnership,createChipPortReceiver,
    createOpnAuditionGuard,receiveOpnAuditionCommand,validateChipClock,normalizeYm2608OutputGains,
    AudioWorkletProcessor:class {constructor() {this.port={postMessage:message => replies.push(message)};}},
    registerProcessor(_name,Type) {Processor=Type;},
  };
  const source = await readFile(new URL('../../tetorica_src/runtime/ym2608-worklet.js',import.meta.url),'utf8');
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''),scope);
  const processor = new Processor();
  const send = gains => processor.port.onmessage({data:{type:'output-gains',gains}});
  send({ssg:.75});
  assert.deepEqual({...processor.outputGains},{fm:1,ssg:.75});
  processor.chip = {setOutputGains:gains => writes.push({...gains})};
  send({fm:.5});
  assert.deepEqual(writes,[{fm:.5,ssg:.75}]);
  send({fm:2,ssg:NaN});
  assert.equal(replies.at(-1).type,'error');
  assert.equal(writes.length,1);
  assert.deepEqual({...processor.outputGains},{fm:.5,ssg:.75});
});

test('real YM2608 output gains scale SSG without changing registers and restore through chip snapshots',async t => {
  const {default:factory} = await import('../../tetorica_src/runtime/generated/ym2608_wasm.js');
  const wasmBinary = await readFile(new URL('../../tetorica_src/runtime/generated/ym2608_wasm.wasm',import.meta.url));
  const chip = await Ym2608.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  t.after(() => chip.dispose());
  const write = (register,value) => {chip.write(0,register);chip.write(1,value);};
  write(0,120);write(1,0);write(7,0x3e);write(8,12);
  const saved = chip.saveState();
  const original = chip.generateStereo(4096);
  chip.loadState(saved);
  chip.setOutputGains({ssg:.75});
  const gainState = chip.saveState(), adjusted = chip.generateStereo(4096);
  assert(original.left.some(value => Math.abs(value) > .01));
  for (let index=0;index<original.left.length;index++) {
    assert(Math.abs(adjusted.left[index]-original.left[index]*.75)<1e-6);
    assert.equal(adjusted.right[index],adjusted.left[index]);
  }
  chip.setOutputGains({fm:.2,ssg:.1});
  chip.loadState(gainState);
  assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:.75});
  assert.deepEqual(chip.generateStereo(4096),adjusted);
  chip.reset();
  assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:.75});
  chip.loadState(saved);
  assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:1});
  assert.deepEqual(chip.generateStereo(4096),original);
});
