import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CDDA_MAX_TRACK_BYTES,
  parseCddaWav,
  parseCddaTrackManifest,
  createCddaTrackSource,
  createCddaWavTrackSource,
  loadCddaTrack,
  loadCddaTracks,
} from './cdda_source.js';

function chunk(id, body) {
  const result = new Uint8Array(8 + body.length + (body.length & 1));
  result.set(new TextEncoder().encode(id));
  new DataView(result.buffer).setUint32(4, body.length, true);
  result.set(body, 8);
  return result;
}

function format(overrides = {}, length = 16) {
  const result = new Uint8Array(length);
  const view = new DataView(result.buffer);
  const values = {tag: 1, channels: 2, rate: 44100, byteRate: 176400, align: 4, bits: 16, ...overrides};
  view.setUint16(0, values.tag, true);
  view.setUint16(2, values.channels, true);
  view.setUint32(4, values.rate, true);
  view.setUint32(8, values.byteRate, true);
  view.setUint16(12, values.align, true);
  view.setUint16(14, values.bits, true);
  return result;
}

function riff(chunks) {
  const result = new Uint8Array(12 + chunks.reduce((sum, data) => sum + data.length, 0));
  result.set(new TextEncoder().encode('RIFF'));
  result.set(new TextEncoder().encode('WAVE'), 8);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  let offset = 12;
  for (const data of chunks) { result.set(data, offset); offset += data.length; }
  return result;
}

function pcm(samples) {
  const result = new Uint8Array(samples.length * 2);
  const view = new DataView(result.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return result;
}

const samples = [-32768, 32767, -1234, 4567, 0, -1, 12000, -12000];
const wav = () => riff([chunk('fmt ', format()), chunk('data', pcm(samples))]);
const manifest = (...tracks) => ({tracks});
const first = {number: 2, file: '/music/02.wav'};

test('PCM16 stereo WAV stays little-endian raw bytes without copying or channel mixing', () => {
  const bytes = wav();
  const parsed = parseCddaWav(bytes);
  assert.equal(parsed.sampleRate, 44100);
  assert.equal(parsed.channels, 2);
  assert.equal(parsed.frames, 4);
  assert.equal(parsed.pcm.buffer, bytes.buffer);
  assert.equal(parsed.pcm.byteOffset, 44);
  assert.deepEqual([...parsed.pcm], [...pcm(samples)]);
  const view = new DataView(parsed.pcm.buffer, parsed.pcm.byteOffset, parsed.pcm.byteLength);
  assert.equal(view.getInt16(0, true), -32768);
  assert.equal(view.getInt16(2, true), 32767);
  assert(Object.isFrozen(parsed));
  bytes[44] = 5;
  assert.equal(parsed.pcm[0], 5);
  assert.equal(parseCddaWav(wav().buffer).frames, 4);
});

test('input view byteOffset and byteLength bound the complete RIFF and selected PCM view', async () => {
  const input = wav();
  const container = new Uint8Array(input.length + 23).fill(0x7f);
  container.set(input, 11);
  const bytes = container.subarray(11, 11 + input.length);
  const parsed = parseCddaWav(bytes);
  assert.equal(parsed.pcm.buffer, container.buffer);
  assert.equal(parsed.pcm.byteOffset, 11 + 44);
  const selected = await loadCddaTrack(manifest({...first, startFrame: 1, endFrame: 3}), 2, {readFile: async () => bytes});
  assert.equal(selected.pcm.buffer, container.buffer);
  assert.equal(selected.pcm.byteOffset, 11 + 44 + 4);
  assert.deepEqual([...selected.pcm], [...pcm(samples.slice(2, 6))]);
  assert.throws(() => parseCddaWav(container), /RIFF/);
});

test('unknown chunks and odd metadata padding are skipped; fmt18 empty extension is accepted', () => {
  const bytes = riff([
    chunk('JUNK', new Uint8Array([1, 2, 3])),
    chunk('fmt ', format({}, 18)),
    chunk('LIST', new Uint8Array([6, 5, 4, 3, 2])),
    chunk('data', pcm(samples)),
    chunk('JUNK', new Uint8Array(0)),
  ]);
  assert.deepEqual([...parseCddaWav(bytes).pcm], [...pcm(samples)]);
  // RIFF chunk order is not used to infer a track pregap or a playback offset.
  assert.equal(parseCddaWav(riff([chunk('data', pcm(samples)), chunk('fmt ', format())])).frames, 4);
});

test('unsupported encoding, channel layout, sample rate and inconsistent PCM headers fail', () => {
  for (const overrides of [
    {tag: 3}, {tag: 0xfffe}, {channels: 1}, {channels: 6}, {rate: 48000}, {bits: 24},
    {align: 2}, {byteRate: 123},
  ]) {
    assert.throws(() => parseCddaWav(riff([chunk('fmt ', format(overrides)), chunk('data', pcm(samples))])), /PCM|44100/);
  }
  const extension = format({}, 18);
  extension[16] = 1;
  assert.throws(() => parseCddaWav(riff([chunk('fmt ', extension), chunk('data', pcm(samples))])), /extension/);
  for (const id of ['RIFX', 'RF64', 'OggS']) {
    const bytes = wav();
    bytes.set(new TextEncoder().encode(id));
    assert.throws(() => parseCddaWav(bytes), /little-endian/);
  }
  assert.throws(() => parseCddaWav(new Int16Array(4)), /ArrayBuffer or Uint8Array/);
  assert.throws(() => parseCddaWav({buffer: wav().buffer}), /ArrayBuffer or Uint8Array/);
});

test('RIFF and chunk bounds reject truncation, trailing bytes, duplicates and incomplete frames', () => {
  for (const length of [0, 7, 11, 12, 43]) assert.throws(() => parseCddaWav(wav().subarray(0, length)), /truncated|size/);
  for (const delta of [-1, 1, 0xffffffff]) {
    const bytes = wav();
    new DataView(bytes.buffer).setUint32(4, delta === 0xffffffff ? delta : bytes.length - 8 + delta, true);
    assert.throws(() => parseCddaWav(bytes), /RIFF size/);
  }
  const truncatedChunk = wav();
  new DataView(truncatedChunk.buffer).setUint32(40, 0xffffffff, true);
  assert.throws(() => parseCddaWav(truncatedChunk), /truncated data/);
  const trailing = new Uint8Array(wav().length + 3);
  trailing.set(wav());
  new DataView(trailing.buffer).setUint32(4, trailing.length - 8, true);
  assert.throws(() => parseCddaWav(trailing), /chunk header/);
  const shortFmt = new Uint8Array(15);
  assert.throws(() => parseCddaWav(riff([chunk('fmt ', shortFmt), chunk('data', pcm(samples))])), /fmt chunk/);
  assert.throws(() => parseCddaWav(riff([chunk('fmt ', format({}, 17)), chunk('data', pcm(samples))])), /fmt chunk/);
  for (const chunks of [
    [chunk('fmt ', format())], [chunk('data', pcm(samples))],
    [chunk('fmt ', format()), chunk('fmt ', format()), chunk('data', pcm(samples))],
    [chunk('fmt ', format()), chunk('data', pcm(samples)), chunk('data', pcm(samples))],
    [chunk('fmt ', format()), chunk('data', new Uint8Array(0))],
    [chunk('fmt ', format()), chunk('data', new Uint8Array(6))],
  ]) assert.throws(() => parseCddaWav(riff(chunks)), /must contain|multiple|complete nonempty/);
  const missingPad = riff([chunk('JUNK', new Uint8Array([1]))]).subarray(0, 21);
  new DataView(missingPad.buffer, missingPad.byteOffset, missingPad.byteLength).setUint32(4, missingPad.length - 8, true);
  assert.throws(() => parseCddaWav(missingPad), /padding/);
});

test('manifest preserves explicit numbers and half-open frame ranges without implicit pregap', () => {
  const input = manifest({...first, title: 'Audio 2', startFrame: 1, endFrame: 4, type: 'audio'}, {number: 99, file: '/end.wav'});
  const tracks = parseCddaTrackManifest(JSON.stringify(input));
  assert.deepEqual(tracks, [
    {number: 2, file: '/music/02.wav', title: 'Audio 2', startFrame: 1, endFrame: 4},
    {number: 99, file: '/end.wav', title: '', startFrame: 0},
  ]);
  assert(Object.isFrozen(tracks));
  assert(tracks.every(Object.isFrozen));
  assert.equal(input.tracks[0].type, 'audio');
  assert.equal(input.tracks[1].startFrame, undefined);
  const nullPrototype = Object.assign(Object.create(null), {tracks: [Object.assign(Object.create(null), first)]});
  assert.equal(parseCddaTrackManifest(nullPrototype)[0].number, 2);
});

test('manifest rejects ambiguous, nonfinite, inherited, accessor and unsupported data-track values', () => {
  const cases = [
    null, [], {}, {tracks: []}, {tracks: new Array(1)}, {tracks: new Array(100).fill(first)},
    manifest(first, first), manifest({...first, type: 'data'}), manifest({...first, type: null}),
    manifest({...first, number: 0}), manifest({...first, number: 100}), manifest({...first, number: 2.5}),
    manifest({...first, number: '2'}), manifest({...first, number: Infinity}), manifest({file: first.file}),
    manifest({...first, file: ''}), manifest({...first, file: '  '}), manifest({...first, file: '/a\0.wav'}),
    manifest({...first, file: 2}), manifest({...first, title: 4}),
    manifest({...first, startFrame: -1}), manifest({...first, startFrame: 0.5}),
    manifest({...first, startFrame: Infinity}), manifest({...first, endFrame: NaN}),
    manifest({...first, startFrame: Number.MAX_SAFE_INTEGER + 1}),
    manifest({...first, startFrame: 2, endFrame: 2}), manifest({...first, startFrame: 3, endFrame: 2}),
    manifest({...first, offset: 2}), {...manifest(first), pregap: 150},
    JSON.parse('{"tracks":[{"number":2,"file":"/a.wav","__proto__":{}}]}'),
    {tracks: [Object.assign(Object.create({number: 2}), {file: '/a.wav'})]},
    Object.assign(Object.create({}), manifest(first)),
  ];
  for (const value of cases) assert.throws(() => parseCddaTrackManifest(value), /CD-DA:/);
  assert.throws(() => parseCddaTrackManifest('{oops'), /valid JSON/);
  let reads = 0;
  const accessor = {...first};
  Object.defineProperty(accessor, 'title', {enumerable: true, get() { reads++; return 'unsafe'; }});
  assert.throws(() => parseCddaTrackManifest(manifest(accessor)), /ordinary JSON/);
  const array = [first];
  Object.defineProperty(array, 0, {enumerable: true, get() { reads++; return first; }});
  assert.throws(() => parseCddaTrackManifest({tracks: array}), /ordinary JSON/);
  assert.equal(reads, 0);
});

test('lazy source loads only selected files, preserves shared-file ranges and does not retain all-file cache', async () => {
  const bytes = wav();
  const calls = [];
  const source = createCddaTrackSource(manifest(
    {...first, startFrame: 0, endFrame: 2},
    {number: 3, file: first.file, startFrame: 2},
    {number: 4, file: '/unused.wav'},
  ), {readFile: async path => { calls.push(path); return bytes; }});
  assert.deepEqual(calls, []);
  const track3 = await source.getTrack(3);
  assert.deepEqual(calls, [first.file]);
  assert.equal(track3.frames, 2);
  assert.equal(track3.sourceFrames, 4);
  assert.equal(track3.startFrame, 2);
  assert.equal(track3.endFrame, 4);
  assert.equal(track3.pcm.buffer, bytes.buffer);
  assert.deepEqual([...track3.pcm], [...pcm(samples.slice(4))]);
  const track2 = await source.getTrack(2);
  assert.deepEqual(calls, [first.file, first.file]);
  assert.equal(track2.frames, 2);
  assert.equal(track2.pcm.buffer, track3.pcm.buffer);
  assert.equal(track2.pcm.byteOffset + track2.pcm.byteLength, track3.pcm.byteOffset);
  assert(Object.isFrozen(track3));
  assert(Object.isFrozen(source));
  await assert.rejects(source.getTrack(1), /unknown track/);
  await assert.rejects(source.getTrack('2'), /track number/);
  assert.deepEqual(calls, [first.file, first.file]);
  assert.throws(() => createCddaTrackSource(manifest(first)), /readFile is required/);
});

test('track bounds are validated against loaded WAV frames and explicit PCM byte limit', async () => {
  const readFile = async () => wav();
  for (const range of [{startFrame: 4}, {startFrame: 5}, {endFrame: 5}]) {
    await assert.rejects(loadCddaTrack(manifest({...first, ...range}), 2, {readFile}), /exceeds its WAV/);
  }
  assert.throws(() => parseCddaTrackManifest(manifest({...first, endFrame: CDDA_MAX_TRACK_BYTES / 4 + 1})), /256 MiB/);
  // ArrayBuffer pages remain zero-filled and are not scanned or materialized as
  // Float32. A long file is allowed when the selected range itself is small.
  const dataBytes = CDDA_MAX_TRACK_BYTES + 4;
  const large = new Uint8Array(44 + dataBytes);
  large.set(wav().subarray(0, 44));
  const view = new DataView(large.buffer);
  view.setUint32(4, large.length - 8, true);
  view.setUint32(40, dataBytes, true);
  assert.equal(parseCddaWav(large).frames, dataBytes / 4);
  await assert.rejects(loadCddaTrack(manifest(first), 2, {readFile: async () => large}), /256 MiB/);
  const selected = await loadCddaTrack(manifest({...first, startFrame: 1, endFrame: 3}), 2, {readFile: async () => large});
  assert.equal(selected.pcm.byteLength, 8);
  assert.equal(selected.pcm.buffer, large.buffer);
  const exactLimit = await loadCddaTrack(manifest({...first, endFrame: CDDA_MAX_TRACK_BYTES / 4}), 2, {readFile: async () => large});
  assert.equal(exactLimit.pcm.byteLength, CDDA_MAX_TRACK_BYTES);
});

test('file failures and cancellation after asynchronous Virtual Files reads do not expose PCM', async () => {
  const stopped = new AbortController();
  stopped.abort('stop');
  assert.throws(() => createCddaTrackSource(manifest(first), {readFile: async () => wav(), signal: stopped.signal}), {name: 'AbortError'});
  let finish;
  let readSignal;
  const controller = new AbortController();
  const source = createCddaTrackSource(manifest(first), {signal: controller.signal, readFile: async (path, options) => {
    assert.equal(path, first.file);
    readSignal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  }});
  const pending = source.getTrack(2);
  assert.equal(readSignal, controller.signal);
  controller.abort(new Error('run stopped'));
  finish(wav());
  await assert.rejects(pending, {name: 'AbortError'});
  await assert.rejects(source.getTrack(2), {name: 'AbortError'});

  const singleLoad = new AbortController();
  const global = new AbortController();
  const concurrent = createCddaTrackSource(manifest(first), {signal: global.signal, readFile: async () => {
    singleLoad.abort();
    return wav();
  }});
  await assert.rejects(concurrent.getTrack(2, {signal: singleLoad.signal}), {name: 'AbortError'});
  const fileError = new Error('Virtual File not found');
  await assert.rejects(loadCddaTrack(manifest(first), 2, {readFile: async () => { throw fileError; }}), error => error === fileError);
});

test('direct WAV convenience and explicit eager convenience preserve the same track contract', async () => {
  const bytes = wav();
  const source = createCddaWavTrackSource(bytes, {number: 7, title: 'Original stereo'});
  assert.deepEqual(source.tracks, [{number: 7, title: 'Original stereo', startFrame: 0}]);
  const track = await source.getTrack(7);
  assert.equal(track.number, 7);
  assert.equal(track.title, 'Original stereo');
  assert.equal(track.frames, 4);
  assert.equal(track.pcm.buffer, bytes.buffer);
  await assert.rejects(source.getTrack(1), /unknown track/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(source.getTrack(7, {signal: controller.signal}), {name: 'AbortError'});
  const specs = parseCddaTrackManifest(manifest(first));
  assert.equal((await loadCddaTrack(specs, 2, {readFile: async () => bytes})).frames, 4);
  const eager = await loadCddaTracks(manifest(first, {number: 3, file: '/other.wav', endFrame: 1}), {readFile: async () => bytes});
  assert.deepEqual(eager.map(item => [item.number, item.frames]), [[2, 4], [3, 1]]);
  assert(Object.isFrozen(eager));
});
