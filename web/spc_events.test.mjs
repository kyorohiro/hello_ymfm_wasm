import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpcEventDecoder, convertSpcTraceEvents, SPC_EVENT_CLOCK_RATE} from './spc_events.js';

function registers() {
  const dsp = new Uint8Array(128);
  dsp.set([100, 0xc0, 0, 0x10, 7, 0x8f, 0xe0, 0x7f], 0);
  return dsp;
}
function create(options = {}) {return createSpcEventDecoder({dsp: registers(), includeInitial: false, ...options});}
function decode(writes, options) {
  const decoder = create(options);
  return [...decoder.pushWrites(writes), ...decoder.flush()];
}

test('SPC clock units and initial notes are explicit heuristics with owned presets', () => {
  assert.equal(SPC_EVENT_CLOCK_RATE, 1024000);
  const dsp = registers();
  dsp[0x4c] = 1 | 2; // voice0 KON, voice1 KON but held KOFF, voice2 envelope tail
  dsp[0x5c] = 2 | 4;
  dsp[0x18] = 10; dsp[0x28] = 1;
  const decoder = createSpcEventDecoder({dsp, startClock: 1024});
  dsp.fill(0);
  const events = decoder.flush(1024);
  assert.deepEqual(events.map(event => [event.type, event.channel, event.clock, event.reason, event.inferred]), [
    ['noteOn', 0, 1024, 'initial', true], ['noteOff', 1, 1024, 'initial', true], ['noteOff', 2, 1024, 'initial', true],
  ]);
  assert.deepEqual(events[0].preset, {sourceNumber: 7, pitch: 4096, adsr1: 143, adsr2: 224, gain: 127, volumeLeft: 100, volumeRight: -64});
  assert.equal(events[0].keyOffHeld, false);
  events[0].preset.pitch = 1;
  assert.equal(decoder.snapshot()[3], 16);
  assert.deepEqual(decoder.flush(), []);
});

test('same-clock PITCH pair is combined across batches and finite watermark holds its boundary', () => {
  const decoder = create();
  assert.deepEqual(decoder.pushWrites(new Float64Array([32, 2, 0x34]), 32), []);
  assert.deepEqual(decoder.flush(32), []);
  assert.deepEqual(decoder.pushWrites(new Uint32Array([32, 3, 0x12])), []);
  assert.deepEqual(decoder.flush(33), [{type: 'pitch', clock: 32, channel: 0, pitch: 0x1234}]);
  assert.deepEqual(decoder.flush(), []);
});

test('unchanged values, PITCH unused high bits and same-clock reverted changes emit no controls', () => {
  assert.deepEqual(decode([
    0, 2, 0, 0, 3, 0xd0, 0, 0, 100, 0, 1, 0xc0,
    32, 2, 0xff, 32, 2, 0, 32, 4, 99, 32, 4, 7,
    64, 7, 0x7f,
  ]), []);
});

test('signed stereo volume and instrument fields aggregate with complete current preset', () => {
  const events = decode([
    16, 0, 0x80, 16, 1, 0xff,
    16, 4, 255, 16, 5, 0x9a, 16, 6, 0x42, 16, 7, 0x21,
  ]);
  assert.deepEqual(events, [
    {type: 'volume', clock: 16, channel: 0, volumeLeft: -128, volumeRight: -1},
    {type: 'instrument', clock: 16, channel: 0, sourceNumber: 255, adsr1: 0x9a, adsr2: 0x42, gain: 0x21,
      preset: {sourceNumber: 255, pitch: 4096, adsr1: 0x9a, adsr2: 0x42, gain: 0x21, volumeLeft: -128, volumeRight: -1}},
  ]);
});

test('KON is a key request on every write and its preset does not include later same-clock changes', () => {
  const events = decode([
    32, 2, 0x20, 32, 0x4c, 1, 32, 4, 8, 32, 0x4c, 1,
    32, 0x5c, 1, 32, 0x5c, 0, 32, 0x4c, 1,
  ]);
  assert.deepEqual(events.map(event => event.type), ['pitch', 'noteOn', 'instrument', 'noteOn', 'noteOff', 'noteOn']);
  const notes = events.filter(event => event.type === 'noteOn');
  assert.deepEqual(notes.map(note => [note.pitch, note.sourceNumber, note.keyOffHeld]), [[0x1020, 7, false], [0x1020, 8, false], [0x1020, 8, false]]);
  assert.equal(notes[0].preset.sourceNumber, 7);
  assert.ok(notes.every(note => note.reason === 'kon'));
});

test('persistent KOFF is respected and repeated unchanged release masks are suppressed', () => {
  const events = decode([
    0, 0x5c, 1, 32, 0x4c, 1, 64, 0x5c, 1, 96, 0x4c, 1,
    128, 0x5c, 0, 160, 0x4c, 1, 192, 0x5c, 1, 224, 0x5c, 1,
  ]);
  assert.deepEqual(events.map(event => [event.type, event.clock, event.keyOffHeld]), [
    ['noteOff', 0, undefined], ['noteOn', 32, true], ['noteOn', 96, true], ['noteOn', 160, false], ['noteOff', 192, undefined],
  ]);
});

test('all eight KON channels and clearing KOFF preserve exact key order', () => {
  const events = decode([0, 0x4c, 255, 0, 0x5c, 255, 0, 0x5c, 0, 0, 0x4c, 128]);
  assert.deepEqual(events.map(event => [event.type, event.channel]), [
    ...Array.from({length: 8}, (_, channel) => ['noteOn', channel]),
    ...Array.from({length: 8}, (_, channel) => ['noteOff', channel]), ['noteOn', 7],
  ]);
});

test('globals remain raw events with control boundaries and ENDX write-to-clear semantics', () => {
  const decoder = create();
  const events = [...decoder.pushWrites([0, 2, 1, 0, 0x2d, 2, 0, 2, 2, 0, 0x5d, 0x30, 0, 0x7c, 0xff, 0, 0x7c, 0xff]), ...decoder.flush()];
  assert.deepEqual(events.map(event => event.type), ['pitch', 'dsp', 'pitch', 'dsp', 'dsp', 'dsp']);
  assert.deepEqual(events.filter(event => event.type === 'dsp').map(event => [event.register, event.value]), [[0x2d, 2], [0x5d, 0x30], [0x7c, 255], [0x7c, 255]]);
  assert.equal(decoder.snapshot()[0x7c], 0);
});

test('channel/type filters never suppress state updates or global DSP events', () => {
  const decoder = create({channels: [1], types: ['noteOn', 'pitch', 'dsp']});
  assert.deepEqual(decoder.pushWrites([0, 4, 42, 0, 0x14, 50, 0, 0x2d, 2, 0, 0x4c, 3]).map(event => [event.type, event.channel]), [['dsp', undefined], ['noteOn', 1]]);
  assert.equal(decoder.snapshot()[4], 42);
  const next = decoder.pushWrites([32, 0x12, 9, 32, 0x13, 0x10], 64);
  assert.deepEqual(next, [{type: 'pitch', clock: 32, channel: 1, pitch: 4105}]);
});

test('clocks larger than Uint32 retain precision and no seconds or MIDI pitch is invented', () => {
  const clock = 2 ** 32 + 123;
  const events = decode(new Float64Array([clock, 2, 1, clock + 32, 0x4c, 1]));
  assert.equal(events[0].clock, clock);
  assert.equal(events[1].clock, clock + 32);
  assert.equal(events[1].pitch, 4097);
  assert.equal('seconds' in events[1], false);
  assert.equal('note' in events[1], false);
});

test('batch partition does not change musical events including split PITCH and ordering boundaries', () => {
  const writes = [0, 2, 10, 0, 3, 20, 0, 0, 90, 0, 1, 80, 0, 0x4c, 1, 32, 4, 8, 32, 5, 0x90, 64, 0x5c, 1, 64, 0x5c, 0, 64, 0x4c, 1];
  const expected = decode(writes);
  for (let partition = 1; partition <= 5; partition++) {
    const decoder = create(), actual = [];
    for (let i = 0; i < writes.length; i += partition * 3) actual.push(...decoder.pushWrites(writes.slice(i, i + partition * 3)));
    actual.push(...decoder.flush());
    assert.deepEqual(actual, expected, `partition ${partition}`);
  }
});

test('malformed or unordered batches fail atomically; reset clears held/pending state and owns its input', () => {
  const decoder = create();
  decoder.pushWrites([32, 2, 3]);
  const before = decoder.snapshot();
  for (const bad of [[33, 4, 4, 31, 0, 1], [33, 128, 0], [NaN, 2, 0], [Infinity, 2, 0], [1.5, 2, 0], [33, 2, 256], [1]]) {
    assert.throws(() => decoder.pushWrites(bad));
    assert.deepEqual(decoder.snapshot(), before);
  }
  assert.throws(() => decoder.flush(NaN), /watermark/);
  const dsp = registers(); dsp[0x4c] = 1;
  decoder.reset(dsp, 128); dsp[4] = 99;
  assert.deepEqual(decoder.flush(), []); // includeInitial=false survives reset
  assert.equal(decoder.snapshot()[4], 7);
  assert.deepEqual(decode([0, 2, 0]), []);
  assert.throws(() => create({channels: [8]}), /channels/);
  assert.throws(() => create({types: ['unknown']}), /types/);
  assert.throws(() => create({dsp: new Uint8Array(127)}), /128/);
});

test('per-call input work is bounded while separate streamed batches remain usable', () => {
  const decoder = create();
  assert.throws(() => decoder.pushWrites(new Uint32Array(8193 * 3)), /8,192/);
  const writes = new Uint32Array(8192 * 3);
  for (let i = 0; i < writes.length; i += 3) {writes[i] = i; writes[i + 1] = 2; writes[i + 2] = i % 256;}
  const events = [...decoder.pushWrites(writes), ...decoder.flush()];
  assert.ok(events.length > 8000);
});

test('trace conversion ignores RAM writes, preserves DSP clocks and has explicit output bounds', () => {
  const trace = {version: 1, clockRate: 1024000, initialState: {dsp: registers()}, events: new Uint32Array([
    0, 1, 0x2000, 10, 32, 0, 2, 0x34, 32, 1, 0x2001, 11, 32, 0, 3, 0x12, 64, 0, 0x4c, 1,
  ])};
  const events = convertSpcTraceEvents(trace, {includeInitial: false});
  assert.deepEqual(events.map(event => [event.type, event.clock, event.pitch]), [['pitch', 32, 0x1234], ['noteOn', 64, 0x1234]]);
  assert.throws(() => convertSpcTraceEvents(trace, {maxEvents: 1}), /limit/);
  assert.throws(() => convertSpcTraceEvents({...trace, clockRate: 32000}), /1,024,000/);
  assert.throws(() => convertSpcTraceEvents({...trace, events: [0, 2, 0, 0]}), /kind/);
});
