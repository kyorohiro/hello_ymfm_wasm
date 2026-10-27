import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessorPerformance,identifyPerformanceNote,nativeVoiceChannel,performanceNoteRelease} from './playground_performance_processor.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createPokeyRegisterClient} from './playground_pokey.js';

const write=(reg,value)=>({method:'writeRegister',args:[reg,value]});
function setup(){
  let frame=0;const registers=new Uint8Array(16),applied=[],port={postMessage(){}};
  const performance=createProcessorPerformance({chip:'pokey',rate:1000,nowFrame:()=>frame,getPokeyRegisters:()=>registers,apply(command){applied.push(command);if(command.method==='writeRegister')registers[command.args[0]]=command.args[1];if(['keyOff','forceKeyOff'].includes(command.method))registers[command.args[0]*2+1]&=240;}});
  performance.receive({type:'performance-start',session:1},port);
  return {performance,registers,applied,port,enqueue(command,time,owner='loop'){performance.receive({performance:{session:1,owner,time},commands:[command]},port);},render(frames){performance.render(new Float32Array(frames),new Float32Array(frames),(l,r)=>{l.fill(0);r.fill(0);});frame+=frames;}};
}

test('POKEY identifies volume gates independently of distortion and maps physical versus shared registers',()=>{
  for(let ch=0;ch<4;ch++){
    assert.deepEqual(identifyPerformanceNote('pokey',write(ch*2+1,0xa8)),{key:ch,on:true});assert.deepEqual(identifyPerformanceNote('pokey',write(ch*2+1,0xf0)),{key:ch,on:false});assert.equal(identifyPerformanceNote('pokey',write(ch*2,72)),null);
    assert.equal(nativeVoiceChannel('pokey',write(ch*2,72)),ch);assert.equal(nativeVoiceChannel('pokey',write(ch*2+1,0xa8)),ch);assert.deepEqual(performanceNoteRelease('pokey',ch),{method:'forceKeyOff',args:[ch]});
  }
  assert.equal(nativeVoiceChannel('pokey',write(8,0x50)),'all');assert.equal(nativeVoiceChannel('pokey',write(9,0)),'all');assert.equal(nativeVoiceChannel('pokey',write(15,3)),'all');
});

test('POKEY joined upper audition protects both timer halves and shared filters',()=>{
  const p=setup();p.registers[8]=0x50;p.registers[3]=0xa8;p.performance.beginAudition(1,'joined');
  for(const command of [write(0,0),write(1,0),write(2,0),write(3,0),write(8,0)])p.enqueue(command,.001);
  p.enqueue(write(4,48),.001);p.enqueue(write(5,0xa6),.001);p.render(2);assert.deepEqual(p.applied,[write(4,48),write(5,0xa6)]);
  assert.equal(nativeVoiceChannel('pokey',write(0,0),{pokeyRegisters:p.registers}),1);assert.equal(nativeVoiceChannel('pokey',write(4,0),{pokeyRegisters:p.registers}),2);
});

test('POKEY immediate allNotesOff releases sibling voices while preserving held manual key',()=>{
  const p=setup();p.registers[1]=0xa8;p.registers[3]=0xa6;p.performance.beginAudition(0,'manual');
  assert.equal(p.performance.receive({method:'allNotesOff',args:[]},p.port),true);assert.equal(p.registers[1],0xa8);assert.equal(p.registers[3],0xa0);
});

test('POKEY cancelling a loop releases its four-channel gates without cutting a newer owner',()=>{
  const p=setup();p.enqueue(write(1,0xa8),.001,'old');p.enqueue(write(3,0xa6),.001,'old');p.enqueue(write(1,0xaf),.002,'new');p.enqueue(write(1,0xa0),.003,'old');p.render(4);assert.equal(p.registers[1],0xaf);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'old'},p.port);assert.equal(p.registers[3],0xa0);assert.equal(p.registers[1],0xaf);p.performance.receive({type:'performance-cancel-owner',session:1,owner:'new'},p.port);assert.equal(p.registers[1],0xa0);
});

test('POKEY held manual audition blocks its channel and shared clock modes while sibling notes continue',()=>{
  const p=setup();p.registers[1]=0xa8;p.performance.beginAudition(0,'manual');
  for(const command of [write(0,0),write(1,0),write(8,0x50),write(9,0),write(15,0)])p.enqueue(command,.001);
  p.enqueue(write(2,48),.001);p.enqueue(write(3,0xa6),.001);p.render(2);assert.deepEqual(p.applied,[write(2,48),write(3,0xa6)]);assert.equal(p.registers[1],0xa8);
  p.performance.applyImmediate({method:'keyOff',args:[0]},p.port,{owner:'manual'});p.performance.endAudition(0,'manual');assert.equal(p.registers[1],0xa0);assert.equal(p.registers[3],0xa6);
});

// Exercise the actual Main runtime owner adapter without booting browser UI,
// an AudioContext or the rest of the application. Its closures are the runtime
// dependencies; the client and its timeline RPC lifecycle remain real.
const runtimeSource=await readFile(new URL('./playground_runtime.js',import.meta.url),'utf8');
const ownerStart=runtimeSource.indexOf('  function ownPokeyMain(raw) {'),ownerEnd=runtimeSource.indexOf('\n  function wonderSwanExtraApi(',ownerStart);
assert(ownerStart>=0&&ownerEnd>ownerStart);
function mainOwnerFixture({chunkedTimeline=false}={}){
  const runtime=vm.runInNewContext(`(()=>{const wonderSwanMainOwners=new WeakMap();let releasingWonderSwan=false,currentLoopContext=null,currentRunToken=7;const voiceOwner=context=>context?.keyboard?context.keyboardOwner:context;
    ${runtimeSource.slice(ownerStart,ownerEnd)}
    return {ownPokeyMain,setPokeyTimelineLifecycle,setContext(value){currentLoopContext=value;},getContext(){return currentLoopContext;},nextRun(){currentRunToken++;},isReleasing(){return releasingWonderSwan;}};})()`,{DOMException,Promise});
  const calls=[],writes=[],observed=[];let pendingPlay,holdPreparation=false,finishPreparation;
  const client=createPokeyRegisterClient((method,args)=>{writes.push({method,args});if(method==='abortTimelineUpload')calls.push({method,args});},{chunkedTimeline,request(method,args){calls.push({method,args});if(method==='beginTimelineUpload'&&holdPreparation)return new Promise(resolve=>{finishPreparation=resolve;});if(method==='playTimeline')return new Promise((resolve,reject)=>{pendingPlay={resolve,reject};});if(method==='stopTimeline'){pendingPlay?.reject(new DOMException('POKEY timeline cancelled','AbortError'));pendingPlay=null;}return Promise.resolve({loaded:true});}});
  client._observe=event=>observed.push(event.method);const control=runtime.ownPokeyMain(client);client.initialize();
  return {client,control,calls,writes,observed,runtime,async prepare(){await client.prepareTimeline(client.createTimeline().finish(100));},holdPreparation(){holdPreparation=true;},finishPreparation(){finishPreparation?.({});},finish(){pendingPlay?.resolve({ended:true});pendingPlay=null;}};
}

test('POKEY Main owner cancellation aborts pending preparation and retains its prior ready score',async()=>{
 const f=mainOwnerFixture({chunkedTimeline:true}),old={name:'preparing'},other={name:'other'};
 try{
  f.runtime.setPokeyTimelineLifecycle(f.client);await f.prepare();
  const commits=()=>f.calls.filter(call=>call.method==='commitTimelineUpload').length;
  assert.equal(commits(),1);f.runtime.setContext(old);f.holdPreparation();
  const pending=f.prepare(),cancelled=assert.rejects(pending,{name:'AbortError'});
  f.runtime.setContext(other);f.control.releaseOwner(other);
  assert.equal(f.calls.filter(call=>call.method==='abortTimelineUpload').length,0);
  old.stopped=true;f.control.releaseOwner(old);await cancelled;
  assert.equal(f.calls.filter(call=>call.method==='abortTimelineUpload').length,1);
  f.finishPreparation();await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(commits(),1,'late preparation ACK does not commit');
  f.runtime.setContext(other);const playing=f.client.playTimeline();f.finish();await playing;
  assert.equal(f.calls.filter(call=>call.method==='playTimeline').length,1,'previously prepared score remains available');
 }finally{f.client.dispose();}
});
test('POKEY Main timeline cancellation owns one loop and never retires a different owner',async()=>{
  const f=mainOwnerFixture(),old={name:'old'},other={name:'other'};try{await f.prepare();f.runtime.setContext(old);const playing=f.client.playTimeline({startFrame:1024}),cancelled=assert.rejects(playing,error=>error.name==='AbortError');
    assert.equal(f.runtime.ownPokeyMain(f.client),f.control,'adapter installation is idempotent');f.control.releaseOwner(other);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,0);
    old.stopped=true;f.control.releaseOwner(old);f.control.releaseOwner(old);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,1);await cancelled;assert.equal(f.runtime.isReleasing(),false);assert(f.observed.includes('playTimeline'),'previous observer stays connected');
  }finally{f.client.dispose();}
});
test('POKEY Main stopped loops cannot start timelines or rewrite gates, while owner cleanup still releases them',async()=>{
  const f=mainOwnerFixture(),loop={name:'loop'};try{await f.prepare();f.runtime.setContext(loop);f.client.keyOn(0);assert.equal(f.client.getRegisterSnapshot()[1]&15,8);loop.stopped=true;
    assert.throws(()=>f.client.playTimeline({startFrame:1024}),error=>error.name==='AbortError');assert.equal(f.calls.filter(call=>call.method==='playTimeline').length,0);f.client.keyOff(0);assert.equal(f.client.getRegisterSnapshot()[1]&15,8,'stopped finally block cannot alter owned gates');
    f.control.releaseOwner(loop);assert.equal(f.client.getRegisterSnapshot()[1]&15,0,'explicit cleanup bypasses stopped writer guard');assert.equal(f.runtime.isReleasing(),false);
  }finally{f.client.dispose();}
});
test('POKEY Main reset and explicit clear forget timeline owners before later loop cleanup',async()=>{
  for(const action of ['reset','clear']){const f=mainOwnerFixture(),loop={name:action};try{await f.prepare();f.runtime.setContext(loop);const playing=f.client.playTimeline({startFrame:1024});f.finish();await playing;if(action==='reset')f.client.reset();else f.control.clear();f.control.releaseOwner(loop);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,0,action);assert.equal(f.runtime.isReleasing(),false);}finally{f.client.dispose();}}
});
test('POKEY Main replacement timeline belongs to its new loop and keyboard callbacks use their shared voice owner',async()=>{
  const f=mainOwnerFixture(),old={name:'old'},shared={name:'keyboard'},firstKey={keyboard:true,keyboardOwner:shared},secondKey={keyboard:true,keyboardOwner:shared};try{await f.prepare();f.runtime.setContext(old);const first=f.client.playTimeline();f.finish();await first;f.runtime.setContext(firstKey);const replacement=f.client.playTimeline(),cancelled=assert.rejects(replacement,error=>error.name==='AbortError');f.control.releaseOwner(old);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,0);f.runtime.setContext(secondKey);f.control.releaseOwner(shared);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,1);await cancelled;}finally{f.client.dispose();}
});
test('POKEY Browser Main await preparation restores its loop before timeline owner acquisition',async()=>{
  const f=mainOwnerFixture(),original={name:'awaiting'},other={name:'other-loop'};try{
    f.runtime.setPokeyTimelineLifecycle(f.client);f.runtime.setContext(original);const prepared=f.prepare();f.runtime.setContext(other);await prepared;assert.equal(f.runtime.getContext(),original);
    const playing=f.client.playTimeline({startFrame:1024}),cancelled=assert.rejects(playing,error=>error.name==='AbortError');f.runtime.setContext(other);f.control.releaseOwner(other);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,0);
    original.stopped=true;f.control.releaseOwner(original);assert.equal(f.calls.filter(call=>call.method==='stopTimeline').length,1);await cancelled;
  }finally{f.client.dispose();}
});
test('POKEY Browser Main pending asynchronous preparation rejects a stopped or replaced Run',async()=>{
  for(const action of ['loop','run']){const f=mainOwnerFixture(),loop={name:action};try{f.runtime.setPokeyTimelineLifecycle(f.client);f.runtime.setContext(loop);const prepared=f.prepare();if(action==='loop')loop.stopped=true;else f.runtime.nextRun();await assert.rejects(prepared,error=>error.name==='AbortError');assert.equal(f.calls.filter(call=>call.method==='playTimeline').length,0);}finally{f.client.dispose();}}
});
