import assert from 'node:assert/strict';
import test from 'node:test';
import {createFm2610SongAdpcmAAudition} from './song_adpcm_a_audition.js';

const endpoint = {context: {}, connectSongOutput() {}};
const snapshot = Object.freeze({
  variant: 'ym2610', clockHz: 7670454,
  adpcm: {adpcmA: {
    volume: 48,
    voices: Array.from({length: 6}, () => ({
      available: true, start: 0x10000, playbackEnd: 0x10100, volume: 23, left: false, right: true,
    })),
  }},
});
const sample = new Uint8Array(256).fill(0x88);

function fixture({deferMemory = false} = {}) {
  const calls = [], transfers = [];
  const adpcmA = {
    loadMemory(bytes, address) {
      calls.push(['memory', bytes, address]);
      if (!deferMemory) return;
      const pending = Promise.withResolvers();
      transfers.push(pending.resolve);
      return pending.promise;
    },
    setVolume: value => calls.push(['level', value]),
    setSample: (channel, range) => calls.push(['sample', channel, range]),
    setVoice: (channel, voice) => calls.push(['voice', channel, voice]),
    keyOn: channel => calls.push(['on', channel]),
    keyOff: channel => calls.push(['off', channel]),
  };
  const runtime = {rawFm: {adpcmA}};
  let current;
  const chip = {
    async load(destination, source) {
      calls.push(['runtime', destination, source]);
      return current = runtime;
    },
    current: () => current,
    close() { current = null; },
    setSourceGains: values => calls.push(['gains', values]),
  };
  return {calls, transfers, audition: createFm2610SongAdpcmAAudition({chip})};
}

test('reference ADPCM-A audition uploads independent voices and keeps VGM level and pan', async () => {
  const {audition, calls} = fixture();
  audition.setSourceGains([1, 1, .4, 1]);
  assert.equal(await audition.audition(endpoint,snapshot,4,sample),true);
  assert.deepEqual(calls,[
    ['gains', [1, 1, .4, 1]],
    ['runtime', endpoint, snapshot],
    ['memory', sample, 0x400000],
    ['level', 48],
    ['sample', 4, {start: 0x400000, end: 0x400100}],
    ['voice', 4, {volume: 23, left: false, right: true}],
    ['on', 4],
  ]);
  assert.equal(await audition.audition(endpoint,snapshot,0,sample),true);
  audition.stop(4);
  assert.deepEqual(calls.filter(([event]) => event === 'off'),[['off', 4]]);
  audition.stop();
  assert.deepEqual(calls.filter(([event]) => event === 'off'),[['off', 4], ['off', 0]]);
});

test('retrigger and closing cancel old ADPCM-A transfers without issuing a stale key-on', async () => {
  const {audition, calls, transfers} = fixture({deferMemory:true});
  const prior = audition.audition(endpoint,snapshot,1,sample);
  await Promise.resolve();
  const next = audition.audition(endpoint,snapshot,1,sample);
  await Promise.resolve();
  transfers[0]();
  assert.equal(await prior,false);
  transfers[1]();
  assert.equal(await next,true);
  assert.deepEqual(calls.filter(([event]) => event === 'on'),[['on', 1]]);

  const other = audition.audition(endpoint,snapshot,5,sample);
  await Promise.resolve();
  audition.close();
  transfers[2]();
  assert.equal(await other,false);
  assert.deepEqual(calls.filter(([event]) => event === 'on'),[['on', 1]]);
  await assert.rejects(audition.audition(endpoint,snapshot,0,sample.subarray(1)),/complete sample/);
});
