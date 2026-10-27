import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {MessageChannel} from 'node:worker_threads';
import {WonderSwanWorkletTransport} from '../web/chip_worklet_transport.js';
import {WonderSwanSynth} from '../web/wonderswansynth.js';
import {createWorkletSoundChip} from '../web/soundchip_worklet.js';

function endpoint() {
  const messages = [], requests = [];
  const value = {execution:'worklet',name:'wonderswan',port:{postMessage:command => messages.push(command)},
    request(method,args=[]) {return new Promise((resolve,reject) => requests.push({method,args,resolve,reject}));},
    async start() {}, async stop() {}, async dispose() {value.disposals++;},disposals:0};
  return {value,messages,requests};
}

test('WonderSwan Synth preserves optional channel/control ownership metadata on its generic Worklet transport', () => {
  const {value,messages}=endpoint(), transport=new WonderSwanWorkletTransport(value), synth=new WonderSwanSynth({transport});
  synth.initialize(); synth.noteOn(2,'A4');
  assert.deepEqual(messages.at(-1),{method:'writeRegister',args:[0x90,4],channel:2,controlMask:4});
  assert(messages.some(command=>command.method==='writeMemory'&&command.channel===2));
  synth.dispose(); assert.equal(value.disposals,0);
  assert.throws(()=>transport.writeRegister(0x90,0),/disposed/);
});

test('WonderSwan uploads are bounded snapshots and reads, mutes, and flush await audio-thread acknowledgements', async () => {
  const {value,requests}=endpoint(),transport=new WonderSwanWorkletTransport(value),bytes=new Uint8Array([0x10,0x32]);
  const upload=transport.loadMemory(bytes,0x3ffe); bytes.fill(0);
  assert.deepEqual(requests[0].args,[new Uint8Array([0x10,0x32]),0x3ffe]);
  let finished=false; upload.then(()=>{finished=true;}); await Promise.resolve(); assert.equal(finished,false);
  requests[0].resolve(); await upload;
  const register=transport.readRegister(0x90),memory=transport.readMemory(0x3fff),muted=transport.setChannelMuted(3,true),flushed=transport.flush();
  assert.deepEqual(requests.slice(1).map(({method,args})=>({method,args})),[
    {method:'readRegister',args:[0x90]},{method:'readMemory',args:[0x3fff]},
    {method:'setChannelMuted',args:[3,true]},{method:'barrier',args:[]},
  ]);
  requests[1].resolve(0x81);requests[2].resolve(0x32);requests[3].resolve();requests[4].resolve();
  assert.equal(await register,0x81);assert.equal(await memory,0x32);await muted;await flushed;
  const before=requests.length;
  assert.throws(()=>transport.loadMemory(new Uint8Array(0x4001)),/16 KiB/);
  assert.throws(()=>transport.loadMemory(new Uint8Array(1),0x4000),/16 KiB/);
  assert.throws(()=>transport.loadMemory([0]),/Uint8Array/);
  assert.throws(()=>transport.readMemory(0x4000),/RAM address/);
  assert.throws(()=>transport.readRegister(0x7f),/register address/);
  assert.throws(()=>transport.setChannelMuted(0,1),/boolean/);
  assert.equal(requests.length,before);transport.dispose();
});

test('WonderSwan schedules use absolute seconds, snapshot a whole valid batch, and await its accepted count', async () => {
  const {value,requests}=endpoint(),transport=new WonderSwanWorkletTransport(value),entries=[{time:2,address:0x89,value:255}];
  const scheduled=transport.scheduleWrites(entries);entries[0].value=0;entries.push({time:3,address:0x89,value:128});
  assert.deepEqual(requests[0].args,[[{time:2,port:0,register:0x89,value:255}]]);
  requests[0].resolve(1);assert.equal(await scheduled,1);
  for(const invalid of [[{time:-1,register:0x89,value:0}],[{time:NaN,register:0x89,value:0}],
    [{time:0,register:0x89,value:256}],[{time:0,register:0x7f,value:0}],
    [{time:0,register:0x89,address:0x88,value:0}],[{time:0,register:0x89,value:0,port:1}],
    [{time:0,register:0x89,value:0},{time:1,register:0x89,value:-1}],new Array(65537)]){
    assert.throws(()=>transport.scheduleWrites(invalid));
  }
  assert.equal(requests.length,1,'a rejected batch never reaches the processor');
  const cleared=transport.clearScheduledWrites();assert.equal(requests[1].method,'clear-scheduled-writes');requests[1].resolve();await cleared;
  transport.dispose();
});

test('transferred MessagePort requests correlate out-of-order responses and flush is a real barrier', async () => {
  const {port1,port2}=new MessageChannel(),transport=new WonderSwanWorkletTransport(port1);
  try {
    const incoming=[];port2.on('message',message=>incoming.push(message));
    const firstMessage=once(port2,'message'),first=transport.readRegister(0x90);await firstMessage;
    const secondMessage=once(port2,'message'),second=transport.readMemory(0);await secondMessage;
    assert.notEqual(incoming[0].id,incoming[1].id);
    port2.postMessage({type:'response',id:'unrelated',value:99});
    port2.postMessage({type:'response',id:incoming[1].id,value:0x32});assert.equal(await second,0x32);
    port2.postMessage({type:'response',id:incoming[0].id,value:0x81});assert.equal(await first,0x81);
    const barrierMessage=once(port2,'message');let resolved=false;
    const barrier=transport.flush().then(()=>{resolved=true;});await barrierMessage;
    assert.equal(incoming[2].method,'barrier');assert.equal(resolved,false);
    port2.postMessage({type:'response',id:incoming[2].id});await barrier;assert.equal(resolved,true);
    const failedMessage=once(port2,'message'),failed=transport.readMemory(1);await failedMessage;
    const rejection=assert.rejects(failed,/core read failed/);port2.postMessage({id:incoming[3].id,error:'core read failed'});await rejection;
  } finally {transport.dispose();port1.close();port2.close();}
});

test('disposing a borrowed transport rejects its pending requests without disposing its endpoint', async () => {
  const {value,requests}=endpoint(),transport=new WonderSwanWorkletTransport(value),pending=transport.readMemory(0);
  const rejection=assert.rejects(pending,/Transport disposed/);transport.dispose();await rejection;
  assert.equal(value.disposals,0);requests[0].resolve(99);await Promise.resolve();
  const other=new WonderSwanWorkletTransport(value),failure=other.readMemory(1),failureCheck=assert.rejects(failure,/processor failed/);
  requests[1].reject(new Error('processor failed'));await failureCheck;other.dispose();
});

test('terminal disposal messages reject all requests on a transferred port', async () => {
  const {port1,port2}=new MessageChannel(),transport=new WonderSwanWorkletTransport(port1);
  try {
    const received=once(port2,'message'),pending=transport.readMemory(0),check=assert.rejects(pending,/chip is disposed/);await received;
    port2.postMessage({type:'disposed',error:'Worklet chip is disposed'});await check;
    assert.throws(()=>transport.readMemory(1),/chip is disposed/);
  } finally {transport.dispose();port1.close();port2.close();}
});

test('generic WonderSwan endpoint publishes readonly effective clock and retains shared context ownership', async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode'),sent=[];
  const node={port:{postMessage(command){sent.push(command);if(command.id!==undefined)queueMicrotask(()=>node.port.onmessage({data:{type:'response',id:command.id}}));}},disconnect(){}};
  Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:class {
    constructor(_context,_name,options){assert.equal(options.processorOptions.name,'wonderswan');queueMicrotask(()=>node.port.onmessage({data:{type:'ready',sampleRate:48000}}));return node;}
  }});
  let contextClosed=0,released=0;
  const context={state:'suspended',currentTime:0,resume:async()=>{},close:async()=>{contextClosed++;},
    audioWorklet:{addModule:async()=>{}},createGain:()=>({gain:{value:0},disconnect(){}})};
  const mixer={reserveId:()=>({id:'ws1',release(){}}),connect:()=>()=>{released++;}};
  let chip;
  try {
    chip=await createWorkletSoundChip('wonderswan',{audioContext:context,mixer,clock:3200011},async()=>new Uint8Array());
    assert.equal(chip.sampleRate(),48000);assert.equal(chip.clock,3200011);
    assert.deepEqual(Object.getOwnPropertyDescriptor(chip,'clock'),{value:3200011,enumerable:true,writable:false,configurable:false});
    await chip.request('barrier');
    const transport=new WonderSwanWorkletTransport(chip),pending=transport.readMemory(0),pendingCheck=assert.rejects(pending,/disposed/);
    await chip.dispose();await pendingCheck;await chip.dispose();transport.dispose();
    assert.equal(released,1);assert.equal(contextClosed,0);assert.equal(sent.at(-1).method,'dispose');
    await assert.rejects(chip.request('readMemory',[0]),/disposed/);
  } finally {
    await chip?.dispose();
    if(descriptor)Object.defineProperty(globalThis,'AudioWorkletNode',descriptor);else delete globalThis.AudioWorkletNode;
  }
});
