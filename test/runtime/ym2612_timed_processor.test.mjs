import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {readHistoricalYm2612TimedWorklet, YM2612_TIMED_BASE_COMMIT, YM2612_TIMED_WORKLET_PREDECESSORS} from '../helpers/historical_ym2612_timed_source_fixture.mjs';
import vm from 'node:vm';
import {createYm2612} from '../../tetorica_src/runtime/ym2612.js';
import ymfmFactory from '../../tetorica_src/runtime/generated/ym2612_wasm.js';
import nukedFactory from '../../tetorica_src/runtime/generated/nuked_opn2_wasm.js';
import {SegaPSG, SEGAPSG_CLOCK} from '../../tetorica_src/runtime/segapsg.js';
import segaPsgModuleFactory from '../../tetorica_src/runtime/generated/segapsg_wasm.js';
import {YM2612Synth,YM2612WorkletTransport} from '../../tetorica_src/runtime/ym2612synth.js';
import {OpnKeyboardInspector} from '../../tetorica_src/runtime/playground_opn_inspector.js';
import {PsgInspectorState, receiveChipInspector} from '../../tetorica_src/runtime/playground_chip_inspector_state.js';
import {validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';
import {createPerformanceQueue, createPerformanceChipOwnership} from '../../tetorica_src/runtime/playground_performance_queue.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand, createPsgAuditionGuard} from '../../tetorica_src/runtime/playground_audition_guard.js';
import {YM2612DacPlayer, receiveDacCommand} from '../../tetorica_src/runtime/ym2612_dac.js';
import {createChipPortReceiver} from '../../tetorica_src/runtime/playground_chip_port.js';
import {createYm2612TimedProcessor, observeYm2612TimedChip} from '../../tetorica_src/runtime/ym2612_timed_processor.js';
import {buildYm2612Operations, compileYm2612Operations} from '../../tetorica_src/runtime/ym2612_operations.js';

const runtime = new URL('../../tetorica_src/runtime/',import.meta.url);
const parityCases=[], sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources = new Map(), binaries = new Map();
for (const [engine,file,wasm] of [['ymfm','ym2612-worklet.js','ym2612'],['nuked','ym2612-worklet-nuked.js','nuked_opn2']]) {
  sources.set(engine,await readFile(new URL(file,runtime),'utf8'));
  binaries.set(engine,await readFile(new URL(`generated/${wasm}_wasm.wasm`,runtime)));
}

/** Real WASM Worklet, rendered into test-owned arrays. No audio device exists. */
async function setup(engine='ymfm',rate=48000,source=sources.get(engine)) {
  let Processor, frame=0, application, address=0;
  const messages=[],writes=[],accepted=[];
  let ready;const initialized=new Promise(resolve=>ready=resolve);
  const mainPort={postMessage(message){messages.push(message);if(message.type==='ready'||message.type==='error')ready(message);}};
  const context={createYm2612,ym2612ModuleFactory:engine==='nuked'?nukedFactory:ymfmFactory,
    segaPsgModuleFactory,SegaPSG,SEGAPSG_CLOCK,OpnKeyboardInspector,PsgInspectorState,receiveChipInspector,
    validateChipClock,createPerformanceQueue,createPerformanceChipOwnership,createOpnAuditionGuard,receiveOpnAuditionCommand,createPsgAuditionGuard,
    YM2612DacPlayer,receiveDacCommand,createChipPortReceiver,createYm2612TimedProcessor,observeYm2612TimedChip,
    sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port=mainPort;}},
    registerProcessor(_name,Type){Processor=Type;},console};
  Object.defineProperty(context,'currentFrame',{get:()=>frame});
  vm.runInNewContext(source.replace(/^import .*;$/gm,'').replace('export class YM2612Processor','class YM2612Processor'),context);
  const processor=new Processor();
  processor.port.onmessage({data:{type:'initialize',wasmBinary:binaries.get(engine)}});
  assert.equal((await initialized).type,'ready',JSON.stringify(messages));
  processor.ym2612.hooks.onWrite=({offset,data})=>{
    if(!(offset&1))address=((offset&2)<<7)|data;
    else if(address>>8===offset>>1){
      const row={port:address>>8,register:address&255,value:data};accepted.push(row);
      if(application)writes.push({...row,...application});
    }
  };
  if(processor.timed){const apply=processor.timed.apply.bind(processor.timed);processor.timed.apply=(operation,port,eventFrame,metadata)=>{
    application={frame:eventFrame,owner:metadata?.owner};
    try{return apply(operation,port,eventFrame,metadata);}finally{application=null;}
  };}
  let sequence=0;
  const rpc=(payload,metadata)=>{
    const id=++sequence;processor.port.onmessage({data:{id,method:'ym2612Timed',args:[payload],...(metadata?{timedPerformance:metadata}:{})}});
    const result=messages.find(message=>message.id===id);
    assert(result,'Control must be acknowledged without waiting for PCM');
    if(result.error)throw new Error(result.error);return result.value;
  };
  const send=data=>processor.port.onmessage({data});
  const synth=new YM2612Synth({transport:{write:(port,register,value)=>send({type:'write',port,register,value}),
    writeBatch:commands=>send(commands.map(command=>({type:'write',...command}))),reset:()=>send({type:'reset'})}});
  return {processor,synth,messages,writes,accepted,rpc,send,rate,engine,frame:()=>frame,
    state:()=>processor.timedChip.getState(),
    render(count,partition=128){const left=new Float32Array(count),right=new Float32Array(count);
      for(let offset=0;offset<count;){const size=Math.min(partition,count-offset);
        processor.process([],[[left.subarray(offset,offset+size),right.subarray(offset,offset+size)]]);frame+=size;offset+=size;}
      assert(left.every(Number.isFinite));assert(right.every(Number.isFinite));return {left,right};},
    close(){processor.ym2612?.dispose();processor.psg?.dispose();}};
}

for(const engine of ['ymfm','nuked'])for(const rate of [44100,48000])test(`${engine} ${rate}Hz real Worklet keeps exact mixed-time frames, port/order/repeated keys and compile parity`,async()=>{
  const p=await setup(engine,rate);
  try{
    p.synth.setOperator(3,0,{dt:5,multi:2,rs:2,ar:7});
    const program=buildYm2612Operations(b=>{
      b.setOperator(3,0,{multi:7});b.keyOn(3,[0,2]);b.keyOn(3,[0,2]);
      b.atSeconds(.1).setOperator(3,0,{ar:21});
      b.atSample(4410).keyOff(3);
    });
    const snapshot=p.rpc({action:'capture'}), compiled=compileYm2612Operations(program,snapshot);
    const before=structuredClone(p.state());
    assert.deepEqual(p.state(),before);assert.equal(p.frame(),0);
    const receipt=p.rpc({action:'schedule',operations:program,options:{name:'mixed'}});
    assert.equal(receipt.startFrame,128);assert.equal(p.writes.length,0);
    p.render(129+Math.round(rate*.1),113);
    assert.deepEqual(p.writes.map(({port,register,value})=>({port,register,value})),compiled.map(({port,register,value})=>({port,register,value})));
    assert.deepEqual(p.writes.map(row=>row.frame),[128,128,128,128+Math.round(rate*.1),128+Math.round(rate*.1)]);
    assert.equal(p.writes[0].port,1);assert.equal(p.writes[0].value,0x57);
    assert.equal(p.writes[3].value,0x95);assert.deepEqual(p.writes.slice(1,3).map(row=>row.value),[0x54,0x54]);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} partial Operator writes resolve after intervening physical edits and raw shared high latch capture`,async()=>{
  const p=await setup(engine);
  try{
    p.synth.setOperator(0,0,{dt:2,multi:1});
    const program=buildYm2612Operations(b=>b.atSample(100).setOperator(0,0,{multi:7}));
    const before=p.rpc({action:'capture'});
    assert.equal(compileYm2612Operations(program,before)[0].value,0x27);
    const receipt=p.rpc({action:'schedule',operations:program,options:{name:'partial'}});
    p.synth.write(0,0x30,0x61);p.render(receipt.startFrame+200);
    assert.equal(p.writes[0].value,0x67);assert.equal(before.registers[0][0x30],0x21,'Snapshot remains detached');
    // The normal-frequency high latch is shared across ports, and writes to
    // mismatched data ports are ignored by the actual native bus.
    p.processor.ym2612.write(0,0xa4);p.processor.ym2612.write(1,0x2a);
    p.processor.ym2612.write(2,0xa1);p.processor.ym2612.write(1,0x99);p.processor.ym2612.write(3,0x44);
    const snapshot=p.rpc({action:'capture'});
    assert.equal(snapshot.pitches[4],0x2a44);assert.equal(snapshot.registers[0][0xa1],0);
    assert.equal(snapshot.registers[1][0xa1],0x44);
    p.send({type:'reset'});assert.equal(p.rpc({action:'capture'}).pitches[4],0);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} atomic replacement, owner staging and Stop preserve existing reservations until accepted`,async()=>{
  const p=await setup(engine);
  try{
    const old=buildYm2612Operations(b=>b.setOperator(0,0,{tl:17}));
    const next=buildYm2612Operations(b=>b.setOperator(0,0,{tl:31}));
    p.rpc({action:'schedule',operations:old,options:{name:'motion',repeatSeconds:.01},owner:'owner'});
    assert.throws(()=>p.rpc({action:'schedule',operations:buildYm2612Operations(b=>b.setOperator(0,0,{tl:128})),options:{name:'motion',repeatSeconds:.01},owner:'owner'}),/tl/);
    p.rpc({action:'stage',transactionId:'failed',owner:'owner',method:'schedule',args:[next,{name:'motion',repeatSeconds:.01}]});
    p.render(700);assert(p.writes.every(row=>row.value===17));
    p.rpc({action:'abort',transactionId:'failed',owner:'owner'});p.render(500);assert(p.writes.every(row=>row.value===17));
    p.rpc({action:'stage',transactionId:'ok',owner:'owner',method:'schedule',args:[next,{name:'motion',repeatSeconds:.01}]});
    p.rpc({action:'commit',transactionId:'ok',owner:'owner'});
    const count=p.writes.length;p.render(700);assert(p.writes.slice(count).some(row=>row.value===31));assert(!p.writes.slice(count).some(row=>row.value===17));
    p.send({type:'performance-stop',session:p.processor.performanceQueue.getStats().activeSession});
    const stopped=p.writes.length;p.render(1000);assert.equal(p.writes.length,stopped);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} live snapshots include legacy scheduler, DAC and inspector audition; cancelling pattern keeps newer manual key`,async()=>{
  const p=await setup(engine);
  try{
    p.send({type:'schedule-writes',entries:[{time:10/48000,port:1,register:0x40,value:57}]});
    p.send({type:'load-dac-bank',name:'dac',data:Uint8Array.of(0,0,0,0,171).buffer});
    p.send({type:'play-dac-bank',name:'dac',time:10/48000});
    p.render(20);
    const snapshot=p.rpc({action:'capture'});assert.equal(snapshot.registers[1][0x40],57);assert.equal(snapshot.registers[0][0x2a],171);
    const program=buildYm2612Operations(b=>{b.keyOn(0);b.atSeconds(.01).noteOff(0);});
    const receipt=p.rpc({action:'schedule',operations:program,options:{name:'gate'},owner:'code'});
    p.render(receipt.startFrame-p.frame()+1);
    p.processor.opnInspector.invoke('auditionOn',[0,69,'human']);
    assert.equal(p.rpc({action:'capture'}).keyMasks[0],15);
    p.rpc({action:'releaseOwner',owner:'code'});p.render(700);
    assert.equal(p.rpc({action:'capture'}).keyMasks[0],15);
    p.processor.opnInspector.invoke('auditionOff',[0,'human']);assert.equal(p.rpc({action:'capture'}).keyMasks[0],0);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])for(const rate of [44100,48000])test(`${engine} ${rate}Hz default immediate/legacy PCM exactly matches pre-feature Worklet`,async()=>{
  const file=engine==='ymfm'?'ym2612-worklet.js':'ym2612-worklet-nuked.js';
  const baseline=await readHistoricalYm2612TimedWorklet(engine);
  const old=await setup(engine,rate,baseline),current=await setup(engine,rate);
  try{
    for(const p of [old,current]){
      p.synth.reset();p.synth.setAlgo(0,7,2);p.synth.setPan(0,true,true);
      for(let op=0;op<4;op++)p.synth.setOperator(0,op,{multi:op+1,tl:op?50:24,ar:31,d1r:5,d2r:3,sl:7,rr:8});
      p.synth.noteOn(0,'C4');
      p.send({type:'schedule-writes',entries:[{time:.007,port:0,register:0x40,value:30},{time:.01,port:0,register:0x28,value:0}]});
    }
    const a=old.render(2000,113),b=current.render(2000,113);
    assert.deepEqual(b.left,a.left);assert.deepEqual(b.right,a.right);assert.deepEqual(current.accepted,old.accepted);
    parityCases.push({engine,sampleRate:rate,stereoFrames:a.left.length,exactPcmEqual:true,exactTraceEqual:true,
      pcmLeftSha256:sha(Buffer.from(b.left.buffer)),pcmRightSha256:sha(Buffer.from(b.right.buffer)),
      traceWrites:current.accepted.length,traceSha256:sha(JSON.stringify(current.accepted))});
  }finally{old.close();current.close();}
});

async function setupGeneric(file,engine='ymfm',rate=48000) {
  let frame=0,Type,ready,sequence=0;
  const messages=[],writes=[],context={sampleRate:rate,console};
  const initialized=new Promise(resolve=>ready=resolve);
  const port={postMessage(message){messages.push(message);if(message.ready||message.type==='ready'||message.error)ready(message);}};
  context.AudioWorkletProcessor=class{constructor(){this.port=port;}};
  context.registerProcessor=(_name,Processor)=>{Type=Processor;};
  Object.defineProperty(context,'currentFrame',{get:()=>frame});
  const source=(await readFile(new URL(file,runtime),'utf8')).replace(/^import (.+) from ['"]([^'"]+)['"];?$/gm,(_line,binding,specifier)=>{
    writes.push([binding,specifier]);return '';
  });
  for(const [binding,specifier] of writes.splice(0)){
    const imported=await import(new URL(specifier.split('?')[0],runtime));
    if(binding.startsWith('{'))for(const entry of binding.slice(1,-1).split(',')){
      const [exported,local]=entry.trim().split(/\s+as\s+/);context[local??exported]=imported[exported];
    }else context[binding]=imported.default;
  }
  const performance=context.createProcessorPerformance;
  context.createProcessorPerformance=options=>performance({...options,rate,nowFrame:()=>frame});
  vm.runInNewContext(source,context);
  const processor=new Type({processorOptions:{name:'ym2612',engine,wasmBinary:binaries.get(engine),chipOptions:{}}});
  assert((await initialized).ready||messages.at(-1)?.type==='ready',JSON.stringify(messages));
  const apply=processor.timed.apply.bind(processor.timed);
  processor.timed.apply=(operation,port,eventFrame,metadata)=>{
    const old=processor.chip.hooks.onWrite;let address=0;
    processor.chip.hooks.onWrite=event=>{
      old?.(event);if(!(event.offset&1))address=((event.offset&2)<<7)|event.data;
      else if(address>>8===event.offset>>1)writes.push({frame:eventFrame,port:address>>8,register:address&255,value:event.data});
    };
    try{return apply(operation,port,eventFrame,metadata);}finally{processor.chip.hooks.onWrite=old;}
  };
  const send=data=>processor.receive(data,port);
  const rpc=payload=>{const id=++sequence;send({id,method:'ym2612Timed',args:[payload]});const message=messages.find(message=>message.id===id);assert(message);if(message.error)throw new Error(message.error);return message.value;};
  return {processor,messages,writes,send,rpc,render(count){for(let offset=0;offset<count;){const size=Math.min(128,count-offset);processor.process([],[[new Float32Array(size),new Float32Array(size)]]);offset+=size;frame+=size;}},close(){send({method:'dispose'});}};
}

for(const [file,engines] of [['playground_opn_worklet.js',['ymfm','nuked']],['soundchip-output-worklet.js',['ymfm']]])for(const engine of engines)for(const rate of [44100,48000])test(`${file} ${engine} ${rate}Hz resolves the same plan in the generic/npm Worklet`,async()=>{
  const p=await setupGeneric(file,engine,rate);
  try{
    const generic=file==='playground_opn_worklet.js';
    p.send(generic?{method:'write',args:[1,0x30,0x52]}:{method:'writeRegister',args:[0x30,0x52,1]});
    if(!generic)p.send({method:'start'});
    const snapshot=p.rpc({action:'capture'});
    assert.equal(snapshot.registers[1][0x30],0x52);
    const plan=buildYm2612Operations(b=>{b.setOperator(3,0,{multi:11});b.atSeconds(.01).noteOn(3,'E3');b.atSample(882).noteOff(3);});
    const expected=compileYm2612Operations(plan,snapshot);
    const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'generic'}});
    p.render(receipt.startFrame+Math.round(rate*.02)+1);
    assert.deepEqual(p.writes.map(({port,register,value})=>({port,register,value})),expected.map(({port,register,value})=>({port,register,value})));
    assert.equal(p.writes[0].frame,receipt.startFrame);assert.equal(p.writes.at(-1).frame,receipt.startFrame+Math.round(rate*.02));
    assert.equal(p.rpc({action:'capture'}).keyMasks[3],0);
  }finally{p.close();}
});


after(async()=>{
  if(!process.env.YM2612_TIMED_PARITY_REPORT)return;
  assert.equal(parityCases.length,4,'All four actual native-engine/output-rate comparisons are required');
  const sources={};
  for(const name of ['ym2612-worklet.js','ym2612-worklet-nuked.js','playground_opn_worklet.js','soundchip-output-worklet.js',
    'ym2612_timed_processor.js','ym2612_operation_state.js','ym2612_operations.js','ym2612_timed_state.js','ym2612synth.js',
    'playground_audition_guard.js','playground_opn_inspector.js','playground_performance_queue.js','playground_performance_processor.js']){
    const bytes=await readFile(new URL(name,runtime));sources['tetorica_src/runtime/'+name]={bytes:bytes.length,sha256:sha(bytes)};
  }
  const binaries={};for(const name of ['ym2612','nuked_opn2']){
    const bytes=await readFile(new URL(`generated/${name}_wasm.wasm`,runtime));binaries[name]={bytes:bytes.length,sha256:sha(bytes)};
  }
  const report={schemaVersion:1,scope:'ym2612-timed-operation-default-audio-and-register-parity',baseCommit:YM2612_TIMED_BASE_COMMIT,
    deviceOpened:false,reference:'Exact authenticated pre-feature Worklets and unchanged real ymfm/Nuked WASM; default immediate patch/note and legacy scheduler paths',
    sources,binaries,predecessors:Object.fromEntries(Object.entries(YM2612_TIMED_WORKLET_PREDECESSORS).map(([engine,entry])=>[engine,{path:entry.path,before:entry.before,after:entry.after}])),
    cases:parityCases,totalStereoFrames:parityCases.reduce((sum,row)=>sum+row.stereoFrames,0),maximumPcmDifference:0};
  await writeFile(process.env.YM2612_TIMED_PARITY_REPORT,JSON.stringify(report,null,2)+'\n');
});

for(const engine of ['ymfm','nuked'])test(`${engine} expanded register write cost rejects an oversized repeating preset atomically`,async()=>{
  const p=await setup(engine);
  try{
    const tl=buildYm2612Operations(b=>b.setOperator(0,0,{tl:17}));
    p.rpc({action:'schedule',operations:tl,options:{name:'motion',repeatSeconds:.01}});
    const preset={algorithm:4,feedback:2,operators:Array.from({length:4},()=>({dt:0,multi:1,tl:20,rs:0,ar:31,am:false,d1r:10,d2r:5,sl:7,rr:8,ssg:0}))};
    const operations=buildYm2612Operations(b=>b.setPreset(0,preset));
    const weight=compileYm2612Operations(operations,p.rpc({action:'capture'})).length;
    assert(weight>16);
    assert.throws(()=>p.rpc({action:'schedule',operations,options:{name:'motion',repeatSeconds:weight/48001}}),/rate/);
    assert.equal(p.processor.performanceQueue.getStats().storedPatternCommands,1);
    assert.equal(p.processor.performanceQueue.getStats().storedPatternCost,1);
    p.render(1200);assert(p.writes.every(row=>row.register===0x40&&row.value===17));
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} clock-dependent resolution failure retires only its pattern and reports recoverably`,async()=>{
  const p=await setup(engine);
  try{
    p.rpc({action:'schedule',operations:buildYm2612Operations(b=>b.setFrequency(0,.02)),options:{name:'pitch',repeatSeconds:.01}});
    p.rpc({action:'schedule',operations:buildYm2612Operations(b=>b.setOperator(0,0,{tl:17})),options:{name:'level',repeatSeconds:.01}});
    p.send({type:'chip-clock',clock:32000000});p.render(1800);
    const diagnostics=p.messages.filter(message=>message.type==='ym2612-timed-error');
    assert.equal(diagnostics.length,1);assert.match(diagnostics[0].message,/Frequency/);
    assert.equal(p.processor.performanceQueue.getStats().patternCount,1);
    assert(p.writes.some(row=>row.register===0x40));
    assert.equal(p.rpc({action:'capture'}).clock,32000000);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} explicit timed pitch and Key On can claim a held manual voice without stale manual or script releases`,async()=>{
  const p=await setup(engine);
  try{
    p.processor.opnInspector.invoke('auditionOn',[0,60,'manual-old']);
    const plan=buildYm2612Operations(b=>{b.atSample(25).setOperator(0,0,{tl:37,multi:9});b.atSample(50).setBlockFnum(0,5,0x789);b.atSample(100).keyOn(0,[0]);b.atSample(300).noteOff(0);});
    const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'claim'},owner:'code'});
    p.render(receipt.startFrame+Math.round(50*48000/44100)+1);
    assert.equal(p.rpc({action:'capture'}).pitches[0],(5<<11)|0x789,'Explicit timed pitch changes the physically held voice');
    assert.equal(p.processor.opnInspector.registers[0][0x40],37);
    assert.equal(p.processor.opnInspector.registers[0][0x30]&15,9);
    assert.equal(p.processor.opnInspector.registers[0][0xa4],(5<<3)|7);
    assert.equal(p.processor.opnInspector.registers[0][0xa0],0x89);
    assert(p.processor.opnInspector.held.has('fm:0'),'Parameter and pitch edits retain the manual release identity');
    p.render(80);assert.equal(p.rpc({action:'capture'}).keyMasks[0],1,'Explicit timed Key On claims the voice');
    assert.equal(p.processor.opnInspector.registers[0][0x28],0x10);
    assert.equal(p.processor.opnInspector.held.has('fm:0'),false,'Timed Key On retires the old inspector identity');
    p.processor.opnInspector.invoke('auditionOff',[0,'manual-old']);
    assert.equal(p.rpc({action:'capture'}).keyMasks[0],1,'Old manual key-up cannot release the timed replacement');
    p.processor.opnInspector.invoke('auditionOn',[0,67,'manual-new']);
    p.render(500);assert.equal(p.rpc({action:'capture'}).keyMasks[0],15,'Old timed Key Off cannot release a newer manual key');
    p.rpc({action:'releaseOwner',owner:'code'});
    assert.equal(p.rpc({action:'capture'}).keyMasks[0],15,'Owner cancellation preserves the manual replacement');
    p.processor.opnInspector.invoke('auditionOff',[0,'manual-new']);assert.equal(p.rpc({action:'capture'}).keyMasks[0],0);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`additional ${engine} timed edits claim an inspector-held voice and retain stale-Off protection`,async()=>{
  const p=await setupGeneric('playground_opn_worklet.js',engine);
  try{
    p.processor.opnInspector.invoke('auditionOn',[0,60,'old']);
    const operations=buildYm2612Operations(b=>{b.atSample(25).setOperator(0,0,{tl:37,multi:9});b.atSample(50).setBlockFnum(0,5,0x789);b.atSample(100).keyOn(0,[0]);b.atSample(300).noteOff(0);});
    const receipt=p.rpc({action:'schedule',operations,options:{name:'claim'},owner:'code'});
    p.render(receipt.startFrame+Math.round(50*48000/44100)+1);
    assert.equal(p.rpc({action:'capture'}).pitches[0],(5<<11)|0x789);
    assert.equal(p.processor.opnInspector.registers[0][0x40],37);
    assert.equal(p.processor.opnInspector.registers[0][0x30]&15,9);
    assert.equal(p.processor.opnInspector.registers[0][0xa0],0x89);
    assert(p.processor.opnInspector.held.has('fm:0'));
    p.render(80);assert.equal(p.rpc({action:'capture'}).keyMasks[0],1);
    assert.equal(p.processor.opnInspector.held.has('fm:0'),false);
    p.processor.opnInspector.invoke('auditionOff',[0,'old']);assert.equal(p.rpc({action:'capture'}).keyMasks[0],1);
    p.processor.opnInspector.invoke('auditionOn',[0,67,'new']);
    p.render(500);assert.equal(p.rpc({action:'capture'}).keyMasks[0],15);
    p.rpc({action:'releaseOwner',owner:'code'});assert.equal(p.rpc({action:'capture'}).keyMasks[0],15);
    p.processor.opnInspector.invoke('auditionOff',[0,'new']);assert.equal(p.rpc({action:'capture'}).keyMasks[0],0);
  }finally{p.close();}
});

test('npm output timed edits and immediate manual register writes share applied order and Gate ownership',async()=>{
  const p=await setupGeneric('soundchip-output-worklet.js');
  try{
    p.send({method:'start'});p.send({type:'write',port:0,register:0x28,value:0xf0});
    const operations=buildYm2612Operations(b=>{b.atSample(25).setOperator(0,0,{tl:37,multi:9});b.atSample(50).setBlockFnum(0,5,0x789);b.atSample(100).keyOn(0,[0]);b.atSample(300).noteOff(0);});
    const receipt=p.rpc({action:'schedule',operations,options:{name:'claim'},owner:'code'});
    p.render(receipt.startFrame+Math.round(50*48000/44100)+1);
    assert.equal(p.rpc({action:'capture'}).pitches[0],(5<<11)|0x789);
    p.render(80);assert.equal(p.rpc({action:'capture'}).keyMasks[0],1);
    p.send({type:'write',port:0,register:0x28,value:0xf0});
    p.render(500);assert.equal(p.rpc({action:'capture'}).keyMasks[0],15,'Old timed Off cannot release the newer immediate Gate');
    p.rpc({action:'releaseOwner',owner:'code'});assert.equal(p.rpc({action:'capture'}).keyMasks[0],15);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} timed owner release cannot silence a later immediate or other timed Gate`,async()=>{
  const p=await setup(engine);
  try{
    const old=buildYm2612Operations(b=>{b.keyOn(0);b.atSample(100).noteOff(0);});
    const receipt=p.rpc({action:'schedule',operations:old,options:{name:'old'},owner:'old'});
    p.render(receipt.startFrame+1);p.send({type:'write',port:0,register:0x28,value:0x10});
    p.render(200);assert.equal(p.rpc({action:'capture'}).keyMasks[0],1);
    const next=buildYm2612Operations(b=>{b.keyOn(0,[1]);b.atSample(200).noteOff(0);});
    const second=p.rpc({action:'schedule',operations:next,options:{name:'second'},owner:'second'});
    p.render(second.startFrame-p.frame()+1);
    const third=buildYm2612Operations(b=>b.keyOn(0,[2]));
    const thirdReceipt=p.rpc({action:'schedule',operations:third,options:{name:'third'},owner:'third'});
    p.render(thirdReceipt.startFrame-p.frame()+300);
    assert.equal(p.rpc({action:'capture'}).keyMasks[0],4);
    p.rpc({action:'releaseOwner',owner:'second'});assert.equal(p.rpc({action:'capture'}).keyMasks[0],4);
  }finally{p.close();}
});

for(const engine of ['ymfm','nuked'])test(`${engine} Code allNotesOff releases sounding reservations and preserves the next cycle and keyboard`,async()=>{
  const p=await setup(engine,48000);
  try {
    const plan=buildYm2612Operations(b=>{b.keyOn(0,[0]);b.keyOn(1,[1]);});
    const receipt=p.rpc({action:'schedule',operations:plan,options:{name:'pulse',repeatSeconds:.06}});
    p.render(receipt.startFrame+1);assert.deepEqual(p.rpc({action:'capture'}).keyMasks.slice(0,2),[1,2]);
    p.send({type:'audition-note-on',channel:1,token:1,block:4,fnum:700});
    const transport=new YM2612WorkletTransport({postMessage:p.send});
    transport._releaseTimedNotes();assert.deepEqual(p.rpc({action:'capture'}).keyMasks.slice(0,2),[0,15]);
    p.render(receipt.startFrame+2880-p.frame()+1);
    assert.deepEqual(p.rpc({action:'capture'}).keyMasks.slice(0,2),[1,2]);
  }finally{p.close();}
});
