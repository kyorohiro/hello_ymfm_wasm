import test from 'node:test';
import assert from 'node:assert/strict';
import {createWonderSwanWaves, wonderswanWaveCode, wonderswanWaveJson} from './wonderswan_waves.js';

const write = (state, register, value, time = 0) => state.apply({type: 'wonderswan-write', register, value}, time);
const memory = (state, offset, value, time = 0) => state.apply({type: 'wonderswan-memory-write', offset, value}, time);
const packedWave = (seed = 0) => Uint8Array.from({length: 16}, (_, index) => (index + seed & 15) | (15 - index << 4));
function upload(state, address, data = packedWave(), time = 0) {
  for (let index = 0; index < data.length; index++) memory(state, address + index, data[index], time);
}

test('32 samples unpack low nibble first; identical waves deduplicate across channels and physical banks', () => {
  const state = createWonderSwanWaves();
  for (let channel = 0; channel < 4; channel++) upload(state, channel * 16);
  write(state, 0, 0x80); write(state, 1, 7); write(state, 8, 0xa3); write(state, 17, 8);
  write(state, 16, 1); state.flush(0);
  assert.equal(state.samples.length, 1);
  assert.equal(state.events.length, 4);
  assert.deepEqual(state.samples[0].waveform.slice(0, 6), [0, 15, 1, 14, 2, 13]);
  const first = state.events.find(event => event.channel === 1);
  assert.equal(first.frequency, 0x780);
  assert.equal(first.frequencyHz, 750);
  assert.equal(first.frequencyKnown, true);
  assert.equal(first.clock, 3072000);
  assert.deepEqual(first.pan, {left: 10, right: 3});
  assert.equal(first.enabled, true);
  assert.deepEqual(first.output, {register: 8, headphones: true, speaker: false, speakerVolume: 0});
  upload(state, 0x3ff0, packedWave(), 44100);
  write(state, 15, 255, 44100); state.flush(44100);
  assert.equal(state.samples.length, 1);
  assert.deepEqual(state.events.at(-1), {...state.events.at(-1), channel: 4, bank: 255, address: 0x3ff0});
});

test('unwritten bytes remain unknown and key-on inside a partial batch never invents zeros', () => {
  const state = createWonderSwanWaves();
  upload(state, 0, packedWave().subarray(0, 15));
  write(state, 16, 1); state.flush(0);
  assert.equal(state.samples.length, 0);
  assert.match([...state.warnings].join('\n'), /incomplete.*unwritten bytes are unknown/);
  memory(state, 15, packedWave()[15], 1); state.flush(1);
  assert.equal(state.samples.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].startTime, 1);
  assert.equal(state.events[0].frequencyKnown, false);
  assert.equal(state.events[0].enabled, true);
});

test('write batches retain byte updates, preserve old snapshots, and deduplicate repeated wave/channel/time observations', () => {
  const state = createWonderSwanWaves();
  upload(state, 0); state.flush(0);
  write(state, 16, 1); write(state, 16, 0); write(state, 16, 1); state.flush(0);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].enabled, true);
  assert.match(state.events[0].reason, /write batch; CH1 key-on/);
  memory(state, 0, 0xff, 5); state.flush(5);
  memory(state, 0, packedWave()[0], 10); state.flush(10);
  assert.equal(state.samples.length, 2);
  assert.deepEqual(state.events.map(event => [event.sampleId, event.startTime]), [[1, 0], [2, 5], [1, 10]]);
  assert.equal(state.samples[0].data[0], 0xf0);
  assert.equal(state.samples[1].data[0], 0xff);
  assert.deepEqual(state.samples[0].waveform.slice(0, 2), [0, 15]);
  // Rewriting the same value is not another RAM snapshot.
  memory(state, 0, 0xf0, 11); state.flush(11);
  assert.equal(state.events.length, 3);
  write(state, 16, 0, 12); write(state, 16, 1, 12);
  assert.equal(state.events.length, 4);
});

test('bank selection flushes old pending writes and captures selected prewritten RAM at the correct physical address', () => {
  const state = createWonderSwanWaves(3579545);
  upload(state, 0, packedWave());
  upload(state, 0x2000, packedWave(1));
  write(state, 15, 0x80); state.flush(0);
  assert.equal(state.samples.length, 2);
  assert.deepEqual(state.events.map(event => [event.sampleId, event.bank, event.address, event.startTime]),
    [[1, 0, 0, 0], [2, 128, 8192, 0]]);
  assert.match(state.events[0].reason, /previous bank/);
  assert.match(state.events[1].reason, /wave bank change/);
  assert.equal(state.events[1].clock, 3579545);
  assert.equal(state.events[1].frequencyHz, Math.floor(3579545 / 128) * 128 / (32 * 2048));
  write(state, 15, 0, 4); state.flush(4);
  assert.equal(state.samples.length, 2);
  assert.equal(state.events.at(-1).sampleId, 1);
  assert.equal(state.events.at(-1).address, 0);
});

test('identical same-time waves in different selected banks keep both physical bank observations', () => {
  const state = createWonderSwanWaves(); upload(state, 0); upload(state, 64);
  write(state, 15, 1); write(state, 16, 1); state.flush(0);
  assert.equal(state.samples.length, 1);
  assert.deepEqual(state.events.map(event => [event.channel, event.bank, event.address]), [[1, 0, 0], [1, 1, 64]]);
  assert.equal(state.events[1].enabled, true);
});

test('Voice PCM and Noise channels are excluded; Sweep retains its written base wave and mode metadata', () => {
  const state = createWonderSwanWaves();
  for (let channel = 0; channel < 4; channel++) upload(state, channel * 16, packedWave(channel));
  write(state, 4, 0x98); write(state, 5, 7);
  write(state, 16, 0xef); state.flush(0);
  assert.deepEqual(state.events.map(event => event.channel), [1, 3]);
  assert.equal(state.events[1].mode, 'sweep');
  assert.equal(state.events[1].frequency, 0x798);
  assert.match([...state.warnings].join('\n'), /Voice PCM.*not extracted/);
  write(state, 16, 0x0f, 10); state.flush(10);
  assert.deepEqual(state.events.slice(2).map(event => [event.channel, event.mode]), [[2, 'wave'], [3, 'wave'], [4, 'wave']]);
  assert.equal(state.samples.length, 4);
});

test('one-byte writes after same-time key-on preserve the intermediate and completed authored wave', () => {
  const state = createWonderSwanWaves();
  upload(state, 0); state.flush(0);
  memory(state, 0, 0x12, 10); write(state, 16, 1, 10);
  memory(state, 1, 0x34, 10); state.flush(10);
  assert.equal(state.samples.length, 3);
  assert.deepEqual(state.events.map(event => event.sampleId), [1, 2, 3]);
  assert.deepEqual(state.samples[1].waveform.slice(0, 4), [2, 1, 1, 14]);
  assert.deepEqual(state.samples[2].waveform.slice(0, 4), [2, 1, 4, 3]);
});

test('waveform JSON and reusable code preserve exact packed bytes and zero-based API channels', () => {
  const state = createWonderSwanWaves(); upload(state, 0x20); state.flush(0);
  const sample = state.samples[0], json = JSON.parse(wonderswanWaveJson(sample, state.events));
  assert.equal(json.representation, 'written-wave-ram');
  assert.equal(json.timebase, 44100);
  assert.deepEqual(json.packedBytes, [...packedWave()]);
  assert.deepEqual(json.waveform, sample.waveform);
  assert.deepEqual(json.observations, state.events);
  let received;
  new Function('ws', wonderswanWaveCode(sample, 2))({setWaveform: (...args) => { received = args; }});
  assert.deepEqual(received, [2, sample.waveform]);
  assert.match(wonderswanWaveCode(sample), /^ws\.setWaveform\(0,/);
  assert.throws(() => wonderswanWaveCode(sample, 4), /channel/);
});

test('definition, observation and retained payload budgets fail explicitly instead of retaining unbounded data', () => {
  for (const [limits, message] of [[{maxDefinitions: 0}, /0 definitions/], [{maxEvents: 0}, /0 observations/],
    [{maxPayloadBytes: 15}, /15-byte payload limit/]]) {
    const state = createWonderSwanWaves(3072000, limits); upload(state, 0);
    assert.throws(() => state.flush(0), message);
  }
  const state = createWonderSwanWaves(3072000, {maxEvents: 1}); upload(state, 0); state.flush(0);
  write(state, 16, 1); // Same instant/sample/channel merges within the budget.
  assert.throws(() => { write(state, 16, 0, 1); write(state, 16, 1, 1); }, /1 observations/);
});

test('invalid event addresses and unsupported second-chip input cannot alias primary wave memory', () => {
  const state = createWonderSwanWaves();
  assert.throws(() => memory(state, 0x4000, 1), /RAM address/);
  assert.throws(() => memory(state, -1, 1), /RAM address/);
  assert.throws(() => write(state, 0x80, 1), /relative register/);
  assert.throws(() => write(state, 0, 256), /byte/);
  assert.throws(() => state.apply({type: 'wonderswan-memory-write', offset: 0, value: 1, chipIndex: 1}, 0), /Second WonderSwan/);
  assert.throws(() => state.flush(Number.MAX_SAFE_INTEGER + 1), /time/);
  assert.throws(() => createWonderSwanWaves(0), /clock/);
  assert.throws(() => createWonderSwanWaves(3072000, {maxEvents: -1}), /budget/);
  state.apply({type: 'unrelated'}, 0); state.flush(0);
  assert.equal(state.samples.length, 0);
  assert.equal(state.warnings.size, 0);
});

test('wave usage requires a positive interval with gate, headphone output and nonzero hardware volume',()=>{
  const state=createWonderSwanWaves();upload(state,0);write(state,16,1);write(state,17,8);state.flush(0);
  assert.equal(state.samples[0].usedInPlayback,false);assert(state.events.every(event=>event.audible===false));
  state.advance(10);assert.equal(state.samples[0].usedInPlayback,false,'a zero-volume enabled voice is not used');
  write(state,8,0x99,10);write(state,16,0,10);state.advance(20);assert.equal(state.samples[0].usedInPlayback,false,'zero-wait key-on/off is not a playback interval');
  write(state,16,1,20);write(state,17,1,20);state.advance(30);assert.equal(state.samples[0].usedInPlayback,false,'the current core does not render speaker-only output');
  write(state,17,8,30);state.advance(40);
  assert.equal(state.samples[0].usedInPlayback,true);
  const audible=state.events.filter(event=>event.audible);assert.equal(audible.length,1);assert.equal(audible[0].startTime,30);assert.equal(audible[0].audibleDurationSamples,10);
  assert.equal(audible[0].audibleStartTime,30);assert.equal(audible[0].audibleEndTime,40);
  memory(state,0,0x11,40);state.flush(40);assert.equal(state.samples.at(-1).usedInPlayback,false,'a final zero-duration RAM write stays a candidate');
  assert.equal(JSON.parse(wonderswanWaveJson(state.samples[0],state.events)).usedInPlayback,true);
});

test('final same-time frequency, volume and output replace stale key-on metadata, and later settings get new observations',()=>{
  const state=createWonderSwanWaves();upload(state,0);write(state,16,1);
  write(state,0,0x4c);write(state,1,6);write(state,8,0x99);write(state,17,8);state.flush(0);
  assert.equal(state.events.length,1);const first=state.events[0];
  assert.equal(first.frequency,0x64c);assert.equal(first.frequencyKnown,true);assert.deepEqual(first.pan,{left:9,right:9});assert.equal(first.output.headphones,true);assert.equal(first.audible,false);
  state.advance(10);write(state,0,0xa6,10);state.flush(10);
  assert.equal(state.events.length,2);const second=state.events[1];assert.equal(second.frequency,0x6a6);assert.equal(second.audible,false);assert.equal(first.audibleDurationSamples,10);
  for(let time=11;time<=100;time++)state.advance(time);
  assert.equal(state.events.length,2,'ordinary waits do not create another definition or observation');assert.equal(second.audibleDurationSamples,90);
  write(state,8,0,100);state.advance(110);assert.equal(state.events.at(-1).audible,false);assert.equal(second.audibleDurationSamples,90);
});

test('zero-wait bank and mode transitions retain RAM candidates without marking them as played',()=>{
  const state=createWonderSwanWaves();upload(state,0);upload(state,64,packedWave(1));write(state,8,0x99);write(state,17,8);write(state,16,1);
  write(state,15,1);write(state,15,0);state.advance(100);
  assert.equal(state.samples.length,2);assert.equal(state.samples[0].usedInPlayback,true);assert.equal(state.samples[1].usedInPlayback,false);
  assert(state.events.filter(event=>event.bank===1).every(event=>event.audible===false));
  assert.throws(()=>state.advance(99),/backwards/);
});
