import {CHIP_CLOCKS, ChipClockResampler} from './playground_chip_clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {NesApuWasm} from './nesapu_wasm.js';
import {createNesClient} from './playground_nes.js';
import {NesApuSynth} from './nesapusynth.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {NesVoiceInspector} from './playground_native_voice_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import factory from '../docs/generated/nesapu_wasm.js';
async function setup(fds, sampleRate) {
  let Processor;
  const source = (await readFile(new URL('./playground_nes_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {factory,NesVoiceInspector,receiveChipInspector,CHIP_CLOCKS, ChipClockResampler,NesApuWasm, sampleRate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:sampleRate,nowFrame:()=>0}),
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage() {}};}},
    registerProcessor: (_, value) => {Processor = value;},
  });
  const processor = new Processor({processorOptions: {fds,wasmBinary:await readFile(new URL('../docs/generated/nesapu_wasm.wasm',import.meta.url))}});
  await processor.initializing;assert.equal(processor.chip?.backend,'wasm');
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

test('only Native NES clients send authored FDS configuration metadata',()=>{
  const state=new NesApuSynth({initialize:false,fds:true,transport:{writeRegister(){}}})._getState();
  for(const native of [false,true]){
    const messages=[],client=createNesClient({start(){},close(){},postMessage:message=>messages.push(message)},{fdsEnabled:true,state,native});
    client.fds.setVolume(19,2);
    assert.deepEqual(messages.slice(0,3),[{method:'writeRegister',args:[0x4023,2]},{method:'writeRegister',args:[0x4080,128]},{method:'writeRegister',args:[0x4089,2]}]);
    assert.deepEqual(messages.slice(3),native?[{method:'configureFds',args:[19,2]}]:[]);
    client.dispose();
  }
});
for (const sampleRate of [44100, 48000]) {
  for (const [example, fds] of [['nes-apu-tones', false], ['nes-pulse-frequency', false], ['nes-fds-wave', true], ['nes-dmc-sample', false]]) {
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
