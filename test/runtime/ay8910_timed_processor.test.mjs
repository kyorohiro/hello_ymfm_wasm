import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ay8910} from '../../tetorica_src/runtime/ay8910.js';
import factory from '../../tetorica_src/runtime/generated/ay8910_wasm.js';
import {createAy8910Client} from '../../tetorica_src/runtime/playground_ay8910.js';
import {Ay8910VoiceInspector} from '../../tetorica_src/runtime/playground_ay8910_inspector.js';
import {receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {createPerformanceSender} from '../../tetorica_src/runtime/playground_performance_sender.js';
import {createAyTimedProcessor} from '../../tetorica_src/runtime/ay8910_timed_processor.js';
import {validateChipClock, ChipClockResampler} from '../../tetorica_src/runtime/playground_chip_clock.js';

const directory = new URL('../../tetorica_src/runtime/',import.meta.url);
const source = (await readFile(new URL('playground_ay8910_worklet.js',directory),'utf8')).replace(/^import .*;$/gm,'');
const wasmBinary = await readFile(new URL('generated/ay8910_wasm.wasm',directory));
const profile = {clock:2000000,type:0x10,flags:1,instanceId:'timed-worklet-test'};

/** Real chip rendering into test-owned arrays; no AudioContext/speaker exists. */
async function setup(rate = 48000) {
  let Processor, frame = 0, ready;
  const messages = [], writes = [], received = [];
  const started = new Promise(resolve => ready = resolve);
  const mainPort = {postMessage(message) { messages.push(message); if(message.ready || message.error)ready(message); }};
  vm.runInNewContext(source, {
    Ay8910,factory,Ay8910VoiceInspector,receiveChipInspector,createAyTimedProcessor,
    validateChipClock,ChipClockResampler,sampleRate:rate,
    createProcessorPerformance:options => createProcessorPerformance({...options,rate,nowFrame:() => frame}),
    AudioWorkletProcessor:class { constructor() { this.port = mainPort; } },
    registerProcessor(_name,Type) { Processor = Type; },
  });
  const processor = new Processor({processorOptions:{...profile,wasmBinary}});
  assert.equal((await started).ready,true,JSON.stringify(messages));
  function connect() {
    const port = {start(){},close(){},postMessage(data) {
      received.push(data);
      processor.receive(data,{postMessage:reply => port.onmessage?.({data:reply})});
    }};
    return port;
  }
  const client = createAy8910Client(connect(),profile);
  client.initialize();
  let application = null, generatedFrames = 0;
  const apply = processor.timed.apply.bind(processor.timed), write = processor.writeRegister.bind(processor);
  processor.timed.apply = (operation,port,eventFrame,metadata) => {
    application = {frame:eventFrame,operation,owner:metadata?.owner};
    try { return apply(operation,port,eventFrame,metadata); }
    finally { application = null; }
  };
  processor.writeRegister = (register,value) => {
    if(application)writes.push({...application,register,value});
    return write(register,value);
  };
  const generate = processor.chip.generateStereo.bind(processor.chip);
  processor.chip.generateStereo = count => { generatedFrames += count; return generate(count); };
  return {
    client,processor,writes,messages,received,connect,rate,
    frame:() => frame, generatedFrames:() => generatedFrames,
    read:() => processor.inspector.getState(),
    invoke:(method,args = []) => processor.inspector.invoke(method,args),
    render(count,partition = 128) {
      const left = new Float32Array(count), right = new Float32Array(count);
      for(let offset = 0; offset < count;) {
        const size = Math.min(partition,count-offset);
        processor.process([],[[left.subarray(offset,offset+size),right.subarray(offset,offset+size)]]);
        frame += size; offset += size;
      }
      assert(left.every(Number.isFinite)); assert(right.every(Number.isFinite));
      return {left,right};
    },
    close() { client.dispose(); processor.dispose(); },
  };
}

test('real Worklet current/client/reset/snapshot compilation isolates state and never advances PCM',async () => {
  const p = await setup();
  try {
    p.client.writeRegister(7,0xc9);
    p.client.setVolume(0,0); p.client.setVolume(1,11,true); p.client.keyOff(1);
    p.invoke('setMixer',[2,{tone:false}]); // Applied state now differs from the client shadow.
    const local = p.client._getState(), applied = p.read();
    const plan = p.client.build(b => { b.setMixer(0,{tone:true}); b.keyOn(0); b.keyOn(1); });
    const current = await p.client.compile(plan);
    const client = await p.client.compile(plan,{initialState:'client'});
    const reset = await p.client.compile(plan,{initialState:'reset'});
    const snapshot = await p.client.captureState();
    assert.deepEqual(current.map(row => row.value),[0xcc,0,27]);
    assert.deepEqual(client.map(row => row.value),[0xc8,0,27]);
    assert.deepEqual(reset.map(row => row.value),[0,9,9]);
    assert.deepEqual(await p.client.compile(plan,{initialState:snapshot}),current);
    assert.deepEqual(snapshot.registers,applied.registers);
    assert.deepEqual(snapshot.levels,applied.levels);
    assert.deepEqual(p.read(),applied); assert.deepEqual(p.client._getState(),local);
    assert.equal(p.frame(),0); assert.equal(p.generatedFrames(),0); assert.equal(p.writes.length,0);

    p.client.writeRegister(7,0xff);
    const off = p.client.build(b => b.setMixer(0,{tone:false}));
    const before = p.received.length;
    const [again,other] = await Promise.all([
      p.client.compile(plan,{initialState:snapshot}),p.client.compile(off,{initialState:snapshot}),
    ]);
    assert.deepEqual(again,current); assert.equal(other[0].value,0xcd);
    assert.equal(p.received.length,before,'Snapshot reuse sends no request to the Worklet');
    assert.equal(snapshot.registers[7],0xcd); assert.equal(p.read().registers[7],0xff);
  } finally { p.close(); }
});

for(const rate of [44100,48000])test(`real ${rate}Hz timed batches match compilation and mixed-time write frames`,async () => {
  const p = await setup(rate);
  try {
    p.client.writeRegister(7,0xc9);
    const program = p.client.build(b => {
      b.setEnvelope({shape:8}); b.setEnvelope({shape:8});
      b.atSeconds(0.1).setMixer(0,{tone:true});
      b.atSample(4410).setMixer(1,{noise:false});
    });
    const compiled = await p.client.compile(program), receipt = await p.client.schedule(program,{name:'mixed'});
    assert.equal(receipt.startFrame,128);
    assert.equal(p.writes.length,0,'Acceptance does not apply future writes');
    p.render(receipt.startFrame+Math.round(rate*0.1)+1,113);
    assert.deepEqual(p.writes.map(({register,value}) => ({register,value})),compiled.map(({register,value}) => ({register,value})));
    assert.deepEqual(p.writes.map(row => row.frame),[128,128,128+Math.round(rate*0.1),128+Math.round(rate*0.1)]);
    assert.deepEqual(p.writes.slice(0,2).map(row => row.value),[8,8],'Repeated R13 writes survive all layers');
  } finally { p.close(); }
});

test('one YM2149 gate keeps Tone and Noise enabled together on the same channel',async () => {
  const p = await setup();
  try {
    p.client.writeRegister(7,0xff);
    const pattern = p.client.build(b => {
      b.setMixer(0,{tone:true});
      b.setMixer(0,{noise:true});
      b.noteOn(0,'A4');
    });
    const writes = await p.client.compile(pattern);
    assert.deepEqual(writes.filter(row => row.register===7).map(row => row.value),[0xfe,0xf6]);
    const receipt = await p.client.schedule(pattern,{name:'tone+noise'});
    p.render(receipt.startFrame+128);
    assert.equal(p.read().registers[7],0xf6);
    assert(p.read().registers[8]>0);
    await p.client.clearSchedule('tone+noise');
    assert.equal(p.read().registers[8],0);
    assert.equal(p.read().registers[7],0xf6);
  } finally { p.close(); }
});

test('real scheduled R7 partial updates preserve an intervening manual edit',async () => {
  const p = await setup();
  try {
    p.client.writeRegister(7,0xc9);
    const program = p.client.build(b => {
      b.setMixer(0,{tone:true}); b.atSample(100).setMixer(1,{noise:false});
    });
    const compiled = await p.client.compile(program);
    assert.deepEqual(compiled.map(row => row.value),[0xc8,0xd8]);
    const receipt = await p.client.schedule(program,{name:'partial'});
    p.render(receipt.startFrame+1);
    assert.equal(p.read().registers[7],0xc8);
    p.invoke('setMixer',[2,{tone:false}]);
    assert.equal(p.read().registers[7],0xcc);
    p.render(200);
    assert.deepEqual(p.writes.map(row => row.value),[0xc8,0xdc]);
    assert.equal(p.writes[1].frame,receipt.startFrame+Math.round(100*48000/44100));
  } finally { p.close(); }
});

for(const rate of [44100,48000])test(`real ${rate}Hz repeated R13 retriggers keep exact frames and invalid replacement retains old pattern`,async () => {
  const p = await setup(rate);
  try {
    const program = p.client.build(b => b.setEnvelope({shape:8}));
    const receipt = await p.client.schedule(program,{name:'buzzer',repeatSeconds:1/110});
    const bad = p.client.build(b => b.setEnvelope({shape:16}));
    await assert.rejects(p.client.schedule(bad,{name:'buzzer',repeatSeconds:1/110}),/Envelope shape/);
    const frames = 2200;
    p.render(frames,71);
    const expected = [];
    for(let cycle=0;;cycle++) {
      const frame = receipt.startFrame+Math.round(cycle*rate/110);
      if(frame>=frames)break;
      expected.push(frame);
    }
    assert.deepEqual(p.writes.map(row => row.frame),expected);
    assert(p.writes.every(row => row.register===13&&row.value===8));
    const state = p.read(), before = p.writes.length;
    assert.equal(await p.client.clearSchedule('buzzer'),true);
    p.render(2000);
    assert.equal(p.writes.length,before); assert.deepEqual(p.read(),state,'Clear cancels future writes only');
  } finally { p.close(); }
});

test('real staged reservations abort or atomically replace; empty commit removes omitted owner patterns',async () => {
  const p = await setup();
  try {
    const timed = p.client._timedOperations;
    const old = p.client.build(b => b.setEnvelope({shape:8}));
    const next = p.client.build(b => { b.setVolume(0,7,undefined); b.setEnvelope({shape:9}); });
    await timed.schedule(old,{name:'buzzer',repeatSeconds:0.01},{owner:'apply-owner'});
    await timed.stage('failed','apply-owner','schedule',[next,{name:'buzzer',repeatSeconds:0.01}]);
    p.render(300); assert(p.writes.every(row => row.value===8));
    await timed.abort('failed','apply-owner');
    const count = p.writes.length; p.render(480);
    assert(p.writes.slice(count).every(row => row.value===8));

    await timed.stage('success','apply-owner','schedule',[next,{name:'buzzer',repeatSeconds:0.01}]);
    const committed = await timed.commit('success','apply-owner');
    assert.equal(committed.reservations.length,1);
    const anchor = committed.reservations[0].startFrame;
    const before = p.writes.length; p.render(700);
    const applied = p.writes.slice(before);
    assert(applied.some(row => row.register===13&&row.value===9&&row.frame===anchor));
    assert(applied.some(row => row.register===8&&row.value===7));
    assert(!applied.some(row => row.register===13&&row.value===8));

    await timed.commit('omitted','apply-owner');
    const state = p.read(), stopped = p.writes.length; p.render(1500);
    assert.equal(p.writes.length,stopped); assert.deepEqual(p.read(),state);
    assert.equal(p.processor.performance.getStats().patternCount,0);
  } finally { p.close(); }
});

test('real shared R13 modulation continues under manual audition and stale scheduled Key Off cannot release it',async () => {
  const p = await setup();
  try {
    const program = p.client.build(b => {
      b.keyOn(0); b.atSeconds(0.01).setEnvelope({shape:8}); b.noteOff(0);
    });
    const receipt = await p.client._timedOperations.schedule(program,{name:'release'},{owner:'old-script'});
    p.render(receipt.startFrame+1);
    p.invoke('auditionOn',[0,69,'manual']);
    const held = p.read();
    assert.equal(held.registers[8]&31,9);
    p.render(700);
    assert(p.writes.some(row => row.register===13&&row.value===8));
    assert.equal(p.read().registers[8]&31,9,'New manual Gate survives old owner release');
    assert.equal(p.read().levels[0],9,'Guarded release cannot replace its metadata');
    p.invoke('auditionOff',[0,'manual']);
    assert.equal(p.read().registers[8]&31,0);
  } finally { p.close(); }
});

test('Worker PerformanceSender reserves one lookahead and cancels the same owner on the real Worklet',async () => {
  const p = await setup();
  let worker;
  const loop = {performanceOwner:'worker-loop'};
  const sender = createPerformanceSender({getLoop:() => loop,now:() => 1000});
  try {
    p.processor.receive({type:'performance-start',session:10},p.processor.port);
    sender.configure({session:10,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:0.02});
    worker = createAy8910Client(sender.port(p.connect(),'ay8910'),profile);
    const program = worker.build(b => b.setEnvelope({shape:8}));
    const receipt = await worker.schedule(program,{name:'worker',repeatSeconds:1/110});
    assert.equal(receipt.startFrame,960,'Worker lead is not followed by another 128-frame lead');
    assert.equal(p.writes.length,0);
    p.render(961); assert.equal(p.writes[0].frame,960); assert.equal(p.writes[0].owner,'worker-loop');
    sender.cancelOwner('worker-loop');
    const count = p.writes.length; p.render(2000); assert.equal(p.writes.length,count);
    await assert.rejects(worker.schedule(program,{name:'worker'}),/Run stopped/);
  } finally { sender.stop(); worker?.dispose(); p.close(); }
});

test('real runtime clock failure reports once without killing unrelated reservations or the client',async () => {
  const p = await setup(), diagnostics = [];
  const unsubscribe = p.client._timedOperations.onError(value => diagnostics.push(value));
  try {
    const invalidAfterClock = p.client.build(b => b.setFrequency(0,50));
    const valid = p.client.build(b => b.setEnvelope({shape:8}));
    await p.client.schedule(invalidAfterClock,{name:'clock-sensitive',repeatSeconds:0.02});
    await p.client.schedule(valid,{name:'unrelated',repeatSeconds:0.01});
    await p.client.setClock(4000000); // 50Hz is now below the 12-bit tone range.
    p.render(1000);
    assert.equal(diagnostics.length,1);
    assert.match(diagnostics[0].message,/range/);
    assert.equal(diagnostics[0].type,'ay-timed-error');
    assert.equal(diagnostics[0].owner,'ay-timed:client');
    assert.equal(diagnostics[0].session,p.processor.performance.getStats().activeSession);
    assert(Object.isFrozen(diagnostics[0]));
    assert.equal(p.processor.performance.getStats().patternCount,1,'Only the failing reservation is removed');
    const count = p.writes.filter(row => row.register===13).length;
    p.render(1000);
    assert(p.writes.filter(row => row.register===13).length>count,'The valid repeating reservation continues');
    assert.equal(diagnostics.length,1,'Removed reservation cannot repeatedly report the same failure');
    assert.equal(p.processor.dead,false);
    const snapshot = await p.client.captureState();
    assert.equal(snapshot.clock,4000000); assert.equal(snapshot.registers[13]&15,8);
    p.client.noteOn(0,'A4');
    const pcm = p.render(1024).left;
    assert(Math.max(...pcm)-Math.min(...pcm)>0.0001,'Client and actual PCM remain usable after the error');
  } finally {unsubscribe(); p.close();}
});

for(const manual of [false,true])test(`real owner release cancels pending Note Off and ${manual?'preserves a newer manual Gate':'releases its currently held scheduled Gate'}`,async () => {
  const p = await setup();
  try {
    const timed = p.client._timedOperations;
    const program = p.client.build(b => {
      b.noteOn(0,'A4'); b.atSeconds(0.1).noteOff(0);
    });
    const receipt = await timed.schedule(program,{name:'loop-note'},{owner:'retired-loop'});
    p.render(receipt.startFrame+1);
    assert.equal(p.read().registers[8]&31,9);
    if(manual)p.invoke('auditionOn',[0,72,'new-manual']);
    const before = p.read();
    await timed.releaseOwner('retired-loop');
    assert.equal(p.processor.performance.getStats().patternCount,0);
    if(manual)assert.deepEqual(p.read(),before,'Stale loop cleanup changes none of the newer manual voice state');
    else assert.equal(p.read().registers[8]&31,0,'Canceled pending Note Off cannot leave a held note');
    p.render(6000);
    assert.equal(p.read().registers[8]&31,manual?9:0);
    if(manual)p.invoke('auditionOff',[0,'new-manual']);
  } finally {p.close();}
});
