import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import timing from './synth_pcm_reference_timing.cjs';
const {samplePcmReferenceTiming}=timing;

function fixture(){
  const clock={native:1000,consumed:900},player={dataset:{state:'playing'}};
  Object.defineProperty(player.dataset,'consumedFrames',{get:()=>String(clock.consumed)});
  const world={window:{__pcmManualReference:{current:()=>({id:7,frames:clock.native})}},document:{getElementById:id=>id==='synthSongPlayer'?player:null}};
  let tasks=0;
  const evaluate=async callback=>{
    const value=vm.runInNewContext(`(${callback.toString()})()`,world);
    // Any delay between Playwright RPCs can let the pump and audible cursor
    // advance arbitrarily, even though each generation has only 100 ahead.
    tasks++;clock.native+=7000;clock.consumed+=7000;
    return structuredClone(value);
  };
  return{clock,world,evaluate,get tasks(){return tasks;}};
}

test('separate RPCs reproduce a false negative ahead time while a single task keeps the real bound',async()=>{
  const torn=fixture();
  const oldReference=await torn.evaluate(()=>window.__pcmManualReference.current());
  const laterConsumed=await torn.evaluate(()=>Number(document.getElementById('synthSongPlayer').dataset.consumedFrames));
  assert(oldReference.frames-laterConsumed<0,'the previous two-RPC measurement is demonstrably torn');

  const f=fixture(),sample=await f.evaluate(samplePcmReferenceTiming);
  assert.equal(f.tasks,1);assert.equal(sample.reference.id,7);
  assert.equal(sample.reference.frames,1000);assert.equal(sample.consumedFrames,900);
  assert.equal(sample.playback,'playing');
  const aheadSeconds=(sample.reference.frames-sample.consumedFrames)/1000;
  assert(aheadSeconds>=0&&aheadSeconds<.11,'the original 0..0.11s assertion is meaningful for a coherent observation');
  const next=await f.evaluate(samplePcmReferenceTiming);
  assert.equal(next.reference.frames,8000);assert.equal(next.consumedFrames,7900);
  assert.equal(next.reference.frames-next.consumedFrames,100,'the callback observes each new generation without freezing playback');
});

test('missing or malformed observations fail rather than accepting an invalid timing result',()=>{
  for(const [native,consumed]of[[NaN,900],[1000,NaN],[-1,0],[1000,-1]]){
    const f=fixture();f.clock.native=native;f.clock.consumed=consumed;
    assert.throws(()=>vm.runInNewContext(`(${samplePcmReferenceTiming.toString()})()`,f.world),/incomplete/);
  }
  const f=fixture();f.world.window.__pcmManualReference.current=()=>null;
  assert.throws(()=>vm.runInNewContext(`(${samplePcmReferenceTiming.toString()})()`,f.world),/incomplete/);
});

const {createPcmReferenceTools,pcmCaptureWorkletSource,renderPcmScheduledWindow}=timing;
const tools=createPcmReferenceTools();

test('gap-aligned calibration retains the original bounds and rejects doubled output gain',()=>{
  const native=Float32Array.from({length:8192},(_,i)=>Math.sin(i*.073)*.1);
  const heard=native.map((v,i)=>i>=3000&&i<7000?0:v),expected=tools.stereo(heard,heard);
  const initial={actual:tools.stereo(heard,heard),expected};
  assert(Math.abs(initial.actual.acRms/tools.stereo(native,native).acRms-1)>.15,'the old unrelated native window is a reproducible false failure');
  assert.deepEqual(tools.calibratedPair(initial,{actual:tools.stereo(heard.map(v=>v*.5),heard.map(v=>v*.5)),expected}),{initialGain:1,halfGain:.5,masterGainRatio:.5});
  assert.throws(()=>tools.calibratedPair({actual:tools.stereo(heard.map(v=>v*2),heard.map(v=>v*2)),expected}),/RMS differs/);
  assert.throws(()=>tools.calibratedPair(initial,{actual:initial.actual,expected}),/half-volume gain/);
  assert.throws(()=>tools.calibratedPair({actual:tools.stereo(heard.map(v=>v+.25),heard.map(v=>v+.25)),expected}),/peak exceeds/);
  assert.deepEqual(tools.verifyCaptureRouting([{kind:'instrument',input:0},{kind:'pilot',input:1}]),{instrumentInput:0,pilotInput:1,zeroOutput:true});
  assert.throws(()=>tools.verifyCaptureRouting([{kind:'instrument',input:0},{kind:'pilot',input:0}]),/Pilot must reach only/);
});

test('scheduled PCM must match every native source sample and preserve the complete prefix',()=>{
  const native={firstFrame:0,sampleRate:1000,left:Float32Array.from({length:32},(_,i)=>i/64),right:Float32Array.from({length:32},(_,i)=>-i/64)};
  assert.deepEqual(tools.verifyNativePcm(native.left.slice(8,16),native.right.slice(8,16),8,native,1000),{firstFrame:8,endFrame:16,verifiedSamples:16});
  assert.throws(()=>tools.verifyNativePcm(native.left.slice(8,16).map(v=>v*2),native.right.slice(8,16),8,native,1000),/differs from native/);
  assert.throws(()=>tools.verifyNativePcm(native.left.slice(9,17),native.right.slice(9,17),8,native,1000),/differs from native/);
  assert.throws(()=>tools.verifyNativePcm(native.left.slice(8,16),native.right.slice(8,16),8,native,2000),/rate differs/);
  const records=[{when:.01,contextTime:0,offset:0,frames:8,sampleRate:1000,sourceFirstFrame:0,verifiedSamples:16},{when:.04,contextTime:.03,offset:0,frames:8,sampleRate:1000,sourceFirstFrame:8,verifiedSamples:16}];
  const summary=tools.scheduleSummary(records);assert.equal(summary.frames,16);assert.equal(summary.verifiedSamples,32);assert(Math.abs(summary.gapSeconds-.022)<1e-12);
  assert.throws(()=>tools.scheduleSummary([records[0],{...records[1],when:.015,contextTime:.01}]),/overlap/);
  assert.throws(()=>tools.scheduleSummary([records[0],{...records[1],sourceFirstFrame:9}]),/missing or repeated/);
  assert.throws(()=>tools.scheduleSummary([{...records[0],when:-.01}]),/past/);
});

test('the capture uses independent pilot PCM while retaining raw clock errors and emitting silence',()=>{
  let Capture;const messages=[];
  class Processor{constructor(){this.port={postMessage:data=>messages.push(data)};}}
  const world={AudioWorkletProcessor:Processor,registerProcessor:(name,ctor)=>{assert.equal(name,'pcm-check-capture');Capture=ctor;},Float32Array,currentFrame:0};
  vm.runInNewContext(pcmCaptureWorkletSource(),world);const capture=new Capture({processorOptions:tools.pilotConfig});capture.port.onmessage({data:{type:'pilot',firstFrame:0,frames:20000}});capture.port.onmessage({data:{token:4,afterFrame:2048}});
  for(let frame=0;frame<10368;frame+=128){world.currentFrame=frame-(frame===2560?128:0);const left=Float32Array.from({length:128},(_,i)=>(frame+i)/20000),right=left.map(v=>-v),outputs=[[new Float32Array(128).fill(1),new Float32Array(128).fill(1)]];const pilot=Float32Array.from({length:128},(_,i)=>(tools.pilotConfig.base+frame+i)/tools.pilotConfig.period);capture.process([[left,right],[pilot]],outputs);assert(outputs[0].every(channel=>channel.every(v=>v===0)));}
  assert.equal(messages.length,1);const message=messages[0];assert.equal(message.firstFrame,2048);assert.equal(message.endFrame,10240);assert.equal(message.token,4);const clock=tools.verifyCaptureClock(message);assert.equal(clock.pilotContinuous,true);assert.equal(clock.rawClockContinuous,false);assert.equal(clock.observedClockAnomalies.length,2);
  const brokenPilot=message.pilot.slice();brokenPilot[10]=brokenPilot[9];assert.throws(()=>tools.verifyCaptureClock({...message,pilot:brokenPilot}),/pilot PCM is missing or repeated/);
  assert.throws(()=>tools.verifyCaptureClock({...message,quanta:message.quanta.map((q,i)=>({...q,ordinal:q.ordinal-(i===1?1:0)}))}),/callback\/pilot input sequence/);
  assert.deepEqual(message.left,Float32Array.from({length:8192},(_,i)=>(i+2048)/20000));
  assert.deepEqual(message.right,message.left.map(v=>-v));
});

test('the real expected-window renderer keeps clipped offsets, future sources and silent gaps',async()=>{
  class Offline {
    constructor(channels,frames,rate){this.frames=frames;this.rate=rate;this.nodes=[];this.destination={};}
    createBufferSource(){const owner=this;return{connect(){},start(when,offset){owner.nodes.push({buffer:this.buffer,when,offset});}};}
    async startRendering(){const pcm=[new Float32Array(this.frames),new Float32Array(this.frames)];for(const node of this.nodes)for(let frame=0;frame<this.frames;frame++){const sourceFrame=Math.round((frame/this.rate-node.when+node.offset)*this.rate);if(frame/this.rate>=node.when&&sourceFrame>=0&&sourceFrame<node.buffer.length)for(let ch=0;ch<2;ch++)pcm[ch][frame]+=node.buffer.getChannelData(ch)[sourceFrame];}return{getChannelData:ch=>pcm[ch]};}
  }
  const buffer=values=>({length:values.length,getChannelData:()=>Float32Array.from(values)});
  const records=[{when:0,offset:0,frames:8,sampleRate:1000,buffer:buffer([1,2,3,4,5,6,7,8])},{when:.012,offset:0,frames:4,sampleRate:1000,buffer:buffer([9,10,11,12])},{when:.1,offset:0,frames:4,sampleRate:1000,buffer:buffer([99,99,99,99])}];
  const rendered=await renderPcmScheduledWindow(records,{sampleRate:1000,firstFrame:4,endFrame:16},Offline);
  assert.deepEqual([...rendered.getChannelData(0)],[5,6,7,8,0,0,0,0,9,10,11,12]);
});

test('the actual reference graph determines its meter without selecting an audible result',()=>{
  const source={},master={},author={},unused={},destination={},connections=new WeakMap([[source,new Set([master])],[master,new Set([destination])],[author,new Set([unused])],[unused,new Set([destination])]]);
  const referenceMeter={source:master,destination},authorMeter={source:unused,destination};
  assert.deepEqual(tools.outputMeters(source,[authorMeter,referenceMeter],connections),[referenceMeter]);
  assert.deepEqual(tools.outputMeters(author,[authorMeter,referenceMeter],connections),[authorMeter]);
  assert.throws(()=>tools.outputMeters(null,[authorMeter,referenceMeter],connections),/No verified reference source/);
  const ended={};assert.deepEqual(tools.referenceOutput([{source,sourceFirstFrame:0},{source:ended,sourceFirstFrame:8}],[authorMeter,referenceMeter],connections),{meters:[referenceMeter],sourceFirstFrame:0});
  connections.delete(master);assert.deepEqual(tools.outputMeters(source,[referenceMeter],connections),[],'a disconnected final route is not live');
  connections.delete(source);assert.throws(()=>tools.referenceOutput([{source,sourceFirstFrame:0}],[referenceMeter],connections),/No live verified/);
});
