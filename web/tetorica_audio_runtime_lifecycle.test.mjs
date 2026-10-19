import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {SoundChipMixer} from './soundchip_mixer.js';

// Exercise the real lifecycle with a deferred rack factory, without creating an
// audio device or depending on fetch/WebAssembly compilation timing.
const source = (await readFile(new URL('./tetorica_audio_runtime.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export class TetoricaAudioRuntime','class TetoricaAudioRuntime') +
  '\nglobalThis.Runtime = TetoricaAudioRuntime;';
function fixture() {
  const pending = [];
  const scope = vm.createContext({SoundChipMixer,DOMException,
    createNativeFXRack(context) {
      return new Promise((resolve,reject) => pending.push({context,resolve,reject}));
    },
  });
  vm.runInContext(source,scope);
  const runtime = new scope.Runtime({audioContext:{}}), routing = [];
  runtime.rebuildFXChain = () => routing.push(runtime.nativeFX);
  const rack = () => ({disposals:0,dispose() {this.disposals++;}});
  return {runtime,pending,routing,rack};
}

test('concurrent native FX preparation shares one rack and routes it once', async () => {
  const {runtime,pending,routing,rack} = fixture();
  const first = runtime.prepareNativeFX(), second = runtime.prepareNativeFX();
  assert.equal(pending.length,1);
  const prepared = rack(); pending[0].resolve(prepared);
  assert.equal(await first,prepared); assert.equal(await second,prepared);
  assert.deepEqual(routing,[prepared]);
  assert.equal(await runtime.prepareNativeFX(),prepared);
  assert.equal(pending.length,1);
  runtime.disposeFXChain(); runtime.disposeFXChain();
  assert.equal(prepared.disposals,1);
});

test('closing during preparation disposes a late rack without reconnecting it', async () => {
  const {runtime,pending,routing,rack} = fixture();
  const cancelled = assert.rejects(runtime.prepareNativeFX(),{name:'AbortError'});
  runtime.disposeFXChain();
  const old = rack(); pending[0].resolve(old);
  await cancelled;
  assert.equal(old.disposals,1);
  assert.equal(runtime.nativeFX,undefined);
  assert.deepEqual(routing,[]);
});

test('a late retired preparation cannot replace a restarted session’s rack or promise', async () => {
  const {runtime,pending,routing,rack} = fixture();
  const cancelled = assert.rejects(runtime.prepareNativeFX(),{name:'AbortError'});
  runtime.disposeFXChain();
  runtime.audioContext = {};
  const restarting = runtime.prepareNativeFX(), replacement = rack();
  assert.equal(pending.length,2);
  const old = rack(); pending[0].resolve(old);
  await cancelled;
  const joining = runtime.prepareNativeFX();
  assert.equal(pending.length,2,'retired completion must not clear the new preparation');
  pending[1].resolve(replacement);
  assert.equal(await restarting,replacement); assert.equal(await joining,replacement);
  assert.equal(runtime.nativeFX,replacement);
  assert.deepEqual(routing,[replacement]);
  assert.equal(old.disposals,1);
  runtime.disposeFXChain(); assert.equal(replacement.disposals,1);
});

test('a changed audio context rejects the obsolete rack even without a completed close', async () => {
  const {runtime,pending,routing,rack} = fixture();
  const cancelled = assert.rejects(runtime.prepareNativeFX(),{name:'AbortError'});
  runtime.audioContext = {};
  const old = rack(); pending[0].resolve(old);
  await cancelled;
  assert.equal(old.disposals,1); assert.deepEqual(routing,[]);
});

test('failed native FX preparation clears its reservation and permits retry', async () => {
  const {runtime,pending,rack} = fixture();
  const failed = assert.rejects(runtime.prepareNativeFX(),/rack failed/);
  pending[0].reject(new Error('rack failed')); await failed;
  const retry = runtime.prepareNativeFX(), prepared = rack();
  assert.equal(pending.length,2);
  pending[1].resolve(prepared); assert.equal(await retry,prepared);
  runtime.disposeFXChain(); assert.equal(prepared.disposals,1);
});
