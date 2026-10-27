import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSoundChip} from '../web/soundchip.js';
import {WonderSwan, WONDERSWAN_CLOCK} from '../web/wonderswan.js';
import createModule from '../docs/generated/wonderswan_wasm.js';

const wasmBinary = await readFile(new URL('../docs/generated/wonderswan_wasm.wasm', import.meta.url));
const moduleFactory = options => createModule({wasmBinary, ...options});

function tone(chip) {
  chip.loadMemory(Uint8Array.from({length:16}, (_, index) => index | (15 - index) << 4), 0x100);
  for (const [address, value] of [[0x8f,4], [0x80,0x26], [0x81,7], [0x88,0xf9], [0x91,8], [0x90,1]]) {
    chip.writeRegister(address, value);
  }
}

for (const options of [{}, {clock:3200011, sampleRate:48000}]) {
  test(`direct WonderSwan factory preserves standalone PCM at ${options.clock ?? WONDERSWAN_CLOCK} Hz / ${options.sampleRate ?? 44100} Hz`, async () => {
    const actual = await createSoundChip('wonderswan', {...options, id:'wonderswan-parity'});
    const expected = await WonderSwan.create({...options, moduleFactory});
    try {
      assert(actual instanceof WonderSwan);
      assert.equal(actual.clock, options.clock ?? WONDERSWAN_CLOCK);
      assert.equal(actual.sampleRate(), options.sampleRate ?? 44100);
      assert.equal(actual.id, 'wonderswan-parity');
      assert.deepEqual(Object.getOwnPropertyDescriptor(actual, 'id'), {
        value:'wonderswan-parity', enumerable:true, writable:false, configurable:false,
      });
      tone(actual); tone(expected);
      for (const frames of [1, 127, 513]) {
        const pcm = actual.generateStereo(frames);
        assert.deepEqual(pcm, expected.generateStereo(frames));
        if (frames > 1) assert(pcm.left.some(value => value > 0));
      }
    } finally {actual.dispose(); expected.dispose();}
    actual.dispose();
    assert.throws(() => actual.generateStereo(1), /disposed/);
  });
}

test('direct WonderSwan chips have independent state and unique automatic IDs even with a shared WASM module', async () => {
  const module = await moduleFactory();
  const chips = await Promise.all([createSoundChip('wonderswan', {moduleFactory:() => module}),
    createSoundChip('wonderswan', {moduleFactory:() => module})]);
  const [a, b] = chips;
  try {
    assert.match(a.id, /^wonderswan:\d+$/); assert.match(b.id, /^wonderswan:\d+$/);
    assert.notEqual(a.id, b.id);
    a.writeMemory(0x200, 0xa5); b.writeMemory(0x200, 0x3c);
    assert.equal(a.readMemory(0x200), 0xa5); assert.equal(b.readMemory(0x200), 0x3c);
    tone(a);
    assert(a.generateStereo(512).left.some(value => value > 0));
    assert(b.generateStereo(512).left.every(value => value === 0));
    a.dispose();
    tone(b);
    assert(b.generateStereo(512).left.some(value => value > 0));
  } finally {for (const chip of chips) chip.dispose();}
});

test('injected WonderSwan factory receives module options and releases its native handle and render buffer', async () => {
  const module = await moduleFactory();
  const calls = {factory:0, create:[], destroy:0, free:0};
  const tracked = new Proxy(module, {get(target, key) {
    if (key === '_wonderswan_create') return (...args) => {calls.create.push(args); return target[key](...args);};
    if (key === '_wonderswan_destroy') return (...args) => {calls.destroy++; return target[key](...args);};
    if (key === '_free') return (...args) => {calls.free++; return target[key](...args);};
    return Reflect.get(target, key);
  }});
  const print = () => {}, settings = {wasmBinary, print, noInitialRun:true, customSetting:'kept'};
  const chip = await createSoundChip('wonderswan', {
    clock:3000128, sampleRate:32000, assetBaseUrl:'file:///missing-wonderswan-assets/',
    moduleOptions:settings,
    moduleFactory(options) {
      calls.factory++;
      assert.notEqual(options, settings);
      assert.deepEqual(options, settings);
      return tracked;
    },
  });
  try {
    assert.equal(calls.factory, 1); assert.deepEqual(calls.create, [[3000128,32000]]);
    tone(chip);
    const owned = chip.generateStereo(512), snapshot = owned.left.slice();
    assert(snapshot.some(value => value > 0));
    chip.dispose(); chip.dispose();
    assert.equal(calls.destroy, 1); assert.equal(calls.free, 1);
    assert.deepEqual(owned.left, snapshot);
  } finally {chip.dispose();}
});

test('automatic WonderSwan asset loading accepts supplied WASM bytes without a neighboring WASM file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wonderswan-factory-'));
  let chip;
  try {
    await copyFile(new URL('../docs/generated/wonderswan_wasm.js', import.meta.url), join(directory, 'wonderswan_wasm.js'));
    chip = await createSoundChip('wonderswan', {
      assetBaseUrl:pathToFileURL(`${directory}/`), moduleOptions:{wasmBinary},
    });
    tone(chip);
    assert(chip.generateStereo(512).left.some(value => value > 0));
  } finally {chip?.dispose(); await rm(directory, {recursive:true, force:true});}
});

test('an already aborted WonderSwan request does not import assets or invoke its injected factory', async () => {
  const controller = new AbortController(), reason = new Error('cancelled before WonderSwan loading');
  controller.abort(reason);
  let calls = 0;
  for (const options of [{assetBaseUrl:'file:///missing-wonderswan-assets/'}, {moduleFactory() {calls++; throw new Error('must not initialize');}}]) {
    await assert.rejects(createSoundChip('wonderswan', {...options, signal:controller.signal}), error => error === reason);
  }
  assert.equal(calls, 0);
});

test('unsupported generic Worklet execution rejects before allocating an AudioContext', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let contexts = 0;
  Object.defineProperty(globalThis, 'AudioContext', {configurable:true, value:class {
    constructor() {contexts++; throw new Error('must not allocate audio');}
  }});
  try {
    await assert.rejects(createSoundChip('ym2203', {execution:'worklet'}), /Worklet chip not supported: ym2203/);
    assert.equal(contexts, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'AudioContext', descriptor);
    else delete globalThis.AudioContext;
  }
});
