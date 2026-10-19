import {PsgInspectorState,receiveChipInspector} from './playground_chip_inspector_state.js';
import {CHIP_CLOCKS,ChipClockResampler} from './playground_chip_clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSegaPsgClient} from './playground_segapsg.js';
import {SegaPSG} from './segapsg.js';
import factory from '../docs/generated/segapsg_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';

for (const highLevel of [true]) test(`Sega PSG ${highLevel ? 'Synth' : 'raw'} example plays through client and worklet, then disposes`, async () => {
  let Processor, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const source = (await readFile(new URL('./playground_segapsg_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {PsgInspectorState,receiveChipInspector,CHIP_CLOCKS,SegaPSG, factory, sampleRate: 48000,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: resolveReady}; } },
    registerProcessor: (_, value) => { Processor = value; },
  });
  const processor = new Processor({processorOptions: {wasmBinary: await readFile(new URL('../docs/generated/segapsg_wasm.wasm', import.meta.url))}});
  assert.equal((await ready).ready, true);
  const client = createSegaPsgClient({postMessage: data => processor.receive(data), close() {}});
  try {
    const code = await readFile(new URL('../docs/playground/examples/genesis/segapsg-tone-noise.js', import.meta.url), 'utf8');
    let played = 0;
    await new (Object.getPrototypeOf(async function() {}).constructor)('useSoundChip', 'sleep', 'write', '"use strict";\n' + code)(
      async name => { assert.equal(name, 'segapsg'); return client; },
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
    assert.equal(played, 5); assert.equal(processor.dead, true);
    assert.throws(() => client.reset(), /disposed/);
  } finally { client.dispose(); processor.dispose(); }
});

for (const rate of [44100,48000,96000]) test(`Sega PSG: borrowed worklet PCM preserves tone/noise, partial segments and clocks at ${rate} Hz`,async t => {
  let Processor, resolveReady;
  const ready = new Promise(resolve => {resolveReady = resolve;});
  const source = (await readFile(new URL('./playground_segapsg_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{PsgInspectorState,receiveChipInspector,CHIP_CLOCKS,ChipClockResampler,SegaPSG,factory,sampleRate:rate,
    createProcessorPerformance:options => createProcessorPerformance({...options,rate,nowFrame:() => 0}),
    AudioWorkletProcessor:class {constructor() {this.port = {postMessage:resolveReady};}},registerProcessor(_name,Type) {Processor = Type;},
  });
  const wasmBinary = await readFile(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url));
  const p = new Processor({processorOptions:{wasmBinary}});
  assert.equal((await ready).ready,true);
  const reference = await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate});
  t.after(() => {p.dispose(); reference.dispose();});
  for (const byte of [0x8c,0x1a,0x9a,0xe5,0xfc]) {p.receive({method:'write',args:[byte]}); reference.write(byte);}
  p.chip.generateStereo = () => assert.fail('realtime PSG must use borrowed PCM');
  let adapter;
  for (const clock of [null,CHIP_CLOCKS.segapsg,Math.round(CHIP_CLOCKS.segapsg/2),CHIP_CLOCKS.segapsg*2]) {
    if (clock) {p.receive({method:'clock',args:[clock],id:1}); (adapter ??= new ChipClockResampler()).setClock(clock,CHIP_CLOCKS.segapsg);}
    for (const frames of [128,37,1,90,128,3,128]) {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      const expectedLeft = new Float32Array(frames), expectedRight = new Float32Array(frames);
      p.process([],[[left,right]]);
      if (adapter) adapter.render({generateStereo:n => reference.generateStereo(n)},expectedLeft,expectedRight);
      else {const pcm = reference.generateStereo(frames); expectedLeft.set(pcm.left); expectedRight.set(pcm.right);}
      assert.deepEqual(left,expectedLeft); assert.deepEqual(right,expectedRight);
      assert(left.every(Number.isFinite));
    }
  }
});


for (const stereoEnabled of [true,false]) test(`PSG worklet keeps Main / Worker ports independent and enforces ${stereoEnabled ? 'Game Gear routing' : 'Master System mono'}`,async t => {
  let Processor, resolveReady;
  const ready = new Promise(resolve => {resolveReady = resolve;});
  const source = (await readFile(new URL('./playground_segapsg_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{PsgInspectorState,receiveChipInspector,CHIP_CLOCKS,ChipClockResampler,SegaPSG,factory,sampleRate:48000,
    createProcessorPerformance:options => createProcessorPerformance({...options,rate:48000,nowFrame:() => 0}),
    AudioWorkletProcessor:class {constructor() {this.port = {postMessage:resolveReady};}},registerProcessor(_name,Type) {Processor = Type;},
  });
  const wasmBinary = await readFile(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url));
  const p = new Processor({processorOptions:{wasmBinary,stereoEnabled,clock:3579545}});
  assert.equal((await ready).ready,true); t.after(() => p.dispose());
  const remote = () => ({closed:false,start(){},close(){this.closed=true;},postMessage(){}});
  const main = remote(), worker = remote();
  p.port.onmessage({data:{port:main}}); p.port.onmessage({data:{port:worker,primaryWorker:true}});
  assert.equal(main.closed,false,'attaching Worker must keep the primary Main client alive');
  for (const byte of [0x8c,0x1a]) worker.onmessage({data:{method:'write',args:[byte]}});
  main.onmessage({data:{method:'write',args:[0x95]}});
  worker.onmessage({data:{method:'setStereo',args:[0x10]}});
  const left = new Float32Array(128), right = new Float32Array(128);
  p.process([],[[left,right]]); assert(left.some(value => value !== 0));
  if (stereoEnabled) assert(right.every(value => value === 0)); else assert.deepEqual(right,left);
  assert.equal(p.inspector.read().clock,3579545);
  p.port.onmessage({data:{type:'detach-chip-port',primaryWorker:true}});
  assert.equal(worker.closed,true); assert.equal(main.closed,false);
  main.onmessage({data:{method:'allNotesOff'}}); p.process([],[[left,right]]);
  assert(left.every(value => value === 0)); assert(right.every(value => value === 0));
  const write=byte=>({method:'write',args:[byte]}), enqueue=(owner,bytes)=>p.receive({performance:{session:1,owner,time:0},commands:bytes.map(write)}),
    cancel=owner=>p.receive({type:'performance-cancel-owner',session:1,owner});
  p.receive({type:'performance-start',session:1});
  enqueue('raw',[0x8a,0x10,0x9f,0x01]); p.process([],[[left,right]]); assert(left.some(value=>value!==0));
  cancel('raw'); p.process([],[[left,right]]); assert(left.every(value=>value===0),'cancelling a continuation-keyed Worker note silences it');
  enqueue('old',[0x90]); enqueue('new',[0x91]); enqueue('old',[0x0f]); p.process([],[[left,right]]);
  assert(left.some(value=>value!==0),'an older Worker raw off cannot mute the replacement owner');
  cancel('old'); p.process([],[[left,right]]); assert(left.some(value=>value!==0));
  cancel('new'); p.process([],[[left,right]]); assert(left.every(value=>value===0));
});
