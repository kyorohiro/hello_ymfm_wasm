import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyClient} from './playground_pokey.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {preparePokeyTimeline,POKEY_TIMELINE_MAX_BYTES} from './pokey_timeline.js';
import {createPokeyTimelineUpload,POKEY_TIMELINE_CHUNK_BYTES} from './pokey_timeline_upload.js';

const trace=(writes=12000,value=7)=>{
  const data=new Uint8Array(writes*3);
  for(let index=0;index<writes;index++)data.set([1,index%16,(value+index)%256],index*3);
  return {version:1,clock:1789790,durationSamples:writes+10,data};
};
const flush=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
const waitFor=async predicate=>{
  for(let turn=0;turn<100&&!predicate();turn++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(predicate(),'expected client progress');
};

/** A remote score store whose RPC replies always arrive after postMessage.
 * Held append replies can arrive after abort/replacement, as with separate
 * MessagePorts. structuredClone performs real sender-buffer detachment. */
function fixture({native=false,lifecycle={},onPost=()=>{},context=()=>undefined,eventListeners=true,wrapPort=port=>port}={}){
  const calls=[],held=[],listeners=new Set(),pendingByUpload=new Map();
  let holdAppend=false,stage=null,ready=null,closed=0,scoreSequence=0,maxPending=0;
  const state=()=>({loaded:!!ready,preparing:!!stage,durationSamples:ready?.durationSamples??0,score:ready?.score??null});
  const deliver=data=>{const event={data};if(eventListeners)for(const listener of listeners)listener(event);else port.onmessage?.(event);};
  const reply=(call,value,error)=>{
    if(call.command.method==='appendTimelineChunk'){
      const uploadId=call.command.args[0].uploadId,count=pendingByUpload.get(uploadId);
      if(count!==undefined)pendingByUpload.set(uploadId,count-1);
    }
    queueMicrotask(()=>deliver(error?{id:call.command.id,error:error.message,name:error.name}:{id:call.command.id,value}));
  };
  function receive(call){
    const command=call.command,{method,args=[]}=command;
    if(command.id===undefined&&method!=='abortTimelineUpload'){
      if(method==='reset'||method==='dispose'){stage=null;ready=null;pendingByUpload.clear();}
      if(command.type==='performance-cancel-owner'&&stage?.metadata?.session===command.session&&stage.metadata.owner===command.owner){pendingByUpload.delete(stage.uploadId);stage=null;}
      if(command.type==='performance-stop'){stage=null;pendingByUpload.clear();}
      return;
    }
    try{
      let value={ok:true};
      if(method==='beginTimelineUpload'){
        assert.equal(stage,null,'the previous stage must be aborted before replacement');
        const header=args[0];stage={...header,metadata:call.metadata,validation:createPokeyTimelineUpload(header,{sampleRate:48000})};value={uploadId:header.uploadId};
      }else if(method==='appendTimelineChunk'){
        const part=args[0];assert.ok(stage);assert.equal(part.uploadId,stage.uploadId);assert.equal(part.offset,stage.validation.receivedBytes);
        assert.deepEqual(call.metadata,stage.metadata,'append must retain the upload owner');
        assert.ok(part.data.byteLength<=POKEY_TIMELINE_CHUNK_BYTES);assert.equal(part.data.byteOffset,0);assert.equal(part.data.byteLength,part.data.buffer.byteLength);
        let progress;try{stage.validation.append(part.data);do{progress=stage.validation.step();}while(!progress.chunkDone);}catch(error){stage=null;throw error;}
        const count=(pendingByUpload.get(part.uploadId)??0)+1;pendingByUpload.set(part.uploadId,count);maxPending=Math.max(maxPending,count);
        value={uploadId:part.uploadId,...progress};
        if(holdAppend){held.push({call,value});return;}
      }else if(method==='commitTimelineUpload'){
        assert.ok(stage);assert.equal(args[0].uploadId,stage.uploadId);assert.equal(pendingByUpload.get(stage.uploadId)??0,0);
        assert.deepEqual(call.metadata,stage.metadata,'commit must retain the upload owner');
        const prepared=stage.validation.finish();ready={...prepared,score:++scoreSequence,uploadId:stage.uploadId};stage=null;value=state();
      }else if(method==='abortTimelineUpload'){
        if(stage?.uploadId===args[0].uploadId){assert.deepEqual(call.metadata,stage.metadata,'abort must retain the upload owner');stage=null;}
        pendingByUpload.delete(args[0].uploadId);value=state();
      }else if(method==='prepareTimeline'){
        ready={...preparePokeyTimeline(args[0]),score:++scoreSequence};value=state();
      }else if(method==='getTimelineState'||method==='stopTimeline'||method==='stopVoices')value=state();
      else if(method==='playTimeline'){
        assert.ok(ready,'remote score must still be ready');value={ended:true,score:ready.score};
      }else if(method==='probeTransfer')value=args[0];
      if(command.id!==undefined)reply(call,value);
    }catch(error){if(command.id!==undefined)reply(call,undefined,error);}
  }
  const port={
    onmessage:null,
    postMessage(command,transfer){
      const buffers=transfer??[],before=buffers.map(buffer=>buffer.byteLength);
      const wire=structuredClone(command,{transfer:buffers}),received=wire.commands?.[0]??wire;
      const metadata=wire.performance?{session:wire.performance.session,owner:wire.performance.owner}:undefined;
      const call={command:received,sent:command.commands?.[0]??command,metadata,wire,transferCount:buffers.length,before,after:buffers.map(buffer=>buffer.byteLength),context:context()};
      calls.push(call);onPost(call);receive(call);
    },
    close(){closed++;},
    ...(eventListeners?{addEventListener(type,listener){assert.equal(type,'message');listeners.add(listener);},removeEventListener(type,listener){listeners.delete(listener);},start(){}}:{})
  };
  const client=createPokeyClient(wrapPort(port),{native},lifecycle);
  return {
    client,port,calls,held,
    get ready(){return ready;},get stage(){return stage;},get closed(){return closed;},get maxPending(){return maxPending;},
    hold(){holdAppend=true;},unhold(){holdAppend=false;},
    release(index=0){const entry=held.splice(index,1)[0];assert.ok(entry,'expected held append ACK');reply(entry.call,entry.value);},
    methods:()=>calls.map(call=>call.command.method),
    async pending(traceValue=trace()){const promise=client.prepareTimeline(traceValue);await waitFor(()=>held.length>0);return {promise,uploadId:held.at(-1).call.command.args[0].uploadId};},
    close(){client.dispose();}
  };
}

test('Browser client snapshots synchronously and transfers one owned <=16 KiB chunk per ACK',async()=>{
  const f=fixture();try{
    const source=trace(),original=source.data.slice(),backing=new Uint8Array(source.data.length+12);backing.set(source.data,5);
    source.data=backing.subarray(5,5+source.data.length);
    f.hold();const prepared=f.client.prepareTimeline(source);
    assert.deepEqual(f.methods(),['beginTimelineUpload']);
    assert.equal(f.calls[0].command.args[0].byteLength,original.byteLength);
    assert.deepEqual(Object.keys(f.calls[0].command.args[0]),['uploadId','version','clock','durationSamples','byteLength']);assert.equal(f.calls[0].transferCount,0);
    source.data.fill(255);
    await waitFor(()=>f.held.length===1);await flush();
    assert.deepEqual(f.methods(),['beginTimelineUpload','appendTimelineChunk']);assert.equal(f.maxPending,1);
    const received=[];
    while(true){
      const append=f.held[0].call;received.push(append.command.args[0].data);
      assert.equal(append.transferCount,1);assert.deepEqual(append.before,[append.command.args[0].data.byteLength]);assert.deepEqual(append.after,[0]);
      assert.equal(append.sent.args[0].data.byteLength,0,'the actual sender chunk is detached');
      const priorCount=f.calls.length;f.release();
      await waitFor(()=>f.held.length===1||f.calls.some(call=>call.command.method==='commitTimelineUpload'));
      if(f.calls.some(call=>call.command.method==='commitTimelineUpload'))break;
      assert.equal(f.calls.length,priorCount+1);await flush();assert.equal(f.held.length,1);
    }
    const result=await prepared;assert.equal(result.loaded,true);assert.equal(f.maxPending,1);
    assert.equal(source.data.byteLength,original.byteLength);assert.equal(backing.buffer.byteLength,original.byteLength+12);
    const combined=new Uint8Array(original.length);let offset=0;for(const chunk of received){combined.set(chunk,offset);offset+=chunk.length;}
    assert.deepEqual(combined,original,'mutations after prepareTimeline do not reach the remote score');
    const parts=f.calls.filter(call=>call.command.method==='appendTimelineChunk');
    assert.deepEqual(parts.map(call=>call.command.args[0].offset),[0,16384,32768]);
    assert.deepEqual(parts.map(call=>call.command.args[0].uploadId),[1,1,1]);
    assert.equal(f.ready.chunks[0],parts[0].command.args[0].data,'the remote owns each transferred chunk');
    await f.client.prepareTimeline(trace(0));
    assert.deepEqual(f.calls.filter(call=>call.command.method==='beginTimelineUpload').map(call=>call.command.args[0].uploadId),[1,2]);
    assert.deepEqual(f.calls.filter(call=>call.command.id).map(call=>call.command.id),f.calls.filter(call=>call.command.id).map((_,index)=>`chip-control:${index+1}`));
    assert.equal(f.calls.filter(call=>call.command.method==='prepareTimeline').length,0);
  }finally{f.close();}
});

test('optional control transfer preserves default requests and interleaved clock/control IDs',async()=>{
  for(const eventListeners of [false,true]){
    const f=fixture({eventListeners});try{
      await f.client.setClock(1789790);
      const borrowed=Uint8Array.of(1,2,3);assert.deepEqual(await f.client._requestControl('probeTransfer',[borrowed]),borrowed);assert.equal(borrowed.byteLength,3);
      const owned=Uint8Array.of(4,5,6),received=await f.client._requestControl('probeTransfer',[owned],[owned.buffer]);assert.equal(owned.byteLength,0);assert.deepEqual([...received],[4,5,6]);
      assert.deepEqual(f.calls.map(call=>call.command.id),['chip-clock:1','chip-control:2','chip-control:3']);
      assert.deepEqual(f.calls.map(call=>call.transferCount),[0,0,1]);
      assert.deepEqual(f.calls[2].after,[0]);
    }finally{f.close();}
  }
});

for(const action of ['stopTimeline','reset','allNotesOff','_stopVoices','dispose','_cancelPreparation'])test(`pending Browser upload aborts on ${action} and ignores a late append ACK`,async()=>{
  const f=fixture();try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;
    f.hold();const {promise,uploadId}=await f.pending();
    const rejected=assert.rejects(promise,error=>error.name==='AbortError');
    const result=f.client[action]();if(result instanceof Promise)await result;
    await rejected;
    const before=f.calls.length;f.release();await flush();
    assert.equal(f.calls.length,before,'late success ACK cannot resume the cancelled upload');
    assert.equal(f.calls.filter(call=>call.command.method==='commitTimelineUpload'&&call.command.args[0].uploadId===uploadId).length,0);
    if(action==='dispose'){
      assert.equal(f.closed,1);assert.throws(()=>f.client.playTimeline(),/disposed/);assert.equal(f.ready,null);
    }else if(action==='reset'){
      assert.equal(f.ready,null);assert.throws(()=>f.client.playTimeline(),/Prepare/);
    }else{
      assert.equal(f.ready,previous,'cancelling a new stage retains the committed score');
      assert.equal((await f.client.playTimeline()).score,previous.score);
      assert.equal(f.calls.filter(call=>call.command.method==='abortTimelineUpload'&&call.command.args[0].uploadId===uploadId).length,1);
    }
  }finally{f.close();}
});

test('replacement waits for its own append ACK and ignores its predecessor late ACK',async()=>{
  const f=fixture();try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;
    f.hold();const first=await f.pending(trace(7000,1)),rejected=assert.rejects(first.promise,error=>error.name==='AbortError');
    const second=f.client.prepareTimeline(trace(4,40));
    await waitFor(()=>f.held.length===2);await rejected;
    const replacement=f.held[1].call.command.args[0].uploadId;assert.ok(replacement>first.uploadId);assert.equal(f.ready,previous);
    const abortIndex=f.calls.findIndex(call=>call.command.method==='abortTimelineUpload'&&call.command.args[0].uploadId===first.uploadId);
    const beginIndex=f.calls.findIndex(call=>call.command.method==='beginTimelineUpload'&&call.command.args[0].uploadId===replacement);assert.ok(abortIndex<beginIndex);
    f.release(0);await flush();assert.equal(f.ready,previous);assert.equal(f.calls.some(call=>call.command.method==='commitTimelineUpload'&&call.command.args[0].uploadId===first.uploadId),false);
    f.release(0);await second;assert.equal(f.ready.uploadId,replacement);assert.notEqual(f.ready,previous);
    assert.equal(f.calls.filter(call=>call.command.method==='commitTimelineUpload'&&call.command.args[0].uploadId===replacement).length,1);
  }finally{f.close();}
});

test('invalid small headers fail before RPC and cannot replace a ready or pending score',async()=>{
  const f=fixture();try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;
    const malformed=[null,[],{}, {...trace(0),version:2},{...trace(0),clock:0},{...trace(0),clock:1789773},{...trace(0),durationSamples:-1},{...trace(0),durationSamples:0x100000000},{...trace(0),data:[0,0,0]},{...trace(0),data:new Uint8ClampedArray(3)},{...trace(0),data:new Uint8Array(POKEY_TIMELINE_MAX_BYTES+1)}];
    if(typeof SharedArrayBuffer!=='undefined')malformed.push({...trace(0),data:new Uint8Array(new SharedArrayBuffer(3))});
    for(const invalid of malformed){const before=f.calls.length;await assert.rejects(f.client.prepareTimeline(invalid));assert.equal(f.calls.length,before);assert.equal(f.ready,previous);}
    f.hold();const pending=await f.pending(trace(4));const before=f.calls.length;
    await assert.rejects(f.client.prepareTimeline({...trace(0),clock:1789773}),/clock/);assert.equal(f.calls.length,before);assert.equal(f.stage.uploadId,pending.uploadId);
    f.release();await pending.promise;assert.equal(f.ready.uploadId,pending.uploadId);
  }finally{f.close();}
});

test('remote validation failure preserves the previously committed score',async()=>{
  const f=fixture();try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;
    await assert.rejects(f.client.prepareTimeline({...trace(0),data:Uint8Array.of(0,16,0)}),/register/);
    assert.equal(f.ready,previous);assert.equal((await f.client.playTimeline()).score,previous.score);
    assert.equal(f.methods().filter(method=>method==='commitTimelineUpload').length,1);
  }finally{f.close();}
});

test('Main lifecycle restores the captured owner across each ACK and fences stopped continuations',async()=>{
  let current={owner:'first'},stopped=new Set();const restored=[];
  const f=fixture({context:()=>current,onPost:call=>{if(call.command.id)current=null;},lifecycle:{captureContext:()=>current,isStopped:context=>stopped.has(context?.owner),restoreContext:context=>{current=context;restored.push(context);}}});
  try{
    const first=current;await f.client.prepareTimeline(trace(3));
    assert.equal(current,first);assert.equal(restored.length,3);assert.ok(f.calls.every(call=>call.context===first));const previous=f.ready;
    current={owner:'stopped'};const stoppedContext=current;f.hold();const pending=await f.pending(trace(7000));
    assert.equal(f.held[0].call.context,stoppedContext);assert.equal(current,null);
    const rejected=assert.rejects(pending.promise,error=>error.name==='AbortError');stopped.add(stoppedContext.owner);const beforeRestore=restored.length;f.release();await rejected;
    assert.deepEqual(restored.slice(beforeRestore),[stoppedContext,null],'stopped owner is entered only for synchronous cleanup, then caller scope is restored');assert.equal(current,null);assert.equal(f.ready,previous);
    assert.equal(f.calls.some(call=>call.command.method==='commitTimelineUpload'&&call.command.args[0].uploadId===pending.uploadId),false);
    current={owner:'next'};assert.equal((await f.client.playTimeline()).score,previous.score);assert.equal(current.owner,'next');
  }finally{f.close();}
});

test('cross-owner replacement aborts under its captured PerformanceSender owner without an abort RPC',async()=>{
  const firstOwner={performanceOwner:'first'},replacementOwner={performanceOwner:'replacement'};
  let current=firstOwner;const resumed=[];
  const sender=createPerformanceSender({getLoop:()=>current,restoreLoop:loop=>{current=loop;},now:()=>1000});
  sender.configure({session:7,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:0});
  const f=fixture({wrapPort:port=>sender.port(port,'independent'),context:()=>current,lifecycle:{captureContext:()=>current,isStopped:loop=>loop?.stopped,restoreContext:loop=>{current=loop;resumed.push(loop);}}});
  try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;
    f.hold();const first=await f.pending(trace(7000)),rejected=assert.rejects(first.promise,error=>error.name==='AbortError');
    current=replacementOwner;const second=f.client.prepareTimeline(trace(4));
    assert.equal(current,replacementOwner,'synchronous abort cleanup restores the replacement caller');
    await waitFor(()=>f.held.length===2);await rejected;
    const abort=f.calls.find(call=>call.command.method==='abortTimelineUpload'&&call.command.args[0].uploadId===first.uploadId);
    assert.equal(abort.command.id,undefined,'abort has no RPC ACK that can restore the retired owner');
    assert.equal(abort.context,firstOwner);assert.deepEqual(abort.metadata,{session:7,owner:'first'});
    const replacement=f.held[1].call.command.args[0].uploadId;
    assert.equal(f.stage.uploadId,replacement);assert.deepEqual(f.stage.metadata,{session:7,owner:'replacement'});assert.equal(f.ready,previous);
    const beforeResume=resumed.length;f.release(0);await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(resumed.length,beforeResume,'the cancelled upload ACK cannot run its queued lifecycle resume');
    assert.equal(f.calls.some(call=>call.command.method==='commitTimelineUpload'&&call.command.args[0].uploadId===first.uploadId),false);
    f.release(0);await second;assert.equal(f.ready.uploadId,replacement);assert.equal(current,replacementOwner);
    for(const call of f.calls.filter(call=>call.command.args?.[0]?.uploadId===replacement))assert.deepEqual(call.metadata,{session:7,owner:'replacement'});
  }finally{f.close();}
});

test('a stopped Main upload cleans staging with its captured context and preserves the new caller',async()=>{
  let current={owner:'ready'};const resumed=[];
  const f=fixture({context:()=>current,lifecycle:{captureContext:()=>current,isStopped:loop=>loop?.stopped,restoreContext:loop=>{current=loop;resumed.push(loop);}}});
  try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;
    const oldOwner=current={owner:'stopped',stopped:false};f.hold();const pending=await f.pending(trace(7000));
    const nextOwner=current={owner:'next'},beforeResume=resumed.length;oldOwner.stopped=true;
    const rejected=assert.rejects(pending.promise,error=>error.name==='AbortError');f.release();await rejected;
    assert.equal(f.stage,null);assert.equal(f.ready,previous);assert.equal(current,nextOwner);assert.equal(oldOwner.stopped,true);
    assert.deepEqual(resumed.slice(beforeResume),[oldOwner,nextOwner],'cleanup restores no user continuation');
    const abort=f.calls.find(call=>call.command.method==='abortTimelineUpload'&&call.command.args[0].uploadId===pending.uploadId);
    assert.equal(abort.context,oldOwner);assert.equal(abort.command.id,undefined);
    assert.equal(f.calls.filter(call=>['appendTimelineChunk','commitTimelineUpload'].includes(call.command.method)&&call.command.args[0].uploadId===pending.uploadId).length,1);
    assert.equal((await f.client.playTimeline()).score,previous.score);
  }finally{f.close();}
});

test('PerformanceSender owner cancellation rejects cleanup sends and late ACKs cannot resume the upload',async()=>{
  const oldOwner={performanceOwner:'stopped',stopped:false},nextOwner={performanceOwner:'next'};let current=oldOwner;const resumed=[];
  const sender=createPerformanceSender({getLoop:()=>current,restoreLoop:loop=>{current=loop;},now:()=>1000});
  sender.configure({session:9,audioSeconds:0,performanceEpochMs:1000,lookaheadSeconds:0});
  const f=fixture({wrapPort:port=>sender.port(port,'independent'),context:()=>current,lifecycle:{captureContext:()=>current,isStopped:loop=>loop?.stopped,restoreContext:loop=>{current=loop;resumed.push(loop);}}});
  try{
    await f.client.prepareTimeline(trace(3));const previous=f.ready;f.hold();const pending=await f.pending(trace(7000));
    const rejected=assert.rejects(pending.promise,error=>error.name==='AbortError');
    oldOwner.stopped=true;sender.cancelOwner(oldOwner.performanceOwner);current=nextOwner;f.client._cancelPreparation();await rejected;
    assert.equal(f.stage,null);assert.equal(f.ready,previous);assert.equal(current,nextOwner);assert.equal(oldOwner.stopped,true);
    assert.equal(f.calls.filter(call=>call.command.method==='abortTimelineUpload').length,0,'the sender suppresses cancelled-owner cleanup');
    const beforeResume=resumed.length;f.release();await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(resumed.length,beforeResume);assert.equal(f.calls.some(call=>call.command.method==='commitTimelineUpload'&&call.command.args[0].uploadId===pending.uploadId),false);
  }finally{f.close();}
});

test('Native client retains one legacy prepareTimeline RPC without transfer or chunk staging',async()=>{
  const f=fixture({native:true});try{
    const source=trace(),expected=source.data.slice(),prepared=f.client.prepareTimeline(source);source.data.fill(255);await prepared;
    assert.deepEqual(f.methods(),['prepareTimeline']);assert.equal(f.calls[0].transferCount,0);assert.equal(source.data.byteLength,expected.byteLength);
    assert.deepEqual(f.calls[0].command.args[0].data,expected);assert.equal(f.ready.data.byteLength,expected.byteLength);
    assert.equal((await f.client.playTimeline()).score,f.ready.score);
  }finally{f.close();}
});
