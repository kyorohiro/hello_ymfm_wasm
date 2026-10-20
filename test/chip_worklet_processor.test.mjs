// Run after build:fm2612: execute the actual packaged processor with real WASM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSoundChip} from '../web/soundchip.js';
import {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} from '../web/ym2612synth.js';
import {ChipPCMRenderer} from '../web/chip_pcm_renderer.js';
import {AY8910Synth,AY8910DirectTransport} from '../web/ay8910synth.js';
import {AY8910WorkletTransport} from '../web/chip_worklet_transport.js';
import {YM2413Synth,YM2413DirectTransport} from '../web/ym2413synth.js';
import {YM2413WorkletTransport} from '../web/chip_worklet_transport.js';
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

test('YM2413 generic Worklet transport matches clock-aware direct PCM for melody and all five mono rhythm voices',async()=>{
  const clock=4000000,{processor,port}=await createProcessor('ym2413',{clock}),transport=new YM2413WorkletTransport(port),chip=await createSoundChip('ym2413'),direct=new YM2413DirectTransport(chip,{clock});
  const actual=new YM2413Synth({transport,clock}),expected=new YM2413Synth({transport:direct,clock});
  try{
    for(const api of [actual,expected]){api.initialize();api.setVoice(8,{instrument:0,attenuation:3});api.noteOn(8,'A4');}
    const renderer=new ChipPCMRenderer(chip,{sampleRate:48000,gain:1});renderer.rate=direct.sampleRate();processor.receive({method:'start'});let audible=false;
    const compare=frames=>{const measured=render(processor,frames),reference=renderer.render(frames);assert.deepEqual(measured.left,reference.left);assert.deepEqual(measured.right,reference.right);assert.deepEqual(measured.left,measured.right);audible||=measured.left.some(value=>Math.abs(value)>.001);};
    for(const frames of [1,127,128,997])compare(frames);assert(audible);
    for(const api of [actual,expected]){api.allNotesOff();api.setNote(6,'C3');api.setNote(7,'G3');api.setNote(8,'D3');api.setRhythmLevels({bassDrum:3,snare:4,tom:5,cymbal:6,hiHat:7});api.setRhythm({enabled:true});}
    for(const name of ['bassDrum','snare','tom','cymbal','hiHat']){for(const api of [actual,expected])api.setRhythm({[name]:true});compare(1024);for(const api of [actual,expected])api.setRhythm({[name]:false});compare(128);}
    const remote={start(){},close(){this.closed=true;},postMessage(){}};processor.receive({method:'attachPort',port:remote});
    processor.receive({type:'performance-start',session:1});processor.receive({performance:{session:1,owner:'hat',time:0},commands:[{method:'writeRegister',args:[0x0e,33]}]});render(processor,1);
    processor.receive({type:'performance-cancel-owner',session:1,owner:'hat'});assert.equal(processor.opllRegisters[0x0e]&1,0,'drum owner cancellation clears its actual trigger');processor.receive({method:'dispose'});assert.equal(remote.closed,true);assert.equal(processor.remotePorts.size,0);assert.equal(processor.opllRegisters,null);
  }finally{transport.dispose();processor.receive({method:'dispose'});chip.dispose();}
});

test('AY generic Worklet renders tone/noise/envelope at the requested fixed core clock and masks zero-volume native DC',async()=>{
  const clock=2000000,{processor,port}=await createProcessor('ay8910',{clock}),transport=new AY8910WorkletTransport(port),chip=await createSoundChip('ay8910',{clock,sampleRate:48000}),direct=new AY8910DirectTransport(chip),actual=new AY8910Synth({transport,clock}),expected=new AY8910Synth({transport:direct,clock});
  const setMute=()=>{let mask=0;const r=expected.getRegisterSnapshot();for(let ch=0;ch<3;ch++)if(!(r[8+ch]&31))mask|=1<<ch;chip.setMuteMask(mask);};
  try{
    for(const api of [actual,expected]){api.initialize();api.tone(2,{note:'A4',volume:9});}setMute();const renderer=new ChipPCMRenderer(chip,{sampleRate:48000,gain:1});processor.receive({method:'start'});
    for(const frames of [1,127,128,997]){const measured=render(processor,frames),reference=renderer.render(frames);assert.deepEqual(measured.left,reference.left);assert.deepEqual(measured.right,reference.right);}assert(render(processor,2048).left.some(value=>Math.abs(value)>.001));
    for(const api of [actual,expected]){api.noise(1,{period:17,volume:8});api.setEnvelope({period:123,shape:10});api.setVoice(0,{tone:true,noise:true,volume:6,envelope:true});}setMute();renderer.render(2048);
    const audio=render(processor,4096);assert(audio.left.every(Number.isFinite));assert(audio.left.some(value=>Math.abs(value)>.001));assert.deepEqual(audio.left,audio.right);
    actual.allNotesOff();assert(render(processor,128).left.every(value=>value===0));
    processor.receive({type:'performance-start',session:1});processor.receive({performance:{session:1,owner:'voice',time:0},commands:[{method:'writeRegister',args:[10,9]}]});render(processor,1);processor.receive({type:'performance-cancel-owner',session:1,owner:'voice'});assert.equal(processor.ayRegisters[10],0);assert(render(processor,128).left.every(value=>value===0));
  }finally{transport.dispose();processor.receive({method:'dispose'});chip.dispose();}
});
