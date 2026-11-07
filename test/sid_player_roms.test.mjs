import test from 'node:test';
import assert from 'node:assert/strict';
import {copyRomSet, concatenateRoms, readRomFile} from '../docs/sid-player/roms.js';

test('user ROM sizes and concatenation are bounded, with detached byte windows in the native order', () => {
  const backing = new Uint8Array(4100).fill(11);
  const input = {chars: backing.subarray(2, 4098), basic: new Uint8Array(8192).fill(22), kernal: new Uint8Array(8192).fill(33)};
  const copy = copyRomSet(input), combined = concatenateRoms(input);
  assert.equal(combined.length, 20480);
  assert(combined.subarray(0, 4096).every(value => value === 11));
  assert(combined.subarray(4096, 12288).every(value => value === 22));
  assert(combined.subarray(12288).every(value => value === 33));
  backing.fill(0); input.basic.fill(0);
  assert(copy.chars.every(value => value === 11)); assert(copy.basic.every(value => value === 22));
  assert(combined.subarray(0, 4096).every(value => value === 11));
  for (const value of [null, {}, {...input, chars: new Uint8Array(4095)}, {...input, basic: new Uint8Array(8193)}, {...input, kernal: 'not firmware'}])
    assert.throws(() => copyRomSet(value), /ROM/);
});

test('file size is checked before reading, and byte-length changes are rejected', async () => {
  let reads = 0;
  await assert.rejects(readRomFile({size: 1000000000, arrayBuffer() {reads++; throw Error('must not read');}}, 'kernal'), /exactly/);
  assert.equal(reads, 0);
  await assert.rejects(readRomFile({size: 4096, async arrayBuffer() {return new ArrayBuffer(4097);}}, 'chars'), /changed/);
  const bytes = await readRomFile({size: 8192, async arrayBuffer() {return new Uint8Array(8192).fill(5).buffer;}}, 'basic');
  assert.equal(bytes.length, 8192); assert(bytes.every(value => value === 5));
  await assert.rejects(readRomFile({size: 8192}, 'other'), /Unknown/);
});
