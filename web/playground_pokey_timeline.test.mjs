import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyFixture} from '../test/helpers/pokey_worklet_fixture.mjs';
import {Pokey} from './pokey.js';
import {PokeyAudioEngine} from './pokeyaudioengine.js';
import {preparePokeyTimeline,createPokeyTimelineCursor} from './pokey_timeline.js';
import {createPokeyTimelineBuilder} from './pokey_timeline_builder.js';
import factory from '../docs/generated/pokey_wasm.js';
import {readFile} from 'node:fs/promises';
import {createPokeyRegisterClient} from './playground_pokey.js';
const wasmBinary=await readFile(new URL('../docs/generated/pokey_wasm.wasm',import.meta.url));
const makeTrace=(clock=1789790)=>{const builder=createPokeyTimelineBuilder({clock});builder.writeRegister(15,3);builder.writeRegister(0,71);builder.writeRegister(1,0xa8);builder.at(173).writeRegister(0,93);builder.at(371).writeRegister(1,0x6a);builder.at(811).writeRegister(1,0xa0);return builder.finish(1003);};
const makeChunkedTrace=()=>{const builder=createPokeyTimelineBuilder();builder.writeRegister(15,3);builder.writeRegister(0,71);builder.writeRegister(1,0xa8);for(let point=1;point<=6000;point++)builder.at(point*2).writeRegister(0,50+point%75);builder.at(12010).writeRegister(1,0xa0);return builder.finish(12050);};
async function reference(trace,rate){const chip=await Pokey.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock:trace.clock,sampleRate:rate}),speaker=new PokeyAudioEngine(chip,1),cursor=createPokeyTimelineCursor(preparePokeyTimeline(trace),rate),out=new Float32Array(cursor.durationFrames);let frame=0;while(frame<out.length){cursor.advance(frame,(reg,value)=>speaker.writePokey(reg,value));const count=Math.min(out.length-frame,Math.max(1,cursor.nextFrame()-frame));out.set(speaker.generateStereoView(count).left,frame);frame+=count;}chip.dispose();return out;}
for(const rate of [44100,48000])test(`POKEY real WASM timeline matches fresh-core sample boundaries at ${rate} Hz`,async()=>{
  const f=await createPokeyFixture({rate});try{const trace=makeTrace(),expected=await reference(trace,rate);await f.pump(f.client.prepareTimeline(trace));const state=await f.client.getTimelineState(),start=state.currentFrame+256,done=f.client.playTimeline({startFrame:start});assert.equal((await f.client.getTimelineState()).playing,true);const outputStart=state.currentFrame,actual=[];for(let n=0;n<Math.ceil((start-outputStart+expected.length+128)/128);n++)actual.push(...f.render()[0]);const result=await done;assert.equal(result.ended,true);assert.deepEqual(Float32Array.from(actual.slice(start-outputStart,start-outputStart+expected.length)),expected);assert.equal(actual.slice(0,start-outputStart).every(value=>value===0),true);assert.equal(actual.slice(start-outputStart+expected.length).every(value=>value===0),true);}finally{f.close();}
});
for(const rate of [44100,48000])test(`POKEY chunk boundaries preserve fresh-core PCM without new typed-array views at ${rate} Hz`,async()=>{
  const f=await createPokeyFixture({rate});try{
    const trace=makeChunkedTrace(),expected=await reference(trace,rate);await f.pump(f.client.prepareTimeline(trace));assert.equal(f.commands.filter(command=>command.method==='appendTimelineChunk').length,2);
    const state=await f.client.getTimelineState(),start=state.currentFrame+256,done=f.client.playTimeline({startFrame:start}),actual=[],original=Float32Array.prototype.subarray;let views=0;
    Float32Array.prototype.subarray=function(...args){views++;return original.apply(this,args);};try{for(let n=0;n<Math.ceil((256+expected.length+128)/128);n++)actual.push(...f.render()[0]);await done;}finally{Float32Array.prototype.subarray=original;}
    assert.deepEqual(Float32Array.from(actual.slice(256,256+expected.length)),expected);assert.equal(views,0);
  }finally{f.close();}
});
test('POKEY timeline rejects late/busy/manual edits and completion cannot survive Stop',async()=>{
  const f=await createPokeyFixture();try{
    await f.pump(f.client.prepareTimeline(makeTrace()));f.invoke('auditionOn',[0,60,'held']);
    await assert.rejects(f.client.playTimeline({startFrame:512}),/manual audition/);await assert.rejects(f.client.prepareTimeline(makeTrace()),/manual audition/);f.invoke('auditionOff',[0,'held']);
    f.render();await assert.rejects(f.client.playTimeline({startFrame:0}),/late/);
    const done=f.client.playTimeline({startFrame:512});const cancelled=assert.rejects(done,error=>error.name==='AbortError');
    await assert.rejects(f.client.playTimeline({startFrame:512}),/busy/);await assert.rejects(f.client.prepareTimeline(makeTrace()),/busy/);assert.throws(()=>f.invoke('auditionOn',[0,60,'during']),/Stop.*timeline/);
    const authored=f.client._getState();assert.throws(()=>f.client.setNote(0,60),/Stop.*timeline/);assert.deepEqual(f.client._getState(),authored);
    const state=await f.client.stopTimeline();assert.equal(state.cancelled,true);await cancelled;assert.equal(f.render()[0].every(value=>value===0),true);
  }finally{f.close();}
});
test('POKEY timeline future start cancels on owner, replacement, reset, Stop and dispose',async()=>{
  for(const action of ['owner','replace','reset','stop','dispose']){const f=await createPokeyFixture();try{await f.pump(f.client.prepareTimeline(makeTrace()));f.receive({type:'performance-start',session:1});const messages=[],port={postMessage:m=>messages.push(m)};f.processor.receive({performance:{session:1,owner:'import',time:0},commands:[{method:'playTimeline',args:[{startFrame:512}],id:'play'}]},port);assert.equal(f.processor.timelineState().playing,true);
    if(action==='owner')f.receive({type:'performance-cancel-owner',session:1,owner:'import'});if(action==='replace')f.receive({type:'performance-start',session:2});if(action==='reset')f.client.reset();if(action==='stop')f.receive({type:'performance-stop',session:1});if(action==='dispose')f.processor.dispose();
    assert.equal(messages.filter(m=>m.id==='play'&&m.name==='AbortError').length,1,action);assert.equal(f.processor.timelineState().playing,false,action);if(action!=='dispose'){for(let n=0;n<8;n++)assert(f.render()[0].every(v=>v===0));}assert.equal(messages.filter(m=>m.id==='play').length,1,action);
  }finally{f.close();}}
});
test('POKEY dual prepared chips share the same absolute output start frame',async()=>{
  const first=await createPokeyFixture({clock:1789773}),second=await createPokeyFixture({clock:1789773});try{const trace=makeTrace(1789773);await Promise.all([first.pump(first.client.prepareTimeline(trace)),second.pump(second.client.prepareTimeline(trace))]);const start=(await first.client.getTimelineState()).currentFrame+384,done=[first.client.playTimeline({startFrame:start}),second.client.playTimeline({startFrame:start})];for(let n=0;n<14;n++)assert.deepEqual(first.render()[0],second.render()[0]);await Promise.all(done);}finally{first.close();second.close();}
});
test('POKEY monitoring mute survives a delayed fresh-core timeline start',async()=>{
  const f=await createPokeyFixture();try{await f.pump(f.client.prepareTimeline(makeTrace()));await f.client.setChannelMuted(0,true);const done=f.client.playTimeline({startFrame:256});for(let n=0;n<12;n++)assert(f.render()[0].every(value=>value===0));await done;assert.equal(f.processor.speaker.mutedChannels[0],1);}finally{f.close();}
});
test('POKEY prepared timeline segmentation allocates no new typed-array views',async()=>{
  const f=await createPokeyFixture();try{await f.pump(f.client.prepareTimeline(makeTrace()));const done=f.client.playTimeline({startFrame:256}),original=Float32Array.prototype.subarray;let views=0;Float32Array.prototype.subarray=function(...args){views++;return original.apply(this,args);};try{for(let n=0;n<12;n++)f.render();await done;}finally{Float32Array.prototype.subarray=original;}assert.equal(views,0);}finally{f.close();}
});
for(const native of [false,true])test(`POKEY ${native?'Native':'Browser Worker'} asynchronous timeline continuation restores its owner and rejects stopped runs`,async()=>{
  let current={owner:'loop-1'},stopped=false,resolveRequest;const restored=[],calls=[];
  const client=createPokeyRegisterClient(()=>{}, {native,chunkedTimeline:!native,lifecycle:{captureContext:()=>current,isStopped:()=>stopped,restoreContext:context=>{current=context;restored.push(context);}},request:(method,args)=>{calls.push({method,args,context:current});return new Promise(resolve=>{resolveRequest=resolve;});}});
  const nextCall=async count=>{for(let turn=0;calls.length<count&&turn<20;turn++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(calls.length,count);};
  const context=current,prepared=client.prepareTimeline(makeTrace());assert.equal(calls[0].method,native?'prepareTimeline':'beginTimelineUpload');assert.equal(calls[0].context,context);current=null;resolveRequest(native?{loaded:true}:{uploadId:1});
  if(!native){await nextCall(2);assert.equal(calls[1].method,'appendTimelineChunk');assert.equal(calls[1].context,context);current=null;resolveRequest({chunkDone:true});await nextCall(3);assert.equal(calls[2].method,'commitTimelineUpload');assert.equal(calls[2].context,context);current=null;resolveRequest({loaded:true});}
  await prepared;assert.equal(current,context);const resumes=native?1:3;assert.equal(restored.length,resumes);
  const playing=client.playTimeline({startFrame:512});assert.equal(calls[native?1:3].context,context);current=null;stopped=true;resolveRequest({ended:true});await assert.rejects(playing,error=>error.name==='AbortError');assert.equal(restored.length,resumes);client.dispose();
});
