// Exercise the real WASM Worklet command queue without speaker output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildNesOperations} from '../js/nes_operations.js';
let Constructor;
globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:value=>this.messages.push(value)};}};
globalThis.sampleRate=48000;
globalThis.registerProcessor=(name,processor)=>{assert.equal(name,'tetorica-nes-fds-synth');Constructor=processor;};
await import('./processor.js');
const wasmBinary=await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
async function fixture(t){
  const processor=new Constructor({processorOptions:{wasmBinary}});await processor.ready;t.after(()=>processor.dispose());
  let id=0;
  const command=async(method,args=[])=>{const next=++id;processor.receive({id:next,method,args});await processor.commands;return processor.messages.find(m=>m.id===next);};
  return{processor,command};
}

test('Code, manual gates and click-guard preferences coexist on the actual Worklet APU',async t=>{
  const {processor,command}=await fixture(t),session=(await command('beginCode')).value.session;
  await command('code',[session,'noteOn',[5,'C4']]);assert.equal(processor.clickGuard.read().phase,'attack');
  await command('setClickGuard',[false]);await command('setClickGuard',[true]);assert.equal(processor.clickGuard.read().phase,'attack');
  await command('noteOn',['manual',64,0]);assert.equal(processor.clickGuard.read().phase,'bypass');
  await command('code',[session,'noteOff',[5]]);assert.equal(processor.clickGuard.read().phase,'bypass','releasing FDS cannot mute the held Pulse');
  const before=processor.instrument.read();await command('endCode',[session]);
  assert.equal(processor.instrument.read().owners[0].kind,'keyboard');assert.equal(processor.instrument.noteOff('manual'),true);
  assert.equal(before.owners[0].kind,'keyboard');
});

test('DMC upload, trigger, Stop and re-Run are ordered; expired sessions cannot reset the next Run',async t=>{
  const {processor,command}=await fixture(t),session=(await command('beginCode')).value.session;
  let id=100;
  for(const [method,args] of [['code',[session,'dmc.loadSample',[new Uint8Array([255,0,170]),{address:0xc040}]]],['code',[session,'dmc.play',[{rate:10,loop:true}]]],['endCode',[session]],['beginCode',[]]])processor.receive({id:++id,method,args});
  await processor.commands;
  const replies=processor.messages.filter(m=>m.id>100);assert(replies.every(r=>!r.error));
  const next=replies.at(-1).value.session;assert(next>session);
  await command('code',[next,'noteOn',[0,'C4']]);
  const invalid=await command('code',[session,'reset',[]]);assert.equal(invalid.name,'AbortError');
  assert.equal(processor.instrument.read().owners[0].session,next);
  const pcm=[[new Float32Array(1024),new Float32Array(1024)]];processor.process([],pcm);
  assert(pcm[0][0].every(Number.isFinite));assert(pcm[0][0].some(v=>Math.abs(v)>.0001));
});

test('clearing one completed reservation releases its gate without stopping keyboard or another pattern',async t=>{
  const {processor,command}=await fixture(t),session=(await command('beginCode')).value.session;
  const timed=payload=>command('nesTimed',[session,{owner:'score',...payload}]);
  for(const [name,ch] of [['clear-me',0],['keep-me',1]]){
    const receipt=await timed({action:'schedule',options:{name},operations:buildNesOperations(b=>b.noteOn(ch,'C4'))});
    assert.equal(receipt.error,undefined);
  }
  processor.process([],[[new Float32Array(512),new Float32Array(512)]]);
  assert.equal(processor.instrument.owners[0].patternName,'clear-me');
  assert.equal(processor.instrument.owners[1].patternName,'keep-me');
  await command('noteOn',['manual',64,2]);
  assert.equal((await timed({action:'clear',name:'clear-me'})).value,true);
  assert.equal(processor.instrument.owners[0],null);
  assert.equal(processor.instrument.owners[1].patternName,'keep-me');
  assert.equal(processor.instrument.read().owners[2].kind,'keyboard');
  assert.equal((await timed({action:'clear',name:'keep-me'})).value,true);
  assert.equal(processor.instrument.owners[1],null);
  assert.equal(processor.instrument.read().owners[2].kind,'keyboard');
});

test('Code allNotesOff releases current Code voices but preserves a later scheduled key and the keyboard',async t=>{
  const {processor,command}=await fixture(t),session=(await command('beginCode')).value.session;
  const receipt=await command('nesTimed',[session,{action:'schedule',owner:'score',options:{name:'later'},
    operations:buildNesOperations(b=>b.atSeconds(.02).noteOn(1,'C4'))}]);
  assert.equal(receipt.error,undefined);
  await command('code',[session,'noteOn',[0,'C4']]);
  await command('noteOn',['keyboard',67,2]);
  const released=await command('code',[session,'allNotesOff',[]]);assert.equal(released.error,undefined);
  assert.equal(processor.instrument.owners[0],null);
  assert.equal(processor.instrument.read().owners[2].kind,'keyboard');
  processor.process([],[[new Float32Array(1500),new Float32Array(1500)]]);
  assert.equal(processor.instrument.owners[1].patternName,'later');
});
