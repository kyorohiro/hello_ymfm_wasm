#!/usr/bin/env node
// Standalone JavaScript references: no npm packages, browser or audio device.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'This smoke test requires Node.js 22+');
const directory = path.resolve(process.argv[2] ?? 'reference/javascript');
const {Msm5205AudioEngine, attachMsm5205} = await import(pathToFileURL(path.join(directory, 'msm5205audioengine.js')));
const {Oki6295AudioEngine, attachOki6295} = await import(pathToFileURL(path.join(directory, 'okim6295audioengine.js')));
const passed = [];
const sampleRate = 22050;

function check(name, test) {
  test();
  passed.push(name);
}

function pcmCheck(pcm, frames, {audible = false} = {}) {
  assert.ok(pcm.left instanceof Float32Array);
  assert.ok(pcm.right instanceof Float32Array);
  assert.equal(pcm.left.length, frames);
  assert.equal(pcm.right.length, frames);
  assert.ok(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite), 'PCM must be finite');
  assert.deepEqual(pcm.left, pcm.right, 'Mono reference output must reach both stereo channels');
  if (audible) assert.ok(pcm.left.some(value => Math.abs(value) > 0.005), 'Configured synthetic sample must be audible');
}

function silent(pcm) {
  pcmCheck(pcm, pcm.left.length);
  assert.ok(pcm.left.every(value => value === 0), 'Expected silent PCM');
}

function chunks(engine, lengths) {
  const result = new Float32Array(lengths.reduce((sum, frames) => sum + frames, 0));
  let offset = 0;
  for (const frames of lengths) {
    const pcm = engine.processFrames(frames);
    pcmCheck(pcm, frames);
    result.set(pcm.left, offset);
    offset += frames;
  }
  return result;
}

function seedMsm(engine) {
  engine.writeMsm5205(0, 1);
  engine.writeMsm5205(0, 0);
  for (const nibble of [7, 1, 15, 0, 6, 8, 3]) engine.writeMsm5205(1, nibble);
}

function msm() {
  const engine = new Msm5205AudioEngine({clock: 384000, outputSampleRate: sampleRate});
  seedMsm(engine);
  return engine;
}

const rom = new Uint8Array(0x200);
// Sample zero: table entry names inclusive byte range 0x100..0x1ff.
rom.set([0, 1, 0, 0, 1, 255], 0);
for (let index = 0x100; index < rom.length; index++) rom[index] = [0x17, 0x89, 0x26, 0xfa][index % 4];

function startOki(engine, voices = 0x10) {
  engine.writeOki6295(0, 0x80);
  engine.writeOki6295(0, voices);
}

function oki({start = true} = {}) {
  const engine = new Oki6295AudioEngine({clock: 1000000, outputSampleRate: sampleRate});
  engine.loadOki6295Rom(rom);
  if (start) startOki(engine);
  return engine;
}

check('msm5205:finite-stereo-and-chunk-continuity', () => {
  const whole = msm(), split = msm();
  const expected = whole.processFrames(256);
  pcmCheck(expected, 256, {audible: true});
  assert.deepEqual(chunks(split, [0, 1, 3, 17, 61, 174]), expected.left);
  whole.dispose(); split.dispose();
});

check('msm5205:muting-keeps-decoder-progression', () => {
  const reference = msm(), muted = msm();
  reference.processFrames(31);
  muted.setMsm5205Muted(true);
  silent(muted.processFrames(31));
  muted.setMsm5205Muted(false);
  assert.deepEqual(muted.processFrames(64), reference.processFrames(64));
  reference.dispose(); muted.dispose();
});

check('msm5205:reset-clears-queued-data-and-restores-determinism', () => {
  const used = msm(), fresh = msm();
  used.processFrames(13);
  used.reset();
  seedMsm(used);
  assert.deepEqual(used.processFrames(128), fresh.processFrames(128));
  used.writeMsm5205(0, 1);
  silent(used.processFrames(64));
  used.dispose(); fresh.dispose();
});

check('msm5205:external-vclk-decodes-only-on-rising-edges', () => {
  const external = new Msm5205AudioEngine({clock: 384000, flags: 7, outputSampleRate: sampleRate});
  seedMsm(external);
  silent(external.processFrames(64));
  external.writeMsm5205(2, 1);
  const first = external.processFrames(32);
  pcmCheck(first, 32, {audible: true});
  assert.ok(first.left.every(value => value === first.left[0]));
  external.writeMsm5205(2, 1);
  assert.deepEqual(external.processFrames(32), first, 'An unchanged high VCLK must not consume another nibble');
  external.writeMsm5205(2, 0);
  external.writeMsm5205(2, 1);
  assert.notEqual(external.processFrames(1).left[0], first.left[0]);
  external.dispose();
});

check('okim6295:finite-stereo-and-chunk-continuity', () => {
  const whole = oki(), split = oki();
  assert.equal(whole.readStatus() & 15, 1);
  const expected = whole.processFrames(512);
  pcmCheck(expected, 512, {audible: true});
  assert.deepEqual(chunks(split, [0, 1, 3, 17, 127, 364]), expected.left);
  whole.dispose(); split.dispose();
});

check('okim6295:muting-keeps-decoder-progression', () => {
  const reference = oki(), muted = oki();
  reference.processFrames(64);
  muted.setOki6295Muted(true);
  silent(muted.processFrames(64));
  muted.setOki6295Muted(false);
  assert.deepEqual(muted.processFrames(256), reference.processFrames(256));
  assert.equal(muted.readStatus(), reference.readStatus());
  reference.dispose(); muted.dispose();
});

check('okim6295:sample-command-four-voices-stop-and-end', () => {
  const engine = oki({start: false});
  assert.equal(engine.readStatus() & 15, 0);
  engine.writeOki6295(0, 0x80);
  assert.equal(engine.readStatus() & 15, 0, 'The sample-select byte alone must not start a voice');
  engine.writeOki6295(0, 0xf0);
  assert.equal(engine.readStatus() & 15, 15);
  pcmCheck(engine.processFrames(64), 64, {audible: true});
  engine.writeOki6295(0, 0x78);
  assert.equal(engine.readStatus() & 15, 0);
  silent(engine.processFrames(64));
  startOki(engine);
  engine.processFrames(4096);
  assert.equal(engine.readStatus() & 15, 0, 'Playback must finish at the sample end');
  silent(engine.processFrames(256));
  engine.dispose();
});

check('okim6295:reset-stops-voices-retains-rom-and-restores-determinism', () => {
  const used = oki(), fresh = oki();
  used.processFrames(113);
  used.reset();
  assert.equal(used.readStatus() & 15, 0);
  silent(used.processFrames(32));
  // Reset again so both output phases start together; ROM is intentionally not uploaded again.
  used.reset();
  startOki(used);
  assert.deepEqual(used.processFrames(256), fresh.processFrames(256));
  assert.equal(used.supportsState(), false);
  used.dispose(); fresh.dispose();
});

check('javascript-reference-attachments:mix-gain-reset-and-dispose', () => {
  for (const [factory, attach] of [[msm, attachMsm5205], [oki, attachOki6295]]) {
    const extra = factory(), reference = factory();
    let resets = 0, disposals = 0;
    const host = {
      processFrames: frames => ({left: new Float32Array(frames), right: new Float32Array(frames)}),
      getMasterVolume: () => 0.5,
      reset: () => { resets++; },
      dispose: () => { disposals++; },
    };
    attach(host, extra);
    const expected = reference.processFrames(128);
    const actual = host.processFrames(128);
    pcmCheck(actual, 128, {audible: true});
    assert.deepEqual(actual.left, Float32Array.from(expected.left, value => value * 0.5));
    host.reset(); host.dispose();
    assert.equal(resets, 1); assert.equal(disposals, 1);
    reference.dispose();
  }
});

check('synthetic-render-example:standalone-pcm16-stereo-wave-files', () => {
  const output = mkdtempSync(path.join(os.tmpdir(), 'tetorica JavaScript references '));
  try {
    const child = spawnSync(process.execPath, [path.join(directory, 'examples/render-adpcm.mjs'), output],
      {cwd: output, encoding: 'utf8', timeout: 30000});
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    for (const filename of ['msm5205-synthetic.wav', 'okim6295-synthetic.wav']) {
      const bytes = readFileSync(path.join(output, filename));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
      assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
      assert.equal(bytes.readUInt16LE(20), 1, 'Example must use linear PCM');
      assert.equal(bytes.readUInt16LE(22), 2);
      assert.equal(bytes.readUInt32LE(24), sampleRate);
      assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.toString('ascii', 36, 40), 'data');
      assert.equal(bytes.readUInt32LE(40), sampleRate * 2 * 4);
      assert.equal(bytes.length, 44 + bytes.readUInt32LE(40));
      let nonzero = false;
      for (let offset = 44; offset < bytes.length; offset += 4) {
        const left = bytes.readInt16LE(offset), right = bytes.readInt16LE(offset + 2);
        assert.equal(left, right);
        nonzero ||= left !== 0;
      }
      assert.ok(nonzero, `${filename} must contain synthetic audio`);
    }
  } finally {
    rmSync(output, {recursive: true, force: true});
  }
});

console.log(JSON.stringify({passed: true, references: ['msm5205', 'okim6295'], checks: passed}, null, 2));
