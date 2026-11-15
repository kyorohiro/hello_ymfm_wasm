import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWonderSwanTimeline,createWonderSwanTimelineCursor,WONDERSWAN_TIMELINE_MAX_BYTES,WONDERSWAN_TIMELINE_MAX_HOST_BYTES} from '../../tetorica_src/runtime/wonderswan_timeline.js';

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
  const hostEvents=[[0,0,0x90,0x22]];
  for(let index=0;index<32;index++)hostEvents.push([index*length,2,0,pcmData.length,count,(index+1)*length]);
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:length*32,events:hostEvents,pcmData},
    {maxBytes:WONDERSWAN_TIMELINE_MAX_HOST_BYTES}),/playback work exceeds the 32 MiB/);
});

test('WonderSwan host preparation accepts a bounded larger trace while default callers retain the 8 MiB budget',()=>{
  const count=Math.floor(WONDERSWAN_TIMELINE_MAX_BYTES/32)+1;
  const input={version:1,clock:3072000,durationSamples:count*4,
    events:Array.from({length:count},(_,index)=>[index*4,1,index&0x3fff,index&255]),pcmData:new Uint8Array()};
  assert.throws(()=>prepareWonderSwanTimeline(input,{sampleRate:48000}),/8 MiB/);
  const prepared=prepareWonderSwanTimeline(input,{sampleRate:48000,maxBytes:WONDERSWAN_TIMELINE_MAX_HOST_BYTES});
  input.events[0][3]=255;input.events[count-1][2]=0;
  assert.equal(prepared.events[0][3],0);
  assert.equal(prepared.events[count-1][2],(count-1)&0x3fff);
  for(const sizes of [[4096],[1,127,3,911]]) {
    const cursor=createWonderSwanTimelineCursor(prepared,48000);
    let frame=0,partition=0,index=0;
    const apply=(kind,address,value)=>{
      assert.equal(kind,1);assert.equal(address,index&0x3fff);assert.equal(value,index&255);index++;
    };
    cursor.advance(0,apply);
    while(frame<cursor.durationFrames) {
      frame=Math.min(cursor.durationFrames,frame+sizes[partition++%sizes.length]);
      cursor.advance(frame,apply);
      const next=index<count?Math.ceil(index*4*48000/44100):Infinity;
      assert.equal(cursor.nextFrame(),next,'partition boundaries retain exact event timing');
      assert(next>frame);
    }
    assert.equal(index,count);
  }
});

test('WonderSwan opt-in host budgets validate before reading or copying the supplied trace',()=>{
  const unreadable=new Proxy({}, {get(){assert.fail('invalid budget must be rejected before trace access');}});
  for(const maxBytes of [0,-1,1.5,NaN,Infinity,'33554432',null,WONDERSWAN_TIMELINE_MAX_HOST_BYTES+1])
    assert.throws(()=>prepareWonderSwanTimeline(unreadable,{maxBytes}),/maxBytes/);
  const empty={version:1,clock:3072000,durationSamples:0,events:[],pcmData:new Uint8Array()};
  assert.doesNotThrow(()=>prepareWonderSwanTimeline(empty,{maxBytes:1}));
  assert.doesNotThrow(()=>prepareWonderSwanTimeline(empty,{maxBytes:WONDERSWAN_TIMELINE_MAX_HOST_BYTES}));
  assert.throws(()=>prepareWonderSwanTimeline({...empty,pcmData:new Uint8Array(2)},{maxBytes:1}),/data exceeds/);
});

test('WonderSwan host budget increases cannot bypass callback density or referenced PCM work limits',()=>{
  const events=Array.from({length:513},()=>[0,1,0,0]);
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:0,events,pcmData:new Uint8Array()},
    {sampleRate:44100,maxBytes:WONDERSWAN_TIMELINE_MAX_HOST_BYTES}),/too many writes/);
  const crossing=Array.from({length:512},()=>[127,1,0,0]);crossing.push([128,1,0,0]);
  assert.throws(()=>prepareWonderSwanTimeline({version:1,clock:3072000,durationSamples:128,events:crossing,pcmData:new Uint8Array()},
    {sampleRate:44100,maxBytes:WONDERSWAN_TIMELINE_MAX_HOST_BYTES}),/output quantum/);
  const pcmData=Uint8Array.of(0,128,4,140),runs=[[0,0,0x90,0x22]];
  for(let index=0;index<10;index++)runs.push([index*4,2,0,pcmData.length,2,(index+1)*4]);
  const input={version:1,clock:3072000,durationSamples:40,events:runs,pcmData};
  const maxBytes=runs.length*32+pcmData.length;
  assert.throws(()=>prepareWonderSwanTimeline(input,{sampleRate:44100,maxBytes}),/referenced PCM playback work/);
  assert.doesNotThrow(()=>prepareWonderSwanTimeline(input,{sampleRate:44100,maxBytes:WONDERSWAN_TIMELINE_MAX_HOST_BYTES}));
});
