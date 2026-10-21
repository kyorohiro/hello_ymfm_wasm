import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisFX} from './native_genesis_fx.js';
import {decodeNativeLiveFxContext} from './native_livefx_context.js';

test('Native device FX uses shared descriptors for series/parallel and timed parameters',()=>{
  const messages=[]; let beatSeconds=.5;
  const fx=createNativeGenesisFX({send:message=>messages.push(structuredClone(message)),getBeatSeconds:()=>beatSeconds});
  const dry=fx.gain({gain:.5}), delay=fx.delay({time:.2,feedback:.4,mix:1}), wet=fx.gain({gain:.25});
  fx.setChain([fx.parallel(fx.branch(dry),fx.branch(delay,wet))]);
  assert.equal(messages.at(-1).op,'chain');
  assert.equal(messages.at(-1).children[0].type,'parallel');
  assert.deepEqual(messages.at(-1).units.map(unit=>[unit.type,unit.slot]),[['gain',0],['delay',0],['gain',1]]);
  delay.time.rampTo(.4,.1);
  assert.equal(messages.at(-1).seconds,.1);
  assert.equal(delay.time.get(),.4);
  beatSeconds=.25;fx.syncTempo();assert.deepEqual(messages.at(-1),{op:'tempo',beatSeconds:.25});
  fx.clear();assert.equal(messages.at(-1).op,'clear');
  fx.dispose();assert.equal(messages.at(-1).op,'reset');
});

test('Native device FX sends JavaScript DSP with a portable context and preserves the public API',()=>{
  const messages=[];const fx=createNativeGenesisFX({send:message=>messages.push(message)});
  const context={gain:.5,samples:new Float32Array([.25,.75])};context.self=context;
  fx.liveFx('test',{process(input,output,state,context){output[0].set(input[0]);},context});
  const decoded=decodeNativeLiveFxContext(messages[0].contextGraph);
  assert.equal(decoded.self,decoded);assert.equal(decoded.gain,.5);assert.deepEqual(decoded.samples,new Float32Array([.25,.75]));
  assert.equal(messages[0].resetState,false);assert.match(messages[0].source,/output\[0\]\.set/);
  fx.updateContext('test',{gain:.25});assert.equal(decodeNativeLiveFxContext(messages[1].contextGraph).gain,.25);
  fx.removeLiveFx('test');assert.deepEqual(messages[2],{op:'live-fx',action:'remove',name:'test'});
  assert.throws(()=>fx.liveFx('test',{process:async()=>{}}),/synchronous/);
});

test('Native device FX preserves common ownership, duplicate and capacity validation',()=>{
  const send=()=>{},fx=createNativeGenesisFX({send}),other=createNativeGenesisFX({send});
  const unit=fx.gain();
  assert.throws(()=>fx.setChain([unit,unit]),/reused/);
  assert.throws(()=>fx.setChain([other.gain()]),/another rack/);
  assert.throws(()=>fx.setChain([fx.parallel()]),/Empty parallel/);
  for(let i=1;i<8;i++)fx.gain();
  assert.throws(()=>fx.gain(),/at most 8/);
  fx.setChain([unit]);assert.throws(()=>unit.dispose(),/Detach/);
});
