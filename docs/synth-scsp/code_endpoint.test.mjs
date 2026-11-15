import test from 'node:test';
import assert from 'node:assert/strict';
import {createScspCodeClient} from './code_endpoint.js';
import {resolveScspCodeNoteTarget} from './code_audio.js';
const metadata={session:1,channels:32,operators:6,sampleRate:44100};

test('borrowed facade clones edits and rejects late replies and stale clients',async()=>{
  const calls=[];let active=true,complete;
  const client=createScspCodeClient({metadata,isCurrent:()=>active,invoke:(method,args)=>{calls.push({method,args});return new Promise(resolve=>{complete=resolve;});},dispose:()=>{active=false;return true;}});
  const pcm=new Int16Array([100,-100]),request=client.applyPCM(0,pcm,{rootNote:69});pcm[0]=500;assert.equal(calls[0].args[1][0],100);
  active=false;complete({id:1});await assert.rejects(request,{name:'AbortError'});assert.throws(()=>client.noteOn(0,69),{name:'AbortError'});
});

test('facade documents separate logical lane and source operator targets and fences dispose',async()=>{
  let stops=0;const client=createScspCodeClient({metadata,isCurrent:()=>true,invoke:async()=>true,dispose:async()=>{stops++;}});
  assert.equal(client.apiKind,'scsp-performance');assert.equal(client.operators,6);assert.equal(client.channels,32);
  assert.deepEqual(resolveScspCodeNoteTarget(client,client,'noteOn',[31,69]),{target:client,channel:31});
  assert.equal(resolveScspCodeNoteTarget(client,client,'setPreset',[0,{}]),null);
  assert.throws(()=>client.setMix(6,{totalLevel:0}),/source operator/);assert.throws(()=>client.noteOn(32,69),/lane/);
  await client.dispose();await client.dispose();assert.equal(stops,1);assert(!client.isCurrent());assert.throws(()=>client.getState(),{name:'AbortError'});
});
