import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createGameboyClient} from './playground_gameboy.js';
import {GameboyApu} from './gameboyapu.js';
import factory from '../docs/generated/gameboy_apu_wasm.js';
import {ChipClockResampler,CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';

for (const highLevel of [false, true]) test(`Game Boy ${highLevel ? 'Synth' : 'raw'} example plays through client and worklet, then disposes`, async () => {
  let Processor, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const source = (await readFile(new URL('./playground_gameboy_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {GameboyVoiceInspector,receiveChipInspector,CHIP_CLOCKS,GameboyApu, factory, sampleRate: 48000,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: resolveReady}; } },
    registerProcessor: (_, value) => { Processor = value; },
  });
  const processor = new Processor({processorOptions: {wasmBinary: await readFile(new URL('../docs/generated/gameboy_apu_wasm.wasm', import.meta.url))}});
  assert.equal((await ready).ready, true);
  const client = createGameboyClient({postMessage: data => processor.receive(data), close() {}});
  try {
    const code = await readFile(new URL(highLevel ? '../docs/playground/examples/gameboy/gameboy-synth.js' : '../docs/playground/examples/chip-raw/gameboy-raw-write-sample.js', import.meta.url), 'utf8');
    let played = 0;
    await new (Object.getPrototypeOf(async function() {}).constructor)('createSoundChip', 'sleep', 'write', '"use strict";\n' + code)(
      async name => { assert.equal(name, 'gameboy'); return client; },
      async seconds => {
        const output = [new Float32Array(seconds * 48000), new Float32Array(seconds * 48000)];
        processor.process([], [output]);
        const peaks = output.map(a => a.reduce((p, x) => Math.max(p, Math.abs(x)), 0));
        assert.ok(Math.max(...peaks) > 0.01);
        if (!highLevel && played === 0) assert.equal(peaks[1], 0);
        if (!highLevel && played === 1) assert.equal(peaks[0], 0);
        assert.ok(output.every(a => a.every(x => Number.isFinite(x) && Math.abs(x) < 1)));
        played++;
      }, () => { throw new Error('Example must not call the global write API'); });
    assert.equal(played, highLevel ? 7 : 5); assert.equal(processor.dead, true);
    assert.throws(() => client.reset(), /disposed/);
  } finally { client.dispose(); processor.dispose(); }
});

test('Game Boy client validates writes before dispatch', () => {
  const calls = []; const client = createGameboyClient({postMessage: data => calls.push(data), close() {}});
  for (const args of [[-1, 0], [0x30, 0], [0, 256], [0, NaN]]) assert.throws(() => client.writeRegister(...args), RangeError);
  assert.equal(calls.length, 0);
  client.dispose(); client.dispose(); assert.equal(calls.length, 1);
});

test('primary and independent Game Boy clock setters acknowledge acceptance before the reserved frame',async()=>{
 let Processor,resolveReady,frame=0;const replies=[];
 const ready=new Promise(resolve=>{resolveReady=resolve;});
 const source=(await readFile(new URL('./playground_gameboy_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
 vm.runInNewContext(source,{GameboyVoiceInspector,receiveChipInspector,GameboyApu,factory,sampleRate:48000,ChipClockResampler,CHIP_CLOCKS,validateChipClock,
  createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>frame}),
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>{replies.push(data);if(data.ready)resolveReady();}};}},
  registerProcessor:(_,value)=>{Processor=value;},
 });
 const processor=new Processor({processorOptions:{wasmBinary:await readFile(new URL('../docs/generated/gameboy_apu_wasm.wasm',import.meta.url))}});
 await ready;
 try{
  processor.receive({type:'performance-start',session:1});
  processor.receive({performance:{session:1,owner:'script',time:.1},commands:[{method:'clock',id:'independent',args:[2000000]}]});
  processor.receive({performance:{session:1,owner:'script',time:.2},commands:[{type:'chip-clock',id:'primary',clock:3000000}]});
  assert(replies.some(data=>data.id==='independent'&&data.value===true));
  assert(replies.some(data=>data.id==='primary'&&data.type==='chip-clock-result'));
  assert.equal(processor.clockResampler,undefined,'acceptance does not advance the chip clock early');
  processor.process([] ,[[new Float32Array(4801),new Float32Array(4801)]]);frame+=4801;
  assert.equal(processor.clockResampler.ratio,2000000/CHIP_CLOCKS.gameboy);
  processor.process([] ,[[new Float32Array(4800),new Float32Array(4800)]]);frame+=4800;
  assert.equal(processor.clockResampler.ratio,3000000/CHIP_CLOCKS.gameboy);
  assert.equal(replies.filter(data=>['primary','independent'].includes(data.id)).length,2);
 }finally{processor.dispose();}
});
