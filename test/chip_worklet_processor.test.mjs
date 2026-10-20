// Run after build:fm2612: execute the actual packaged processor with real WASM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSoundChip} from '../web/soundchip.js';
import {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} from '../web/ym2612synth.js';
import {ChipPCMRenderer} from '../web/chip_pcm_renderer.js';
import {OPLSynth,OPLDirectTransport,OPL_PRESETS} from '../web/opl_synth.js';
import {OPLWorkletTransport} from '../web/chip_worklet_transport.js';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
let Processor;
let receive;
globalThis.sampleRate = 48000;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {constructor() {this.port = {postMessage: message => receive(message)};}};
globalThis.registerProcessor = (_name, Type) => {Processor = Type;};
await import('../dist/fm2612/soundchip-output-worklet.js');
const wasmBinary = await readFile(new URL('../docs/generated/ym2612_wasm.wasm', import.meta.url));
async function createProcessor(name='ym2612',chipOptions={}) {
  const listeners = [];
  let resolve, reject;
  const ready = new Promise((a, b) => {resolve = a; reject = b;});
  receive = message => {
    if (message.type === 'ready') resolve();
    if (message.error) reject(new Error(message.error));
    for (const listener of listeners) listener({data: message});
  };
  const binary=name==='ym2612'?wasmBinary:await readFile(new URL(`../docs/generated/${name}_wasm.wasm`,import.meta.url));
  const processor = new Processor({processorOptions: {name, chipOptions, wasmBinary:binary}});
  await ready;
  const port = {postMessage: command => processor.receive(command), addEventListener: (_type, listener) => listeners.push(listener), start() {}};
  return {processor, port, transport: new YM2612WorkletTransport(port)};
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
    processor.renderer.render = () => {throw Error('AudioWorklet must fill existing output buffers');};
    processor.direct.generateStereo = () => {throw Error('AudioWorklet must borrow native PCM views');};
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

for(const name of ['ym3526','ym3812','y8950','ymf262'])test(`${name}: generic Worklet OPL transport matches direct native PCM at an explicit clock`,async()=>{
  const clock=name==='ymf262'?16000000:4000000,{processor,port}=await createProcessor(name,{clock}),transport=new OPLWorkletTransport(port),chip=await createSoundChip(name);
  const direct=new OPLDirectTransport(chip,{chip:name,clock}),expected=new OPLSynth({transport:direct,chip:name,clock}),actual=new OPLSynth({transport,chip:name,clock});
  try{
    const channel=name==='ymf262'?9:0;for(const api of [expected,actual]){api.initialize();api.setPreset(channel,OPL_PRESETS.sine);if(name==='ymf262')api.setPan(channel,true,false);api.noteOn(channel,'A4');}
    const renderer=new ChipPCMRenderer(chip,{sampleRate:48000,gain:1});renderer.rate=direct.sampleRate();processor.receive({method:'start'});
    for(const frames of [1,127,128,997]){const measured=render(processor,frames),reference=renderer.render(frames);assert.deepEqual(measured.left,reference.left);assert.deepEqual(measured.right,reference.right);}
    const audio=render(processor,2048);assert(audio.left.some(value=>Math.abs(value)>.01));if(name==='ymf262')assert(audio.right.every(value=>value===0));
    processor.receive({type:'performance-start',session:1});const register=0xb0+channel%9,bank=channel>=9?1:0;
    processor.receive({performance:{session:1,owner:'voice',time:0},commands:[{method:'writeRegister',args:[register,0x32,bank]}]});render(processor,1);
    processor.receive({type:'performance-cancel-owner',session:1,owner:'voice'});assert.equal(processor.oplRegisters[(bank<<8)+register]&32,0,'owner cancellation releases its actual banked gate');
  }finally{transport.dispose();processor.receive({method:'dispose'});chip.dispose();}
});
