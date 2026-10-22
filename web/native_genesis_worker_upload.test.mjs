import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createNativeGenesisYm2608} from './native_genesis_ym2608.js';
import {createNativeGenesisYm2610B} from './native_genesis_ym2610b.js';
import {createPerformanceHost} from './playground_performance_host.js';

function deferred(){let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve};}
function reply(port,id){
  return new Promise((resolve,reject)=>{
    const listener=data=>{if(data.id!==id)return;clearTimeout(timer);port.off('message',listener);resolve(data);};
    const timer=setTimeout(()=>{port.off('message',listener);reject(new Error('Native memory request did not settle'));},2000);
    port.on('message',listener);
  });
}
async function fixture(kind){
  const commands=[],controls=[],errors=[],channels=[],firstUpload=deferred(),gate=deferred();let armed=false,blocked=false;
  const synth={session:1,generation:1,clock:{sampleRate:48000},isReady:()=>true,frameAt:time=>Math.round(time*48000),
    enqueue:command=>commands.push(command),enqueueMany:list=>commands.push(...list),
    async flush(){if(armed&&!blocked&&commands.at(-1)?.message.method==='memory'){blocked=true;firstUpload.resolve();await gate.promise;}},
    async setNativePerformance(request){controls.push(request);},
  };
  const adapter=kind==='ym2608'?createNativeGenesisYm2608(synth,{fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer})}):createNativeGenesisYm2610B(synth);
  if(kind==='ym2608')synth.nativeOpna=adapter;else synth.nativeOpnb=adapter;
  synth.dispatchNativeCommand=(message,timing)=>adapter.dispatch(message,timing);
  await adapter.initialize();commands.length=0;armed=true;
  const bridge=createNativeGenesisWorkerBridge({synth,onError:error=>errors.push(error),MessageChannelClass:class{
    constructor(){const channel=new MessageChannel();channels.push(channel);return channel;}
  }});
  const host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  const clock=await host.start([bridge.port],.25);
  return {commands,controls,errors,firstUpload,gate,bridge,host,clock,
    async control(message){
      const received=new Promise(resolve=>{const listener=data=>{if(data.type!==message.type)return;channels[1].port1.off('message',listener);resolve();};channels[1].port1.on('message',listener);});
      bridge.chipPort.postMessage(message);await received;
    },
    async close(){gate.resolve();host.stop();await bridge.dispose();},
  };
}

for(const kind of ['ym2608','ym2610b'])for(const protocol of ['raw','method'])for(const cancellation of ['owner','performance']){
  test(`Native ${kind} ${protocol} memory upload stops between chunks after ${cancellation} cancellation and replies with an error`,{timeout:5000},async()=>{
    const f=await fixture(kind);
    const command=(id,bytes)=>protocol==='raw'?{type:'loadAdpcmMemory',id,...(kind==='ym2610b'?{memoryType:1}:{}),bytes,address:256}:
      {method:'memory',id,args:kind==='ym2610b'?[1,bytes,256]:[bytes,256]};
    try{
      let response=reply(f.bridge.chipPort,10);
      f.bridge.chipPort.postMessage({nativePerformance:{session:f.clock.session,owner:'loop:a'},commands:[command(10,new Uint8Array(131073).fill(0x87))]});
      await f.firstUpload.promise;assert.equal(f.commands.length,1);assert.equal(f.commands[0].message.data.length,65536);
      await f.control({type:cancellation==='owner'?'performance-cancel-owner':'performance-stop',session:f.clock.session,...(cancellation==='owner'?{owner:'loop:a'}:{})});
      f.gate.resolve();const failed=await response;
      assert.match(failed.error,/stopped|cancelled/i);assert.equal(failed.id,10);
      if(protocol==='raw')assert.equal(failed.type,'adpcm-memory-loaded');
      assert.equal(f.commands.length,1,'retired owner cannot send later chunks while Native cancellation waits behind the upload');
      const first=f.commands[0];assert.equal(first.frame,0);assert.equal(first.performance,f.clock.session);assert.equal(first.owner,1);
      assert.equal(first.checkCurrent,undefined);assert.equal(first.message.checkCurrent,undefined);assert.doesNotThrow(()=>structuredClone(first));
      let clock=f.clock;
      if(cancellation==='performance'){f.host.stop();clock=await f.host.start([f.bridge.port],.25);}
      response=reply(f.bridge.chipPort,11);
      f.bridge.chipPort.postMessage({nativePerformance:{session:clock.session,owner:'loop:b'},commands:[command(11,new Uint8Array([31]))]});
      assert.equal((await response).error,undefined);assert.equal(f.commands.length,2);assert.deepEqual(f.commands[1].message.data,[31]);
      assert.deepEqual(f.errors,[]);
    }finally{await f.close();}
  });
}
