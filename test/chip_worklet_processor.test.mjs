// Run after build:fm2612: execute the actual packaged processor with real WASM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSoundChip} from '../web/soundchip.js';
import {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} from '../web/ym2612synth.js';
import {ChipPCMRenderer} from '../web/chip_pcm_renderer.js';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
let Processor;
let receive;
globalThis.sampleRate = 48000;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {constructor() {this.port = {postMessage: message => receive(message)};}};
globalThis.registerProcessor = (_name, Type) => {Processor = Type;};
await import('../dist/fm2612/soundchip-output-worklet.js');
const wasmBinary = await readFile(new URL('../docs/generated/ym2612_wasm.wasm', import.meta.url));
async function createProcessor() {
  const listeners = [];
  let resolve, reject;
  const ready = new Promise((a, b) => {resolve = a; reject = b;});
  receive = message => {
    if (message.type === 'ready') resolve();
    if (message.error) reject(new Error(message.error));
    for (const listener of listeners) listener({data: message});
  };
  const processor = new Processor({processorOptions: {name: 'ym2612', chipOptions: {}, wasmBinary}});
  await ready;
  const port = {postMessage: command => processor.receive(command), addEventListener: (_type, listener) => listeners.push(listener), start() {}};
  return {processor, transport: new YM2612WorkletTransport(port)};
}
function render(processor, frames) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  processor.process([], [[left, right]]); return {left, right};
}
test('WorkletTransport scheduled writes split PCM at exact output frames', async () => {
  const {processor, transport} = await createProcessor();
  const chip = await createSoundChip('ym2612'); const direct = new YM2612DirectTransport(chip);
  try {
    const fm = new YM2612Synth({transport}); fm.setPreset(0, FM_PRESETS.sine); fm.setFrequency(0, 4, 553);
    const expectedFM = new YM2612Synth({transport: direct}); expectedFM.setPreset(0, FM_PRESETS.sine); expectedFM.setFrequency(0, 4, 553);
    const renderer = new ChipPCMRenderer(chip, {sampleRate: 48000, gain: 1, removeIdleOffset: true, generate: direct.generateStereo.bind(direct)});
    transport.scheduleWrites([{time: 0, port: 0, register: 0x28, value: 0xf0}, {time: 16 / 48000, port: 0, register: 0x28, value: 0}]);
    processor.receive({method: 'start'});
    direct.write(0, 0x28, 0xf0); const first = renderer.render(16);
    direct.write(0, 0x28, 0); const second = renderer.render(16);
    const expected = new Float32Array(32); expected.set(first.left); expected.set(second.left, 16);
    assert.deepEqual(render(processor, 32).left, expected);
    assert.equal(processor.scheduled.length, 0);
  } finally {processor.receive({method: 'dispose'}); chip.dispose();}
});
test('WorkletTransport PCM DAC ACK, output-clock playback and legacy bank commands work', async () => {
  const {processor, transport} = await createProcessor();
  try {
    await transport.dacCommand({action: 'load', name: 'tone', data: new Uint8Array([255, 128]), sampleRate: 48000});
    await transport.dacCommand({action: 'play', name: 'tone', when: 0});
    processor.receive({method: 'start'});
    assert.ok(render(processor, 1).left[0] > .01);
    transport.clearDacPlayback(); assert.equal(processor.pcmDac.active, null);
    const bytes = new Uint8Array(10), view = new DataView(bytes.buffer);
    view.setUint32(0, 0, true); bytes[4] = 128; view.setUint32(5, 1, true); bytes[9] = 255;
    transport.loadDacBank('legacy', bytes);
    transport.write(0, 0x2b, 0x80);
    transport.playDacBank('legacy', 0);
    assert.ok(render(processor, 2).left[1] > .01);
    transport.scheduleWrites([{time: 1, port: 0, register: 0x28, value: 0}]);
    transport.clearScheduledWrites(); assert.equal(processor.scheduled.filter(entry => !entry.bank).length, 0);
    transport.clearDacPlayback(); assert.equal(processor.scheduled.length, 0);
  } finally {processor.receive({method: 'dispose'});}
});
