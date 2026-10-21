import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeGenesisLiveFxMessage as normalize,createNativeGenesisLiveFxStatus} from './native_genesis_livefx.js';
import {decodeNativeLiveFxContext} from './native_livefx_context.js';

test('native liveFx normalization preserves context graph and validates before transport',()=>{
  const context={gain:.5,map:new Map([['value',2n]])};context.self=context;
  const message=normalize({op:'live-fx',action:'register',name:'gain',source:'function(){}',context});
  const again=normalize(message),decoded=decodeNativeLiveFxContext(again.contextGraph);
  assert.equal(decoded.self,decoded);assert.equal(decoded.map.get('value'),2n);
  assert.equal(again.resetState,false);assert.deepEqual(again,message);assert.notEqual(again.contextGraph,message.contextGraph);
  for(const input of [null,{op:'wrong',action:'clear'},{op:'live-fx',action:'bad'},
    {...message,name:''},{...message,name:'x'.repeat(129)},{...message,source:''},
    {...message,contextGraph:{version:1,nodes:[],root:{ref:9}}}])assert.throws(()=>normalize(input));
  assert.throws(()=>normalize({op:'live-fx',action:'context',name:'gain',context:{large:'a'.repeat(100000)}}),/limit/);
  assert.throws(()=>normalize({...message,name:'音'.repeat(43)}),/128 UTF-8 bytes/);
  assert.throws(()=>normalize({...message,source:'a'.repeat(300000)}),/192 KiB/);
  assert.throws(()=>normalize({...message,source:'"'.repeat(180000)}),/256 KiB/);
  assert.deepEqual(normalize({op:'live-fx',action:'clear'}),{op:'live-fx',action:'clear'});
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture() {
  let generation=1,session=7,ready=true,frame=0,time=0,reply;
  const timers=new Map(),calls=[],errors=[],changes=[];let sequence=0;
  const status=(patch={})=>({session,frame,sampleRate:48000,liveFx:{active:1,initialized:true,latencyFrames:2048,blockFrames:128,underruns:0,overruns:0,error:null,...patch}});
  const api=createNativeGenesisLiveFxStatus({invoke:(command,args)=>{calls.push([command,args]);return reply??status();},
    getSession:()=>session,getGeneration:()=>generation,isReady:()=>ready,now:()=>time,
    onChange:value=>changes.push(value),onError:value=>errors.push(value),setTimer:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
  return {api,timers,calls,errors,changes,status,setReply:value=>{reply=value;},replace:()=>{generation++;session++;},
    setFrame:value=>{frame=value;},advance:milliseconds=>{time+=milliseconds;},setReady:value=>{ready=value;},async fire(){const [id,timer]=timers.entries().next().value??[];if(!timer)return;timers.delete(id);timer.fn();await ticks();}};
}

test('native FX observation stays idle until used and polls once per 250ms independently of audio commands',async()=>{
  const f=fixture();assert.equal(f.timers.size,0);assert.deepEqual(f.calls,[]);
  f.api.track({action:'register'});assert.equal(f.timers.size,1);await f.fire();
  assert.equal(f.calls.length,1);assert.equal(f.api.status.active,1);assert.equal(f.api.status.latencyFrames,2048);
  assert.equal(f.timers.values().next().value.ms,250);
  f.api.reset();assert.equal(f.timers.size,0);assert.equal(f.api.status.active,0);
});

test('native FX diagnostics permits one in-flight request and ignores Stop/replacement responses',async()=>{
  const f=fixture(),gate=deferred();f.setReply(gate.promise);f.api.track({action:'register'});await f.fire();
  assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);await f.api.poll();assert.equal(f.calls.length,1);
  f.api.reset();f.replace();gate.resolve({...f.status({error:'stale'}),session:7});await ticks();
  assert.deepEqual(f.errors,[]);assert.equal(f.api.status.active,0);assert.equal(f.timers.size,0);
  f.setReply(f.status());f.api.track({action:'register'});await f.fire();assert.equal(f.api.status.active,1);f.api.reset();
});

test('native FX errors are reported once without stopping audio and the last removal stops observation',async()=>{
  const f=fixture();f.api.track({action:'register'});f.setReply(f.status({error:'[liveFx:gain] failed; bypassed',reports:['[liveFx:gain] failed; bypassed']}));
  await f.fire();await f.fire();assert.deepEqual(f.errors,['[liveFx:gain] failed; bypassed']);
  f.advance(1000);
  const status=f.status({active:0,initialized:false,latencyFrames:0});status.frame=48000;f.setReply(status);await f.fire();
  assert.equal(f.timers.size,0);assert.equal(f.api.status.active,0);
});

test('native FX diagnostics watches pending future work but stops after cancellation',async()=>{
  const f=fixture();f.api.track({action:'register'},96000);
  const status=f.status({active:0,initialized:false,latencyFrames:0,queuedCommands:1});status.frame=48000;f.setReply(status);await f.fire();assert.equal(f.timers.size,1);
  f.advance(1000);
  f.setReply({...status,liveFx:{...status.liveFx,queuedCommands:0}});await f.fire();assert.equal(f.timers.size,0);
});

test('native FX diagnostics observes late compilation failure after an empty admission snapshot',async()=>{
  const f=fixture();f.api.track();f.setReply(f.status({active:0,latencyFrames:0,queuedCommands:0}));
  await f.fire();assert.equal(f.timers.size,1);
  f.advance(250);f.setReply(f.status({active:0,latencyFrames:0,queuedCommands:0,error:'compilation failed'}));
  await f.fire();assert.deepEqual(f.errors,['compilation failed']);assert.equal(f.timers.size,1);
  f.advance(750);await f.fire();assert.equal(f.timers.size,0);
});

test('native FX diagnostics ignores a pre-admission empty snapshot and malformed reports never reach UI state',async()=>{
  const f=fixture(),gate=deferred();f.setReply(gate.promise);f.api.track();await f.fire();
  f.api.track();f.api.observe(f.status({active:0,latencyFrames:0,queuedCommands:1}));
  gate.resolve(f.status({active:0,latencyFrames:0,queuedCommands:0}));await ticks();
  assert.equal(f.api.status.queuedCommands,1);assert.equal(f.timers.size,1);
  f.setReply(f.status({active:99,error:{bad:true}}));await f.fire();assert.equal(f.api.status.active,0);assert.match(f.errors[0],/invalid diagnostics/);
  f.setReply(Promise.reject(new Error('status transport unavailable')));await f.fire();assert.match(f.errors.at(-1),/status transport unavailable/);f.api.reset();
});
