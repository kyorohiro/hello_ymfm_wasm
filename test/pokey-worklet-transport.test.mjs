import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {MessageChannel} from 'node:worker_threads';
import {PokeyWorkletTransport} from '../web/chip_worklet_transport.js';
import {PokeySynth} from '../web/pokeysynth.js';
import {createWorkletSoundChip} from '../web/soundchip_worklet.js';

test('POKEY Synth generic transport retains zero-based channel metadata and validates complete schedule snapshots',async()=>{
  const writes=[],requests=[],endpoint={execution:'worklet',name:'pokey',clock:1789773,port:{postMessage:message=>writes.push(message)},request:(method,args)=>new Promise((resolve,reject)=>requests.push({method,args,resolve,reject}))};
  const transport=new PokeyWorkletTransport(endpoint),synth=new PokeySynth({transport});
  synth.initialize();synth.noteOn(3,'A4');assert.deepEqual(writes.at(-1),{method:'writeRegister',args:[7,0xa8],channel:3});assert.equal(synth.clock,1789773);
  const entries=[{time:2,address:1,value:0xaf}],pending=transport.scheduleWrites(entries);entries[0].value=0;
  assert.deepEqual(requests[0].args,[[{time:2,port:0,register:1,value:0xaf}]]);requests[0].resolve(1);assert.equal(await pending,1);
  for(const invalid of [[{time:-1,register:1,value:0}],[{time:0,register:16,value:0}],[{time:0,register:1,value:256}],[{time:0,register:1,address:3,value:0}],new Array(65537)])assert.throws(()=>transport.scheduleWrites(invalid));
  assert.equal(requests.length,1);const read=transport.readRegister(10),state=transport.getState(),flush=transport.flush();
  assert.deepEqual(requests.slice(1).map(x=>x.method),['readRegister','getState','barrier']);requests[1].resolve(0x55);requests[2].resolve({registers:Array(16).fill(0)});requests[3].resolve();assert.equal(await read,0x55);await state;await flush;
  const waiting=transport.readRegister(0),check=assert.rejects(waiting,/disposed/);synth.dispose();await check;assert.throws(()=>transport.writeRegister(0,0),/disposed/);
});

test('POKEY transferred Worker port correlates real read/barrier ACKs and rejects terminal disposal',async()=>{
  const {port1,port2}=new MessageChannel(),transport=new PokeyWorkletTransport(port1);
  try{
    let received=once(port2,'message');const first=transport.readRegister(10);const [message]=await received;assert.equal(message.method,'readRegister');
    port2.postMessage({type:'response',id:message.id,value:0xaa});assert.equal(await first,0xaa);
    received=once(port2,'message');let done=false;const flushed=transport.flush().then(()=>{done=true;});const [barrier]=await received;assert.equal(barrier.method,'barrier');assert.equal(done,false);port2.postMessage({id:barrier.id});await flushed;assert(done);
    received=once(port2,'message');const pending=transport.readRegister(0),check=assert.rejects(pending,/chip is disposed/);await received;port2.postMessage({type:'disposed',error:'POKEY chip is disposed'});await check;assert.throws(()=>transport.readRegister(0),/disposed/);
  }finally{transport.dispose();port1.close();port2.close();}
});

test('POKEY endpoint publishes readonly clock and preserves the borrowed context',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode');let closed=0;
  const node={port:{postMessage(message){if(message.id!==undefined)queueMicrotask(()=>node.port.onmessage({data:{id:message.id}}));}},disconnect(){}};
  Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:class{constructor(context,name,options){assert.equal(options.processorOptions.name,'pokey');queueMicrotask(()=>node.port.onmessage({data:{type:'ready',sampleRate:48000}}));return node;}}});
  const context={state:'suspended',currentTime:0,resume:async()=>{},close:async()=>{closed++;},audioWorklet:{addModule:async()=>{}},createGain:()=>({gain:{value:0},disconnect(){}})};
  const mixer={reserveId:()=>({id:'pokey:2',release(){}}),connect:()=>()=>{}};let chip;
  try{chip=await createWorkletSoundChip('pokey',{audioContext:context,mixer,clock:1789773},async()=>new Uint8Array());assert.equal(chip.clock,1789773);assert.equal(chip.sampleRate(),48000);assert.deepEqual(Object.getOwnPropertyDescriptor(chip,'clock'),{value:1789773,enumerable:true,writable:false,configurable:false});await chip.dispose();assert.equal(closed,0);}finally{await chip?.dispose();if(descriptor)Object.defineProperty(globalThis,'AudioWorkletNode',descriptor);else delete globalThis.AudioWorkletNode;}
});
