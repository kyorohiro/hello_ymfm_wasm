import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWonderSwanTimeline,createWonderSwanTimelineCursor,WONDERSWAN_TIMELINE_MAX_BYTES} from './wonderswan_timeline.js';

const trace = () => ({version:1,clock:3072000,durationSamples:10,events:[[0,0,0x90,0x22],[1,2,0,6,3,7],[7,0,0x90,0]],pcmData:Uint8Array.of(0,42,3,99,3,128)});

test('WonderSwan compact timeline owns source storage and traverses exact ceil-frame order without PCM expansion',()=>{
  const original=trace(),prepared=prepareWonderSwanTimeline(original,{sampleRate:48000});
  original.events[0][3]=0;original.pcmData.fill(0);
  assert.equal(prepared.events[0][3],0x22);assert.equal(prepared.pcmData[1],42);assert.equal(prepared.events.length,3);
  const cursor=createWonderSwanTimelineCursor(prepared,48000),writes=[];
  for(let frame=0;frame<=cursor.durationFrames;frame++)cursor.advance(frame,(kind,address,value)=>writes.push([frame,kind,address,value]));
  assert.deepEqual(writes,[[0,0,0x90,0x22],[2,0,0x89,42],[5,0,0x89,99],[8,0,0x89,128],[8,0,0x90,0]]);
  assert.equal(cursor.durationFrames,11);assert.equal(cursor.nextFrame(),Infinity);
  const buffer=Buffer.from([0,42,3,99,3,128]),fromBuffer=prepareWonderSwanTimeline({...trace(),pcmData:buffer});buffer.fill(0);assert.equal(fromBuffer.pcmData[1],42,'Buffer slices cannot retain caller storage');
});

test('WonderSwan timeline rejects malformed schema and packed runs before accepting any state',()=>{
  const bad=[
    t=>t.version=2,t=>t.clock=0,t=>t.durationSamples=-1,t=>t.events[0][0]=11,t=>t.events[0][2]=0x7f,
    t=>t.events[0][3]=256,t=>t.events[0][1]=9,t=>t.events[0].push(0),t=>t.events[0][3]=0,
    t=>t.events[1][2]=1,t=>t.events[1][3]=5,t=>t.events[1][4]=4,t=>t.events[1][5]=6,t=>t.events[2][0]=6,
    t=>t.pcmData[0]=1,t=>t.pcmData=Uint8Array.of(0x80,0,42,3,99,3,128),
    t=>t.pcmData=Uint8Array.of(0x80,0x80,0x80,0x80,0x10,42),
    t=>t.events[1]=[1,2,0,6,0,7],t=>t.events[1][5]=0xffffffff,
  ];
  for(const mutate of bad){const value=trace();mutate(value);assert.throws(()=>prepareWonderSwanTimeline(value));}
  assert.throws(()=>prepareWonderSwanTimeline({...trace(),pcmData:new Uint8Array(WONDERSWAN_TIMELINE_MAX_BYTES)}),/8 MiB/);
  assert.throws(()=>prepareWonderSwanTimeline(trace(),{sampleRate:0}),/sample rate/);
  assert.throws(()=>createWonderSwanTimelineCursor(trace(),Infinity),/sample rate/);
});

test('WonderSwan timeline bounds callback work while allowing ordinary dense 12 kHz voice audio',()=>{
  const events=Array.from({length:513},()=>[0,1,0,0]);
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:0,events,pcmData:new Uint8Array()}),/too many writes/);
  const spread=events.map((event,index)=>[Math.floor(index/3),1,0,0]);
  assert.doesNotThrow(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:200,events:spread,pcmData:new Uint8Array()}));
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:200,events:spread,pcmData:new Uint8Array()},{sampleRate:16000}),/output quantum/);
  const crossing=Array.from({length:512},()=>[127,1,0,0]);crossing.push([128,1,0,0]);
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:128,events:crossing,pcmData:new Uint8Array()},{sampleRate:44100}),/output quantum/,'density includes writes across an aligned quantum boundary');
  const count=12000,bytes=new Uint8Array(count*2);for(let index=0;index<count;index++){bytes[index*2]=index?index%4?4:3:0;bytes[index*2+1]=index&255;}
  const end=(count-1)*4-Math.floor((count-1)/4),dense={version:1,clock:3072000,durationSamples:50000,events:[[0,0,0x90,0x22],[0,2,0,bytes.length,count,end]],pcmData:bytes};
  assert.equal(prepareWonderSwanTimeline(dense,{sampleRate:44100}).events.length,2);
});

test('WonderSwan repeated PCM ranges share bytes but cannot multiply admission work without a bound',()=>{
  const pcmData=new Uint8Array(1024*1024),count=pcmData.length/2;for(let index=0;index<count;index++){pcmData[index*2]=index?5:0;pcmData[index*2+1]=128;}
  const events=[[0,0,0x90,0x22]],length=(count-1)*5;
  for(let index=0;index<8;index++)events.push([index*length,2,0,pcmData.length,count,(index+1)*length]);
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:length*8,events,pcmData}),/playback work exceeds the 8 MiB/);
});
