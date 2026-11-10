// Pure metadata, fake FIFO clients and offline WASM arrays; no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rf5c164MidiNote,rf5c164NoteStep,RF5C164NoteTuning,attachRf5c164NoteControls} from '../../tetorica_src/runtime/rf5c164_notes.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../../tetorica_src/runtime/rf5c164synth.js';
import {Rf5c164} from '../../tetorica_src/runtime/rf5c164.js';
import {encodeRf5c164} from '../../tetorica_src/runtime/rf5c164_pcm.js';
import factory from '../../docs/generated/rf5c164_wasm.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=async()=>{await Promise.resolve();await Promise.resolve();};
function direct() {
  const writes=[];let resets=0;
  const synth=new RF5C164Synth({transport:{write:(...args)=>writes.push(args),loadMemory(){},reset(){resets++;}}});
  return {synth,writes,get resets(){return resets;}};
}
function facade({gates={},nested=false}={}) {
  const calls=[];let clock=12500000,owner=null,stopped=false;
  const issue=(method,args)=>{
    calls.push({method,args,owner});
    return Promise.resolve(gates[method]?.promise).then(()=>{if(stopped)throw new DOMException('Run stopped','AbortError');return method;});
  };
  const client={
    setChannel:(ch,options)=>issue('setChannel',[ch,options]),
    setPitch(ch,step){return nested?this.setChannel(ch,{step}):issue('setPitch',[ch,step]);},
    keyOn:ch=>issue('keyOn',[ch]),keyOff:ch=>issue('keyOff',[ch]),
    writeRegister:(r,v)=>issue('writeRegister',[r,v]),reset:()=>issue('reset',[]),
    loadSample:()=>({start:0,loopStart:0,step:2048}),dispose(){},
  };
  Object.defineProperty(client,'clock',{configurable:true,enumerable:true,get:()=>clock});
  Object.defineProperty(client,'privateToken',{value:{}});
  return {client,calls,setClock:value=>{clock=value;},stop:()=>{stopped=true;},
    withOwner(value,fn){const previous=owner;owner=value;try{return fn();}finally{owner=previous;}}};
}

test('shared note math validates names/MIDI and transposes an explicit fractional speed without a waveform assumption',()=>{
  for(const [note,midi]of [['C-1',0],['c4',60],['Db4',61],['B#3',60],['G9',127],[69,69]])assert.equal(rf5c164MidiNote(note),midi);
  for(const value of [null,undefined,true,[],{},NaN,Infinity,-1,128,69.5,440,'A','H4','C10','C#-2'])assert.throws(()=>rf5c164MidiNote(value));
  assert.equal(rf5c164NoteStep('C5',{baseStep:2048}),4096);
  assert.equal(rf5c164NoteStep('A3',{rootNote:'A4',baseStep:2048}),1024);
  assert.equal(rf5c164NoteStep(69,{rootNote:69,baseStep:2048.49}),2048);
  const base=12345.67/ (12500000/384)*2048;
  assert.equal(rf5c164NoteStep(72,{rootNote:60,baseStep:base}),Math.round(base*2));
  assert.equal(rf5c164NoteStep(0,{rootNote:127,baseStep:1}),1);
  assert.equal(rf5c164NoteStep(127,{rootNote:0,baseStep:65535}),65535);
  for(const baseStep of [0,-1,NaN,Infinity,'2048',null])assert.throws(()=>rf5c164NoteStep('C4',{baseStep}),/positive reference step/);
});

test('tuning state distinguishes declared speed from musical output and composes raw register bytes against actual state',()=>{
  const state=new RF5C164NoteTuning();
  assert.throws(()=>state.noteStep(0,'C4'),/positive raw playback step/);
  state.observeChannel(0,{step:2048});state.observeChannel(7,{step:4096});
  assert.equal(state.noteStep(0,'C5'),4096);state.observeNoteStep(0,4096);
  assert.equal(state.noteStep(0,'C4'),2048);assert.equal(state.noteStep(7,'C5'),8192);
  state.observeRegister(7,0xc0);state.observeRegister(2,1);
  assert.equal(state.getState().referenceSteps[0],4097,'a raw low-byte edit combines with the current musical high byte');
  state.observeRegister(3,0x12);assert.equal(state.noteStep(0,'C4'),0x1201);
  state.observeChannel(3,{step:0x2211});state.observeRegister(7,0x81);state.observeRegister(2,0x33);
  assert.equal(state.getState().selected,3,'RAM-bank selection does not select a new channel');
  assert.equal(state.noteStep(3,'C4'),0x2233);
  state.observeChannel(1,{step:0});assert.throws(()=>state.noteStep(1,'C4'),/positive raw playback step/);
  assert.equal(state.setRootNote('A4'),69);assert.equal(state.noteStep(7,'A4'),4096);
  const before=state.getState();assert.throws(()=>state.setRootNote(undefined));assert.deepEqual(state.getState(),before);
  const detached=state.getState();detached.referenceSteps[7]=1;assert.equal(state.noteStep(7,'A4'),4096);
  state.reset();assert.equal(state.getState().rootNote,69);assert(state.getState().referenceSteps.every(value=>value===null));
  assert.throws(()=>state.noteStep(7,'A4'),/positive raw playback step/);assert.equal(state.setRootNote(null),60);
});

test('direct class preserves existing valid raw register bytes and rejects invalid note inputs before writing',()=>{
  const {synth,writes}=direct();
  synth.setChannel(4,{start:256,loopStart:0x1234,step:0x2345,volume:27,pan:{left:2,right:3}});
  assert.deepEqual(writes,[[7,0xc4],[6,1],[4,0x34],[5,0x12],[2,0x45],[3,0x23],[0,27],[1,0x32]]);
  synth.keyOn(4);assert.deepEqual(writes.slice(-3),[[7,0xc4],[8,255],[8,239]]);
  synth.keyOff(4);assert.deepEqual(writes.at(-1),[8,255]);
  const before=writes.length;
  for(const method of ['setNote','noteOn'])for(const args of [[8,'C4'],[-1,'C4'],[1.5,'C4'],[0,'bad'],[0,128],[0,69.5],[0,true]])assert.throws(()=>synth[method](...args));
  assert.throws(()=>synth.noteOff(8));assert.throws(()=>synth.setRootNote('bad'));
  assert.equal(writes.length,before);
});

test('direct class musical calls are synchronous, do not compound, retain Root through raw reset and follow explicit raw updates',()=>{
  const {synth,writes}=direct();synth.setPitch(2,2048);writes.length=0;
  assert.equal(synth.setNote(2,'C5'),4096);assert.equal(synth.setNote(2,'C4'),2048);
  assert.equal(synth.setRootNote('A4'),69);const count=writes.length;
  assert.equal(synth.setRootNote(null),60);assert.equal(writes.length,count,'Root changes never retune held channels');
  writes.length=0;assert.equal(synth.noteOn(2,'C5'),undefined);
  assert.deepEqual(writes,[[7,0xc2],[2,0],[3,16],[7,0xc2],[8,255],[8,251]]);
  assert.equal(synth.noteOff(2),undefined);assert.deepEqual(writes.at(-1),[8,255]);
  synth.setPitch(2,1024);assert.equal(synth.setNote(2,'C5'),2048);
  synth.writeRegister(7,0xc2);synth.writeRegister(2,1);assert.equal(synth.setNote(2,'C4'),2049);
  synth.setRootNote('A4');synth.reset();assert.throws(()=>synth.setNote(2,'A4'),/positive raw playback step/);
  synth.setPitch(2,1000);assert.equal(synth.setNote(2,'A4'),1000);
  synth.setPitch(2,0);const before=writes.length;assert.throws(()=>synth.noteOn(2,'A4'),/positive raw playback step/);assert.equal(writes.length,before);
});

test('decorator keeps facade identity/descriptors and uses only successful raw declarations as each client baseline',async()=>{
  const f=facade(),clock=Object.getOwnPropertyDescriptor(f.client,'clock'),token=f.client.privateToken,dispose=f.client.dispose;
  const a=attachRf5c164NoteControls(f.client);assert.equal(a,f.client);assert.equal(attachRf5c164NoteControls(a),a);
  assert.deepEqual(Object.getOwnPropertyDescriptor(a,'clock'),clock);assert.equal(a.privateToken,token);assert.equal(a.dispose,dispose);
  await assert.rejects(a.setNote(0,'C4'),/positive raw playback step/);assert.equal(f.calls.length,0);
  await a.setChannel(0,{step:2048});await a.setPitch(7,4096);
  assert.equal(await a.setNote(0,'C5'),4096);assert.equal(await a.setNote(0,'C4'),2048);
  assert.equal(await a.setNote(7,'C5'),8192);assert.equal(a.setRootNote('A4'),69);
  assert.equal(await a.setNote(0,'A4'),2048);
  f.setClock(25000000);assert.equal(a.clock,25000000);assert.equal(await a.setNote(0,'A4'),2048,'clock changes keep raw-reference hardware semantics');
  await a.writeRegister(7,0xc7);await a.writeRegister(2,1);assert.equal(await a.setNote(7,'A4'),8193);
  await a.reset();await assert.rejects(a.setNote(7,'A4'),/positive raw playback step/);
  await a.setPitch(7,3000);assert.equal(await a.setNote(7,'A4'),3000,'raw reset keeps software Root');
  assert.equal(a.setRootNote(null),60);assert.equal(await a.setNote(7,'C4'),3000);
  assert(f.calls.every(call=>['setChannel','setPitch','writeRegister','keyOn','keyOff','reset'].includes(call.method)));
});

test('a failed or pending raw ACK never establishes a tuning basis; invalid notes and channels issue no requests',async()=>{
  const gate=deferred(),f=facade({gates:{setPitch:gate}}),a=attachRf5c164NoteControls(f.client);
  const configuring=a.setPitch(0,2048);await assert.rejects(a.setNote(0,'C4'),/positive raw playback step/);
  gate.reject(Error('raw pitch rejected'));await assert.rejects(configuring,/rejected/);
  await assert.rejects(a.setNote(0,'C4'),/positive raw playback step/);
  const good=facade(),b=attachRf5c164NoteControls(good.client);await b.setPitch(0,2048);const before=good.calls.length;
  for(const method of ['setNote','noteOn'])for(const args of [[8,'C4'],[-1,'C4'],[0,'bad'],[0,440],[0,null]])await assert.rejects(b[method](...args));
  await assert.rejects(b.noteOff(8));assert.throws(()=>b.setRootNote(undefined));assert.equal(good.calls.length,before);
});

test('pending raw options retain their declared values and failed musical writes leave actual/reference state intact',async()=>{
  const ack=deferred(),gates={setChannel:ack},f=facade({gates}),a=attachRf5c164NoteControls(f.client);
  const options={step:2048},configured=a.setChannel(0,options);options.step=4096;ack.resolve();await configured;
  assert.equal(await a.setNote(0,'C4'),2048,'ACK observes the submitted step, not a later edit of the options object');
  const failed=deferred();gates.setPitch=failed;
  const tuning=a.setNote(0,'C5');failed.reject(Error('pitch was cancelled'));await assert.rejects(tuning,/cancelled/);
  delete gates.setPitch;
  await a.writeRegister(7,0xc0);await a.writeRegister(2,1);
  assert.equal(await a.setNote(0,'C4'),2049,'a rejected musical write never commits a different high step byte');
});

test('noteOn issues pitch and gate under the same synchronous Native owner, then awaits both existing guarded acknowledgements',async()=>{
  const pitch=deferred(),gate=deferred();
  const g=facade({gates:{setPitch:pitch,keyOn:gate}}),b=attachRf5c164NoteControls(g.client);
  // Configure using setChannel so setPitch can remain pending for this note.
  await b.setChannel(0,{step:2048});g.calls.length=0;
  let settled=false;
  const pending=g.withOwner('melody',()=>b.noteOn(0,'C5')).then(()=>{settled=true;});
  assert.deepEqual(g.calls,[{method:'setPitch',args:[0,4096],owner:'melody'},{method:'keyOn',args:[0],owner:'melody'}]);
  await turn();assert.equal(settled,false);pitch.resolve();await turn();assert.equal(settled,false);gate.resolve();await pending;
  assert.equal(settled,true);await b.noteOff(0);assert.equal(g.calls.at(-1).method,'keyOff');
  const waiting=deferred(),h=facade({gates:{setPitch:waiting,keyOn:waiting}}),c=attachRf5c164NoteControls(h.client);
  await c.setChannel(0,{step:2048});const cancelled=c.noteOn(0,'C5');h.stop();waiting.resolve();
  await assert.rejects(cancelled,{name:'AbortError'});
});

test('nested facade methods do not let helper-generated raw writes compound the reference step',async()=>{
  const f=facade({nested:true}),a=attachRf5c164NoteControls(f.client);
  await a.setPitch(0,2048);assert.equal(await a.setNote(0,'C5'),4096);assert.equal(await a.setNote(0,'C4'),2048);
  await a.noteOn(0,'C5');assert.equal(await a.setNote(0,'C4'),2048);
  await a.setChannel(0,{volume:30});assert.equal(await a.setNote(0,'C5'),4096,'volume-only edits retain the reference');
});

test('direct helper PCM equals independently programmed raw hardware speeds on real WASM',async()=>{
  const wasmBinary=await readFile(new URL('../../docs/generated/rf5c164_wasm.wasm',import.meta.url));
  const chips=await Promise.all([0,1].map(()=>Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000})));
  try {
    const synths=chips.map(chip=>new RF5C164Synth({transport:new RF5C164DirectTransport(chip)}));
    const sample=encodeRf5c164({channels:[Float32Array.from({length:256},(_,i)=>.7*Math.sin(2*Math.PI*i/256))],sampleRate:32768});
    for(const synth of synths){synth.loadMemory(sample.bytes,0);synth.setChannel(0,{start:0,loopStart:0,step:2048,volume:96,pan:{left:15,right:0}});}
    synths[0].noteOn(0,'C5');synths[1].setPitch(0,4096);synths[1].keyOn(0);
    const first=chips.map(chip=>chip.generateStereo(8192));assert(first[0].left.some(value=>Math.abs(value)>.001));assert.deepEqual(first[0],first[1]);
    assert.equal(synths[0].setNote(0,'C4'),2048);synths[1].setPitch(0,2048);
    assert.deepEqual(chips[0].generateStereo(8192),chips[1].generateStereo(8192));
    for(const synth of synths)synth.noteOff(0);assert(chips[0].generateStereo(256).left.every(value=>value===0));
  } finally {chips.forEach(chip=>chip.dispose());}
});
