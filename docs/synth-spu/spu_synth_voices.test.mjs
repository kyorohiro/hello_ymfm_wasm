// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {SpuRoundRobinVoices} from './spu_synth_voices.js';

test('24 held voices rotate, steal oldest notes, and ignore their late releases', () => {
  const voices = new SpuRoundRobinVoices();
  for (let i = 0; i < 24; i++) assert.deepEqual(voices.allocate(`note:${i}`), {channel:i, stolen:null});
  assert.deepEqual(voices.allocate('note:24'), {channel:0, stolen:{id:'note:0', channel:0, order:1}});
  assert.deepEqual(voices.allocate('note:25'), {channel:1, stolen:{id:'note:1', channel:1, order:2}});
  assert.equal(voices.release('note:0'), null);
  assert.equal(voices.release('note:1'), null);
  assert.equal(voices.entries().length, 24);
  assert.equal(voices.release('note:24'), 0);
  assert.equal(voices.release('note:25'), 1);
  assert.equal(voices.entries().length, 22);
});

test('released slots are preferred to stealing a held voice, in round-robin order', () => {
  const voices = new SpuRoundRobinVoices(3);
  assert.equal(voices.allocate('a').channel, 0);
  assert.equal(voices.allocate('b').channel, 1);
  assert.equal(voices.release('a'), 0);
  assert.equal(voices.allocate('c').channel, 2);
  assert.deepEqual(voices.allocate('d'), {channel:0, stolen:null});
  assert.equal(voices.release('c'), 2);
  assert.deepEqual(voices.allocate('e'), {channel:2, stolen:null});
  assert(voices.entries().some(note => note.id === 'b'));
});

test('invalid or duplicate identities leave ownership untouched, reset retires all prior notes', () => {
  const voices = new SpuRoundRobinVoices(); voices.allocate('a');
  for (const id of ['', null, 1, 'x'.repeat(129), 'a']) assert.throws(() => voices.allocate(id));
  assert.deepEqual(voices.entries(), [{id:'a', channel:0, order:1}]);
  const copy = voices.entries(); copy[0].id = 'mutated';
  assert.equal(voices.entries()[0].id, 'a');
  voices.reset(); assert.equal(voices.release('a'), null);
  assert.deepEqual(voices.allocate('fresh'), {channel:0, stolen:null});
});
