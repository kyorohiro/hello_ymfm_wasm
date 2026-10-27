import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PokeyAudioEngine} from '../web/pokeyaudioengine.js';
import factory from '../docs/generated/pokey_wasm.js';

const binary=await readFile(new URL('../docs/generated/pokey_wasm.wasm',import.meta.url));
let Processor,receive;globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:message=>receive(message)};}};
globalThis.registerProcessor=(name,Type)=>{assert.equal(name,'tetorica-soundchip');Processor=Type;};
await import('../docs/js/soundchip-output-worklet.js');
async function create(rate=48000,clock=1789773){
  globalThis.sampleRate=rate;globalThis.currentFrame=0;const messages=[];let resolve,reject;
  const ready=new Promise((a,b)=>{resolve=a;reject=b;});receive=message=>{messages.push(message);if(message.type==='ready')resolve(message);else if(!message.type&&message.error)reject(new Error(message.error));};
  const processor=new Processor({processorOptions:{name:'pokey',chipOptions:{clock,sampleRate:32000},wasmBinary:binary}});await ready;return {processor,messages};
}
function render(processor,frames){const left=new Float32Array(frames),right=new Float32Array(frames);processor.process([],[[left,right]]);globalThis.currentFrame+=frames;return {left,right};}
const config=[[15,3],[0,72],[1,0xa8],[9,0]];
function configure(processor,engine){for(const [reg,value]of config){processor.receive({method:'writeRegister',args:[reg,value]});engine?.writeRegister(reg,value);}}
const dispose=processor=>processor.receive({method:'dispose'});

for(const rate of [44100,48000])test(`POKEY generic Worklet matches speaker engine at actual host ${rate} Hz`,async()=>{
  const {processor}=await create(rate),engine=await PokeyAudioEngine.create({moduleFactory:options=>factory({wasmBinary:binary,...options}),clock:1789773,outputSampleRate:rate});
  try{
    assert.equal(processor.chip.sampleRate(),rate);configure(processor,engine);processor.receive({method:'start'});
    processor.chip.generateStereo=()=>{throw new Error('render must borrow PCM');};
    for(const frames of [1,127,128,997])assert.deepEqual(render(processor,frames),engine.processFrames(frames));
    processor.receive({method:'setChannelMuted',args:[0,true]});assert(render(processor,128).left.every(x=>x===0));
    processor.receive({method:'setChannelMuted',args:[0,false]});processor.receive({method:'keyOff',args:[0]});assert(render(processor,128).left.every(x=>x===0));
  }finally{dispose(processor);engine.dispose();}
});

test('POKEY scheduled writes are bounded, atomic, exact-frame and cancelled by Stop',async()=>{
  const {processor,messages}=await create(),engine=await PokeyAudioEngine.create({moduleFactory:options=>factory({wasmBinary:binary,...options}),clock:1789773,outputSampleRate:48000});
  try{
    configure(processor,engine);const entries=[{time:0,register:1,value:0xa8},{time:3/48000,register:0,value:91},{time:3/48000,register:0,value:61},{time:31/48000,register:1,value:0xa0}];
    processor.receive({method:'schedule-writes',args:[entries],id:1});assert.equal(messages.at(-1).value,4);const old=processor.scheduled.slice();
    processor.receive({method:'schedule-writes',args:[[{time:1,register:0,value:0},{time:1,register:16,value:0}]],id:2});assert(messages.at(-1).error);assert.deepEqual(processor.scheduled,old);
    const expected={left:new Float32Array(64),right:new Float32Array(64)};let offset=0;
    for(const entry of entries){const next=Math.round(entry.time*48000);if(next>offset){const pcm=engine.processFrames(next-offset);expected.left.set(pcm.left,offset);expected.right.set(pcm.right,offset);offset=next;}engine.writeRegister(entry.register,entry.value);}
    const tail=engine.processFrames(64-offset);expected.left.set(tail.left,offset);expected.right.set(tail.right,offset);
    processor.scheduled.shift=()=>{throw new Error('render must not shift schedule');};processor.receive({method:'start'});assert.deepEqual(render(processor,64),expected);
    processor.receive({method:'schedule-writes',entries:[{time:5,register:1,value:0xaf}]});processor.receive({method:'stop'});assert.equal(processor.scheduled.length,0);
    processor.receive({method:'readRegister',args:[0],id:3});assert.notEqual(messages.at(-1).value,61);
    processor.receive({method:'getState',id:4});assert.equal(messages.at(-1).value.registers[0],61);
    processor.receive({method:'reset'});assert.equal(processor.pokeySpeaker.previousOutput,0);assert(render(processor,128).left.every(x=>x===0));
  }finally{dispose(processor);engine.dispose();}
});

test('POKEY generic Worklet dual instances retain independent state after disposal',async()=>{
  const {processor:first}=await create(),{processor:second}=await create();
  try{configure(first);configure(second);first.receive({method:'start'});second.receive({method:'start'});first.receive({method:'setChannelMuted',args:[0,true]});assert(render(first,128).left.every(x=>x===0));assert(render(second,128).left.some(x=>x!==0));dispose(first);assert(render(second,128).left.some(x=>x!==0));second.receive({method:'allNotesOff'});assert(render(second,128).left.every(x=>x===0));}finally{dispose(first);dispose(second);}
});
