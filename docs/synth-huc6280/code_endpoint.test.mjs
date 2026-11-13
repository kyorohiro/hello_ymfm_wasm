import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeClient,HUC6280_CODE_METHODS} from './code_endpoint.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function setup(options={}){
  let current=true,disposed=0;const calls=[];
  const client=createHuc6280CodeClient({metadata:{session:1,clock:3579545,channels:6},isCurrent:()=>current,ownsOutput:()=>true,
    invoke:(method,args)=>{calls.push({method,args});return method==='getState'?{editorSource:'wave'}:17;},dispose:()=>{disposed++;},...options});
  return{client,calls,get disposed(){return disposed;},stop(){current=false;}};
}
test('Code exposes the initialized Playground HuC6280 shape as awaitable methods on one six-channel client',async()=>{
  const f=setup();for(const method of HUC6280_CODE_METHODS)assert.equal(typeof f.client[method],'function',method);
  assert.equal(f.client.chip,'huc6280');assert.equal(f.client.clock,3579545);assert.equal(f.client.channels,6);
  assert.deepEqual(await f.client.getState(),{editorSource:'wave'});assert.equal(await f.client.setNote(0,'A4'),17);
  await f.client.noteOn(5,60);await f.client.noteOff(5);assert.equal(f.calls.at(-1).method,'noteOff');
  assert.equal(f.client.isCurrent(),true);
});
test('malformed note owners and waves fail before any RPC is sent',()=>{
  const f=setup();assert.throws(()=>f.client.noteOn(6,'C4'));assert.throws(()=>f.client.noteOn(0,'broken'));
  assert.throws(()=>f.client.setWaveform(0,Array(31).fill(0)));assert.throws(()=>f.client.writeRegister(10,0));assert.throws(()=>f.client.writeDda(0,32));
  assert.equal(f.calls.length,0);
});
test('Stop before dispatch and after an in-flight acknowledgement rejects the old session',async()=>{
  const a=setup(),pending=a.client.noteOn(0,'C4');a.stop();await assert.rejects(pending,{name:'AbortError'});assert.equal(a.calls.length,0);
  const task=deferred(),b=setup({invoke:()=>task.promise}),late=b.client.getState();await turn();b.stop();task.resolve({});await assert.rejects(late,{name:'AbortError'});
  assert.throws(()=>b.client.keyOff(0),{name:'AbortError'});
});
test('client disposal ends the lease once while its neutral output ownership remains host-controlled',async()=>{
  const f=setup(),closing=f.client.dispose();assert.equal(f.client.dispose(),closing);await closing;assert.equal(f.disposed,1);
  assert.equal(f.client.isCurrent(),false);assert.equal(f.client.ownsOutput(),true);assert.throws(()=>f.client.getState(),{name:'AbortError'});
});
