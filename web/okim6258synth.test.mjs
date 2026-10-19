import test from 'node:test';
import assert from 'node:assert/strict';
import factory from '../docs/generated/okim6258_wasm.js';
import {Oki6258AudioEngine} from './okim6258audioengine.js';
import {encodeOki6258, summarizeOki6258, oki6258Rate, Oki6258Synth, Oki6258Stream} from './okim6258synth.js';
import {createOki6258Client} from './playground_okim6258.js';

async function makeStream(clock = 8000000, rate = 44100) {
  const engine = await Oki6258AudioEngine.create({moduleFactory:factory, clock, flags:12, outputSampleRate:rate});
  return {engine, stream:new Oki6258Stream(engine, {clock})};
}
function render(stream, count) {
  const left = new Float32Array(count), right = new Float32Array(count);
  stream.process(left, right); return {left, right};
}
function collect(stream, count, split) {
  const left = [], right = [];
  for (let offset = 0; offset < count; offset += split) {
    const pcm = render(stream, Math.min(split, count - offset));
    left.push(...pcm.left); right.push(...pcm.right);
  }
  return {left, right};
}

test('OKI encoder uses low nibble first and the native initial predictor / 12-bit scale', async () => {
  // These four exact native levels require codes 0, 1, 8, 15 respectively.
  const encoded = encodeOki6258({channels:[Float32Array.of(0, 6 / 2047, 4 / 2047, -26 / 2048)], sampleRate:8000}, 8000);
  assert.deepEqual([...encoded.bytes], [0x10, 0xf8]);
  const {engine, stream} = await makeStream(8192000, 8000);
  try {
    stream.writeRegister(12, 0);
    stream.loadMemory(encoded.bytes); stream.play();
    assert.deepEqual([...render(stream, 4).left], [0, 6 / 2048, 4 / 2048, -26 / 2048]);
    assert.ok(render(stream, 100).left.every(value => value === 0));
  } finally { engine.dispose(); }
});

test('PCM conversion averages channels, resamples and pads one final nibble', () => {
  const mono = Float32Array.from({length:101}, (_, i) => Math.sin(i / 7) * 0.4);
  const other = Float32Array.from(mono, value => -value);
  const stereo = encodeOki6258({channels:[mono, other], sampleRate:10000}, 5000);
  const silence = encodeOki6258({channels:[new Float32Array(101)], sampleRate:10000}, 5000);
  assert.deepEqual(stereo.bytes, silence.bytes);
  assert.equal(stereo.frames, 51); assert.equal(stereo.paddedFrames, 52);
  assert.equal(stereo.durationSeconds, 52 / 5000);
  assert.throws(() => encodeOki6258({channels:[Float32Array.of(NaN)], sampleRate:8000}, 8000), /Nonfinite/);
  assert.throws(() => encodeOki6258({channels:[mono], sampleRate:1}, 100000, 10), /exceeds/);
});

test('OKI preview decodes native ADPCM levels and stores only bounded signed peaks',()=>{
  assert.deepEqual(summarizeOki6258(Uint8Array.of(0x10,0xf8)),{frames:4,waveform:[0,6/2048,4/2048,-26/2048]});
  assert.deepEqual(summarizeOki6258(Uint8Array.of(0x10,0xf8),{bins:2}),{frames:4,waveform:[6/2048,-26/2048]});
  const source=Uint8Array.from({length:100000},(_,i)=>i&255),copy=source.slice(),preview=summarizeOki6258(source);
  assert.equal(preview.frames,200000);assert.equal(preview.waveform.length,512);assert(preview.waveform.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));assert.deepEqual(source,copy);
  assert.throws(()=>summarizeOki6258(source,{bins:513}),/bins/);
});

test('VCLK uses only hardware dividers and nearest supported sample rate', () => {
  assert.deepEqual(oki6258Rate(8000000, 16000), {divider:512, sampleRate:15625});
  assert.deepEqual(oki6258Rate(8000000, 10000), {divider:768, sampleRate:8000000 / 768});
  assert.deepEqual(oki6258Rate(4000000, 4000), {divider:1024, sampleRate:3906.25});
  assert.throws(() => oki6258Rate(8000000, 0), /rate/);
});

for (const [clock, outputRate, divider] of [[8000000, 44100, 512], [8192000, 8000, 512], [8000000, 48000, 768], [4000000, 44100, 1024]]) {
  test(`native FIFO rendering is partition independent at ${clock}/${divider} into ${outputRate}`, async () => {
    const {engine, stream} = await makeStream(clock, outputRate);
    const encoded = Uint8Array.from({length:181}, (_, i) => ((i * 31) ^ (i >>> 2)) & 255);
    try {
      stream.writeRegister(12, [1024, 768, 512].indexOf(divider)); stream.loadMemory(encoded);
      const count = Math.ceil(encoded.length * 2 / (clock / divider) * outputRate) + 200;
      stream.play(); const whole = collect(stream, count, count);
      stream.play(); assert.deepEqual(collect(stream, count, 1), whole);
      stream.play(); assert.deepEqual(collect(stream, count, 127), whole);
      assert.ok(whole.left.some(value => value !== 0));
      assert.ok(whole.left.slice(-100).every(value => value === 0));
      assert.equal(stream.playing, false);
    } finally { engine.dispose(); }
  });
}

test('repeating restarts predictor, Stop silences immediately and preserves sample/config', async () => {
  const {engine, stream} = await makeStream(8192000, 8000);
  try {
    stream.writeRegister(2, 1); stream.loadMemory(Uint8Array.of(0x10, 0xf8)); stream.play({repeat:true});
    const pcm = render(stream, 12);
    assert.deepEqual([...pcm.left], [6 / 2048, -26 / 2048, 6 / 2048, -26 / 2048, 6 / 2048, -26 / 2048, 6 / 2048, -26 / 2048, 6 / 2048, -26 / 2048, 6 / 2048, -26 / 2048]);
    assert.ok(pcm.right.every(value => value === 0));
    stream.stop(); assert.ok(render(stream, 128).left.every(value => value === 0));
    stream.play(); assert.deepEqual([...render(stream, 2).left], [6 / 2048, -26 / 2048]);
    stream.reset(); assert.equal(stream.bytes.length, 2); assert.equal(stream.pan, 0);
    stream.play(); assert.deepEqual([...render(stream, 2).left], [6 / 2048, -26 / 2048]);
  } finally { engine.dispose(); }
});

test('rate and pan changes preserve the queued stream and silence has no DC after EOF', async () => {
  const {engine, stream} = await makeStream();
  try {
    stream.loadMemory(Uint8Array.from({length:100}, () => 0x71)); stream.play(); render(stream, 100);
    stream.setClock(4000000); stream.writeRegister(12, 1); stream.writeRegister(2, 2);
    const pcm = render(stream, 2000);
    assert.ok(pcm.left.every(value => value === 0));
    assert.ok(pcm.right.some(value => value !== 0));
    assert.ok(pcm.right.slice(-100).every(value => value === 0));
  } finally { engine.dispose(); }
});

test('client waits for memory acknowledgement, preserves ownership methods and adopts state without writes', async () => {
  const messages = [];
  const port = {onmessage:null, postMessage(message) { messages.push(message); }, start(){}, close(){}};
  const client = createOki6258Client(port);
  assert.equal(messages.length, 0);
  const loading = client.loadSample({channels:[Float32Array.of(0, 0.2, -0.2, 0)], sampleRate:15625});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(client.sample, null);
  const memory = messages.find(message => message.method === 'loadMemory');
  assert.ok(memory.args[0] instanceof Uint8Array);
  port.onmessage({data:{id:memory.id}});
  const metadata = await loading;
  assert.equal(metadata.bytes, 2); assert.equal(client.sample.frames, 4);
  client.setPan(false, true); client.setPlaybackRate(7800);
  const state = client._getState(), before = messages.length;
  const otherPort = {postMessage(message) { throw new Error(`Unexpected shadow write ${message.method}`); }, start(){}, close(){}};
  const mirror = createOki6258Client(otherPort); mirror._adoptState(state);
  assert.deepEqual(mirror._getState(), state); assert.equal(messages.length, before);
  client.play({repeat:true}); client.stop(); client.keyOff(); client.allNotesOff();
  assert.deepEqual(messages.slice(-4).map(message => message.method), ['play', 'stop', 'stop', 'stop']);
  const clockRequest = client.setClock(4000000);
  port.onmessage({data:{id:messages.at(-1).id}}); await clockRequest;
  assert.equal(client.clock, 4000000); assert.equal(client.playbackRate, 3906.25);
  client.dispose(); assert.throws(() => client.play(), /disposed/);
});

test('disposing rejects memory RPC and invalid shadow state is rejected', async () => {
  const port = {postMessage(){}, start(){}, close(){}};
  const client = createOki6258Client(port);
  const loading = client.loadMemory(Uint8Array.of(0)); client.dispose();
  await assert.rejects(loading, /disposed/);
  const synth = new Oki6258Synth({transport:{}});
  assert.throws(() => synth._adoptState({clock:8000000, divider:512, pan:0, sample:{bytes:4,frames:1,sampleRate:15625,durationSeconds:1}}), /sample state/);
});
