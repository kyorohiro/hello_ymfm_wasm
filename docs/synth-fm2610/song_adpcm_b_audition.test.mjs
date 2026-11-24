import assert from 'node:assert/strict';
import test from 'node:test';
import {YM2610BAdpcmBSynth} from '../js/ym2610bsynth.js';
import {createFm2610SongAdpcmBAudition} from './song_adpcm_b_audition.js';

const endpoint = {context: {}, connectSongOutput() {}};
const bytes = new Uint8Array(256).fill(0x89);
const settings = {available: true, start: 0x10000, end: 0x10100, deltaN: 0x1234,
  volume: 209, left: true, right: false, repeat: true};
const snapshot = {variant: 'ym2610', clockHz: 7670454, adpcm: {adpcmB: settings}};

function fixture(deferMemory = false) {
  const calls = [], transfers = [];
  const adpcmB = new YM2610BAdpcmBSynth({
    write: (register, value) => calls.push(['write', register, value]),
    loadMemory(data, address) {
      calls.push(['memory', data, address]);
      if (!deferMemory) return;
      const transfer = Promise.withResolvers();
      transfers.push(transfer.resolve);
      return transfer.promise;
    },
  });
  const runtime = {rawFm: {adpcmB}};
  let current;
  const chip = {
    async load(output, source) {
      calls.push(['runtime', output, source]);
      return current = runtime;
    },
    current: () => current,
    close() { current = null; },
    setSourceGains: gains => calls.push(['gains', gains]),
  };
  return {calls, transfers, audition: createFm2610SongAdpcmBAudition({chip})};
}

test('ADPCM-B reference audition preserves raw Delta-N, level, pan and Repeat', async () => {
  const {audition, calls} = fixture();
  audition.setSourceGains([1, 1, 1, .35]);
  assert.equal(await audition.audition(endpoint,snapshot,bytes),true);
  assert.deepEqual(calls,[
    ['gains', [1, 1, 1, .35]],
    ['runtime', endpoint, snapshot],
    ['memory', bytes, 0],
    ['write', 0x01, 0],
    ['write', 0x02, 0],
    ['write', 0x03, 0],
    ['write', 0x04, 0],
    ['write', 0x05, 0],
    ['write', 0x09, 0x34],
    ['write', 0x0a, 0x12],
    ['write', 0x0b, 209],
    ['write', 0x01, 0x80],
    ['write', 0x00, 0xb0],
  ]);
  audition.stop();
  assert.deepEqual(calls.at(-1),['write', 0x00, 1]);
});

test('ADPCM-B reference audition accepts the full ROM window and rejects unavailable samples', async () => {
  const {audition, calls} = fixture();
  const fullRom = new Uint8Array(0x1000000);
  const full = {...snapshot, variant:'ym2610b', adpcm: {adpcmB: {
    ...settings, start:0, end:fullRom.length, deltaN:65535, repeat:false,
  }}};
  await assert.rejects(audition.audition(endpoint,full,bytes),/complete ADPCM-B sample/);
  await assert.rejects(audition.audition(endpoint,{
    ...snapshot, adpcm: {adpcmB: {...settings, deltaN:0}},
  },bytes),/positive Delta-N/);
  assert.deepEqual(calls,[]);
  assert.equal(await audition.audition(endpoint,full,fullRom),true);
  assert.equal(calls[1][1],fullRom);
  assert.equal(calls[1][2],0);
  assert.deepEqual(calls.filter(([, address]) => address === 0x04 || address === 0x05),[
    ['write', 0x04, 0xff], ['write', 0x05, 0xff],
  ]);
  assert.deepEqual(calls.at(-1),['write', 0x00, 0xa0]);
});

test('ADPCM-B Stop, retrigger and close cancel unfinished uploads', async () => {
  const {audition, calls, transfers} = fixture(true);
  const first = audition.audition(endpoint,snapshot,bytes);
  await Promise.resolve();
  const second = audition.audition(endpoint,snapshot,bytes);
  await Promise.resolve();
  transfers[0]();
  assert.equal(await first,false);
  transfers[1]();
  assert.equal(await second,true);

  const stopped = audition.audition(endpoint,snapshot,bytes);
  await Promise.resolve();
  audition.stop();
  transfers[2]();
  assert.equal(await stopped,false);
  const closed = audition.audition(endpoint,snapshot,bytes);
  await Promise.resolve();
  await audition.close();
  transfers[3]();
  assert.equal(await closed,false);

  assert.deepEqual(calls.filter(([kind, address, value]) => kind === 'write' && address === 0 && value & 0x80),[
    ['write', 0x00, 0xb0],
  ]);
});
