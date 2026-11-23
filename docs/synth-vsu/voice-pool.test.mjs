// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVsuVoicePool } from './voice-pool.js';

const waveChannels = [0, 1, 2, 3, 4];

test('AUTO rotates through free Wave channels even when keys are lifted in between', () => {
  const pool = createVsuVoicePool();
  const played = [];
  for (const owner of ['a', 's', 'd', 'f', 'g', 'h']) {
    const { voice, displaced } = pool.acquire(waveChannels, { owner, note: 60 });
    played.push(voice.channel);
    assert.equal(displaced, null);
    assert.equal(pool.release(owner), voice);
  }
  assert.deepEqual(played, [0, 1, 2, 3, 4, 0]);
});

test('AUTO keeps five held voices and a sixth supersedes only the oldest', () => {
  const pool = createVsuVoicePool();
  const voices = ['a', 's', 'd', 'f', 'g'].map(owner => pool.acquire(waveChannels, { owner }).voice);
  assert.deepEqual(pool.voices(), voices);
  assert.equal(pool.acquire(waveChannels, { owner: 'a' }), null);

  const { voice, displaced } = pool.acquire(waveChannels, { owner: 'h' });
  assert.equal(displaced, voices[0]);
  assert.equal(voice.channel, 0);
  assert.equal(pool.release('a'), null);
  assert.equal(pool.releaseVoice(displaced), null);
  assert.equal(pool.voiceOn(0), voice);
  assert.deepEqual(pool.voices(), [...voices.slice(1), voice]);
  assert.equal(pool.release('h'), voice);

  assert.equal(pool.acquire(waveChannels, { owner: 'j' }).voice.channel, 0);
});

test('superseded, early-released and reused owners cannot commit an asynchronous start', () => {
  const pool = createVsuVoicePool();
  const first = pool.acquire([4], { owner: 'key:a' }).voice;
  assert.equal(pool.isCurrent(first), true);
  const second = pool.acquire([4], { owner: 'key:s' }).voice;
  assert.equal(pool.isCurrent(first), false);
  assert.equal(pool.release('key:a'), null);
  assert.equal(pool.release('key:s'), second);
  assert.equal(pool.isCurrent(second), false);

  const retrigger = pool.acquire([4], { owner: 'key:s' }).voice;
  assert.notEqual(retrigger, second);
  assert.equal(pool.releaseVoice(second), null);
  assert.equal(pool.isCurrent(retrigger), true);
});

test('effect and Noise pools keep dedicated channels and global release clears ownership', () => {
  const pool = createVsuVoicePool();
  const mod = pool.acquire([4], { owner: 'mod' }).voice;
  const noise = pool.acquire([5], { owner: 'noise' }).voice;
  const firstWave = pool.acquire(waveChannels, { owner: 'wave' }).voice;
  assert.deepEqual([mod.channel, noise.channel, firstWave.channel], [4, 5, 0]);
  assert.deepEqual(pool.clear(), [mod, noise, firstWave]);
  assert.equal(pool.isCurrent(mod), false);
  assert.equal(pool.voiceOn(5), null);
  assert.equal(pool.acquire(waveChannels, { owner: 'new' }).voice.channel, 0);
});
