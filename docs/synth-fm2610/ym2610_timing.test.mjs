// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {attachYm2612TimedClient} from '../js/ym2612_timed_client.js';
import {ym2610Timing} from '../js/ym2610_timed.js';

test('the OPNB Worklet schedules variant-specific FM and raw SSG writes at exact output frames', async () => {
  let Processor, ready;
  const receive = new EventTarget();
  const notifications = [];
  const workletPort = {postMessage(data) {
    if (data.type === 'ready' || data.type === 'error') ready(data);
    notifications.push(data);
    receive.dispatchEvent(new MessageEvent('message', {data}));
  }};
  Object.assign(globalThis, {
    sampleRate: 48000, currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = workletPort; } },
    registerProcessor(_name, implementation) { Processor = implementation; },
  });
  try {
    await import('../js/ym2610b-worklet.js');
    const wasmBinary = await readFile(new URL('../generated/ym2610b_wasm.wasm', import.meta.url));
    for (const [variant, control] of [['ym2610', 0xf1], ['ym2610b', 0xf0]]) {
      globalThis.currentFrame = 0;
      notifications.length = 0;
      const processor = new Processor();
      const send = data => processor.port.onmessage({data});
      const initialized = new Promise(resolve => { ready = resolve; });
      send({type:'initialize', wasmBinary, variant:variant === 'ym2610b'});
      assert.equal((await initialized).type, 'ready');
      send({type:'observe-timed-writes', enabled:true, instanceId:variant});
      const port = {
        postMessage: send,
        addEventListener: receive.addEventListener.bind(receive),
        removeEventListener: receive.removeEventListener.bind(receive),
      };
      const fm = attachYm2612TimedClient({clock:8000000}, {variant, instanceId:variant}, port, ym2610Timing);
      try {
        const program = fm.build(pattern => {
          pattern.setAlgo(0, 7).setOperator(0, 0, {dt:3, multi:1}).keyOn(0);
          pattern.write(0, 8, 15).atSample(24).setOperator(0, 0, {multi:2});
          pattern.atSample(48).keyOff(0).write(0, 8, 0);
        }, {referenceSampleRate:48000});
        const predicted = await fm.compile(program, {initialState:await fm.captureState()});
        assert(predicted.some(row => row.register === 0x28 && row.value === control));
        assert(predicted.some(row => row.offsetSeconds === 24 / 48000 && row.value === 0x32));
        const actual = [];
        const write = processor.writeRegister.bind(processor);
        let writeFrame = 0;
        const apply = processor.timed.apply.bind(processor.timed);
        processor.timed.apply = (operation, reply, frame, metadata) => {
          writeFrame = frame;
          return apply(operation, reply, frame, metadata);
        };
        processor.writeRegister = (bank, register, value, timed) => {
          write(bank, register, value, timed);
          if (timed) actual.push({port:bank, register, value, frame:writeFrame});
        };
        const receipt = await fm.schedule(program, {name:'notes', repeatSeconds:0.02});
        assert.equal(actual.length, 0);
        for (let frame = 0; frame <= 256; frame += 128) {
          globalThis.currentFrame = frame;
          processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
        }
        assert.deepEqual(actual, predicted.map(({port:bank, register, value, offsetSeconds}) =>
          ({port:bank, register, value, frame:receipt.startFrame + Math.round(offsetSeconds * 48000)})));
        assert.deepEqual(notifications.filter(row => row.type === 'opnb-timed-writes').flatMap(row => row.writes),
          actual.map(({port:bank, register, value}) => ({port:bank, register, value})));
        assert.equal(await fm.clearSchedule('notes'), true);
        globalThis.currentFrame = 1024;
        processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
        assert.equal(actual.length, predicted.length);
      } finally {
        fm.dispose();
        processor.chip.dispose();
      }
    }
  } finally {
    for (const key of ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor']) delete globalThis[key];
  }
});
