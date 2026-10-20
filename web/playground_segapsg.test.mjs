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

test('primary PSG Keyboard protects manual notes, restores quiet levels, preserves continuation targets and retires IDs on Stop',async t=>{
  let Processor,resolveReady,current=0;const ready=new Promise(resolve=>resolveReady=resolve),rate=48000;
  const source=(await readFile(new URL('./playground_segapsg_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{PsgInspectorState,receiveChipInspector,CHIP_CLOCKS,ChipClockResampler,SegaPSG,factory,sampleRate:rate,createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>current}),AudioWorkletProcessor:class{constructor(){this.port={postMessage:resolveReady};}},registerProcessor(_name,Type){Processor=Type;}});
  const p=new Processor({processorOptions:{wasmBinary:await readFile(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url))}});await ready;t.after(()=>p.dispose());const port={postMessage(){}},client=createSegaPsgClient({postMessage:data=>p.receive(data,port),close(){}}),render=frames=>{const left=new Float32Array(frames),right=new Float32Array(frames);p.process([],[[left,right]]);current+=frames;return left;},peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
  client.tone(0,{note:'A4',attenuation:9});client.off(0);p.inspector.invoke('auditionOn',[0,69,'old']);assert.equal(p.inspector.read().channels[0].attenuation,9,'audition retains the previously edited attenuation');assert(peak(render(1024))>.005);const period=p.inspector.read().channels[0].period;
  p.inspector.invoke('auditionOn',[0,72,'new']);assert.equal(p.inspector.invoke('auditionOff',[0,'old']),false);const held=p.inspector.read().channels[0].period;assert(held<period);client.off(0);client.setPeriod(0,123);assert.equal(p.inspector.read().channels[0].period,held);assert(p.inspector.read().channels[0].active);
  // A client continuation belongs to its own last register, even when the
  // inspector changed the physical latch in between its two message events.
  client.write(0xa5);p.inspector.invoke('setFrequency',[0,440]);client.write(0x12);assert.equal(p.inspector.read().channels[1].period,0x125);assert.equal(p.inspector.read().channels[0].period,period);
  p.receive({type:'performance-start',session:31},port);p.receive({performance:{session:31,owner:'code',time:current/rate},commands:[{method:'write',args:[0x9f]},{method:'write',args:[0xb2]}]},port);render(128);assert(p.inspector.read().channels[0].active);assert(p.inspector.read().channels[1].active,'another code channel continues');p.receive({method:'allNotesOff'},port);assert(p.inspector.read().channels[0].active);assert(!p.inspector.read().channels[1].active);
  p.receive({performance:{session:31,owner:'late',time:1},commands:[{method:'write',args:[0x90]}]},port);p.receive({method:'stopVoices'},port);assert.equal(p.inspector.read().auditions.length,0);assert.equal(p.inspector.invoke('auditionOff',[0,'new']),false);assert.equal(peak(render(48001)),0);assert.equal(p.inspector.read().channels[0].period,period,'Stop retains pitch');p.inspector.invoke('auditionOn',[0,69,'after']);assert.equal(p.inspector.read().channels[0].attenuation,9);assert(peak(render(1024))>.005);
});

test('standalone PSG held tone-3-rate noise keeps its divider against Main and queued code while other tones remain live',async t=>{
  let Processor,resolveReady,current=0;const ready=new Promise(resolve=>resolveReady=resolve),rate=48000;
  const source=(await readFile(new URL('./playground_segapsg_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{PsgInspectorState,receiveChipInspector,CHIP_CLOCKS,ChipClockResampler,SegaPSG,factory,sampleRate:rate,createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>current}),AudioWorkletProcessor:class{constructor(){this.port={postMessage:resolveReady};}},registerProcessor(_name,Type){Processor=Type;}});
  const wasmBinary=await readFile(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url)),p=new Processor({processorOptions:{wasmBinary}});await ready;
  const reference=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate});t.after(()=>{p.dispose();reference.dispose();});
  const port={postMessage(){}},client=createSegaPsgClient({postMessage:data=>p.receive(data,port),close(){}}),writeReference=bytes=>{for(const byte of bytes)reference.write(byte);};
  const render=frames=>{const actual=[new Float32Array(frames),new Float32Array(frames)];p.process([],[actual]);current+=frames;const expected=reference.generateStereo(frames);assert.deepEqual(actual[0],expected.left);assert.deepEqual(actual[1],expected.right);assert(actual.every(values=>values.every(value=>Number.isFinite(value)&&Math.abs(value)<1)));return actual;};
  const initial=[0xc0,0x19,0xdf,0xe7,0xf8,0xff];for(const byte of initial)client.write(byte);writeReference(initial);
  p.inspector.invoke('auditionOn',[3,60,'old']);p.inspector.invoke('auditionOn',[3,84,'new']);writeReference([0xf8]);
  const period=p.inspector.read().channels[2].period;assert.equal(period,400);assert.equal(p.inspector.read().noise.rate,'tone3');
  client.setPeriod(2,123);client.setAttenuation(2,9);client.tone(0,{period:220,attenuation:9});client.noiseOff();writeReference([0xd9,0x8c,0x0d,0x99]);
  assert.equal(p.inspector.read().channels[2].period,period);assert.equal(p.inspector.read().channels[2].attenuation,9);assert(p.inspector.read().noise.active);assert.equal(p.inspector.invoke('auditionOff',[3,'old']),false);assert(render(512)[0].some(value=>Math.abs(value)>.005));
  p.receive({type:'performance-start',session:81},port);
  p.receive({performance:{session:81,owner:'code',time:(current+128)/rate},commands:[{method:'write',args:[0xc1]},{method:'write',args:[3],psgRegister:4},{method:'write',args:[0xd8]},{method:'write',args:[0xa3]},{method:'write',args:[0x14],psgRegister:2},{method:'write',args:[0xb7]}]},port);
  render(128);writeReference([0xd8,0xa3,0x14,0xb7]);render(256);assert.equal(p.inspector.read().channels[2].period,period);assert.equal(p.inspector.read().channels[2].attenuation,8);assert.equal(p.inspector.read().channels[1].period,0x143);
  p.receive({method:'stopVoices'},port);const state=p.inspector.read();assert.equal(state.noise.active,false);assert.equal(state.noise.rate,'tone3');assert.equal(state.channels[2].period,period);assert.equal(p.inspector.invoke('auditionOff',[3,'new']),false);
  client.setPeriod(2,123);assert.equal(p.inspector.read().channels[2].period,123,'Stop releases the shared divider lease without resetting the configured noise mode');
});

test('PSG Stop ACK fences the remote command before a new admin audition and shares disposal with clock RPCs',async t=>{
  let Processor,resolveReady;const ready=new Promise(resolve=>resolveReady=resolve),rate=48000;
  const source=(await readFile(new URL('./playground_segapsg_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{PsgInspectorState,receiveChipInspector,CHIP_CLOCKS,ChipClockResampler,SegaPSG,factory,sampleRate:rate,createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>0}),AudioWorkletProcessor:class{constructor(){this.port={postMessage:resolveReady};}},registerProcessor(_name,Type){Processor=Type;}});
  const p=new Processor({processorOptions:{wasmBinary:await readFile(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url))}});await ready;t.after(()=>p.dispose());
  let delayed,settled=false,ackObserved=false;const port={onmessage:null,start(){},close(){},postMessage(data){if(data.method==='stopVoices')delayed=data;else p.receive(data,reply);}},reply={postMessage(data){if(data.id===delayed?.id){assert(p.inspector.read().channels.every(ch=>!ch.active),'ACK is posted after all channels stop');assert.equal(p.inspector.read().auditions.length,0);ackObserved=true;}port.onmessage?.({data});}},client=createSegaPsgClient(port);t.after(()=>client.dispose());
  p.inspector.invoke('auditionOn',[0,69,'before-stop']);const stop=client._stopVoices().then(value=>{settled=true;return value;});await Promise.resolve();assert(delayed?.id);assert.equal(settled,false,'Stop does not resolve merely after posting');assert(p.inspector.read().channels[0].active);client._cancelClockRequests('Run stopped');await Promise.resolve();assert.equal(settled,false,'clock cancellation must not retire a pending Stop ACK');
  p.receive(delayed,reply);assert.equal(await stop,true);assert(ackObserved);assert.equal(client.clock,3579545,'Stop ACK cannot change the clock');p.inspector.invoke('auditionOn',[0,69,'after-stop']);const left=new Float32Array(1024),right=new Float32Array(1024);p.process([],[[left,right]]);assert(left.some(value=>value!==0),'an audition after the fence cannot be muted by the old Stop');
  const pending=client._stopVoices();client.dispose();await assert.rejects(pending,/disposed/i);
});
