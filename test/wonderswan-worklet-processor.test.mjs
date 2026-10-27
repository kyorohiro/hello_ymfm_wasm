// Real SDK WASM through the actual source processor; no audio device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WonderSwanAudioEngine} from '../web/wonderswanaudioengine.js';
import factory from '../docs/generated/wonderswan_wasm.js';

const binary=await readFile(new URL('../docs/generated/wonderswan_wasm.wasm',import.meta.url));
let Processor,receive;
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:message=>receive(message)};}};
globalThis.registerProcessor=(name,Type)=>{assert.equal(name,'tetorica-soundchip');Processor=Type;};
await import('../docs/js/soundchip-output-worklet.js');
async function create(rate=48000,options={}){
  globalThis.sampleRate=rate;globalThis.currentFrame=0;
  const messages=[];let resolve,reject;
  const ready=new Promise((a,b)=>{resolve=a;reject=b;});
  receive=message=>{messages.push(message);if(message.type==='ready')resolve(message);else if(!message.type&&message.error)reject(new Error(message.error));};
  const processor=new Processor({processorOptions:{name:'wonderswan',chipOptions:options,wasmBinary:binary}});
  await ready;
  return {processor,messages};
}
function render(processor,frames){
  const left=new Float32Array(frames),right=new Float32Array(frames);
  processor.process([],[[left,right]]);globalThis.currentFrame+=frames;return {left,right};
}
function configure(processor,engine,channel=0){
  const bytes=Uint8Array.from({length:16},(_,index)=>index|(15-index)<<4),offset=0x100+channel*16;
  processor.receive({method:'loadMemory',args:[bytes,offset]});engine?.loadWonderSwanMemory(bytes,offset);
  for(const [address,value]of [[0x8f,4],[0x80+channel*2,0x26],[0x81+channel*2,7],[0x88+channel,0xf9],[0x91,8],[0x90,1<<channel]]){
    processor.receive({method:'writeRegister',args:[address,value]});engine?.writeWonderSwan(address-0x80,value);
  }
}
function dispose(processor){processor.receive({method:'dispose'});}

for(const rate of [44100,48000])test(`WonderSwan generic Worklet speaker PCM matches synchronous engine at host ${rate} Hz`,async()=>{
  const {processor}=await create(rate,{clock:3200011,sampleRate:32000});
  const engine=await WonderSwanAudioEngine.create({moduleFactory:options=>factory({wasmBinary:binary,...options}),clock:3200011,outputSampleRate:rate});
  try{
    assert.equal(processor.chip.sampleRate(),rate,'host context rate wins over requested core rate');assert.equal(processor.renderer.gain,1);
    configure(processor,engine);processor.receive({method:'start'});
    processor.speaker.processFrames=()=>{throw Error('Worklet must borrow PCM without owned copies');};
    processor.chip.generateStereo=()=>{throw Error('Worklet must borrow raw PCM views');};
    let negative=false,positive=false;
    for(const frames of [1,127,128,997]){
      const actual=render(processor,frames),expected=engine.processFrames(frames);
      assert.deepEqual(actual,expected);negative||=actual.left.some(value=>value<0);positive||=actual.left.some(value=>value>0);
    }
    assert(negative&&positive,'speaker output is centered, not unipolar raw DAC');
    const owned=engine.processFrames(128),ownedSnapshot={left:owned.left.slice(),right:owned.right.slice()};
    const borrowed=engine.generateStereoView(128),snapshot=borrowed.left.slice();
    assert.equal(engine.generateStereoView(128),borrowed,'fixed size reuses wrapper and PCM buffers');
    assert.notDeepEqual(borrowed.left,snapshot,'borrowed PCM is overwritten by the next render');
    assert.deepEqual(owned,ownedSnapshot,'owned engine PCM survives later borrowed rendering');
  }finally{dispose(processor);engine.dispose();}
});

test('WonderSwan generic Worklet exact-frame Voice PCM schedules preserve equal-time order and reject invalid batches atomically',async()=>{
  const rate=48000,{processor,messages}=await create(rate),engine=await WonderSwanAudioEngine.create({moduleFactory:options=>factory({wasmBinary:binary,...options}),outputSampleRate:rate});
  try{
    for(const [register,value]of [[17,8],[20,15],[16,34],[9,127]]){processor.receive({method:'writeRegister',args:[register+0x80,value]});engine.writeWonderSwan(register,value);}
    const entries=[{time:0,register:0x89,value:20},{time:3/rate,register:0x89,value:230},{time:3/rate,register:0x89,value:120},{time:7/rate,register:0x94,value:8},{time:15/rate,register:0x89,value:250},{time:31/rate,register:0x90,value:32}];
    processor.receive({method:'schedule-writes',args:[entries],id:1});assert.equal(messages.at(-1).value,entries.length);
    const previous=processor.scheduled.slice();
    for(const bad of [{time:1,register:0x7f,value:0},{time:1,register:0x89,value:256},{time:1,register:0x89,value:0,port:1},{time:Number.MAX_VALUE,register:0x89,value:0}]){
      processor.receive({method:'schedule-writes',entries:[{time:0,register:0x89,value:12},bad],id:2});assert.match(messages.at(-1).error,/Invalid/);assert.deepEqual(processor.scheduled,previous);
    }
    processor.receive({method:'schedule-writes',entries:Array(65537).fill(entries[0]),id:3});assert.match(messages.at(-1).error,/capacity/);assert.deepEqual(processor.scheduled,previous);
    const expected={left:new Float32Array(48),right:new Float32Array(48)};let position=0;
    for(const entry of entries){const frame=Math.round(entry.time*rate);if(frame>position){const pcm=engine.processFrames(frame-position);expected.left.set(pcm.left,position);expected.right.set(pcm.right,position);position=frame;}engine.writeWonderSwan(entry.register-0x80,entry.value);}
    const last=engine.processFrames(48-position);expected.left.set(last.left,position);expected.right.set(last.right,position);
    processor.scheduled.shift=()=>{throw Error('PCM render must not shift the schedule array');};processor.receive({method:'start'});
    assert.deepEqual(render(processor,48),expected);assert.equal(processor.scheduled.length,0);assert.equal(processor.scheduledIndex,0);
  }finally{dispose(processor);engine.dispose();}
});

test('WonderSwan generic Worklet validates RAM/read/mute and resets all speaker and scheduling history',async()=>{
  const {processor,messages}=await create();
  try{
    configure(processor);processor.receive({method:'writeMemory',args:[0x123,0xab]});processor.receive({method:'readMemory',args:[0x123],id:1});assert.equal(messages.at(-1).value,0xab);
    processor.receive({method:'readRegister',args:[0x90],id:2});assert.equal(messages.at(-1).value,1);
    for(const command of [{method:'writeMemory',args:[0x4000,1]},{method:'loadMemory',args:[new Uint8Array(2),0x3fff]},{method:'readMemory',args:[-1]},{method:'readRegister',args:[0x7f]},{method:'setChannelMuted',args:[4,true]},{method:'setChannelMuted',args:[0,1]},{method:'keyOff',args:[4]},{method:'writeRegister',args:[0x90,1],controlMask:256}]){
      processor.receive({...command,id:9});assert(messages.at(-1).error,JSON.stringify(command));
    }
    processor.receive({method:'start'});assert(render(processor,1024).left.some(value=>value!==0));
    processor.receive({method:'setChannelMuted',args:[0,true]});assert(render(processor,128).left.every(value=>value===0));
    processor.receive({method:'setChannelMuted',args:[0,false]});assert(render(processor,128).left.some(value=>value!==0));
    processor.receive({method:'schedule-writes',entries:[{time:2,register:0x90,value:1}]});processor.receive({method:'reset'});
    assert.equal(processor.scheduled.length,0);assert.equal(processor.renderer.phase,0);assert.equal(processor.speaker.speakerPhase,0);assert(processor.speaker.heldLeft.every(value=>value===0));assert(processor.speaker.waveReady.every(value=>value===0));assert(processor.speaker.memory.every(value=>value===0));assert(render(processor,128).left.every(value=>value===0));
    configure(processor);processor.receive({method:'allNotesOff'});assert.equal(processor.speaker.registers[16]&15,0);assert(render(processor,128).left.every(value=>value===0));
  }finally{dispose(processor);}
});

test('WonderSwan generic Worklet control masks merge shared gates and owner cancellation releases only its channel',async()=>{
  const {processor}=await create();
  try{
    processor.receive({type:'performance-start',session:1});processor.receive({method:'start'});
    processor.receive({performance:{session:1,owner:'first',time:0},commands:[{method:'writeRegister',args:[0x90,1],controlMask:1}]});
    render(processor,1);assert.equal(processor.speaker.registers[16],1);
    processor.receive({performance:{session:1,owner:'second',time:0},commands:[{method:'writeRegister',args:[0x90,2],controlMask:2}]});
    render(processor,1);assert.equal(processor.speaker.registers[16],3);
    processor.receive({type:'performance-cancel-owner',session:1,owner:'first'});assert.equal(processor.speaker.registers[16],2,'second channel remains on');
    processor.receive({type:'performance-cancel-owner',session:1,owner:'second'});assert.equal(processor.speaker.registers[16]&15,0);
    processor.receive({performance:{session:1,owner:'scheduled',time:0},commands:[{method:'schedule-writes',entries:[{time:1,register:0x90,value:2},{time:2,register:0x89,value:255}]}]});assert.equal(processor.scheduled.length,2);
    processor.receive({type:'performance-start',session:1});assert.equal(processor.scheduled.length,2,'same session start is idempotent');
    processor.receive({type:'performance-cancel-owner',session:1,owner:'scheduled'});assert.equal(processor.scheduled.length,0,'cancelled owner cannot start future Voice PCM');
    processor.receive({performance:{session:1,owner:'playing',time:0},commands:[{method:'schedule-writes',entries:[{time:currentFrame/48000,register:0x90,value:34},{time:2,register:0x89,value:255}]}]});
    render(processor,1);assert.equal(processor.speaker.registers[16],34);
    processor.receive({type:'performance-cancel-owner',session:1,owner:'playing'});assert.equal(processor.speaker.registers[16]&15,0,'owner cancellation releases a gate applied by the scheduled PCM queue');assert.equal(processor.scheduled.length,0);
    processor.receive({type:'performance-stop',session:2});processor.receive({method:'schedule-writes',entries:[{time:3,register:0x89,value:77}]});
    processor.receive({type:'performance-start',session:1});assert.equal(processor.scheduled.length,1,'expired sessions cannot clear unrelated accepted schedules');
  }finally{dispose(processor);}
});

test('WonderSwan Stop/clear/session stop cancel future writes, and disposal releases handles and remote pending requests',async()=>{
  const {processor,messages}=await create();
  const scheduled=()=>processor.receive({method:'schedule-writes',entries:[{time:1,register:0x89,value:255}]});
  for(const command of [{method:'clear-scheduled-writes'},{method:'stop'},{type:'performance-stop',session:1}]){scheduled();assert.equal(processor.scheduled.length,1);processor.receive(command);assert.equal(processor.scheduled.length,0);}
  const events=[],remote={postMessage:message=>events.push(message),start(){},close(){this.closed=true;}};
  processor.receive({method:'attachPort',port:remote});const chip=processor.chip;
  dispose(processor);assert.equal(remote.closed,true);assert.equal(events.at(-1).type,'disposed');assert.equal(messages.at(-1).type,'disposed');assert.equal(processor.speaker,null);assert.equal(processor.renderer,null);assert.throws(()=>chip.sampleRate(),/disposed/);assert.equal(processor.process([],[[new Float32Array(128),new Float32Array(128)]]),false);dispose(processor);
});

test('WonderSwan prewarmed raw PCM prefix cache survives alternating spans and reset without new views',async()=>{
  const module=await factory({wasmBinary:binary});
  const {WonderSwan}=await import('../web/wonderswan.js');
  const chip=await WonderSwan.create({moduleFactory:async()=>module,sampleRate:48000});
  const original=Float32Array.prototype.subarray;
  try{
    chip.reserveFrames(128);
    const views=Array.from({length:129},(_,frames)=>chip.generateStereoView(frames));
    Float32Array.prototype.subarray=function(){throw Error('Prewarmed worklet spans must not allocate typed array views');};
    for(const frames of [3,4,1,128,7,3,4,0,127,128])assert.equal(chip.generateStereoView(frames),views[frames]);
    chip.reset();assert.equal(chip.generateStereoView(3),views[3]);assert(views[3].left.every(value=>value===0));
  }finally{Float32Array.prototype.subarray=original;chip.dispose();}
});

test('WonderSwan bounded PCM cache rebuilds after reserve expansion and actual WASM heap growth, preserving owned output',async()=>{
  const module=await factory({wasmBinary:binary});
  const {WonderSwan}=await import('../web/wonderswan.js');
  const chip=await WonderSwan.create({moduleFactory:async()=>module,sampleRate:44100});let allocation=0;
  try{
    chip.loadMemory(Uint8Array.from({length:16},(_,index)=>index|(15-index)<<4),0x100);
    for(const [address,value]of [[0x8f,4],[0x80,0x26],[0x81,7],[0x88,0xf9],[0x91,8],[0x90,1]])chip.writeRegister(address,value);
    chip.reserveFrames(128);const first=chip.generateStereoView(3);
    const owned=chip.generateStereo(997),snapshot={left:owned.left.slice(),right:owned.right.slice()};
    const expanded=chip.generateStereoView(3);assert.notEqual(expanded,first,'output pointer/capacity expansion invalidates old prefix wrappers');
    const oldHeap=module.HEAPF32;allocation=module._malloc(oldHeap.byteLength);assert(allocation);assert.notEqual(module.HEAPF32,oldHeap,'test really grows the WASM memory');
    const grown=chip.generateStereoView(3);assert.notEqual(grown,expanded);assert.equal(grown.left.buffer,module.HEAPF32.buffer);assert.equal(grown.right.buffer,module.HEAPF32.buffer);
    assert.equal(chip.generateStereoView(4).left.buffer,module.HEAPF32.buffer);assert.equal(chip.generateStereoView(3),grown);
    assert.deepEqual(owned,snapshot);chip.dispose();assert.deepEqual(owned,snapshot);assert.throws(()=>chip.generateStereoView(3),/disposed/);
  }finally{if(allocation)module._free(allocation);chip.dispose();}
});

test('WonderSwan generic Worklet prepared short Voice PCM segments do not allocate PCM arrays or subviews',async()=>{
  const {processor}=await create(),original=Float32Array.prototype.subarray;
  try{
    for(const [address,value]of [[0x91,8],[0x94,15],[0x90,34]])processor.receive({method:'writeRegister',args:[address,value]});
    processor.receive({method:'schedule-writes',entries:Array.from({length:32},(_,index)=>({time:index*4/48000,register:0x89,value:index*7}))});processor.receive({method:'start'});
    Float32Array.prototype.subarray=function(){throw Error('Prepared PCM schedule must not create typed array views');};
    const pcm=render(processor,128);assert(pcm.left.some(value=>value!==0));assert.equal(processor.scheduled.length,0);
  }finally{Float32Array.prototype.subarray=original;dispose(processor);}
});
