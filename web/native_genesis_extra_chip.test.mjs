import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture({createGate,initializeGate,disposeGate,attach,reset,notify,construct}={}){
  const calls=[],errors=[],counts={initialize:0,reset:0,attach:0,connectionDispose:0},synth={
    session:7,generation:3,clock:{sampleRate:48000},nextExtraChipInstance:0,extraDevices:new Map(),extraYm2612Devices:new Map(),ready:true,stopping:false,closing:false,
    isReady(){return this.ready;},nativeRequest(command,args){calls.push({command,args});if(command.endsWith('_create')&&createGate)return createGate.promise;if(command.endsWith('_dispose')&&disposeGate)return disposeGate.promise;return Promise.resolve({});},
    enqueue(){},enqueueMany(){},flush(){return Promise.resolve();},frameAt:()=>0,reportAsyncError:error=>errors.push(error),chipInspector:{notify(){notify?.(synth);}},
  };
  const bridge={attachEndpoint(){counts.attach++;attach?.();return {port:{},controlPort:{},dispose(){counts.connectionDispose++;}};}};
  const createEndpoint=facade=>{construct?.();return {client:{},initialize(){counts.initialize++;if(initializeGate)return initializeGate.promise;},reset(){counts.reset++;reset?.();},mix:async()=>{},dispatch(){},facade};};
  const create=options=>createNativeGenesisExtraChip(synth,{id:'chip',kind:'ym2612',label:'YM2612',createEndpoint,...options});
  return {synth,calls,errors,counts,bridge,create,disposals:()=>calls.filter(c=>c.command.endsWith('_dispose'))};
}
test('Native factory abort settles before a delayed create reply and late success releases only its instance once',async()=>{
  const gate=deferred(),f=fixture({createGate:gate}),controller=new AbortController();let outcome;
  const pending=f.create({signal:controller.signal}).then(value=>outcome={value},error=>outcome={error});
  assert.equal(f.synth.extraDevices.size,1);controller.abort();await ticks();
  assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.extraYm2612Devices.size,0);assert.equal(f.counts.reset,1);
  assert.equal(outcome?.error?.name,'AbortError');assert.equal(f.counts.initialize,0);assert.equal(f.disposals().length,0);
  gate.resolve({});await pending;await ticks();assert.deepEqual(f.disposals().map(c=>c.args),[{instance:1}]);assert.equal(f.counts.initialize,0);assert.deepEqual(f.errors,[]);
});
test('Native factory observes late create rejection after abort without initializing or disposing another chip',async()=>{
  const gate=deferred(),f=fixture({createGate:gate}),controller=new AbortController();const reason=new Error('owner cancelled');
  const pending=f.create({signal:controller.signal});const rejected=assert.rejects(pending,error=>error===reason);controller.abort(reason);await ticks();gate.reject(new Error('reservation rejected'));await rejected;await ticks();assert.equal(f.counts.initialize,0);assert.equal(f.disposals().length,0);assert.deepEqual(f.errors,[]);
});
test('Native factory cancellation during initialize settles without waiting for the late initializer',async()=>{
  const gate=deferred(),f=fixture({initializeGate:gate}),controller=new AbortController();let outcome;
  const pending=f.create({signal:controller.signal}).then(value=>outcome={value},error=>outcome={error});await ticks();assert.equal(f.counts.initialize,1);
  controller.abort();await ticks();assert.equal(outcome?.error?.name,'AbortError');assert.equal(f.synth.extraDevices.size,0);assert.equal(f.disposals().length,1);
  gate.reject(new Error('late initialization failure'));await pending;await ticks();assert.equal(f.disposals().length,1);assert.deepEqual(f.errors,[]);
});
test('Native factory abort during bridge attachment closes the newly returned connection and never publishes ready',async()=>{
  const controller=new AbortController(),f=fixture({attach:()=>controller.abort()});
  await assert.rejects(f.create({signal:controller.signal,bridge:f.bridge}),{name:'AbortError'});assert.equal(f.counts.connectionDispose,1);assert.equal(f.counts.reset,1);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.disposals().length,1);
});
test('Native factory cancelled late create cannot dispose a replacement session or generation',async()=>{
  for(const changed of ['session','generation']){
    const gate=deferred(),f=fixture({createGate:gate}),controller=new AbortController();const pending=f.create({signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();f.synth[changed]++;gate.resolve({});await rejected;await ticks();assert.equal(f.disposals().length,0);assert.equal(f.counts.initialize,0);
  }
});
test('Native factory failed initialization cleans bookkeeping and sends one instance disposal',async()=>{
  const gate=deferred(),f=fixture({initializeGate:gate}),failure=new Error('initialization failed');const pending=f.create(),rejected=assert.rejects(pending,error=>error===failure);await ticks();gate.reject(failure);await rejected;assert.equal(f.counts.reset,1);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.disposals().length,1);assert.deepEqual(f.errors,[]);
});
test('Native factory ready device is disposed once and its completed creation signal is detached',async()=>{
  const f=fixture(),controller=new AbortController(),device=await f.create({signal:controller.signal,bridge:f.bridge});assert.equal(device.ready,true);controller.abort();assert.equal(device.ready,true);device.dispose();device.client.dispose();assert.equal(f.counts.reset,1);assert.equal(f.counts.connectionDispose,1);assert.equal(f.disposals().length,1);assert.deepEqual(f.errors,[]);
});

test('Native factory already-aborted and constructor-aborted creations admit no Native core',async()=>{
  const before=new AbortController();before.abort();const a=fixture();await assert.rejects(a.create({signal:before.signal}),{name:'AbortError'});assert.equal(a.synth.nextExtraChipInstance,0);assert.equal(a.calls.length,0);
  const during=new AbortController(),b=fixture({construct:()=>during.abort()});await assert.rejects(b.create({signal:during.signal}),{name:'AbortError'});assert.equal(b.synth.extraDevices.size,0);assert.equal(b.calls.length,0);assert.equal(b.counts.reset,1);
});
test('Native factory ready notification can cancel before publication completes',async()=>{
  const controller=new AbortController(),f=fixture({notify:synth=>{if([...synth.extraDevices.values()].some(device=>device.ready))controller.abort();}});
  await assert.rejects(f.create({signal:controller.signal,bridge:f.bridge}),{name:'AbortError'});assert.equal(f.synth.extraDevices.size,0);assert.equal(f.counts.connectionDispose,1);assert.equal(f.disposals().length,1);
});
test('Native factory cleanup failure cannot skip the remaining JS and Native releases',async()=>{
  const resetFailure=new Error('reset failed'),f=fixture({reset:()=>{throw resetFailure;}}),device=await f.create({bridge:f.bridge});
  assert.throws(()=>device.dispose(),error=>error===resetFailure);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.extraYm2612Devices.size,0);assert.equal(f.counts.connectionDispose,1);assert.equal(f.disposals().length,1);assert.deepEqual(f.errors,[]);
});
test('Native factory preserves initialization failure when best-effort endpoint cleanup also fails',async()=>{
  const gate=deferred(),failure=new Error('initialize failed'),f=fixture({initializeGate:gate,reset:()=>{throw Error('reset failed');}}),pending=f.create(),rejected=assert.rejects(pending,error=>error===failure);await ticks();gate.reject(failure);await rejected;assert.equal(f.synth.extraDevices.size,0);assert.equal(f.disposals().length,1);assert.deepEqual(f.errors,[]);
});
test('Native factory ignores disposal failure from a superseded session or generation',async()=>{
  for(const field of ['session','generation']){const gate=deferred(),f=fixture({disposeGate:gate}),device=await f.create();device.dispose();f.synth[field]++;gate.reject(Error('stale disposal failed'));await ticks();assert.deepEqual(f.errors,[]);}
});
test('Native factory explicit disposal of a pending instance promptly aborts and leaves its replacement intact',async()=>{
  const gate=deferred(),f=fixture({createGate:gate});let failure;
  const old=f.create().catch(error=>{failure=error;}),device=[...f.synth.extraDevices.values()][0];device.dispose();device.dispose();await ticks();assert.equal(failure?.name,'AbortError');
  const next=f.create();assert.equal(f.synth.extraDevices.size,1);gate.resolve({});await old;const replacement=await next;await ticks();assert.equal(replacement.nativeInstance,2);assert.equal(replacement.ready,true);assert.deepEqual([...f.synth.extraDevices.keys()],[2]);assert.deepEqual(f.disposals().map(c=>c.args.instance),[1]);replacement.dispose();assert.deepEqual(f.disposals().map(c=>c.args.instance),[1,2]);
});
