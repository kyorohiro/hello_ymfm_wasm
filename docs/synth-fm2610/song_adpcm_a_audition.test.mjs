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

test('ADPCM-A trial applies an edited hardware window and mix settings without changing the VGM snapshot', async () => {
  const {audition, calls} = fixture();
  const bytes = new Uint8Array(512).fill(0x18);
  const changes = {start:0x120000, end:0x220200, volume:7, left:true, right:false, totalVolume:19};
  assert.equal(await audition.audition(endpoint,snapshot,2,bytes,changes),true);
  assert.deepEqual(calls.slice(1),[
    ['memory', bytes, 0x200000],
    ['level', 19],
    ['sample', 2, {start:0x200000,end:0x200200}],
    ['voice', 2, {volume:7,left:true,right:false}],
    ['on', 2],
  ]);
  assert.equal(snapshot.adpcm.adpcmA.volume,48);
  assert.equal(snapshot.adpcm.adpcmA.voices[2].volume,23);

  const before = calls.length;
  await assert.rejects(audition.audition(endpoint,snapshot,2,sample,changes),/complete sample/);
  await assert.rejects(audition.audition(endpoint,snapshot,2,bytes,{...changes,start:0x120001}),RangeError);
  await assert.rejects(audition.audition(endpoint,snapshot,2,bytes,{...changes,totalVolume:64}),RangeError);
  await assert.rejects(audition.audition(endpoint,snapshot,2,bytes,{...changes,left:'left'}),TypeError);
  assert.equal(calls.length,before);
});

test('pending trials use current voice and shared level edits without retriggering active drums', async () => {
  const {audition, calls, transfers} = fixture({deferMemory:true});
  const first = audition.audition(endpoint,snapshot,0,sample,{totalVolume:25});
  await Promise.resolve();
  const second = audition.audition(endpoint,snapshot,5,sample,{totalVolume:33});
  await Promise.resolve();
  audition.setVoice(0,{volume:15,left:true,right:false});
  audition.setVoice(5,{right:false});
  audition.setVolume(38);
  assert(!calls.some(([event]) => event === 'on' || event === 'level' || event === 'voice'));

  transfers[1]();
  assert.equal(await second,true);
  assert.deepEqual(calls.filter(([event]) => event === 'voice'),[['voice',5,{volume:23,left:false,right:false}]]);
  audition.setVoice(5,{volume:8,left:true,right:true});
  audition.setVolume(42);
  assert.deepEqual(calls.slice(-2),[['voice',5,{volume:8,left:true,right:true}],['level',42]]);

  transfers[0]();
  assert.equal(await first,true);
  assert.deepEqual(calls.filter(([event]) => event === 'level'),[['level',38],['level',42],['level',42]]);
  assert.deepEqual(calls.slice(-2),[['voice',0,{volume:15,left:true,right:false}],['on',0]]);
  assert.deepEqual(calls.filter(([event]) => event === 'on'),[['on',5],['on',0]]);
});
