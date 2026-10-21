import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {borrowNativeApi,createNativePrimaryClient,createNativeWorkerApis} from './playground_native_primary.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {GameboySynth} from './gameboysynth.js';

const delay=()=>new Promise(resolve=>setTimeout(resolve,1));
async function until(predicate){for(let n=0;n<1000;n++){if(predicate())return;await delay();}throw new Error('Native console bridge timed out');}
function message(port){return new Promise(resolve=>port.once('message',resolve));}
function fixture(extra={}){
  const calls=[],errors=[],synth={gameboy:{},snes:{},huc6280:{},
    async setNativePerformance(command){calls.push(['control',command]);},
    async dispatchNativeConsoleCommand(kind,command,timing){calls.push([kind,command,timing]);return {id:command.id,value:true};},
    async dispatchNativeSnesCommand(command,timing){calls.push(['snes',command,timing]);return {id:command.id,value:true};},...extra};
  const bridge=createNativeGenesisWorkerBridge({synth,MessageChannelClass:MessageChannel,onError:error=>errors.push(error)});
  const host=createPerformanceHost({getContext:()=>({currentTime:5,state:'running'})});
  return {calls,errors,bridge,host,start:()=>host.start([bridge.port],.1),async close(){host.stop();await bridge.dispose();}};
}
test('Game Boy, SNES and PC Engine Worker ports share the actual performance/owner clock',async()=>{
  const f=fixture();try{
    const clock=await f.start();
    for(const [kind,port]of [['gameboy',f.bridge.gameboyPort],['snes',f.bridge.snesPort],['huc6280',f.bridge.huc6280Port]]){
      assert(port);const response=message(port),command={method:'writeRegister',args:[2,9],id:kind};
      port.postMessage({performance:{session:clock.session,owner:'same-loop',time:5.75},commands:[command]});
      assert.deepEqual(await response,{id:kind,value:true});assert.deepEqual(f.calls.at(-1),[kind,command,{time:5.75,performance:clock.session,owner:1}]);
    }
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('console Worker Stop fences stale requests and replacement Run cleanup on all new ports',async()=>{
  const f=fixture();try{
    const old=await f.start();f.host.stop();await until(()=>f.calls.some(c=>c[1].op==='stop'));const fresh=await f.start();
    for(const port of [f.bridge.gameboyPort,f.bridge.snesPort,f.bridge.huc6280Port]){
      const response=message(port);port.postMessage({nativePerformance:{session:old.session,owner:'old'},commands:[{method:'stopVoices',id:7}]});
      assert.match((await response).error,/stopped/);
    }
    const response=message(f.bridge.huc6280Port);f.bridge.huc6280Port.postMessage({nativePerformance:{session:fresh.session,owner:'new'},commands:[{method:'keyOn',args:[1],id:8}]});assert.deepEqual(await response,{id:8,value:true});
    assert.equal(f.calls.filter(c=>['gameboy','snes','huc6280'].includes(c[0])).length,1);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('SNES timeline deferred completion leaves the command FIFO open for Stop and other chips',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const f=fixture({async dispatchNativeSnesCommand(command,timing){f.calls.push(['snes',command,timing]);if(command.method==='playTimeline')return {deferred:pending};if(command.method==='stopTimeline'){finish({id:1,error:'Timeline stopped',name:'AbortError'});return {id:command.id,value:true};}}});
  const replies=[];f.bridge.snesPort.on('message',reply=>replies.push(reply));
  try{
    await f.start();f.bridge.snesPort.postMessage({method:'playTimeline',id:1});await until(()=>f.calls.some(c=>c[1].method==='playTimeline'));
    const response=message(f.bridge.gameboyPort);f.bridge.gameboyPort.postMessage({method:'keyOn',args:[0],id:2});assert.deepEqual(await response,{id:2,value:true});
    assert.equal(replies.length,0);f.bridge.snesPort.postMessage({method:'stopTimeline',id:3});await until(()=>replies.length===2);
    assert(replies.some(v=>v.id===1&&v.name==='AbortError'));assert(replies.some(v=>v.id===3&&v.value));assert.deepEqual(f.errors,[]);
  }finally{finish();await f.close();}
});
test('Game Boy native primary Worker client adopts configuration and sends existing high-level controls',async()=>{
  const source=new GameboySynth({transport:{writeRegister(){},reset(){}}});source.initialize();source.pulse.setVoice(1,{volume:7,duty:.25});
  const channel=new MessageChannel(),sent=[];channel.port1.on('message',data=>sent.push(data));
  const client=createNativePrimaryClient('gameboy',channel.port2,{native:true,state:source._getState()});
  try{assert.deepEqual(client._getState(),source._getState());client.pulse.noteOn(1,'C4');await until(()=>sent.length>=2);assert(sent.some(c=>c.method==='writeRegister'&&c.args[0]===9&&(c.args[1]&128)));}
  finally{client.dispose();channel.port1.close();channel.port2.close();}
});
test('real Native Worker Game Boy API wraps frozen voice sections and preserves reflected public state',async()=>{
  const source=new GameboySynth({transport:{writeRegister(){},reset(){}}});source.initialize();
  const channel=new MessageChannel(),sent=[],observed=[];channel.port1.on('message',data=>sent.push(data));
  const worker=createNativeWorkerApis([{name:'gameboy',globalName:'gameboy',port:channel.port2,state:source._getState(),native:true}],
    {port:port=>port},(name,state)=>observed.push({name,state}));
  const api=worker.apis.gameboy;
  try{
    assert.equal(api.id,'gameboy');assert.equal(api.dispose,undefined);assert.equal(api._getState,undefined);
    assert.equal('pulse'in api,true);assert(Object.keys(api).includes('pulse'));assert(Object.keys(api.pulse).includes('setVoice'));
    assert.equal(Object.getOwnPropertyDescriptor(api.pulse,'setVoice').value instanceof Function,true);
    api.pulse.setVoice(0,{volume:7});api.pulse.noteOn(0,'C4');api.wave.setLevel(.5);api.noise.setVoice({volume:4});
    assert.throws(()=>{api.clock=1234567;},TypeError,'the source clock getter remains read-only');
    await until(()=>sent.some(command=>command.method==='writeRegister'&&command.args[0]===4&&(command.args[1]&128)));
    await until(()=>observed.length>0);assert.equal(observed.at(-1).state.voice[2]>>4,7);
    assert.throws(()=>{api.pulse.setVoice=()=>{};},TypeError,'frozen source sections remain read-only');
  }finally{worker.raw.get('gameboy').dispose();channel.port1.close();channel.port2.close();}
});
test('borrowed chip facade forwards public reflection and mutable configuration to its source',()=>{
  const raw={clock:3579545,section:'test',method(){return this.clock;}};const api=borrowNativeApi(raw,'test');
  assert.deepEqual(Object.keys(api),Object.keys(raw));assert.equal(api.method(),3579545);api.clock=4000000;assert.equal(raw.clock,4000000);
  Object.defineProperty(api,'extra',{value:8,enumerable:true,configurable:true});assert.equal(raw.extra,8);assert.equal(api.extra,8);delete api.extra;assert.equal('extra'in api,false);
});
