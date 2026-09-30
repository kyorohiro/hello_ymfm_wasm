import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MessageChannel} from 'node:worker_threads';
import {createYm2608Client} from './playground_ym2608.js';
import {Ym2608AudioEngine} from './ym2608audioengine.js';
import factory from '../docs/generated/ym2608_wasm.js';

test('client disposal rejects outstanding memory uploads and closes the port', async () => {
  const channel = new MessageChannel();
  const client = createYm2608Client(channel.port2);
  const pending = client.adpcm.loadMemory(new Uint8Array(32));
  const rejected = assert.rejects(pending, /disposed/);
  client.dispose(); client.dispose();
  await rejected;
  await assert.rejects(client.rhythm.loadRom(new Uint8Array(8192)), /disposed/);
  channel.port1.close();
});

test('Stop during worklet initialization disposes the late chip without announcing ready', async () => {
  let Processor, complete, disposed = false;
  const messages = [];
  const source = (await readFile(new URL('./playground_ym2608_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {
    Ym2608AudioEngine: {create: () => new Promise(resolve => { complete = resolve; })}, factory: {}, Uint8Array, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: data => messages.push(data)}; } },
    registerProcessor: (_, cls) => { Processor = cls; },
  });
  const processor = new Processor({processorOptions: {}});
  processor.receive({method: 'dispose'}, processor.port);
  complete({dispose() { disposed = true; }});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(disposed, true); assert.equal(messages.length, 0);
  assert.equal(processor.process([], []), false);
});

test('YM2608 port client and real worklet core: rhythm, SSG, ADPCM memory, reset and disposal', async () => {
  let Processor, readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const source = (await readFile(new URL('./playground_ym2608_worklet.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {Ym2608AudioEngine, factory, Uint8Array, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: data => readyResolve(data)}; } },
    registerProcessor: (_, cls) => { Processor = cls; },
  });
  const rom = await readFile(new URL('./tetorica_ym2608_adpcm_rom.bin', import.meta.url));
  const processor = new Processor({processorOptions: {
    wasmBinary: await readFile(new URL('../docs/generated/ym2608_wasm.wasm', import.meta.url)), rom,
  }});
  const channel = new MessageChannel();
  const synth = createYm2608Client(channel.port2);
  try {
    assert.equal((await ready).ready, true);
    processor.port.onmessage({data: {port: channel.port1}});
    const barrier = () => synth.rhythm.loadRom(rom);
    const render = () => {
      const output = [new Float32Array(4096), new Float32Array(4096)];
      processor.process([], [output]); return output;
    };
    const audible = data => data.some(x => Math.abs(x) > 0.001);
    synth.reset(); synth.rhythm.setVolume(48);
    synth.rhythm.setVoice(0, {volume: 24, left: true, right: false}); synth.rhythm.keyOn(0);
    await barrier();
    const [left, right] = render(); assert.ok(audible(left)); assert.ok(!audible(right));
    synth.reset(); synth.ssg.tone(0, {frequency: 440, volume: 12}); await barrier(); assert.ok(audible(render()[0]));
    synth.reset(); synth.setAlgo(0, 7, 0); synth.setPan(0, true, true);
    synth.setOperator(0, 3, {multi: 1, tl: 0, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15});
    synth.noteOn(0, 4, 600); await barrier(); assert.ok(audible(render()[0]));
    await synth.adpcm.loadMemory(new Uint8Array(256).fill(0x17));
    synth.reset(); // Uploaded memory must survive reset.
    synth.adpcm.setSample({start: 0, end: 256}); synth.adpcm.setVolume(200);
    synth.adpcm.setPan(true, true); synth.adpcm.setPlaybackRate(8000); synth.adpcm.keyOn();
    await barrier(); render();
    synth.adpcm.keyOn({repeat: true}); await barrier(); assert.ok(audible(render()[0]));
    // Execute the actual example without a global fm; every scheduled hit must sound.
    const example = await readFile(new URL('../docs/playground/examples/chip-saw/ym2608-rhythm.js', import.meta.url), 'utf8');
    let hits = 0;
    const run = new (Object.getPrototypeOf(async function() {}).constructor)('createSoundChip', 'sleep', example);
    await run(async name => { assert.equal(name, 'ym2608'); return synth; }, async seconds => {
      await barrier();
      const output = [new Float32Array(Math.round(48000 * seconds)), new Float32Array(Math.round(48000 * seconds))];
      processor.process([], [output]);
      assert.ok(audible(output[0]) && audible(output[1]), `example hit ${++hits}`);
    });
    assert.equal(hits, 14);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(processor.dead, true);
    assert.throws(() => synth.keyOn(0), /disposed/);
  } finally { synth.dispose(); processor.dispose(); channel.port1.close(); channel.port2.close(); }
});
