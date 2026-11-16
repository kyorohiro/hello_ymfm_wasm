// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createAtariSongEngine, readAtariSource, ATARI_PLAYER_LIMITS } from './atari_engine.js';
import { makeYm3Fixture, makeYm5Fixture, makeSndhFixture, packLhaFixture, packIceFixture } from './atari_test_fixtures.mjs';
import { checkAtariAudioPlayerBuild } from '../../scripts/atari_audio_player_artifacts.mjs';

const wasmBytes = await readFile(new URL('../generated/atari-audio-player/atari-audio-player.wasm', import.meta.url));

async function nativeCore() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: { emscripten_notify_memory_growth() {}, abort() { throw new Error('native abort'); } },
    wasi_snapshot_preview1: { proc_exit(code) { throw new Error(`exit ${code}`); }, fd_write() { return 0; }, fd_close() { return 0; }, fd_seek() { return 0; } },
  });
  const core = instance.exports;
  core._initialize?.();
  const text = pointer => {
    const bytes = new Uint8Array(core.memory.buffer);
    return new TextDecoder().decode(bytes.subarray(pointer, bytes.indexOf(0, pointer)));
  };
  return {
    core,
    open(bytes, subsong = 1) {
      const pointer = core.atari_alloc(bytes.length);
      assert.ok(pointer);
      new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes);
      const result = core.atari_open(pointer, bytes.length, subsong);
      core.atari_free(pointer);
      return { result, error: text(core.atari_error()) };
    },
    text,
    output(count) { return new Int16Array(core.memory.buffer, core.atari_output(), count).slice(); },
  };
}

test('native AtariAudio source and WASM receipt match', async () => {
  const receipt = await checkAtariAudioPlayerBuild();
  assert.equal(receipt.upstream.revision, '1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb');
  assert.equal(receipt.maximumMemoryBytes, 64 * 1024 * 1024);
});

for (const [name, bytes] of [
  ['YM3', makeYm3Fixture()], ['YM5 interleaved', makeYm5Fixture()],
  ['YM5 sequential', makeYm5Fixture({ interleaved: false })], ['LHA YM5', packLhaFixture(makeYm5Fixture())],
  ['YM5 empty digidrum slot', makeYm5Fixture({ emptySample: true })],
]) {
  test(`${name} generates native PCM and observed YM registers`, async () => {
    const host = await nativeCore();
    assert.equal(host.open(bytes).result, 1);
    assert.equal(host.core.atari_clock(), 2000000);
    assert.equal(host.core.atari_subsong_count(), 1);
    assert.ok(host.core.atari_duration() > 4096);
    assert.equal(host.core.atari_render(4096), 4096);
    const pcm = host.output(4096);
    assert.ok(pcm.some(value => Math.abs(value) > 100));
    assert.equal(host.core.atari_register(0), 0xc4);
    assert.equal(host.core.atari_register(1), 1);
    assert.equal(host.core.atari_register(7), 0x3e);
    assert.equal(host.core.atari_register(8), 15);
    assert.equal(host.core.atari_frame(), 4096);
    assert.equal(host.open(bytes).result, 1);
    host.core.atari_render(4096);
    assert.deepEqual(host.output(4096), pcm);
    host.core.atari_close();
  });
}

for (const packed of [false, true]) test(`${packed ? 'ICE-packed' : 'Raw'} synthetic SNDH executes native 68000 init/play, metadata and two subsongs`, async () => {
  const host = await nativeCore();
  const bytes = packed ? packIceFixture(makeSndhFixture()) : makeSndhFixture();
  assert.equal(host.open(bytes, 0).result, 1);
  assert.equal(host.core.atari_format(), 2);
  assert.equal(host.core.atari_default_subsong(), 2);
  assert.equal(host.core.atari_subsong_count(), 2);
  assert.equal(host.text(host.core.atari_text(0)), 'Generated SNDH tone');
  assert.equal(host.text(host.core.atari_text(1)), 'Codex test');
  assert.equal(host.core.atari_duration(), host.core.atari_subsong_duration(2));
  assert.equal(host.open(bytes, 1).result, 1);
  assert.equal(host.core.atari_register(0), 0xc4);
  const duration = host.core.atari_duration();
  assert.ok(duration > 2000 && duration < 4096);
  assert.equal(host.core.atari_render(4096), duration);
  assert.ok(host.output(duration).some(value => Math.abs(value) > 100));
  assert.equal(host.core.atari_register(0), 0x90);
  assert.equal(host.core.atari_register(8), 15);
  assert.equal(host.core.atari_render(1), 0);
  assert.equal(host.open(bytes, 2).result, 1);
  assert.ok(host.core.atari_duration() > duration);
  host.core.atari_close();
});

test('nonreturning native SNDH init stops at the upstream CPU cycle budget', async () => {
  const host = await nativeCore();
  const result = host.open(makeSndhFixture({ endlessInit: true }));
  assert.equal(result.result, 0);
  assert.match(result.error, /CPU cycle budget/);
  host.core.atari_close();
});

test('SNDH subsong-name table at the header boundary stays within its parser bounds', async () => {
  const host = await nativeCore();
  const bytes = new Uint8Array(28);
  bytes.set([0x60, 0, 0, 24, 0x4e, 0x75, 0x4e, 0x71, 0x4e, 0x75, 0x4e, 0x71]);
  bytes.set(new TextEncoder().encode('SNDH##01#!SN'), 12);
  bytes.set([0x4e, 0x75], 26);
  assert.equal(host.open(bytes, 0).result, 1);
  assert.equal(host.core.atari_subsong_count(), 1);
  assert.equal(host.open(bytes, 1).result, 1);
  host.core.atari_close();
});

test('native host rejects malformed bounded structures and invalid render sizes', async () => {
  const host = await nativeCore();
  for (const bytes of [
    new Uint8Array(20), makeYm3Fixture().subarray(0, 19), makeYm5Fixture().subarray(0, 39),
    makeSndhFixture().subarray(0, 40), packLhaFixture(makeYm3Fixture()).subarray(0, 40),
  ]) {
    const result = host.open(bytes);
    assert.equal(result.result, 0);
    assert.ok(result.error.length);
  }
  for (const offset of [12, 20, 22, 26, 32]) {
    const bytes = makeYm5Fixture();
    bytes.fill(255, offset, offset + 2);
    assert.equal(host.open(bytes).result, 0, `header offset ${offset}`);
  }
  const sndh = makeSndhFixture();
  sndh.fill(0xff, 20, 128);
  assert.equal(host.open(sndh).result, 0);
  const badLha = packLhaFixture(makeYm5Fixture());
  badLha[24 + badLha[21] + 2] = 0xf8; // PT alphabet length 31 exceeds 19.
  assert.equal(host.open(badLha).result, 0);
  const badIce = packIceFixture(makeSndhFixture());
  badIce.fill(0, badIce.length - 5);
  assert.equal(host.open(badIce).result, 0);
  assert.equal(host.open(makeYm3Fixture()).result, 1);
  assert.equal(host.core.atari_render(0), -1);
  assert.equal(host.core.atari_render(4097), -1);
  host.core.atari_close();
});

// Runs the production Worker file in a real Node Worker, with browser transport
// and local WASM fetch shims. This keeps native execution off the test thread.
class BrowserWorker {
  constructor(url) {
    const bootstrap = `
      const { parentPort } = require('node:worker_threads');
      const fs = require('node:fs/promises');
      global.self = global;
      global.fetch = async url => ({ok: true, arrayBuffer: async () => { const b = await fs.readFile(url); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }});
      self.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
      import(${JSON.stringify(url.href)}).then(() => parentPort.on('message', data => self.onmessage({ data })));
    `;
    this.worker = new NodeWorker(bootstrap, { eval: true });
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(value, transfer) { this.worker.postMessage(value, transfer); }
  terminate() { this.terminated = true; this.worker.terminate(); }
}

test('production Worker transport renders YM and SNDH with cloned snapshots', async () => {
  const previous = globalThis.Worker;
  globalThis.Worker = BrowserWorker;
  try {
    for (const bytes of [makeYm5Fixture(), makeSndhFixture(), packIceFixture(makeSndhFixture()), packLhaFixture(makeYm5Fixture())]) {
      const source = await readAtariSource(bytes, { name: 'fixture' });
      assert.equal(source.metadata.name, 'fixture');
      assert.ok(source.durationFrames > 0);
      assert.equal(source.metadata.subsongDurationFrames.length, source.subsongCount);
      const engine = await createAtariSongEngine(source);
      assert.equal(engine.sampleRate(), 44100);
      const initial = await engine.snapshot();
      const block = await engine.processFrames(2048);
      assert.equal(block.left.length, 2048);
      assert.deepEqual(block.left, block.right);
      assert.ok(block.left.some(value => Math.abs(value) > 0.01));
      assert.equal(engine.frame, 2048);
      assert.equal(block.snapshot.frame, 2048);
      assert.deepEqual(block.snapshot.registerKnown, [...Array(14).fill(1), 0, 0]);
      initial.registers[8] = 123;
      assert.equal((await engine.snapshot()).registers[8], 15);
      await assert.rejects(engine.processFrames(4097), /1\.\.4096/);
      engine.dispose();
      await assert.rejects(engine.snapshot(), /disposed/);
    }
  } finally {
    globalThis.Worker = previous;
  }
});

test('Worker cancellation and request deadlines terminate native work', async () => {
  const previousWorker = globalThis.Worker;
  const previousTimeout = globalThis.setTimeout;
  const workers = [];
  class StalledWorker {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = StalledWorker;
  try {
    const controller = new AbortController();
    const reading = readAtariSource(makeYm3Fixture(), { signal: controller.signal });
    controller.abort();
    await assert.rejects(reading, { name: 'AbortError' });
    assert.ok(workers[0].terminated);
    globalThis.setTimeout = (callback, delay, ...args) => previousTimeout(callback, delay === ATARI_PLAYER_LIMITS.requestDeadlineMs ? 5 : delay, ...args);
    await assert.rejects(readAtariSource(makeYm3Fixture()), /deadline/);
    assert.ok(workers[1].terminated);
  } finally {
    globalThis.Worker = previousWorker;
    globalThis.setTimeout = previousTimeout;
  }
});
