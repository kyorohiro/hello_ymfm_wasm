import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePokeyTimeline,createPokeyTimelineCursor,POKEY_TIMELINE_MAX_BYTES} from './pokey_timeline.js';
import {createPokeyTimelineUpload,createPokeyChunkTimelineCursor,POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM} from './pokey_timeline_upload.js';

const header=(byteLength,durationSamples=0xffffffff)=>({version:1,clock:1789790,durationSamples,byteLength});
const trace=(data,durationSamples=0xffffffff)=>({...header(data.byteLength,durationSamples),data});
function pack(points){
  const bytes=[];let previous=0;
  for(const [sample,register,value] of points){
    let delta=sample-previous;previous=sample;
    do{const byte=delta%128;delta=Math.floor(delta/128);bytes.push(byte+(delta?128:0));}while(delta);
    bytes.push(register,value);
  }
  return Uint8Array.from(bytes);
}
function upload(data,{sampleRate,durationSamples=0xffffffff,sizes=[POKEY_TIMELINE_CHUNK_BYTES],budget=POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM}={}){
  const staging=createPokeyTimelineUpload(header(data.byteLength,durationSamples),{sampleRate});
  let position=0,index=0,previousBytes=0,previousWrites=0;
  while(position<data.byteLength){
    const end=Math.min(data.byteLength,position+sizes[index++%sizes.length]);
    staging.append(data.slice(position,end));position=end;
    let progress;
    do{
      progress=staging.step(budget);
      assert.ok(progress.validatedBytes-previousBytes<=POKEY_TIMELINE_CHUNK_BYTES);
      assert.ok(progress.validatedWrites-previousWrites<=budget);
      previousBytes=progress.validatedBytes;previousWrites=progress.validatedWrites;
    }while(!progress.chunkDone);
  }
  assert.deepEqual(staging.step(),{chunkDone:true,complete:true,validatedBytes:data.byteLength,validatedWrites:previousWrites});
  return staging.finish();
}
function events(create,prepared,rate){
  const cursor=create(prepared,rate),result=[];
  while(Number.isFinite(cursor.nextFrame())){
    const frame=cursor.nextFrame();
    cursor.advance(frame-1,()=>assert.fail('write was scheduled early'));
    cursor.advance(frame,(register,value)=>result.push([frame,register,value]));
  }
  assert.equal(cursor.nextFrame(),Infinity);
  return {durationFrames:cursor.durationFrames,events:result};
}

test('chunk cursor exactly matches flat cursor across every split of multi-byte records',()=>{
  const points=[[0,15,3],[0,1,168],[1,0,255],[128,2,4],[256,3,5],[16640,4,6],[2113792,5,7],[270549248,6,8],[0xffffffff,7,9]];
  const data=pack(points);
  for(const rate of [44100,48000]){
    const expected=events(createPokeyTimelineCursor,preparePokeyTimeline(trace(data),{sampleRate:rate}),rate);
    for(let split=1;split<data.byteLength;split++){
      const prepared=upload(data,{sampleRate:rate,sizes:[split,data.byteLength-split],budget:1});
      assert.deepEqual(events(createPokeyChunkTimelineCursor,prepared,rate),expected,`split ${split} at ${rate}`);
    }
    for(let size=1;size<=17;size++)assert.deepEqual(events(createPokeyChunkTimelineCursor,upload(data,{sampleRate:rate,sizes:[size]}),rate),expected);
  }
});

test('random chunk boundaries preserve long timeline order and ceil-frame scheduling',()=>{
  let sample=0,seed=42;
  const points=Array.from({length:12000},(_,index)=>{sample+=index%17===0?128:index%7===0?0:1;return [sample,index%16,index%256];});
  const data=pack(points),sizes=Array.from({length:31},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%POKEY_TIMELINE_CHUNK_BYTES+1;});
  assert.ok(data.byteLength>POKEY_TIMELINE_CHUNK_BYTES);
  for(const rate of [44100,48000]){
    const flat=preparePokeyTimeline(trace(data,sample),{sampleRate:rate});
    const prepared=upload(data,{sampleRate:rate,durationSamples:sample,sizes});
    assert.deepEqual(events(createPokeyChunkTimelineCursor,prepared,rate),events(createPokeyTimelineCursor,flat,rate));
    const skipped=[],cursor=createPokeyChunkTimelineCursor(prepared,rate);cursor.advance(cursor.durationFrames,(register,value)=>skipped.push([register,value]));
    assert.deepEqual(skipped,points.map(point=>point.slice(1)));
  }
});

test('incremental decoder rejects every malformed flat trace even when split inside a record',()=>{
  const invalid=[
    [128],[255,255,255,255],[128,0,0,0],[255,255,255,255,16,0,0],
    [255,255,255,255,15,0,0,1,0,0],[0,16,0],[0,0],[0],[1,0,0],[0,0,0,128]
  ];
  for(const bytes of invalid){
    const data=Uint8Array.from(bytes),durationSamples=bytes.length===3&&bytes[0]===1?0:0xffffffff;
    for(const sampleRate of [undefined,44100,48000]){
      assert.throws(()=>preparePokeyTimeline(trace(data,durationSamples),{sampleRate}),/POKEY timeline/);
      for(let size=1;size<=data.byteLength;size++)assert.throws(()=>upload(data,{durationSamples,sampleRate,sizes:[size],budget:1}),/POKEY timeline/);
    }
  }
  const failed=createPokeyTimelineUpload(header(3));failed.append(Uint8Array.of(0,16,0));
  assert.throws(()=>failed.step(),/register/);
  assert.throws(()=>failed.finish(),/has failed/);
  assert.throws(()=>failed.step(),/has failed/);
  assert.throws(()=>failed.append(Uint8Array.of(0)),/has failed/);
});

test('rolling density is measured across chunk and fixed-quantum boundaries at both output rates',()=>{
  const dense=pack(Array.from({length:513},(_,index)=>[index<256?100:200,1,index%256]));
  for(const sampleRate of [44100,48000]){
    assert.throws(()=>preparePokeyTimeline(trace(dense),{sampleRate}),/one output quantum/);
    assert.throws(()=>upload(dense,{sampleRate,sizes:[1,137,19],budget:7}),/one output quantum/);
    const delta=sampleRate===44100?128:117;
    const boundary=pack(Array.from({length:513},(_,index)=>[index<256?0:delta,1,index%256]));
    assert.doesNotThrow(()=>upload(boundary,{sampleRate,sizes:[2,31],budget:1}));
    assert.deepEqual(events(createPokeyChunkTimelineCursor,upload(boundary,{sampleRate,sizes:[1]}),sampleRate),events(createPokeyTimelineCursor,preparePokeyTimeline(trace(boundary),{sampleRate}),sampleRate));
  }
  const same=pack(Array.from({length:513},()=>[0,1,0]));
  assert.throws(()=>upload(same,{sizes:[2]}),/one sample/);
  assert.doesNotThrow(()=>upload(dense,{sizes:[1]}));
});

test('header and append validate only bounded owned buffers and exact byte accounting',()=>{
  for(const value of [null,[],{}, {...header(0),version:2},{...header(0),clock:1},{...header(0),durationSamples:0x100000000},{...header(0),durationSamples:-1},header(-1),header(1.5),header(POKEY_TIMELINE_MAX_BYTES+1)])assert.throws(()=>createPokeyTimelineUpload(value));
  for(const sampleRate of [NaN,Infinity,7999,384001])assert.throws(()=>createPokeyTimelineUpload(header(0),{sampleRate}),/sample rate/);
  const staging=createPokeyTimelineUpload(header(3));
  const buffer=new ArrayBuffer(4);
  const bad=[null,[0,0,0],new Uint8ClampedArray(3),new DataView(buffer),new Uint8Array(buffer,1),new Uint8Array(buffer,0,3),new Uint8Array(),new Uint8Array(POKEY_TIMELINE_CHUNK_BYTES+1)];
  if(typeof SharedArrayBuffer!=='undefined')bad.push(new Uint8Array(new SharedArrayBuffer(3)));
  for(const chunk of bad)assert.throws(()=>staging.append(chunk));
  assert.equal(staging.receivedBytes,0);
  assert.throws(()=>staging.append(new Uint8Array(4)),/declared/);
  const first=Uint8Array.of(0);staging.append(first);
  assert.equal(staging.receivedBytes,1);assert.equal(staging.validatedBytes,0);
  assert.throws(()=>staging.append(Uint8Array.of(0)),/previous chunk/);
  assert.throws(()=>staging.finish(),/incomplete/);
  assert.deepEqual(staging.step(0),{chunkDone:false,complete:false,validatedBytes:0,validatedWrites:0});
  assert.deepEqual(staging.step(1),{chunkDone:true,complete:false,validatedBytes:1,validatedWrites:0});
  const second=Uint8Array.of(0,7);staging.append(second);
  assert.deepEqual(staging.step(1),{chunkDone:true,complete:true,validatedBytes:3,validatedWrites:1});
  assert.throws(()=>staging.append(Uint8Array.of(0)),/declared/);
  const prepared=staging.finish();assert.equal(prepared.chunks[0],first);assert.equal(prepared.chunks[1],second);
  assert.equal(staging.validatedBytes,3);assert.equal(staging.validatedWrites,1);
  assert.throws(()=>staging.append(Uint8Array.of(0)),/finished/);
  assert.throws(()=>staging.finish(),/finished/);
  const empty=upload(new Uint8Array(),{durationSamples:5,sampleRate:48000});
  assert.deepEqual(empty.chunks,[]);assert.deepEqual(events(createPokeyChunkTimelineCursor,empty,48000),{durationFrames:6,events:[]});
});

test('each step bounds completed writes and bytes, including a split five-byte delta',()=>{
  const data=pack(Array.from({length:6000},(_,index)=>[index,1,index%256]));
  const staging=createPokeyTimelineUpload(header(data.byteLength));staging.append(data.slice(0,POKEY_TIMELINE_CHUNK_BYTES));
  assert.throws(()=>staging.step(-1),/budget/);assert.throws(()=>staging.step(Infinity),/budget/);
  let previousBytes=0,previousWrites=0,progress;
  do{
    progress=staging.step(13);
    assert.ok(progress.validatedWrites-previousWrites<=13);
    assert.ok(progress.validatedBytes-previousBytes<=POKEY_TIMELINE_CHUNK_BYTES);
    previousBytes=progress.validatedBytes;previousWrites=progress.validatedWrites;
  }while(!progress.chunkDone);
  assert.equal(progress.validatedBytes,POKEY_TIMELINE_CHUNK_BYTES);assert.equal(progress.complete,false);
  staging.append(data.slice(POKEY_TIMELINE_CHUNK_BYTES));
  progress=staging.step(Number.MAX_SAFE_INTEGER);
  assert.equal(progress.chunkDone,true);assert.equal(progress.complete,true);assert.equal(progress.validatedWrites,6000);staging.finish();
  const longest=Uint8Array.of(255,255,255,255,15,0,9);
  const split=createPokeyTimelineUpload(header(longest.byteLength));
  for(let index=0;index<longest.byteLength;index++){
    split.append(longest.slice(index,index+1));const result=split.step(1);
    assert.equal(result.validatedBytes,index+1);assert.equal(result.validatedWrites,index===6?1:0);assert.equal(result.complete,index===6);
  }
  assert.deepEqual(events(createPokeyChunkTimelineCursor,split.finish(),44100).events,[[0xffffffff,0,9]]);
});

test('the full 8 MiB limit is accepted incrementally without an aggregate buffer',()=>{
  const staging=createPokeyTimelineUpload(header(POKEY_TIMELINE_MAX_BYTES),{sampleRate:48000});
  for(let offset=0;offset<POKEY_TIMELINE_MAX_BYTES;offset+=POKEY_TIMELINE_CHUNK_BYTES){
    const chunk=new Uint8Array(POKEY_TIMELINE_CHUNK_BYTES);chunk.fill(1);
    if(!offset)chunk.set([128,128,1,1,1]);
    staging.append(chunk);let progress,previousBytes=staging.validatedBytes,previousWrites=staging.validatedWrites;
    do{
      progress=staging.step();assert.ok(progress.validatedBytes-previousBytes<=POKEY_TIMELINE_CHUNK_BYTES);
      assert.ok(progress.validatedWrites-previousWrites<=POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM);
      previousBytes=progress.validatedBytes;previousWrites=progress.validatedWrites;
    }while(!progress.chunkDone);
  }
  assert.equal(staging.validatedBytes,POKEY_TIMELINE_MAX_BYTES);
  assert.equal(staging.validatedWrites,(POKEY_TIMELINE_MAX_BYTES-2)/3);
  assert.throws(()=>staging.append(Uint8Array.of(0)),/declared/);
  const prepared=staging.finish();assert.equal(prepared.byteLength,POKEY_TIMELINE_MAX_BYTES);
  assert.equal(prepared.chunks.length,POKEY_TIMELINE_MAX_BYTES/POKEY_TIMELINE_CHUNK_BYTES);
  assert.equal('data' in prepared,false);
});

test('header, finish and cursor never allocate a full trace or render-time typed views',()=>{
  const NativeUint8Array=globalThis.Uint8Array,NativeFloat64Array=globalThis.Float64Array;
  const nativeSlice=Uint8Array.prototype.slice,nativeSubarray=Uint8Array.prototype.subarray,nativeFreeze=Object.freeze;
  const allocations=[],chunks=[Uint8Array.of(128),Uint8Array.of(1,15),Uint8Array.of(3,0,1,7)];
  try{
    globalThis.Uint8Array=new Proxy(NativeUint8Array,{construct(target,args){allocations.push(['u8',args[0]]);return Reflect.construct(target,args);}});
    globalThis.Float64Array=new Proxy(NativeFloat64Array,{construct(target,args){allocations.push(['f64',args[0]]);return Reflect.construct(target,args);}});
    createPokeyTimelineUpload(header(POKEY_TIMELINE_MAX_BYTES),{sampleRate:48000});
    assert.deepEqual(allocations,[['f64',512]]);allocations.length=0;
    const staging=createPokeyTimelineUpload(header(7));
    Uint8Array.prototype.slice=Uint8Array.prototype.subarray=()=>assert.fail('unexpected copied bytes or typed view');
    for(const chunk of chunks){staging.append(chunk);staging.step();}
    Object.freeze=value=>{assert.equal(Array.isArray(value),false,'finish must not freeze/scan all chunk entries');return nativeFreeze(value);};
    const prepared=staging.finish(),cursor=createPokeyChunkTimelineCursor(prepared,48000),result=[];
    cursor.advance(1000,(register,value)=>result.push([register,value]));
    assert.deepEqual(result,[[15,3],[1,7]]);assert.deepEqual(allocations,[]);
    assert.equal(prepared.chunks[0],chunks[0]);assert.equal(prepared.chunks[2],chunks[2]);
  }finally{
    globalThis.Uint8Array=NativeUint8Array;globalThis.Float64Array=NativeFloat64Array;
    Uint8Array.prototype.slice=nativeSlice;Uint8Array.prototype.subarray=nativeSubarray;Object.freeze=nativeFreeze;
  }
});
