import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

const delay = () => new Promise(resolve => setTimeout(resolve,1));
async function until(predicate) {
  for(let i=0;i<1000;i++) {if(predicate())return;await delay();}
  throw new Error('Native Worker test timed out');
}
function message(port) {return new Promise(resolve => port.once('message',resolve));}
function deferred() {let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve};}
function harness(options={}) {
  const calls=[],errors=[];
  const synth={
    async setNativePerformance(request) {calls.push(['control',request]);},
    async dispatchNativeCommand(command,timing) {calls.push(['chip',command,timing]);if(command.type==='pcm-dac')return {type:'pcm-dac-result',id:command.id};if(command.type==='chip-clock')throw new Error('Clock is fixed');},
    async dispatchNativeFxCommand(command,timing) {calls.push(['fx',command,timing]);if(command.op==='sample')return {op:'sample-response',id:command.id,value:7};},
    ...options.synth,
  };
  const {synth:ignored,...settings}=options;
  const bridge=createNativeGenesisWorkerBridge({synth,MessageChannelClass:MessageChannel,onError:error=>errors.push(error),...settings});
  const host=createPerformanceHost({getContext:()=>({currentTime:12,state:'running'})});
  return {bridge,calls,errors,host,async start(){return host.start([bridge.port],.5);},async close(){host.stop();await bridge.dispose();}};
}

test('real performance handshake, single batched native IPC and shared chip/FX owners',async()=>{
  const h=harness();
  try {
    const clock=await h.start();assert.equal(clock.audioSeconds,12);assert.equal(clock.lookaheadSeconds,.5);
    const performance={session:clock.session,owner:'loop:lead:1',time:12.75};
    const commands=[{type:'write',port:0,addr:0x28,data:0xf0},{type:'write',port:0,addr:0xa0,data:2}];
    h.bridge.chipPort.postMessage({performance,commands});
    await until(()=>h.calls.length===2);
    h.bridge.fxPort.postMessage({performance,commands:[{op:'parameter',id:1,name:'gain',value:.5}]});
    await until(()=>h.calls.length===3);
    assert.deepEqual(h.calls[1],['chip',commands,{time:12.75,performance:clock.session,owner:1}]);
    assert.deepEqual(h.calls[2][2],h.calls[1][2]);
    assert.equal(h.errors.length,0);
  } finally {await h.close();}
});

test('DAC/sample request replies and unsupported clock errors reach the real ports',async()=>{
  const h=harness();
  try {
    await h.start();
    let response=message(h.bridge.chipPort);h.bridge.chipPort.postMessage({type:'pcm-dac',id:4,command:{action:'play'}});
    assert.deepEqual(await response,{type:'pcm-dac-result',id:4});
    response=message(h.bridge.fxPort);h.bridge.fxPort.postMessage({op:'sample',id:5,action:'play'});
    assert.deepEqual(await response,{op:'sample-response',id:5,value:7});
    response=message(h.bridge.chipPort);h.bridge.chipPort.postMessage({type:'chip-clock',id:6});
    assert.deepEqual(await response,{type:'chip-clock-result',id:6,error:'Clock is fixed'});
    assert.equal(h.errors.length,0);
  } finally {await h.close();}
});

test('owner cancellation invalidates queued notes, preserving other owners and interactive input',async()=>{
  const gate=deferred(),entered=deferred();let blocked=false;
  const h=harness({synth:{async dispatchNativeCommand(command,timing){h.calls.push(['chip',command,timing]);if(!blocked){blocked=true;entered.resolve();await gate.promise;}}}});
  try {
    const clock=await h.start();
    const send=(owner,data)=>h.bridge.chipPort.postMessage({performance:{session:clock.session,owner,time:13},commands:[{type:'write',data}]});
    send('lead',1);await entered.promise;send('lead',2);send('bass',3);
    h.bridge.chipPort.postMessage({type:'performance-cancel-owner',session:clock.session,owner:'lead'});
    h.bridge.chipPort.postMessage({type:'performance-cancel-owner',session:clock.session,owner:'lead'});
    h.bridge.chipPort.postMessage({type:'write',data:4});
    await delay();gate.resolve();
    await until(()=>h.calls.some(c=>c[0]==='chip'&&c[1].data===4));
    assert.deepEqual(h.calls.filter(c=>c[0]==='chip').map(c=>c[1].data),[1,3,4]);
    assert.deepEqual(h.calls.filter(c=>c[1].op==='cancel-owner').map(c=>c[1]),[{op:'cancel-owner',performance:clock.session,owner:1}]);
    assert.equal(h.errors.length,0);
  } finally {gate.resolve();await h.close();}
});

test('Stop fences queued cleanup and replies to pending sample requests after slow IPC',async()=>{
  const gate=deferred(),entered=deferred();
  const h=harness({synth:{async dispatchNativeCommand(command){h.calls.push(['chip',command]);entered.resolve();await gate.promise;}}});
  try {
    const clock=await h.start();
    h.bridge.chipPort.postMessage({type:'write',data:1});await entered.promise;
    const response=message(h.bridge.fxPort);
    h.bridge.fxPort.postMessage({op:'sample',id:8,action:'play'});await delay();
    h.bridge.port.postMessage({type:'performance-stop',session:clock.session});
    await delay();h.bridge.chipPort.postMessage({type:'write',data:2});await delay();
    gate.resolve();
    assert.match((await response).error,/stopped/);
    await until(()=>h.calls.some(c=>c[1].op==='stop'));
    assert.equal(h.calls.filter(c=>c[0]==='chip').length,1);
    assert.equal(h.errors.length,0);
  } finally {gate.resolve();await h.close();}
});

test('backlog counts in-flight native calls and Stop bypasses a full command queue',async()=>{
  const gate=deferred(),entered=deferred();
  const h=harness({maxPending:2,synth:{async dispatchNativeCommand(command){h.calls.push(['chip',command]);entered.resolve();await gate.promise;}}});
  try {
    const clock=await h.start();
    h.bridge.chipPort.postMessage([{type:'write'},{type:'write'}]);await entered.promise;
    h.bridge.chipPort.postMessage({type:'write'});await until(()=>h.errors.length===1);
    assert.match(h.errors[0].message,/queue is full/);
    h.host.stop();await delay();gate.resolve();
    await until(()=>h.calls.some(c=>c[1].op==='stop'&&c[1].performance===clock.session));
    assert.equal(h.calls.filter(c=>c[0]==='chip').length,1);
  } finally {gate.resolve();await h.close();}
});

test('dispose waits for native Stop and old performance commands cannot reach a new Run',async()=>{
  const h=harness();
  try {
    const old=await h.start();h.host.stop();await until(()=>h.calls.some(c=>c[1].op==='stop'));
    const next=await h.start();assert.notEqual(old.session,next.session);
    h.bridge.chipPort.postMessage({performance:{session:old.session,owner:'old',time:12},commands:[{type:'write'}]});
    h.bridge.chipPort.postMessage({performance:{session:next.session,owner:'new',time:13},commands:[{type:'write',data:9}]});
    await until(()=>h.calls.some(c=>c[0]==='chip'));
    assert.equal(h.calls.filter(c=>c[0]==='chip').length,1);
    await h.bridge.dispose();assert.deepEqual(h.calls.at(-1),['control',{op:'stop',performance:next.session}]);
  } finally {await h.close();}
});

test('a delayed Native cleanup lease cannot reset FX or mute a replacement Run across real ports',async()=>{
  const h=harness(),held=[];
  const sender=createPerformanceSender({leaseUntimed:true});
  const staged=sender.port({postMessage:data=>held.push(structuredClone(data))},'fx');
  try {
    const old=await h.start();sender.configure(old);
    sender.stop();sender.immediateCleanup(()=>staged.postMessage({op:'reset'}));
    const cleanup=held.at(-1);assert.equal(cleanup.nativePerformance.session,old.session);
    h.host.stop();await until(()=>h.calls.some(c=>c[0]==='control'&&c[1].op==='stop'));
    const next=await h.start();
    // Delay the old FX-port task until the new admin-port handshake completed.
    h.bridge.fxPort.postMessage(cleanup);
    h.bridge.chipPort.postMessage({performance:{session:next.session,owner:'new',time:13},commands:[{type:'write',data:9}]});
    await until(()=>h.calls.some(c=>c[0]==='chip'));
    assert.equal(h.calls.filter(c=>c[0]==='fx').length,0);
    assert.equal(h.calls.filter(c=>c[0]==='chip').length,1);assert.equal(h.errors.length,0);
  } finally {await h.close();}
});

test('Native explicit DAC schedules preserve their owner without applying the performance lead',async()=>{
  const h=harness();let loop={performanceOwner:'dac-loop'};
  try {
    const clock=await h.start();
    const sender=createPerformanceSender({leaseUntimed:true,getLoop:()=>loop});sender.configure(clock);
    const port=sender.port(h.bridge.chipPort,'chip');
    const command={type:'sample-writes',entries:[{sample:4410,port:0,register:0x2a,value:128}]};
    port.postMessage(command);await until(()=>h.calls.some(c=>c[0]==='chip'));
    const call=h.calls.find(c=>c[0]==='chip');assert.deepEqual(call[1],command);
    assert.deepEqual(call[2],{performance:clock.session,owner:1});assert.equal(call[2].time,undefined);
    sender.cancelOwner('dac-loop');await until(()=>h.calls.some(c=>c[1].op==='cancel-owner'));
    h.bridge.chipPort.postMessage({nativePerformance:{session:clock.session,owner:'dac-loop'},commands:[command]});
    loop={keyboard:true};port.postMessage({type:'write',data:1});
    await until(()=>h.calls.filter(c=>c[0]==='chip').length===2);
    const last=h.calls.filter(c=>c[0]==='chip').at(-1);assert.equal(last[2].time,undefined);assert.notEqual(last[2].owner,1);
    assert.equal(h.errors.length,0);
  } finally {await h.close();}
});

test('Native backlog bounds count the backing storage of small PCM views before native IPC',async()=>{
  const h=harness();
  try {
    await h.start();
    const backing=new ArrayBuffer(64*1024*1024+1),response=message(h.bridge.chipPort);
    h.bridge.chipPort.postMessage({type:'pcm-dac',id:100,command:{action:'load',data:new Uint8Array(backing,0,1)}},[backing]);
    const result=await response;assert.match(result.error,/queue is full/);
    assert.equal(h.calls.filter(call=>call[0]==='chip').length,0);assert.equal(h.errors.length,0);
  } finally {await h.close();}
});
