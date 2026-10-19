import test from 'node:test';
import assert from 'node:assert/strict';
import {GameboyRuntimeSynth} from './gameboy_runtime_synth.js';

const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:()=>resolve()};};
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve();}assert.fail('Async boundary not reached');}
function harness(t,stage=''){
 const gate=deferred(),nodes=[];let reached=false;
 const context={state:'running',currentTime:0,destination:{},resume:async()=>{},close:async()=>{},
  audioWorklet:{addModule:async()=>{if(stage==='module'){reached=true;await gate.promise;}}},
  createGain:()=>({gain:{value:1,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}},connect(){},disconnect(){}}),
  createChannelSplitter:()=>({connect(){},disconnect(){}}),createChannelMerger:()=>({connect(){},disconnect(){}}),
 };
 const previous=globalThis.AudioWorkletNode;
 globalThis.AudioWorkletNode=class{
  constructor(_context,name,options){
   this.name=name;this.options=options;this.connected=false;this.handlers=new Set();this.messages=[];
   this.port={closed:false,close:()=>{this.port.closed=true;},start(){},
    addEventListener:(_,fn)=>this.handlers.add(fn),removeEventListener:(_,fn)=>this.handlers.delete(fn),
    postMessage:data=>this.messages.push(data),
   };
   nodes.push(this);reached=true;
   if(stage!=='ready')queueMicrotask(()=>this.send({ready:true}));
  }
  send(data){for(const fn of [...this.handlers])fn({data});}
  connect(){this.connected=true;}disconnect(){this.connected=false;}
 };
 t.after(()=>{globalThis.AudioWorkletNode=previous;});
 t.mock.method(globalThis,'fetch',async()=>{
  if(stage==='fetch'){reached=true;await gate.promise;}
  return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};
 });
 return {context,nodes,gate,reached:()=>reached,synth:new GameboyRuntimeSynth({audioContext:context})};
}

test('primary Game Boy starts one initialized APU with shared mixer/media services and can restart',async t=>{
 const {synth,nodes}=harness(t);
 assert.equal(synth.audioContext.state,'running');assert.equal(synth.fm,null);
 await synth.start();
 assert.equal(synth.isReady(),true);assert.equal(nodes.length,1);
 assert.equal(nodes[0].name,'tetorica-gameboy');assert(nodes[0].options.processorOptions.wasmBinary instanceof ArrayBuffer);
 assert.deepEqual(synth.capabilities,{chip:'gameboy',fmChannels:0,psg:false,dac:false,recorder:false});
 assert.equal(synth.gameboy._getState().initialized,true);
 assert.equal(typeof synth.sample.load,'function');assert.equal(typeof synth.stream.load,'function');
 assert.deepEqual(synth.mixer.list().filter(row=>row.connected).map(row=>row.id),['gameboy']);
 const raw=synth.gameboy,count=nodes[0].messages.length;
 await synth.start();assert.equal(synth.gameboy,raw);assert.equal(nodes[0].messages.length,count);
 const clock=synth.gameboy.setClock(4000000),command=nodes[0].messages.at(-1);
 nodes[0].send({id:command.id});await clock;assert.equal(synth.gameboy.clock,4000000);
 await synth.close();assert.equal(nodes[0].port.closed,true);assert.equal(nodes[0].handlers.size,0);
 assert(nodes[0].messages.some(data=>data.method==='dispose'));
 await synth.start();assert.equal(synth.isReady(),true);assert.equal(nodes.length,2);await synth.close();
});

for(const stage of ['module','fetch','ready'])test(`primary Game Boy close cancels ${stage} initialization and permits restart`,async t=>{
 const {synth,nodes,gate,reached}=harness(t,stage);
 const canceled=assert.rejects(synth.start(),{name:'AbortError'});
 await until(reached);await synth.close();await canceled;
 gate.resolve();for(const node of nodes)node.send({ready:true});
 assert.equal(synth.gameboy,null);assert.equal(synth.state,'closed');
 assert(nodes.every(node=>!node.connected&&node.port.closed&&node.handlers.size===0));
 const restarting=synth.start();
 if(stage==='ready'){await until(()=>nodes.length===2);nodes[1].send({ready:true});}
 await restarting;assert.equal(synth.isReady(),true);await synth.close();
});
