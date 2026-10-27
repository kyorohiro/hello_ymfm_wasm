import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {WonderSwan,WONDERSWAN_CLOCK} from './wonderswan.js';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js';
import {ChipClockResampler,validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {prepareWonderSwanTimeline,createWonderSwanTimelineCursor} from './wonderswan_timeline.js';
import {createWonderSwanClient} from './playground_wonderswan.js';

const binary=await readFile(new URL('../docs/generated/wonderswan_wasm.wasm',import.meta.url));
const source=(await readFile(new URL('./playground_wonderswan_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const peak=values=>values.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
async function setup(rate=48000,initialFrame=0){
  let Processor,resolveReady,frame=initialFrame;const messages=[],ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:message=>{messages.push(message);if(message.ready||message.error)resolveReady(message);}};
  const scope={WonderSwan,WONDERSWAN_CLOCK,factory,WonderSwanVoiceInspector,ChipClockResampler,validateChipClock,receiveChipInspector,prepareWonderSwanTimeline,createWonderSwanTimelineCursor,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value};
  Object.defineProperty(scope,'currentFrame',{get:()=>frame});vm.runInNewContext(source,scope);
  const processor=new Processor({processorOptions:{wasmBinary:binary}});assert.equal((await ready).ready,true);
  return {processor,port,messages,send:command=>processor.receive(command,port),render(frames){const left=new Float32Array(frames),right=new Float32Array(frames);processor.process([],[[left,right]]);frame+=frames;return {left,right};},get frame(){return frame;},dispose:()=>processor.dispose()};
}
function voiceTrace(){
  const count=240,pcmData=new Uint8Array(count*2),start=63;
  for(let index=0;index<count;index++){pcmData[index*2]=index?index%4?4:3:0;pcmData[index*2+1]=(index*71+index*index*13)&255;}
  const end=start+(count-1)*4-Math.floor((count-1)/4),events=[];
  for(let index=0;index<64;index++)events.push([0,1,0x1200+index,(index*23)&255]);
  events.push([0,0,0x8f,0x48],[0,0,0x80,150],[0,0,0x81,7],[0,0,0x84,220],[0,0,0x85,7],[0,0,0x8c,255],[0,0,0x8d,0],[0,0,0x8e,0x13],[0,0,0x88,0x67],[0,0,0x8a,0x34],[0,0,0x8b,0x23],[0,0,0x91,8],[0,0,0x94,15],[0,0,0x90,0xcd],[start,0,0x90,0xef],[start,2,0,pcmData.length,count,end],[end,0,0x90,0xcd],[end+7,0,0x90,0]);
  return {version:1,clock:3200011,durationSamples:end+32,events,pcmData};
}

for(const rate of [44100,48000])test(`WonderSwan ${rate}Hz compact timeline matches direct real-WASM register/RAM/PCM rendering exactly`,async()=>{
  const direct=await setup(rate),scheduled=await setup(rate);try{
    const trace=prepareWonderSwanTimeline(voiceTrace(),{sampleRate:rate}),cursor=createWonderSwanTimelineCursor(trace,rate),total=cursor.durationFrames+128;
    direct.send({method:'clock',args:[trace.clock]});direct.send({method:'reset',args:[]});
    const expected={left:[],right:[]};
    for(let frame=0;frame<total;frame++){
      cursor.advance(frame,(kind,address,value)=>direct.send({method:kind===0?'writeRegister':'writeMemory',args:[address,value]}));
      if(frame===cursor.durationFrames)direct.send({method:'allNotesOff',args:[]});
      const pcm=direct.render(1);expected.left.push(...pcm.left);expected.right.push(...pcm.right);
    }
    scheduled.send({method:'prepareTimeline',args:[trace],id:'prepare'});scheduled.send({method:'playTimeline',args:[],id:'play'});
    assert(!scheduled.messages.some(message=>message.id==='play'),'play RPC waits for the actual output end');
    const actual={left:[],right:[]},partitions=[128,7,1,13,2,63];let offset=0,part=0;
    while(offset<total){const count=Math.min(total-offset,partitions[part++%partitions.length]),pcm=scheduled.render(count);actual.left.push(...pcm.left);actual.right.push(...pcm.right);offset+=count;}
    assert.deepEqual(actual,expected);assert(peak(actual.left)>.01);assert(actual.left.slice(cursor.durationFrames).every(value=>value===0));
    const result=scheduled.messages.find(message=>message.id==='play').value;
    assert.equal(result.playing,false);assert.equal(result.positionSamples,trace.durationSamples);assert.equal(result.endFrame,cursor.durationFrames);assert.equal(result.startFrame,0);assert.equal(result.state.registers[16]&15,0);
    assert.equal(scheduled.processor.performance.getStats().queuedCommands,0,'PCM was not expanded into the global performance queue');
    scheduled.send({method:'playTimeline',args:[],id:'replay'});const replay=scheduled.render(128);assert.deepEqual([...replay.left],actual.left.slice(0,128),'a second play starts with clean phase and RAM');
  }finally{direct.dispose();scheduled.dispose();}
});

test('WonderSwan prepared resource is immediate but playback takes exactly one reserved performance lead',async()=>{
  const p=await setup();try{
    p.send({type:'performance-start',session:1});
    p.send({performance:{session:1,owner:'song',time:1},commands:[{method:'prepareTimeline',args:[voiceTrace()],id:'prepare'}]});
    assert(p.messages.find(message=>message.id==='prepare').value.loaded);
    p.send({performance:{session:1,owner:'song',time:256/48000},commands:[{method:'playTimeline',args:[],id:'play'}]});
    assert.equal(p.processor.timelineStarts.size,1);
    assert.throws(()=>p.processor.inspector.invoke('auditionOn',[0,60,'manual']),/timeline/);
    assert.equal(peak(p.render(128).left),0);assert.equal(peak(p.render(128).left),0);
    const first=p.render(128);assert(peak(first.left)>0);assert.equal(p.processor.timelineStartFrame,256);
    p.send({type:'performance-cancel-owner',session:1,owner:'other'});assert(p.processor.timelineCursor);
    p.send({type:'performance-cancel-owner',session:1,owner:'song'});
    assert.match(p.messages.find(message=>message.id==='play').error,/stopped/);assert.equal(peak(p.render(128).left),0);
  }finally{p.dispose();}
});

test('WonderSwan a chip prepared after an existing AudioContext starts at the current output frame',async()=>{
  const late=await setup(48000,4800000),fresh=await setup();try{
    for(const p of [late,fresh]){p.send({method:'prepareTimeline',args:[voiceTrace()],id:'prepare'});p.send({method:'playTimeline',args:[],id:'play'});}
    assert.equal(late.processor.timelineStartFrame,4800000);assert.deepEqual(late.render(128),fresh.render(128));
  }finally{late.dispose();fresh.dispose();}
});

for(const method of ['stopTimeline','stopVoices','reset','dispose'])test(`WonderSwan ${method} cancels compact playback and prevents late completion`,async()=>{
  const p=await setup();try{
    p.send({method:'prepareTimeline',args:[voiceTrace()],id:'prepare'});p.send({method:'playTimeline',args:[],id:'play'});p.render(128);
    p.send({method,args:[],id:'stop'});assert.match(p.messages.find(message=>message.id==='play').error,/stopped|reset|disposed/);
    if(method!=='dispose')assert.equal(peak(p.render(128).left),0);
    assert.equal(p.messages.filter(message=>message.id==='play').length,1);
  }finally{p.dispose();}
});

test('WonderSwan stale queued starts, failed preparation, manual leases and replacement are fenced',async()=>{
  const p=await setup();try{
    p.send({method:'prepareTimeline',args:[voiceTrace()],id:'prepare'});const data=p.processor.timelineData;
    p.processor.inspector.invoke('auditionOn',[0,60,'manual']);p.send({method:'playTimeline',args:[],id:'held'});assert.match(p.messages.find(message=>message.id==='held').error,/held/);
    p.processor.inspector.invoke('auditionOff',[0,'manual']);
    p.send({method:'prepareTimeline',args:[{...voiceTrace(),pcmData:new Uint8Array()}],id:'bad'});assert(p.messages.find(message=>message.id==='bad').error);assert.equal(p.processor.timelineData,data);
    p.send({type:'performance-start',session:1});p.send({performance:{session:1,owner:'song',time:1},commands:[{method:'playTimeline',args:[],id:'pending'}]});
    p.send({method:'stopTimeline',args:[],id:'stop'});assert.match(p.messages.find(message=>message.id==='pending').error,/cancelled/);
    for(let index=0;index<400;index++)p.render(128);
    assert.equal(p.messages.filter(message=>message.id==='pending').length,1);assert(!p.processor.timelineCursor);
    p.send({method:'playTimeline',args:[],id:'active'});p.render(128);p.send({method:'prepareTimeline',args:[voiceTrace()],id:'replace'});
    assert.match(p.messages.find(message=>message.id==='active').error,/stopped|replaced/);assert.equal(peak(p.render(128).left),0);
  }finally{p.dispose();}
});

test('WonderSwan public client sends one cloned compact preparation and keeps playback RPC pending until completion',async()=>{
  const p=await setup(),sent=[];let clientPort;
  clientPort={postMessage(command){sent.push(command);p.processor.receive(command,{postMessage:message=>queueMicrotask(()=>clientPort.onmessage?.({data:message}))});},start(){},close(){}};
  const client=createWonderSwanClient(clientPort);
  try{
    const trace=voiceTrace();await client.prepareTimeline(trace);trace.pcmData.fill(0);trace.events[0][3]=255;
    let completed=false;const play=client.playTimeline().then(value=>{completed=true;return value;});await Promise.resolve();assert.equal(completed,false);
    for(let index=0;index<20;index++)p.render(128);
    const result=await play;assert.equal(result.playing,false);assert.equal(sent.filter(command=>command.method==='prepareTimeline').length,1);assert.equal(sent.filter(command=>command.method==='writeRegister').length,0);
    const again=client.playTimeline(),aborted=assert.rejects(again,{name:'AbortError'});await client.stopTimeline();await aborted;
  }finally{client.dispose();p.dispose();}
});
