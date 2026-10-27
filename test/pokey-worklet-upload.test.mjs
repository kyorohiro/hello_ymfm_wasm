import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyFixture} from './helpers/pokey_worklet_fixture.mjs';
import {POKEY_TIMELINE_MAX_BYTES} from '../web/pokey_timeline.js';
import {POKEY_TIMELINE_CHUNK_BYTES,POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM} from '../web/pokey_timeline_upload.js';
import {createPokeyTimelineBuilder} from '../web/pokey_timeline_builder.js';

function endpoint(f,metadata){
  let serial=0;const replies=[],port={postMessage:message=>replies.push(message),start(){},close(){this.closed=true;}};
  return {port,replies,send(method,args=[]){const id=++serial,command={method,args,id};f.processor.receive(metadata?{performance:metadata,commands:[command]}:command,port);return id;},reply:id=>replies.findLast(message=>message.id===id)};
}
const header=(f,trace,uploadId=1)=>({uploadId,version:trace.version,clock:f.clock,durationSamples:trace.durationSamples,byteLength:trace.data.byteLength});
function traceWithBytes(length){
  // All points are spaced far enough apart to satisfy both host-rate density
  // limits. A longer first delta lets the trace hit the exact 8 MiB boundary.
  assert(length>=5);const extra=length%3,data=new Uint8Array(length);let position=0,sample=0;
  if(extra===1){data.set([128,1,0,71]);position=4;sample=128;}
  if(extra===2){data.set([128,128,1,0,71]);position=5;sample=16384;}
  while(position<length){data.set([1,0,71],position);position+=3;sample++;}
  return {version:1,clock:1789790,durationSamples:sample+1,data};
}
const smallTrace=()=>{const builder=createPokeyTimelineBuilder();builder.writeRegister(15,3);builder.writeRegister(0,71);builder.writeRegister(1,0xa8);return builder.finish(1000);};
function configure(f){for(const [register,value]of [[15,3],[0,71],[1,0xa8]])f.receive({method:'writeRegister',args:[register,value]});}
function commitTrace(f,trace,uploadId=1){const rpc=endpoint(f);assert.equal(rpc.reply(rpc.send('beginTimelineUpload',[header(f,trace,uploadId)])).value.uploadId,uploadId);for(let offset=0;offset<trace.data.length;offset+=POKEY_TIMELINE_CHUNK_BYTES){const id=rpc.send('appendTimelineChunk',[{uploadId,offset,data:trace.data.slice(offset,offset+POKEY_TIMELINE_CHUNK_BYTES)}]);while(!rpc.reply(id))f.render();assert.equal(rpc.reply(id).error,undefined);}assert.equal(rpc.reply(rpc.send('commitTimelineUpload',[{uploadId}])).value.loaded,true);return rpc;}

for(const rate of [44100,48000])test(`POKEY maximum upload validates within each quantum while ordinary real-WASM audio stays continuous at ${rate} Hz`,async()=>{
  const f=await createPokeyFixture({rate}),reference=await createPokeyFixture({rate});
  try{
    configure(f);configure(reference);const trace=traceWithBytes(POKEY_TIMELINE_MAX_BYTES),rpc=endpoint(f),chunks=[];
    const compare=()=>assert.deepEqual(f.render()[0],reference.render()[0]);compare();
    const begin=rpc.send('beginTimelineUpload',[header(f,trace)]);assert.equal(rpc.reply(begin).value.uploadId,1);assert.equal(f.processor.timelineState().preparing,true);
    assert.equal(f.processor.speaker.registers[1],0xa8);
    let quanta=0;
    for(let offset=0;offset<trace.data.length;offset+=POKEY_TIMELINE_CHUNK_BYTES){
      const chunk=trace.data.slice(offset,offset+POKEY_TIMELINE_CHUNK_BYTES);chunks.push(chunk);
      const validation=f.processor.timelineUpload.validation,before=validation.validatedWrites,id=rpc.send('appendTimelineChunk',[{uploadId:1,offset,data:chunk}]);
      assert.equal(rpc.reply(id),undefined,'a port handler must not scan and acknowledge its chunk');assert.equal(validation.validatedWrites,before);
      assert.equal(f.processor.timelineState().bytesReceived,offset+chunk.length);
      while(!rpc.reply(id)){
        const writes=validation.validatedWrites,bytes=validation.validatedBytes;compare();quanta++;
        assert(validation.validatedWrites-writes<=POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM);
        assert(validation.validatedBytes-bytes<=POKEY_TIMELINE_CHUNK_BYTES);
      }
      assert.equal(rpc.reply(id).error,undefined);assert.equal(rpc.reply(id).value.chunkDone,true);
    }
    assert(quanta>2000,'the maximum trace must span many independent render quanta');
    const validation=f.processor.timelineUpload.validation;validation.step=()=>{throw new Error('commit must not scan');};
    const commit=rpc.reply(rpc.send('commitTimelineUpload',[{uploadId:1}]));assert.equal(commit.value.loaded,true);assert.equal(commit.value.preparing,false);
    assert.equal(f.processor.timelineData.chunks.length,chunks.length);
    for(let index=0;index<chunks.length;index++)assert.equal(f.processor.timelineData.chunks[index],chunks[index],'commit must retain transferred buffers without combining or copying');
    assert.equal(f.processor.speaker.registers[1],0xa8);compare();
  }finally{f.close();reference.close();}
});

test('POKEY upload ownership, offsets and admission are strict and old score commits atomically',async()=>{
  const f=await createPokeyFixture();try{
    commitTrace(f,smallTrace());const old=f.processor.timelineData;configure(f);
    f.receive({type:'performance-start',session:1});const metadata={session:1,owner:'import',time:0},owner=endpoint(f,metadata),otherOwner=endpoint(f,{session:1,owner:'other',time:0}),otherPort=endpoint(f,{session:1,owner:'import',time:0}),trace=traceWithBytes(12000);
    const begin=owner.reply(owner.send('beginTimelineUpload',[header(f,trace,2)]));assert.equal(begin.value.uploadId,2);
    assert.match(owner.reply(owner.send('beginTimelineUpload',[header(f,trace,3)])).error,/busy/);
    for(const other of [otherOwner,otherPort])assert.match(other.reply(other.send('appendTimelineChunk',[{uploadId:2,offset:0,data:trace.data}])).error,/identity/);
    metadata.owner='other';assert.match(owner.reply(owner.send('appendTimelineChunk',[{uploadId:2,offset:0,data:trace.data}])).error,/identity/);metadata.owner='import';
    assert.match(owner.reply(owner.send('appendTimelineChunk',[{uploadId:3,offset:0,data:trace.data}])).error,/identity/);
    assert.match(owner.reply(owner.send('appendTimelineChunk',[{uploadId:2,offset:1,data:trace.data}])).error,/offset/);
    const pending=owner.send('appendTimelineChunk',[{uploadId:2,offset:0,data:trace.data}]);
    assert.match(owner.reply(owner.send('appendTimelineChunk',[{uploadId:2,offset:0,data:trace.data}])).error,/busy/);
    assert.match(owner.reply(owner.send('commitTimelineUpload',[{uploadId:2}])).error,/busy/);
    assert.match(owner.reply(owner.send('playTimeline')).error,/incomplete/);assert.equal(f.processor.timelineData,old);
    while(!owner.reply(pending))f.render();
    f.invoke('auditionOn',[0,60,'held']);assert.match(owner.reply(owner.send('commitTimelineUpload',[{uploadId:2}])).error,/manual audition/);assert.equal(f.processor.timelineData,old);assert.equal(f.processor.timelineState().preparing,true);
    f.invoke('auditionOff',[0,'held']);assert.equal(owner.reply(owner.send('commitTimelineUpload',[{uploadId:2}])).value.loaded,true);assert.notEqual(f.processor.timelineData,old);
    assert.match(owner.reply(owner.send('appendTimelineChunk',[{uploadId:2,offset:12000,data:new Uint8Array([0,0,0])}])).error,/identity/);
  }finally{f.close();}
});

test('POKEY upload validation runs once for a quantum even when performance writes split rendering',async()=>{
  const f=await createPokeyFixture();try{
    f.receive({type:'performance-start',session:1});const rpc=endpoint(f),trace=traceWithBytes(12000);rpc.send('beginTimelineUpload',[header(f,trace)]);const pending=rpc.send('appendTimelineChunk',[{uploadId:1,offset:0,data:trace.data}]);
    const validation=f.processor.timelineUpload.validation,step=validation.step.bind(validation);let calls=0;validation.step=budget=>{calls++;return step(budget);};
    for(const frame of [1,2,63,127])f.receive({performance:{session:1,owner:'tones',time:frame/f.rate},commands:[{method:'writeRegister',args:[0,71]}]});
    let segments=0;const render=f.processor.renderSegment;f.processor.renderSegment=(...args)=>{segments++;return render(...args);};
    f.render();assert(segments>1);assert.equal(calls,1);assert.equal(validation.validatedWrites,1024);assert.equal(rpc.reply(pending),undefined);
    rpc.send('abortTimelineUpload',[{uploadId:1}]);
  }finally{f.close();}
});

test('POKEY abort and malformed preparation keep current voices and the previously committed score',async()=>{
  const f=await createPokeyFixture(),reference=await createPokeyFixture();try{
    commitTrace(f,smallTrace());const old=f.processor.timelineData;configure(f);configure(reference);const rpc=endpoint(f),trace=traceWithBytes(12000);
    rpc.send('beginTimelineUpload',[header(f,trace,2)]);const pending=rpc.send('appendTimelineChunk',[{uploadId:2,offset:0,data:trace.data}]);
    assert.equal(rpc.reply(rpc.send('abortTimelineUpload',[{uploadId:2}])).value.uploadId,2);
    assert.equal(rpc.replies.filter(message=>message.id===pending&&message.name==='AbortError').length,1);assert.equal(f.processor.timelineData,old);
    // Reference starts at the same fresh waveform state as the subject after
    // configure: preparation of the old score never touched the subject chip.
    // It consumed audio time silently, so reset both cores before comparison.
    f.processor.speaker.reset();reference.processor.speaker.reset();configure(f);configure(reference);
    assert.deepEqual(f.render()[0],reference.render()[0]);
    const bad={version:1,durationSamples:100,data:new Uint8Array([0,16,1])};rpc.send('beginTimelineUpload',[header(f,bad,3)]);const invalid=rpc.send('appendTimelineChunk',[{uploadId:3,offset:0,data:bad.data}]);
    assert.equal(rpc.reply(invalid),undefined);assert.deepEqual(f.render()[0],reference.render()[0]);assert.match(rpc.reply(invalid).error,/register/);assert.equal(f.processor.timelineData,old);assert.equal(f.processor.timelineState().preparing,false);
    for(let count=0;count<4;count++)assert.deepEqual(f.render()[0],reference.render()[0]);assert.equal(rpc.replies.filter(message=>message.id===pending).length,1);assert.equal(rpc.replies.filter(message=>message.id===invalid).length,1);
  }finally{f.close();reference.close();}
});

test('POKEY pending upload ACK is rejected once by Stop, reset, owner cancellation, replacement and port teardown',async()=>{
  for(const action of ['stop','stopTimeline','reset','allNotesOff','clear','owner','replacement','detach','portReplacement','workerReplacement','dispose']){
    const f=await createPokeyFixture();try{
      commitTrace(f,smallTrace());const old=f.processor.timelineData;f.receive({type:'performance-start',session:1});const rpc=endpoint(f,{session:1,owner:'import',time:0}),trace=traceWithBytes(12000);
      if(action==='portReplacement')f.processor.remote=rpc.port;if(action==='workerReplacement')f.processor.workerRemote=rpc.port;
      rpc.send('beginTimelineUpload',[header(f,trace,2)]);const pending=rpc.send('appendTimelineChunk',[{uploadId:2,offset:0,data:trace.data}]);f.render();assert.equal(rpc.reply(pending),undefined);
      if(action==='stop')f.receive({type:'performance-stop',session:1});
      if(['stopTimeline','reset','allNotesOff'].includes(action))f.receive({method:action,args:[]});
      if(action==='clear')f.receive({type:'clear-scheduled-writes'});
      if(action==='owner')f.receive({type:'performance-cancel-owner',session:1,owner:'import'});
      if(action==='replacement')f.receive({type:'performance-start',session:2});
      if(action==='detach')f.processor.port.onmessage({data:{type:'detach-chip-port'}});
      if(action==='portReplacement')f.processor.port.onmessage({data:{port:endpoint(f).port}});
      if(action==='workerReplacement')f.processor.port.onmessage({data:{primaryWorker:true,port:endpoint(f).port}});
      if(action==='dispose')f.processor.dispose();
      assert.equal(f.processor.timelineState().preparing,false,action);assert.equal(rpc.replies.filter(message=>message.id===pending&&message.name==='AbortError').length,1,action);
      if(action!=='reset')assert.equal(f.processor.timelineData,old,action);
      for(let count=0;count<4;count++)f.render();assert.equal(rpc.replies.filter(message=>message.id===pending).length,1,action);
      const late=rpc.reply(rpc.send('commitTimelineUpload',[{uploadId:2}]));assert(late?.error,action);
    }finally{f.close();}
  }
});

test('POKEY legacy bulk preparation has no unbounded scan path and uses deferred quantum ACKs',async()=>{
  const f=await createPokeyFixture();try{
    const rpc=endpoint(f),large=traceWithBytes(POKEY_TIMELINE_CHUNK_BYTES+1),oversize=rpc.send('prepareTimeline',[large]);assert.match(rpc.reply(oversize).error,/16 KiB/);assert.equal(f.processor.timelineState().preparing,false);
    const trace=traceWithBytes(12000),pending=rpc.send('prepareTimeline',[trace]);assert.equal(rpc.reply(pending),undefined);
    let quanta=0;while(!rpc.reply(pending)){const upload=f.processor.timelineUpload.validation,before=upload.validatedWrites;f.render();quanta++;assert(upload.validatedWrites-before<=1024);}
    assert.equal(quanta,4);assert.equal(rpc.reply(pending).value.loaded,true);
    const empty=rpc.send('prepareTimeline',[{version:1,clock:f.clock,durationSamples:0,data:new Uint8Array()}]);assert.equal(rpc.reply(empty),undefined);f.render();assert.equal(rpc.reply(empty).value.loaded,true);
  }finally{f.close();}
});
