import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {exportYm2612VgmToPlaygroundJavaScript} from '../js/ym2612vgm.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {YM2612Synth} from '../js/ym2612synth.js';
import {createYm2612} from '../js/ym2612.js';
import {YM2612DacPlayer, receiveDacCommand} from '../js/ym2612_dac.js';
import {createChipPortReceiver} from '../js/playground_chip_port.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from '../js/playground_audition_guard.js';
import ym2612ModuleFactory from '../generated/ym2612_wasm.js';
import {vgmBytes} from '../../web/test-support/vgm-mock.js';

const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
const wait = n => [0x61, n & 255, n >>> 8];
const expectedDac = [[0, 0x90], [441, 0xc0], [882, 0x40], [1323, 0xa0], [1323, 0x88], [1323, 0x99]];
const totalSamples = 2205;

function streamFixture(start = 0) {
  // Command-count mode is 1; mode 0 retains a previous length and cannot start
  // an uninitialized stream. The first command is emitted immediately.
  // A 100 Hz stream maps exactly to both output rates, independently of the
  // player's floor versus the worklet's round policy for fractional frames.
  const bytes = vgmBytes([
    ...(start ? wait(start) : []),
    0x53, 0xb6, 0xc0, 0x52, 0x2b, 0x80,
    0x67, 0x66, 0, ...u32(4), 0x90, 0xc0, 0x40, 0xa0,
    0x90, 0, 2, 0, 0x2a, 0x91, 0, 0, 1, 0,
    0x92, 0, ...u32(100), 0x93, 0, ...u32(0), 1, ...u32(4),
    ...wait(1323), 0x52, 0x2a, 0x88, 0x52, 0x2a, 0x99,
    ...wait(441), 0x52, 0x2b, 0, ...wait(441), 0x66,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x2c, 7670454, true);
  view.setUint32(0x18, start + totalSamples, true);
  return bytes;
}

async function renderer(rate) {
  let Processor;
  const messages = [];
  const scope = {
    sampleRate: rate, currentFrame: 0, Float32Array, Uint8Array, Error,
    YM2612DacPlayer, receiveDacCommand, createChipPortReceiver,
    createOpnAuditionGuard, receiveOpnAuditionCommand, createYm2612, ym2612ModuleFactory,
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage: message => messages.push(message)};}},
    registerProcessor: (_name, type) => {Processor = type;},
  };
  vm.runInNewContext(readFileSync(new URL('../js/ym2612-worklet.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), scope);
  const processor = new Processor();
  await processor.init(readFileSync(new URL('../generated/ym2612_wasm.wasm', import.meta.url)));
  assert.ok(messages.some(message => message.type === 'ready'));
  const trace = [];
  let writeFrame = 0;
  const generate = processor.renderFrames.bind(processor);
  processor.renderFrames = (...args) => {
    generate(...args);
    writeFrame = scope.currentFrame + args[2] + args[3];
  };
  const write = processor.ym2612.writeRegister.bind(processor.ym2612);
  processor.ym2612.writeRegister = (register, value, port = 0) => {
    trace.push([writeFrame, port, register, value]);
    write(register, value, port);
  };
  return {
    processor, trace,
    render(frames) {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      processor.process([], [[left, right]]);
      scope.currentFrame += frames;
      return {left, right};
    },
    close() {processor.ym2612.dispose();},
  };
}

async function exportedProgram(bytes, mode, encoding, start) {
  let packed;
  const source = exportYm2612VgmToPlaygroundJavaScript(bytes, {
    scheduled: mode === 'schedule', high: mode === 'high', splitChannels: false,
    dacBase64: encoding !== 'raw',
    ...(encoding === 'file' ? {writeDacFile(data) {packed = new Uint8Array(data); return '/dac.dat';}} : {}),
  });
  const loops = [], writes = [];
  let clock = start, streamStart;
  const record = (port, register, value) => writes.push([clock, port, register, value]);
  const fm = new YM2612Synth({transport: {write: record}});
  writes.length = 0;
  const globals = {
    fm, liveLoop: (_name, fn) => loops.push(fn),
    livePrepare: async (_name, fn) => fn(),
    sleepSamples: async samples => {clock += samples;},
    write: (...args) => record(...(args.length === 2 ? [0, ...args] : args)),
    beginSampleSchedule: () => start,
    scheduleWritesSamples: (start, entries) => writes.push(...entries.map(([offset, ...rest]) => [start + offset, ...rest])),
    dac: {
      async load(_name, data) {packed = new Uint8Array(data);},
      async loadBase64(_name, data) {packed = new Uint8Array(Buffer.from(data, 'base64'));},
      playStream: (_name, {atSamples}) => {streamStart = atSamples;},
    },
    file: async () => packed.slice().buffer,
    CH1: 0, CH2: 1, CH3: 2, CH4: 3, CH5: 4, CH6: 5,
    OP1: 0, OP2: 1, OP3: 2, OP4: 3,
  };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction(...Object.keys(globals), source)(...Object.values(globals));
  assert.equal(loops.length, 1);
  await loops[0]();
  assert.equal(clock, start + totalSamples);
  if (encoding !== 'raw') {
    assert.equal(streamStart, start);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    assert.equal(packed.length, expectedDac.length * 5);
    assert.deepEqual(Array.from({length: packed.length / 5}, (_, i) => [view.getUint32(i * 5, true), packed[i * 5 + 4]]), expectedDac);
  }
  return {writes, packed, streamStart};
}

for (const rate of [44100, 48000]) for (const start of [0, 4410]) {
  test(`Write/Schedule/High DAC streams match original player and real WASM PCM at ${rate} Hz, start ${start}`, async () => {
    const frames = (start + totalSamples) * rate / 44100;
    const reference = await renderer(rate);
    try {
      const engine = {
        sampleRate: () => rate,
        processFrames: count => reference.render(count),
        vgmTargets: {ym2612: {writeRegister(register, value, port = 0) {
          reference.processor.applyCommand({type: 'write', port, register, value});
        }}},
      };
      const player = new VgmPlayer(engine);
      player.load(streamFixture(start)); player.play();
      const expected = {left: new Float32Array(frames), right: new Float32Array(frames)};
      assert.equal(player.process(expected.left, expected.right, frames), frames);
      const dacTrace = trace => trace.filter(([, port, register]) => port === 0 && register === 0x2a).map(([frame, , , value]) => [frame, value]);
      assert.deepEqual(dacTrace(reference.trace), expectedDac.map(([sample, value]) => [(start + sample) * rate / 44100, value]));
      assert.ok(expected.left.some(value => Math.abs(value) > .001), 'the original stream must produce real PCM');
      for (const mode of ['write', 'schedule', 'high']) for (const encoding of ['raw', 'base64', 'file']) {
        const program = await exportedProgram(streamFixture(), mode, encoding, start), actual = await renderer(rate);
        try {
          actual.processor.applyCommand({type: 'schedule-writes', entries: program.writes.map(([sample, port, register, value]) => ({time: sample / 44100, port, register, value}))});
          if (program.packed) {
            actual.processor.applyCommand({type: 'load-dac-bank', name: 'vgm-dac', data: program.packed.buffer});
            actual.processor.applyCommand({type: 'play-dac-bank', name: 'vgm-dac', time: program.streamStart / 44100});
          }
          const pcm = actual.render(frames);
          assert.deepEqual(dacTrace(actual.trace), dacTrace(reference.trace), `${mode}/${encoding} DAC timestamps and insertion order`);
          assert.deepEqual(pcm, expected, `${mode}/${encoding} stereo PCM`);
        } finally {actual.close();}
      }
    } finally {reference.close();}
  });
}
