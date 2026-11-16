import test from 'node:test';
import assert from 'node:assert/strict';
import {AY8910Synth} from '../js/ay8910synth.js';
import {createInstrument} from './instrument.js';
import {createYmBorrowedClient,createYmCodeAudio} from './code_audio.js';

function fixture() {
  const writes=[];
  const client=new AY8910Synth({clock:2000000,transport:{writeRegister:(...args)=>writes.push(args),reset(){}}});
  client.initialize();
  const instrument=createInstrument({client});
  const node=()=>({destinations:new Set(),connect(to){this.destinations.add(to);},disconnect(to){if(to)this.destinations.delete(to);else this.destinations.clear();}});
  const input=node(),output=node();input.connect(output);
  return {writes,engine:{client,instrument,context:{state:'running'},codeInputNode:input,codeOutputNode:output,codeFadeNode:output},node};
}

test('borrowed AY methods and detached state stay synchronous and old leases cannot write',()=>{
  const {engine,writes}=fixture();let current=true,disposed=0;
  const client=createYmBorrowedClient(engine,()=>current,()=>{current=false;disposed++;});
  assert.equal(client.clock,2000000);assert.equal(client.channels,3);assert.equal(client.then,undefined);
  const write=client.writeRegister;
  write(6,7);assert.equal(client.getState().preset.noisePeriod,7);
  const state=client.getState();state.registers[6]=99;state.preset.noisePeriod=99;
  assert.equal(client.getState().preset.noisePeriod,7);
  client.dispose();client.dispose();assert.equal(disposed,1);
  const count=writes.length;
  assert.throws(()=>write(6,5),{name:'AbortError'});
  assert.throws(()=>client.getState(),{name:'AbortError'});assert.equal(writes.length,count);
});

test('Code Stop preserves newer keyboard notes and retires only its FX and borrowed session',async()=>{
  const {engine,node}=fixture(),events=[];let rack;
  const audio=createYmCodeAudio({ensureReady:async()=>{},getAudio:()=>engine,
    createOutput:()=>({fadeOut:async()=>events.push('fade'),open:()=>events.push('open')}),
    createFxRack:()=>rack={node:node(),controller:{getChain:()=>[]},stop:()=>events.push('stop-fx'),dispose:()=>events.push('dispose-fx')}});
  const client=await audio.useSoundChip('ay8910');
  client.noteOn(0,'C4');engine.instrument.selectChannel(2);engine.instrument.noteOn('manual',67);
  await audio.beforeStop();await audio.stop();
  assert.deepEqual(engine.instrument.read().activeChannels,[2]);
  assert.throws(()=>client.noteOn(0,'D4'),{name:'AbortError'});
  assert.deepEqual(events,['fade','stop-fx','dispose-fx','open']);
  assert(engine.codeInputNode.destinations.has(engine.codeOutputNode));
  assert(!engine.codeInputNode.destinations.has(rack.node));
  engine.instrument.noteOff('manual');
  const next=await audio.useSoundChip('ay8910');next.noteOn(1,'E4');
  assert.deepEqual(engine.instrument.read().activeChannels,[1]);
  await audio.dispose();
  assert.deepEqual(engine.instrument.read().activeChannels,[]);
});

test('FX borrowing rewires exactly the one existing chip route and restores it on Stop',async()=>{
  const {engine,node}=fixture();let rack,stops=0;
  const controller={liveFx(){},removeLiveFx(){},getChain:()=>[]};
  const audio=createYmCodeAudio({ensureReady:async()=>{},getAudio:()=>engine,
    createOutput:()=>({fadeOut:async()=>{},open(){}}),
    createFxRack:()=>rack={node:node(),controller,stop:()=>stops++,dispose(){}}});
  await audio.prepare();audio.fx.liveFx('echo',()=>{});
  assert(!engine.codeInputNode.destinations.has(engine.codeOutputNode));
  assert(engine.codeInputNode.destinations.has(rack.node));assert(rack.node.destinations.has(engine.codeOutputNode));
  await audio.stop();assert.equal(stops,1);
  assert(engine.codeInputNode.destinations.has(engine.codeOutputNode));assert(!rack.node.destinations.has(engine.codeOutputNode));
});
