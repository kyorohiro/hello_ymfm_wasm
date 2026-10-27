import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMSM5205Sample, MSM5205_MAX_SAMPLE_BYTES} from './msm5205_sample.js';
import {Msm5205AudioEngine} from './msm5205audioengine.js';

function wav(channels, sampleRate = 8000, {type = 1, bits = 16} = {}) {
  const count = channels.length, frames = channels[0].length, block = count * bits / 8;
  const bytes = new Uint8Array(44 + frames * block), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    bytes.set(new TextEncoder().encode(text), offset);
  }
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, type, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * block, true);
  view.setUint16(32, block, true); view.setUint16(34, bits, true); view.setUint32(40, frames * block, true);
  channels.forEach((channel, c) => channel.forEach((value, i) => {
    const offset = 44 + i * block + c * bits / 8;
    if (type === 3) view.setFloat32(offset, value, true);
    else view.setInt16(offset, Math.round(value * 32768), true);
  }));
  return bytes;
}

function decode(data) {
  const engine = new Msm5205AudioEngine({clock: 1536000});
  engine.writeMsm5205(0, 1); engine.writeMsm5205(0, 0);
  const values = [];
  for (const byte of data) for (const nibble of [byte >> 4, byte & 15]) {
    engine.writeMsm5205(1, nibble); engine.decode(); values.push(engine.signal / 2048);
  }
  return values;
}

test('PCE register rates use the actual clock and preserve encoding metadata', async () => {
  for (let rate = 0; rate < 16; rate++) {
    const prepared = await prepareMSM5205Sample({channels: [new Float32Array(32)], sampleRate: 32000}, {rate});
    assert.equal(prepared.rate, rate);
    assert.equal(prepared.sampleRate, 1536000 / (48 * (16 - rate)));
    assert.equal(prepared.frames, Math.round(prepared.sampleRate / 1000));
    assert.equal(prepared.duration, prepared.frames / prepared.sampleRate);
    assert.equal(prepared.paddedFrames, Math.ceil(prepared.frames / 2) * 2);
    assert.equal(prepared.data.length, prepared.paddedFrames / 2);
  }
  const alternate = await prepareMSM5205Sample({channels: [[0]], sampleRate: 8000}, {clock: 1000000, rate: 12});
  assert.equal(alternate.sampleRate, 1000000 / 192);
});

test('greedy high-first 4-bit encoding matches the real legacy decoder and keeps sine pitch', async () => {
  const input = Float32Array.from({length: 8000}, (_, i) => .6 * Math.sin(i * 2 * Math.PI * 440 / 8000));
  const sample = await prepareMSM5205Sample({channels: [input], sampleRate: 8000});
  const output = decode(sample.data);
  let error = 0, energy = 0, dot = 0, outputEnergy = 0;
  for (let i = 100; i < input.length; i++) {
    error += (output[i] - input[i]) ** 2; energy += input[i] ** 2;
    dot += output[i] * input[i]; outputEnergy += output[i] ** 2;
  }
  assert.ok(Math.sqrt(error / energy) < .06, `relative RMS error ${Math.sqrt(error / energy)}`);
  assert.ok(dot / Math.sqrt(energy * outputEnergy) > .998, 'sine shape and frequency survive the codec');
  assert.equal(sample.frames, 8000); assert.equal(sample.data.length, 4000);
  assert.equal(sample.duration, 1);
});

test('WAV PCM16, float32 and offset views share stereo downmix and linear resampling', async () => {
  const channels = [[-.5, 0, .5, 0, -.5, 0], [.5, 0, -.5, 0, .5, 0]];
  const silence = await prepareMSM5205Sample({channels: [new Float32Array(6)], sampleRate: 8000});
  for (const options of [{type: 1, bits: 16}, {type: 3, bits: 32}]) {
    const bytes = wav(channels, 8000, options), wrapped = new Uint8Array(bytes.length + 10); wrapped.set(bytes, 5);
    const result = await prepareMSM5205Sample(wrapped.subarray(5, bytes.length + 5));
    assert.deepEqual(result, silence);
  }
  const input = {channels: [[-.5, -.25, 0, .25, .5]], sampleRate: 4000};
  const resampled = {channels: [[-.5, -.375, -.25, -.125, 0, .125, .25, .375, .5, .5]], sampleRate: 8000};
  assert.deepEqual(await prepareMSM5205Sample(input), await prepareMSM5205Sample(resampled));
  const raw = wav([[.25, .5, -.5]]);
  assert.deepEqual(await prepareMSM5205Sample(new Blob([raw])), await prepareMSM5205Sample(raw.buffer));
});

test('odd frame padding is encoded toward silence, never copied from an unrelated nibble', async () => {
  const prepared = await prepareMSM5205Sample({channels: [[.6]], sampleRate: 8000});
  assert.equal(prepared.frames, 1); assert.equal(prepared.paddedFrames, 2); assert.equal(prepared.data.length, 1);
  const actual = decode(prepared.data);
  assert.ok(actual[0] > 0); assert.ok(Math.abs(actual[1]) < Math.abs(actual[0]));
});

test('a faded tone returns the decoder step to zero for stable hardware RAM loops', async () => {
  // Hardware loops preserve predictor/step state. A hard-cut PCM tone ends at
  // a large adaptive step and need not be loop-safe; this fixture fades 25 ms.
  const input=Float32Array.from({length:8000},(_,i)=>.25*Math.sin(i*2*Math.PI*440/8000)*Math.min(1,i/200,(8000-i)/200));
  const {data}=await prepareMSM5205Sample({channels:[input],sampleRate:8000});
  const engine=new Msm5205AudioEngine({clock:1536000});engine.writeMsm5205(0,1);engine.writeMsm5205(0,0);
  const peaks=[];
  for(let loop=0;loop<4;loop++){
    let peak=0;
    for(const byte of data)for(const nibble of[byte>>4,byte&15]){
      engine.writeMsm5205(1,nibble);engine.decode();peak=Math.max(peak,Math.abs(engine.signal/2048));
    }
    assert.equal(engine.step,0,'The encoded fade settles the adaptive step before wrapping');peaks.push(peak);
  }
  assert.ok(peaks.every(peak=>Math.abs(peak-peaks[0])<.002),'Continuous raw ADPCM loops retain amplitude');
});

test('64 KiB RAM boundary is enforced before encoding or WAV channel allocation', async () => {
  assert.equal(MSM5205_MAX_SAMPLE_BYTES, 65536);
  const maximum = await prepareMSM5205Sample({channels: [new Float32Array(131072)], sampleRate: 8000});
  assert.equal(maximum.data.length, 65536);
  await assert.rejects(prepareMSM5205Sample({channels: [new Float32Array(131073)], sampleRate: 8000}), /64 KiB/);
  const oversized = wav([new Float32Array(131073)]);
  await assert.rejects(prepareMSM5205Sample(oversized, {decodeAudio: () => assert.fail('must reject dimensions before decoding')}), /64 KiB/);
  const largePCM = {channels: [{length: 33554433}], sampleRate: 1000000000};
  await assert.rejects(prepareMSM5205Sample(largePCM), /128 MiB/);
});

test('sample preparation rejects invalid timing, dimensions, paths, truncated WAV and skipped NaN', async () => {
  const source = {channels: [[0, 0]], sampleRate: 8000};
  for (const options of [{rate: -1}, {rate: 16}, {rate: 1.5}, {clock: 0}, {clock: NaN}]) {
    await assert.rejects(prepareMSM5205Sample(source, options), /rate|clock/);
  }
  for (const pcm of [{channels: [], sampleRate: 8000}, {channels: [[0], [0, 0]], sampleRate: 8000},
    {channels: [[0]], sampleRate: 0}]) await assert.rejects(prepareMSM5205Sample(pcm), /Invalid/);
  await assert.rejects(prepareMSM5205Sample({channels: [[0, NaN, 0, 0]], sampleRate: 32000}), /Nonfinite/);
  await assert.rejects(prepareMSM5205Sample('/sample.wav'), /Resolve/);
  await assert.rejects(prepareMSM5205Sample(new URL('file:///sample.wav')), /Resolve/);
  await assert.rejects(prepareMSM5205Sample(wav([[0, 0]]).subarray(0, 45)), /Truncated/);
  await assert.rejects(prepareMSM5205Sample(new Uint8Array([1, 2])), /decodeAudio/);
});

test('AudioBuffer and injected decoder validate bounds and honor cancellation after decode', async () => {
  const source = {numberOfChannels: 1, sampleRate: 8000, getChannelData: () => new Float32Array(4)};
  const prepared = await prepareMSM5205Sample(source);
  assert.deepEqual(await prepareMSM5205Sample(new Uint8Array([1]), {decodeAudio: async () => source}), prepared);
  const controller = new AbortController();
  await assert.rejects(prepareMSM5205Sample(new Uint8Array([1]), {signal: controller.signal, decodeAudio: async () => {
    controller.abort(); return source;
  }}), {name: 'AbortError'});
  await assert.rejects(prepareMSM5205Sample(source, {signal: controller.signal}), {name: 'AbortError'});
  await assert.rejects(prepareMSM5205Sample(new Uint8Array([1]), {decodeAudio: async () => ({channels: [new Float32Array(131073)], sampleRate: 8000})}), /64 KiB/);
});
