import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundCodeRuntime} from '../../tetorica_src/runtime/playground_code_runtime.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function until(predicate) {
  for(let turn=0;turn<300;turn++){if(predicate())return;await Promise.resolve();}
  assert(predicate(),'expected asynchronous runtime progress');
}

// The fake models one chip's atomic manifest transaction and cancellation fence.
// No audio device, worker or physical speaker is opened by these lifecycle tests.
function chipFixture() {
  const events=[],patterns=new Map(),transactions=new Map(),cancelled=new Set();
  let failStage=false,failCommit=false,stageGate=null,cleanupGate=null;
  const key=(transaction,owner)=>`${transaction}|${owner}`;
  const checkOwner=owner=>{assert.equal(typeof owner,'string');assert(owner.length>0&&owner.length<=256);if(cancelled.has(owner))throw new DOMException('Run stopped','AbortError');};
  const capability={
    async stage(transaction,owner,method,args){
      checkOwner(owner);events.push(['stage',transaction,owner,method,structuredClone(args)]);
      if(failStage)throw Error('Invalid timed operation');
      const id=key(transaction,owner);if(!transactions.has(id))transactions.set(id,new Map());
      if(method==='schedule')transactions.get(id).set(args[1].name,{operations:structuredClone(args[0]),owner});
      else if(method==='clearSchedule')transactions.get(id).set(args[0],null);
      else throw Error('Unexpected transaction method');
      if(stageGate)await stageGate.promise;
      checkOwner(owner);return {accepted:true};
    },
    async commit(transaction,owner){
      checkOwner(owner);events.push(['commit',transaction,owner]);
      if(failCommit)throw Error('Commit rejected');
      const id=key(transaction,owner),staged=transactions.get(id)??new Map();
      for(const [name,pattern]of patterns)if(pattern.owner===owner)patterns.delete(name);
      for(const [name,pattern]of staged)if(pattern)patterns.set(name,pattern);
      transactions.delete(id);return {accepted:true};
    },
    async abort(transaction,owner){events.push(['abort',transaction,owner]);transactions.delete(key(transaction,owner));if(cleanupGate)await cleanupGate.promise;},
    async schedule(operations,options,{owner}){checkOwner(owner);events.push(['schedule',owner,structuredClone(operations),structuredClone(options)]);patterns.set(options.name,{operations:structuredClone(operations),owner});return {accepted:true};},
    async clearSchedule(name,{owner}){checkOwner(owner);events.push(['clear',owner,name]);if(patterns.get(name)?.owner===owner)patterns.delete(name);return {accepted:true};},
    async cancelOwner(owner){events.push(['cancel',owner]);cancelled.add(owner);for(const [name,pattern]of patterns)if(pattern.owner===owner)patterns.delete(name);if(cleanupGate)await cleanupGate.promise;},
  };
  const client={chip:'ay8910',clock:2000000,_timedOperations:capability,
    schedule(){throw Error('Unscoped schedule bypassed lifecycle');},clearSchedule(){throw Error('Unscoped clear bypassed lifecycle');},
    noteOn(...args){events.push(['noteOn',...args]);},noteOff(...args){events.push(['noteOff',...args]);}};
  return {client,capability,events,patterns,transactions,setFailStage:value=>{failStage=value;},setFailCommit:value=>{failCommit=value;},setStageGate:value=>{stageGate=value;},setCleanupGate:value=>{cleanupGate=value;}};
}
function runtimeFixture(chip=chipFixture()) {
  const reads=[],logs=[],physical=[];
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,useSoundChip:async()=>chip.client,
    supportedSoundChips:['ay8910'],guardExecution:false,createTaskChannel:()=>null,
    readFile(path){const task=deferred();reads.push({path,...task});return task.promise;},
    onLog:line=>logs.push(line),beforeStopSoundChips:async()=>physical.push('fade'),stopSoundChips:async()=>physical.push('stop')});
  return {...chip,runtime,reads,logs,physical};
}
const stageSource=(value=1,name='buzzer')=>`const ym = await useSoundChip("ay8910"); await ym.schedule([{value:${value}}], {name:${JSON.stringify(name)}, repeatSeconds:0.01});`;

test('entry scheduling stays staged until evaluation completes; only successful Apply changes its manifest',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  const pending=f.runtime.run(`${stageSource()} await file("/ready");`);
  await until(()=>f.reads.length===1);
  assert.equal(f.patterns.size,0,'accepted staging cannot play before entry success');
  assert.equal(f.transactions.size,1);
  f.reads[0].resolve('ready');await pending;
  assert.deepEqual(f.patterns.get('buzzer').operations,[{value:1}]);
  const original=f.patterns.get('buzzer'),owner=original.owner;
  await assert.rejects(f.runtime.apply(`${stageSource(2)} throw Error("bad Apply");`),/bad Apply/);
  assert.equal(f.patterns.get('buzzer'),original,'failed Apply retains the prior live pattern');
  assert.equal(f.transactions.size,0,'failed evaluation aborts staged data');
  await f.runtime.apply(stageSource(3));
  assert.deepEqual(f.patterns.get('buzzer').operations,[{value:3}]);
  assert.equal(f.patterns.get('buzzer').owner,owner,'entry owner survives Apply');
  await f.runtime.apply('context.updated = true;');
  assert.equal(f.patterns.size,0,'successful empty Apply removes omitted entry names without using the client');
  assert(f.events.some(event=>event[0]==='commit'&&event[2]===owner));
});

test('unawaited stage validation failures still reject Apply and never produce a partial manifest',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());await f.runtime.run(stageSource());
  const original=f.patterns.get('buzzer');f.setFailStage(true);
  await assert.rejects(f.runtime.apply('const ym=await useSoundChip("ay8910"); ym.schedule([], {name:"buzzer"});'),/Invalid timed operation/);
  assert.equal(f.patterns.get('buzzer'),original);
  assert.equal(f.transactions.size,0);
});

test('staged clear waits for successful Apply and retained context clients join the new transaction',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  await f.runtime.run('context.ym=await useSoundChip("ay8910"); await context.ym.schedule([1], {name:"a"}); await context.ym.schedule([2], {name:"b"});');
  const old=f.patterns.get('a');
  await assert.rejects(f.runtime.apply('await context.ym.clearSchedule("a"); throw Error("rollback");'),/rollback/);
  assert.equal(f.patterns.get('a'),old);assert(f.patterns.has('b'));
  const pending=f.runtime.apply('await context.ym.clearSchedule("a"); await context.ym.schedule([3], {name:"b"}); await file("/ready");');
  await until(()=>f.reads.length===1);assert(f.patterns.has('a'));
  f.reads[0].resolve();await pending;
  assert.equal(f.patterns.has('a'),false);assert.deepEqual(f.patterns.get('b').operations,[3]);
  const stages=f.events.filter(event=>event[0]==='stage');
  assert.notEqual(stages[0][1],stages.at(-1)[1],'retained proxy uses the current evaluation transaction');
});

test('a rejected commit keeps the old pattern and retires the staging transaction',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());await f.runtime.run(stageSource());
  const old=f.patterns.get('buzzer');f.setFailCommit(true);
  await assert.rejects(f.runtime.apply(stageSource(2)),/Commit rejected/);
  assert.equal(f.patterns.get('buzzer'),old);assert.equal(f.transactions.size,0);
});

test('liveLoop reservations use a stable loop owner across Apply and are cancelled when removed',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  await f.runtime.run('context.ym=await useSoundChip("ay8910"); liveLoop("tone", async()=>{await context.ym.schedule([1], {name:"loop"}); await file("/cycle");});');
  await until(()=>f.reads.length===1);const first=f.events.find(event=>event[0]==='schedule'),loopOwner=first[1];
  assert.equal(f.events.filter(event=>event[0]==='stage').length,0,'loop callback updates an accepted pattern directly');
  await f.runtime.apply('liveLoop("tone", async()=>{await context.ym.schedule([2], {name:"loop"}); await file("/cycle");});');
  f.reads[0].resolve();await until(()=>f.reads.length===2);
  const scheduled=f.events.filter(event=>event[0]==='schedule');
  assert.equal(scheduled[1][1],loopOwner);assert.deepEqual(f.patterns.get('loop').operations,[2]);
  await f.runtime.apply('context.removed = true;');
  assert.equal(f.patterns.has('loop'),false);assert(f.events.some(event=>event[0]==='cancel'&&event[1]===loopOwner));
});

test('a removed loop finally cannot clear a newer entry-owned replacement',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  await f.runtime.run('context.ym=await useSoundChip("ay8910"); liveLoop("old",async()=>{await context.ym.schedule([1], {name:"shared"});try{await file("/hold");}finally{await context.ym.clearSchedule("shared");}});');
  await until(()=>f.reads.length===1);const oldOwner=f.patterns.get('shared').owner;
  await f.runtime.apply('await context.ym.schedule([9], {name:"shared"});');
  await until(()=>f.events.some(event=>event[0]==='cancel'&&event[1]===oldOwner));
  for(let turn=0;turn<20;turn++)await Promise.resolve();
  assert(f.patterns.has('shared'),JSON.stringify(f.events));
  assert.deepEqual(f.patterns.get('shared').operations,[9]);
  assert.notEqual(f.patterns.get('shared').owner,oldOwner);
  assert.equal(f.events.filter(event=>event[0]==='clear').length,0,'old finally is fenced before capability dispatch');
});

test('Stop aborts pending staging and observes hung cleanup acknowledgements without waiting for them',async()=>{
  const f=runtimeFixture(),stage=deferred(),cleanup=deferred();f.setStageGate(stage);f.setCleanupGate(cleanup);
  const run=f.runtime.run(stageSource()).then(()=>null,error=>error);
  await until(()=>f.events.some(event=>event[0]==='stage'));
  await f.runtime.stop();
  assert.equal((await run).name,'AbortError');assert.deepEqual(f.physical,['fade','stop','fade','stop']);
  assert(f.events.some(event=>event[0]==='abort'));assert(f.events.some(event=>event[0]==='cancel'));
  stage.resolve();cleanup.resolve();for(let turn=0;turn<20;turn++)await Promise.resolve();
  assert.equal(f.patterns.size,0);assert.equal(f.transactions.size,0);
});

test('a superseded Apply cannot commit after the newer transaction has replaced its pattern',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());await f.runtime.run(stageSource());
  const gate=deferred();f.setStageGate(gate);
  const superseded=f.runtime.apply(stageSource(2)).then(()=>null,error=>error);
  await until(()=>f.events.filter(event=>event[0]==='stage').length===2);
  f.setStageGate(null);await f.runtime.apply(stageSource(3));
  assert.equal((await superseded).name,'AbortError');
  gate.resolve();for(let turn=0;turn<20;turn++)await Promise.resolve();
  assert.deepEqual(f.patterns.get('buzzer').operations,[{value:3}]);
  assert.equal(f.transactions.size,0);
});

test('a retained client pending ACK belongs to the Apply that issued it',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  await f.runtime.run('context.ym=await useSoundChip("ay8910");await context.ym.schedule([1], {name:"buzzer"});');
  const gate=deferred();f.setStageGate(gate);
  const superseded=f.runtime.apply('await context.ym.schedule([2], {name:"buzzer"});context.lateContinuation=true;').then(()=>null,error=>error);
  await until(()=>f.events.filter(event=>event[0]==='stage').length===2);
  f.setStageGate(null);await f.runtime.apply('await context.ym.schedule([3], {name:"buzzer"});');
  assert.equal((await superseded).name,'AbortError');gate.resolve();for(let turn=0;turn<20;turn++)await Promise.resolve();
  assert.equal(f.runtime.getContext().lateContinuation,undefined);
  assert.deepEqual(f.patterns.get('buzzer').operations,[3]);
});

test('detached entry callbacks cannot mutate the newer completed entry manifest',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  await f.runtime.run('context.ym=await useSoundChip("ay8910");await context.ym.schedule([1],{name:"shared"});file("/detached").finally(async()=>{await context.ym.clearSchedule("shared");}).catch(error=>{context.lateError=error.name;context.lateMessage=error.message;});');
  await f.runtime.apply('await context.ym.schedule([9],{name:"shared"});');
  f.reads[0].reject(Error('late detached completion'));
  await until(()=>f.runtime.getContext().lateError!==undefined);
  assert.equal(f.runtime.getContext().lateError,'AbortError');
  assert.match(f.runtime.getContext().lateMessage,/active entry evaluation or liveLoop/);
  assert.deepEqual(f.patterns.get('shared').operations,[9]);assert.equal(f.events.filter(event=>event[0]==='clear').length,0);
});

test('a loop body waiting forever does not retain execution guards or block Stop',async(t)=>{
  const chip=chipFixture(),originalFetch=()=>{},realm={fetch:originalFetch};
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,useSoundChip:async()=>chip.client,
    supportedSoundChips:['ay8910'],realm,guardExecution:true});
  t.after(()=>runtime.stop());
  await runtime.run('liveLoop("held", async()=>{const ym=await useSoundChip("ay8910");await ym.schedule([1], {name:"held"});await new Promise(()=>{});});');
  await until(()=>chip.patterns.has('held'));assert.notEqual(realm.fetch,originalFetch);
  await runtime.stop();for(let turn=0;turn<20;turn++)await Promise.resolve();
  assert.equal(realm.fetch,originalFetch);assert.equal(chip.patterns.size,0);
});

test('Run and separate runtimes use bounded distinct owners and Stop never cancels a sibling',async(t)=>{
  const chip=chipFixture(),a=runtimeFixture(chip),b=runtimeFixture(chip);t.after(async()=>{await a.runtime.stop();await b.runtime.stop();});
  await a.runtime.run(stageSource(1,'a'));await b.runtime.run(stageSource(2,'b'));
  const first=chip.patterns.get('a').owner,sibling=chip.patterns.get('b').owner;
  assert.notEqual(first,sibling);assert(first.length<=256&&sibling.length<=256);
  await a.runtime.stop();assert.equal(chip.patterns.has('a'),false);assert.equal(chip.patterns.get('b').owner,sibling);
  await a.runtime.run(stageSource(3,'a'));assert.notEqual(chip.patterns.get('a').owner,first);assert.equal(chip.patterns.get('b').owner,sibling);
});

test('the private capability stays hidden and unrelated custom schedule methods retain their behavior',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  await f.runtime.run('const ym=await useSoundChip("ay8910"); context.hidden=ym._timedOperations; ym.noteOn(CH1,"C4");');
  assert.equal(f.runtime.getContext().hidden,undefined);assert(f.events.some(event=>event[0]==='noteOn'&&event[1]===0));
  const calls=[],client={schedule(...args){calls.push(args);return 12;}};
  const plain=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,useSoundChip:async()=>client,supportedSoundChips:['ay8910'],guardExecution:false});
  t.after(()=>plain.stop());await plain.run('const chip=await useSoundChip("ay8910"); context.result=chip.schedule("plain");');
  assert.deepEqual(calls,[['plain']]);assert.equal(plain.getContext().result,12);
});

test('frozen timed plans, snapshots, traces and admission receipts remain plain detached data',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  const plan=Object.freeze({operations:Object.freeze([Object.freeze({args:Object.freeze([7])})])});
  const snapshot=Object.freeze({configuration:Object.freeze({clock:2000000})});
  const rows=Object.freeze([Object.freeze({register:7,value:56})]);
  const receipt=Object.freeze({info:Object.freeze({accepted:true})});
  f.client.build=()=>plan;f.client.captureState=async()=>snapshot;
  f.client.compile=async(operations,options)=>{assert.equal(operations,plan);assert.equal(options.initialState,snapshot);return rows;};
  const stage=f.capability.stage.bind(f.capability);
  f.capability.stage=async(...args)=>{await stage(...args);return receipt;};
  await f.runtime.run('const ym=await useSoundChip("ay8910"); const ops=ym.build(()=>{});context.arg=ops.operations[0].args[0]; const snapshot=await ym.captureState();context.clock=snapshot.configuration.clock; const rows=await ym.compile(ops,{initialState:snapshot});context.register=rows[0].register; const receipt=await ym.schedule(ops,{name:"frozen"});context.accepted=receipt.info.accepted; context.plan=ops; context.rows=rows; context.snapshot=snapshot;');
  assert.equal(f.runtime.getContext().arg,7);assert.equal(f.runtime.getContext().clock,2000000);
  assert.equal(f.runtime.getContext().register,7);assert.equal(f.runtime.getContext().accepted,true);
  assert.equal(f.runtime.getContext().plan,plan);assert.equal(f.runtime.getContext().rows,rows);assert.equal(f.runtime.getContext().snapshot,snapshot);
});

test('timed runtime errors are logged for the owning Code Run and listeners retire on Stop',async(t)=>{
  const f=runtimeFixture(),listeners=new Set();t.after(()=>f.runtime.stop());
  f.capability.onError=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
  await f.runtime.run(stageSource());const owner=f.patterns.get('buzzer').owner;
  const oldListener=[...listeners][0];oldListener({owner,message:'timed operation failed'});oldListener({owner:'other-run',message:'foreign error'});
  assert(f.logs.some(line=>line.includes('timed operation failed')));assert(!f.logs.some(line=>line.includes('foreign error')));
  await f.runtime.stop();assert.equal(listeners.size,0);
  await f.runtime.run(stageSource(2));const before=f.logs.length;oldListener({owner,message:'retired notification'});assert.equal(f.logs.length,before);
  assert.equal(listeners.size,1);
});

test('a loop exiting after a tracked rejection releases its accepted recurring pattern',async(t)=>{
  const f=runtimeFixture();t.after(()=>f.runtime.stop());
  f.capability.releaseOwner=async owner=>{f.events.push(['release',owner]);return f.capability.cancelOwner(owner);};
  await f.runtime.run('const ym=await useSoundChip("ay8910");liveLoop("failed",async()=>{await ym.schedule([1],{name:"loop"});trackAsync(Promise.reject(Error("tracked failure")));await file("/wait");});');
  await until(()=>f.events.some(event=>event[0]==='schedule'));
  await until(()=>f.reads.length===1);f.reads[0].resolve();
  await until(()=>f.events.some(event=>event[0]==='cancel'));
  assert.equal(f.patterns.size,0);
  assert.equal(f.events.filter(event=>event[0]==='release').length,1);
});

test('loop removal uses optional full owner release while global Stop stays future-only before fade',async(t)=>{
  const removed=runtimeFixture(),stopped=runtimeFixture();t.after(async()=>{await removed.runtime.stop();await stopped.runtime.stop();});
  for(const f of [removed,stopped])f.capability.releaseOwner=async owner=>{f.events.push(['release',owner]);return f.capability.cancelOwner(owner);};
  const source='const ym=await useSoundChip("ay8910");liveLoop("gate",async()=>{await ym.schedule([1],{name:"gate"});await file("/hold");});';
  await removed.runtime.run(source);await until(()=>removed.reads.length===1);await removed.runtime.apply('context.removed=true;');
  assert.equal(removed.events.filter(event=>event[0]==='release').length,1,'retiring a loop releases scheduled Gates safely');
  await stopped.runtime.run(source);await until(()=>stopped.reads.length===1);await stopped.runtime.stop();
  assert.equal(stopped.events.filter(event=>event[0]==='release').length,0,'global Stop must not bypass its output fade with full owner release');
  assert(stopped.events.some(event=>event[0]==='cancel'),'future operations are still cancelled promptly');
});
