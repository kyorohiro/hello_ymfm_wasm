import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {NesApu} from './nesapu.js';
import {createNesClient} from './playground_nes.js';
async function setup(fds, sampleRate) {
  let Processor;
  const source = (await readFile(new URL('./playground_nes_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {NesApu, sampleRate,
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage() {}};}},
    registerProcessor: (_, value) => {Processor = value;},
  });
  const processor = new Processor({processorOptions: {fds}});
  const port = {start() {}, close() {}, postMessage(data) {
    processor.receive(data, {postMessage(reply) {queueMicrotask(() => port.onmessage({data: reply}));}});
  }};
  const chip = createNesClient(port, {fdsEnabled: fds});
  Object.defineProperty(chip, 'id', {value: 'nes:test'});
  return {chip, processor, render(seconds) {
    const output = [new Float32Array(Math.round(seconds * sampleRate)), new Float32Array(Math.round(seconds * sampleRate))];
    processor.process([], [output]); return output;
  }};
}
for (const sampleRate of [44100, 48000]) {
  for (const [example, fds] of [['nes-apu-tones', false], ['nes-fds-wave', true], ['nes-dmc-sample', false]]) {
    test(`${example}: real NES processor at ${sampleRate} Hz`, async () => {
      const {chip, processor, render} = await setup(fds, sampleRate);
      let peak = 0;
      const source = await readFile(new URL(`../docs/playground/examples/nes/${example}.js`, import.meta.url), 'utf8');
      const open = async (name, options) => {assert.equal(name, 'nes'); assert.equal(options?.fds ?? false, fds); return chip;};
      const sleep = async seconds => {
        const output = render(seconds);
        for (const channel of output) for (const value of channel) {assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value));}
      };
      try {
        await new (Object.getPrototypeOf(async function() {}).constructor)('createSoundChip', 'useSoundChip', 'sleep', 'mixer', source)(open, open, sleep, {set: async id => assert.equal(id, chip.id)});
        assert.ok(peak > .001, `silent output: ${peak}`);
        assert.equal(processor.dead, true);
        assert.throws(() => chip.pulse.noteOn(0, 'A4'), /disposed/);
        chip.dispose();
      } finally {chip.dispose(); processor.dispose();}
    });
  }
}
test('disposing NES rejects pending DMC uploads', async () => {
  const chip = createNesClient({start() {}, close() {}, postMessage() {}});
  const upload = chip.dmc.loadSample(new Uint8Array(17));
  chip.dispose();
  await assert.rejects(upload, /disposed/);
});
