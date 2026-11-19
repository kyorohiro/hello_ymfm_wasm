import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Huc6280Synth,HUC6280_CLOCK} from '../../tetorica_src/runtime/huc6280synth.js';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';
import factory from '../../tetorica_src/runtime/generated/huc6280_wasm.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {createHuc6280TimedProcessor,huc6280TimedCommandCost} from '../../tetorica_src/runtime/huc6280_timed_processor.js';
import {createHuc6280TimedSnapshot,validateHuc6280TimedSnapshot} from '../../tetorica_src/runtime/huc6280_timed_state.js';
import {buildHuc6280Operations as build,compileHuc6280Operations as compile} from '../../tetorica_src/runtime/huc6280_operations.js';

// Real native rendering through the Worklet's shared queue, into owned arrays.
// No AudioContext, audio device, timers or browser output are used.
async function setup(rate=44100) {
  const core=await Huc6280AudioEngine.create({moduleFactory:factory,clock:HUC6280_CLOCK,outputSampleRate:rate});
  let frame=0,eventFrame=0,timed,serial=0,operationFrame=null;
  const writes=[],messages=[],port={postMessage:message=>messages.push(message)};
  const synth=new Huc6280Synth({transport:{reset:()=>core.reset(),writeRegister(register,value){
    core.writeHuc6280(register,value);writes.push({frame:eventFrame,register,value});
  }}});
  synth.initialize();writes.length=0;
  const performance=createProcessorPerformance({chip:'huc6280',rate,nowFrame:()=>frame,
    getHucChannel:()=>synth._getState().selectedChannel,patternCommandCost:huc6280TimedCommandCost,
    apply(command,p,at,metadata){
      eventFrame=operationFrame??at??frame;
      if(command.method==='applyHuc6280TimedOperation'){
        operationFrame=at;try{return timed.apply(command.operation,p,at,metadata);}finally{operationFrame=null;}
      }
      return synth[command.method](...command.args);
    },
  });
  timed=createHuc6280TimedProcessor({performance,getState:()=>synth._getState(),
    getConfig:()=>({clock:HUC6280_CLOCK,instanceId:'native-test'}),
    nowFrame:()=>frame,sampleRate:rate,
    dispatch:(command,port,_frame,metadata)=>performance.applyImmediate(command,port,metadata),
  });
  return {core,synth,writes,messages,performance,timed,rate,
    request(payload,metadata){const id=++serial;assert.equal(timed.receive({id,method:'huc6280Timed',args:[payload],timedPerformance:metadata},port),true);const reply=messages.find(row=>row.id===id);if(reply.error){const error=Error(reply.error);error.name=reply.name;throw error;}return reply.value;},
    manual(method,args){eventFrame=frame;return performance.applyImmediate({method,args},port);},
    frame:()=>frame,
    render(count,partition=128){
      const result={left:new Float32Array(count),right:new Float32Array(count)};
      for(let offset=0;offset<count;){const n=Math.min(partition,count-offset);
        performance.render(result.left.subarray(offset,offset+n),result.right.subarray(offset,offset+n),(l,r)=>{
          const pcm=core.processFrames(l.length);l.set(pcm.left);r.set(pcm.right);
        });frame+=n;offset+=n;
      }
      assert(result.left.every(Number.isFinite));assert(result.right.every(Number.isFinite));return result;
    },
    stop(){const session=performance.getStats().activeSession;performance.receive({type:'performance-stop',session},port);timed.clear();performance.clear();synth.allNotesOff();},
    close(){performance.clear();timed.clear();core.dispose();},
  };
}

for(const rate of [44100,48000])test(`native ${rate} Hz queue executes mixed offsets and same-frame writes in compile order`,async()=>{
 const p=await setup(rate);try{
 const plan=build(b=>{b.setVolume(0,17).keyOn(0);b.atSeconds(.002).setPan(0,8,9);b.atSample(441).setLfo({frequency:7,depth:1,reset:true}).setLfo({frequency:7,depth:1,reset:true});b.atSeconds(.011).keyOff(0);});
 const compiled=compile(plan,p.synth._getState());
 const receipt=p.request({action:'schedule',operations:plan,options:{name:'mixed'}});
 assert.equal(p.writes.length,0);assert.equal(receipt.startFrame,128);
 const audio=p.render(1000,37);assert(audio.left.some(value=>value!==0));
 assert.deepEqual(p.writes,compiled.map(({offsetSeconds,register,value})=>({frame:128+Math.round(offsetSeconds*rate),register,value})));
 }finally{p.close();}
});

test('partial updates resolve against manual gate/DDA edits made after reservation admission',async()=>{
 const p=await setup();try{
 p.request({action:'schedule',operations:build(b=>b.setVolume(4,8)),options:{name:'partial'}});
 p.manual('setDda',[4,true]);p.manual('keyOn',[4]);p.writes.length=0;p.render(129);
 assert.equal(p.synth._getState().registers[4][4],0xc8);
 assert.equal(p.writes.at(-1).value,0xc8);
 }finally{p.close();}
});

test('admission uses live DDA state and rejects the whole invalid replacement while preserving old pattern',async()=>{
 const p=await setup();try{
 p.manual('setDda',[0,true]);
 p.request({action:'schedule',operations:build(b=>b.writeDda(0,21)),options:{name:'dda',repeatSeconds:.01}});
 const before=p.performance.getStats();
 assert.throws(()=>p.request({action:'schedule',operations:build(b=>b.setVolume(0,33)),options:{name:'dda'}}));
 assert.equal(p.performance.getStats().patterns,before.patterns);
 p.writes.length=0;p.render(700);
 assert.equal(p.writes.filter(row=>row.register===6&&row.value===21).length,2);
 assert.equal(p.messages.filter(row=>row.type==='huc6280-timed-error').length,0);
 }finally{p.close();}
});

test('repeat patterns stay compact, cancel by name, and account for expanded write cost',async()=>{
 const p=await setup();try{
 const plan=build(b=>b.setLfo({frequency:4,depth:2,reset:true}));
 const receipt=p.request({action:'schedule',operations:plan,options:{name:'buzzer',repeatSeconds:1/110}});
 assert.equal(receipt.entries,1);p.render(1800);
 assert.deepEqual(p.writes.filter(row=>row.register===9).map(row=>row.frame),Array.from({length:5},(_,i)=>128+Math.round(i*44100/110)));
 assert.throws(()=>p.request({action:'schedule',operations:plan,options:{name:'buzzer',repeatSeconds:1/10000}}),/rate limit/);
 p.request({action:'clear',name:'buzzer'});p.writes.length=0;p.render(1000);assert.equal(p.writes.length,0);
 }finally{p.close();}
});

test('stage is silent, commit uses a fresh anchor, abort and invalid stage keep current reservations',async()=>{
 const p=await setup();try{
 const old=build(b=>b.setVolume(0,5)),next=build(b=>b.setVolume(0,19));
 p.request({action:'schedule',operations:old,options:{name:'voice',repeatSeconds:.01},owner:'script'});
 p.request({action:'stage',owner:'script',transactionId:1,method:'schedule',args:[next,{name:'voice',repeatSeconds:.01}]});
 assert.throws(()=>p.request({action:'stage',owner:'script',transactionId:1,method:'schedule',args:[build(b=>b.setVolume(0,99)),{name:'other'}]}));
 p.render(300);assert.equal(p.synth._getState().registers[0][4]&31,5);
 const receipt=p.request({action:'commit',owner:'script',transactionId:1});assert.equal(receipt.reservations[0].startFrame,428);
 p.render(200);assert.equal(p.synth._getState().registers[0][4]&31,19);
 p.request({action:'stage',owner:'script',transactionId:2,method:'clearSchedule',args:['voice']});
 p.request({action:'abort',owner:'script',transactionId:2});p.request({action:'commit',owner:'script',transactionId:2});
 p.render(500);assert.equal(p.synth._getState().registers[0][4]&31,19);
 }finally{p.close();}
});

test('detached capture can be reused for comparison without writes, rendering or opening a session',async()=>{
 const p=await setup();try{
 const before=p.synth._getState();p.writes.length=0;
 const snapshot=p.request({action:'capture'});
 assert.equal(p.performance.getStats().activeSession,0);assert.equal(p.frame(),0);assert.deepEqual(snapshot.state,before);assert.equal(p.writes.length,0);
 const copy=validateHuc6280TimedSnapshot(structuredClone(snapshot),{instanceId:'native-test',clock:HUC6280_CLOCK});
 const plan=build(b=>b.setVolume(0,7));const rows=compile(plan,copy.state);
 p.manual('keyOn',[0]);assert.deepEqual(compile(plan,copy.state),rows);assert.deepEqual(snapshot.state,before);
 assert.throws(()=>validateHuc6280TimedSnapshot(snapshot,{instanceId:'other'}),/instance/);
 assert.throws(()=>validateHuc6280TimedSnapshot(snapshot,{clock:4000000}),/clock/);
 assert.throws(()=>createHuc6280TimedSnapshot({...before,indices:[]},{instanceId:'test',frame:0,sampleRate:44100}),/Incomplete/);
 const mutable=structuredClone(snapshot);const owned=validateHuc6280TimedSnapshot(mutable);mutable.state.waveforms[0][0]=31;assert.notEqual(owned.state.waveforms[0][0],31);
 }finally{p.close();}
});

test('old owner releases cannot silence a newer manual gate; owner cancel and Stop retire reservations',async()=>{
 const p=await setup();try{
 p.request({action:'schedule',owner:'old',operations:build(b=>{b.keyOn(0);b.atSeconds(.01).keyOff(0);}),options:{name:'note'}});
 p.render(200);p.manual('writeRegister',[0,0]);p.manual('writeRegister',[4,0x9f]);p.render(500);assert(p.synth._getState().registers[0][4]&128);
 p.request({action:'schedule',owner:'loop',operations:build(b=>b.keyOn(1)),options:{name:'repeat',repeatSeconds:.01}});p.render(200);
 p.request({action:'releaseOwner',owner:'loop'});assert.equal(p.synth._getState().registers[1][4]&128,0);
 const session=p.performance.getStats().activeSession;
 p.request({action:'schedule',operations:build(b=>b.keyOn(2)),options:{name:'stop',repeatSeconds:.01}});
 p.stop();p.writes.length=0;p.render(1000);assert.equal(p.writes.length,0);
 assert.throws(()=>p.request({action:'schedule',operations:build(b=>b.keyOn(0)),options:{name:'stale'}},{session,owner:'old',time:0}),/expired/);
 }finally{p.close();}
});

test('execution-time invalidity retires only the failing reservation and reports a recoverable error',async()=>{
 const p=await setup();try{
 p.manual('setDda',[0,true]);
 p.request({action:'schedule',operations:build(b=>b.writeDda(0,22)),options:{name:'dda',repeatSeconds:.01}});
 p.request({action:'schedule',operations:build(b=>b.setVolume(1,13)),options:{name:'other',repeatSeconds:.01}});
 p.manual('setDda',[0,false]);p.render(700);
 assert.equal(p.messages.filter(row=>row.type==='huc6280-timed-error').length,1);
 assert.equal(p.synth._getState().registers[1][4]&31,13);
 }finally{p.close();}
});

test('canonical timed modules match their browser mirrors',async()=>{
 for(const name of ['huc6280_timed_state.js','huc6280_timed_processor.js','huc6280_timed_client.js'])assert.deepEqual(await readFile(new URL(`../../docs/js/${name}`,import.meta.url)),await readFile(new URL(`../../tetorica_src/runtime/${name}`,import.meta.url)));
});

test('explicit timed parameters update a held manual audition but stale releases leave its gate intact',async()=>{
 const p=await setup();try{
 p.request({action:'schedule',owner:'script',operations:build(b=>{b.keyOn(0);b.atSeconds(.01).setVolume(0,7).keyOff(0);}),options:{name:'manual'}});
 p.render(200);
 p.performance.beginAudition(0,'manual');
 p.performance.applyImmediate({method:'writeRegister',args:[0,0]},null,{owner:'manual'});
 p.performance.applyImmediate({method:'writeRegister',args:[4,0x9f]},null,{owner:'manual'});
 p.render(500);
 assert.equal(p.synth._getState().registers[0][4],0x87);
 }finally{p.close();}
});

test('commit revalidates a staged DDA transaction atomically after a manual mode change',async()=>{
 const p=await setup();try{
 p.manual('setDda',[0,true]);
 p.request({action:'schedule',owner:'script',operations:build(b=>b.setVolume(1,5)),options:{name:'retained',repeatSeconds:.01}});
 p.request({action:'stage',owner:'script',transactionId:1,method:'clearSchedule',args:['retained']});
 p.request({action:'stage',owner:'script',transactionId:1,method:'schedule',args:[build(b=>b.writeDda(0,21)),{name:'dda'}]});
 p.manual('setDda',[0,false]);
 assert.throws(()=>p.request({action:'commit',owner:'script',transactionId:1}));
 p.render(700);assert.equal(p.synth._getState().registers[1][4]&31,5);
 }finally{p.close();}
});
