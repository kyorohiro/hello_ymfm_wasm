import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createNativeGenesisX68000} from './native_genesis_x68000.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {createNativePrimaryClient} from './playground_native_primary.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Native X68000 real ports cancel a blocked OKI upload before commit and a new owner can replace it',async()=>{
  const commands=[],errors=[],performanceControls=[];
  let memory=new Uint8Array([0x11,0x22]),staging=null,blockedResolve,reachedResolve,blockChunk=false,sampleId=0;
  const blocked=new Promise(resolve=>{blockedResolve=resolve;}),reached=new Promise(resolve=>{reachedResolve=resolve;});
  const synth={session:1,generation:1,clock:{sampleRate:48000},isReady:()=>true,frameAt:time=>Math.round(time*48000),emit(){},
    enqueue(command){commands.push(command);const m=command.message;if(m.method==='memory-begin')staging={id:m.sampleId,bytes:new Uint8Array(m.byteLength),metadata:m.metadata};if(m.method==='memory-chunk'){assert.equal(m.sampleId,staging.id);staging.bytes.set(m.data,m.offset);}if(m.method==='memory-commit'){assert.equal(m.sampleId,staging.id);memory=staging.bytes;sampleId=m.sampleId;staging=null;}},
    async flush(){if(blockChunk&&commands.at(-1)?.message.method==='memory-chunk'){blockChunk=false;reachedResolve();await blocked;}},
    async nativeRequest(){return {okim6258:{sampleId},sampleRate:48000};},
    async setNativePerformance(message){performanceControls.push(message);},
    async dispatchNativeConsoleCommand(kind,message,timing){return endpoints[kind].dispatch(message,timing);},
  };
  const endpoints=createNativeGenesisX68000(synth);synth.ym2151=endpoints.ym2151.client;synth.okim6258=endpoints.okim6258.client;
  await endpoints.ym2151.initialize();await endpoints.okim6258.initialize();commands.length=0;
  const bridge=createNativeGenesisWorkerBridge({synth,MessageChannelClass:MessageChannel,onError:error=>errors.push(error)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25);let loop={performanceOwner:'old'};
    const sender=createPerformanceSender({leaseUntimed:true,getLoop:()=>loop,now:()=>clock.performanceEpochMs});sender.configure(clock);
    const worker=createNativePrimaryClient('okim6258',sender.port(bridge.okim6258Port,'independent'));
    blockChunk=true;const first=worker.loadMemory(new Uint8Array(131073).fill(0x87));const rejected=assert.rejects(first,/stopped/);
    await reached;assert.deepEqual([...memory],[0x11,0x22]);sender.cancelOwner('old');
    // The cancellation crosses the real port while its preceding dispatch is
    // awaiting Native IPC. Its fence must become visible before IPC resumes.
    await tick();await tick();blockedResolve();await rejected;
    assert.deepEqual(commands.map(c=>c.message.method),['memory-begin','memory-chunk']);assert.deepEqual([...memory],[0x11,0x22]);
    loop={performanceOwner:'new'};await worker.loadMemory(new Uint8Array([0x34,0x56,0x78]));
    assert.deepEqual([...memory],[0x34,0x56,0x78]);assert.equal(commands.filter(c=>c.message.method==='memory-commit').length,1);
    assert(commands.every(c=>c.frame===0&&c.performance===clock.session&&c.owner>0));assert.notEqual(commands[0].owner,commands.at(-1).owner);
    assert(performanceControls.some(c=>c.op==='cancel-owner'));assert.deepEqual(errors,[]);
  }finally{blockedResolve();host.stop();await bridge.dispose();}
});
