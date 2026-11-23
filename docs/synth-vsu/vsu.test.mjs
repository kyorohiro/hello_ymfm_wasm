// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVsuClient, createVsuWave, vsuFrequencyRegister, vsuNoiseShiftRate, vsuStartWrites } from './vsu.js';

function captureWrites() {
	const operations = [];
	const client = createVsuClient({
		write(offset, value) { operations.push([offset, value]); },
		writeBatch(writes) { operations.push(writes); },
		writeEnvelope(writes) { operations.push(writes); },
	});
	return { client, operations };
}

test('note helpers use the tone and noise clocks and gate without resetting the envelope', () => {
	const { client, operations } = captureWrites();
	assert.equal(client.id, 'vsu');
	assert.equal(vsuFrequencyRegister(0, 0), 0, 'unreachable low pitches clamp to the hardware minimum');
	client.noteOn(0, 'A4');
	client.noteOn(5, 69);
	client.noteOff(5);
	client.allNotesOff();
	assert.deepEqual(operations, [
		[[0x408, 0x9d], [0x40c, 0x06], [0x400, 0x80]],
		[[0x548, 0x90], [0x54c, 0x03], [0x540, 0x80]],
		[0x540, 0x00],
		[0x580, 0x01],
	]);
	assert(Math.abs(5_000_000 / (32 * (2048 - vsuFrequencyRegister(0, 'A4'))) - 440) < 1);
	assert(Math.abs(500_000 / (2048 - vsuFrequencyRegister(5, 'A4')) - 440) < 1);
});

test('CH6 fixed-rate playback writes the hardware divider and one-shot interval', () => {
	assert.equal(vsuNoiseShiftRate(0), 244.140625);
	assert.equal(vsuNoiseShiftRate(0x7f0), 31250);
	assert.equal(vsuNoiseShiftRate(0x7ff), 500000);
	assert.deepEqual(vsuStartWrites(5, 0x7f0, 0), [[0x548, 0xf0], [0x54c, 7], [0x540, 0xa0]]);
	assert.deepEqual(vsuStartWrites(5, 0x7f0, 31), [[0x548, 0xf0], [0x54c, 7], [0x540, 0xbf]]);
	assert.throws(() => vsuStartWrites(5, 0x7f0, 32), /interval/);
});

test('shared wave uploads use physical offsets and reject incomplete or invalid data before writing', () => {
	const { client, operations } = captureWrites();
	const wave = createVsuWave('square');
	assert(wave instanceof Uint8Array);
	assert.deepEqual([...wave], [...Array(16).fill(63), ...Array(16).fill(0)]);
	client.setWave(4, wave);
	assert.deepEqual(operations[0], [...wave].map((value, index) => [0x200 + index * 4, value]));
	client.setWaveSample(4, 31, 31);
	assert.deepEqual(operations.at(-1), [0x27c, 31]);
	const invalid = [...wave];
	invalid[31] = 64;
	assert.throws(() => client.setWave(4, invalid), /Wave sample/);
	assert.throws(() => client.setWave(5, wave), /Wave bank/);
	assert.throws(() => client.setWave(4, wave.subarray(1)), /32 six-bit samples/);
	assert.throws(() => client.setWaveSample(4, 32, 0), /Wave sample index/);
	assert.equal(operations.length, 2);
});

test('channel volume, wave selection, and raw writes respect the VSU register layout', () => {
	const { client, operations } = captureWrites();
	client.setVolume(5, 12, 3);
	client.setWaveBank(4, 2);
	client.write(0x51c, 0x40);
	assert.deepEqual(operations, [[0x544, 0xc3], [0x518, 2], [0x51c, 0x40]]);
	assert.throws(() => client.setVolume(0, 16, 0), /Left level/);
	assert.throws(() => client.setWaveBank(5, 0), /Wave channel/);
	assert.throws(() => client.write(0x401, 0x80), /aligned/);
	assert.throws(() => client.write(0x400, 256), /Register byte/);
	assert.equal(operations.length, 3);
});

test('envelope helpers encode hardware writes per channel and validate settings before enqueueing', () => {
	const { client, operations } = captureWrites();
	const options = { level: 12, rate: 7, direction: 'up', enabled: true, repeat: true };
	client.setEnvelope(4, options);
	client.resetEnvelope(5);
	assert.deepEqual(operations, [
		[[0x510, 0xcf], [0x514, 3, 3]],
		[[0x550, 0, 0]],
	]);
	assert.throws(() => client.setEnvelope(6, options), /Channel/);
	assert.throws(() => client.setEnvelope(0, { ...options, level: 16 }), /Envelope initial level/);
	assert.throws(() => client.setEnvelope(0, { ...options, rate: 8 }), /Envelope rate/);
	assert.throws(() => client.setEnvelope(0, { ...options, direction: 'attack' }), /direction/);
	assert.throws(() => client.setEnvelope(0, { ...options, enabled: 1 }), /enable/);
	assert.throws(() => client.resetEnvelope(-1), /Channel/);
	assert.equal(operations.length, 2);
});
