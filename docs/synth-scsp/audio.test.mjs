import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudio} from './audio.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t){
  const saved=Object.fromEntries(['AudioContext','AudioWorkletNode','fetch'].map(key=>[key,globalThis[key]]));
  const f={contexts:[],worklets:[],messages:[],held:[],hold:null,errors:[]};
  class Node{
    constructor(context,name){this.context=context;this.name=name;this.edges=new Set();this.gain={value:1,setTargetAtTime(value){this.value=value;}};}
    connect(target){this.edges.add(target);}disconnect(target){if(target)this.edges.delete(target);else this.edges.clear();}
  }
  globalThis.AudioContext=class{
    constructor(){this.state='suspended';this.currentTime=0;this.sampleRate=48000;this.listeners=new Set();this.destination=new Node(this,'destination');this.nodes=[];this.modules=[];this.audioWorklet={addModule:async url=>{this.modules.push(url);}};f.contexts.push(this);}
    async resume(){this.state='running';}async close(){this.state='closed';for(const listener of this.listeners)listener();}
    createGain(){const node=new Node(this,'gain'+this.nodes.length);this.nodes.push(node);return node;}
    addEventListener(_event,listener){this.listeners.add(listener);}removeEventListener(_event,listener){this.listeners.delete(listener);}
  };
  globalThis.AudioWorkletNode=class extends Node{
    constructor(context,name,options){super(context,name);this.session=0;this.options=options;this.closed=false;this.port={onmessage:null,postMessage:message=>{
      f.messages.push(message);if(message.id===undefined)return;
      const answer=()=>{let value=true;if(message.method==='beginCode')value={session:++this.session,channels:32,operators:6,sampleRate:44100};else if(message.method==='code')value={session:message.args[0],method:message.args[1],args:message.args[2]};queueMicrotask(()=>this.port.onmessage?.({data:{id:message.id,value}}));};
      if(f.hold===message.method)f.held.push(answer);else answer();
    },close:()=>{this.closed=true;}};f.worklets.push(this);queueMicrotask(()=>this.port.onmessage?.({data:{ready:true}}));}
  };
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
  f.release=()=>{f.hold=null;for(const reply of f.held.splice(0))reply();};
  t.after(()=>{for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  return f;
}

test('engine exposes one calibrated SCSP route, final Master and session-fenced borrowed clients',async t=>{
  const f=setup(t),engine=await createAudio({onError:error=>f.errors.push(error)});t.after(()=>engine.dispose());
  assert.equal(f.contexts.length,1);assert.equal(f.worklets.length,1);assert.equal(f.contexts[0].modules.length,1);
  assert.equal(engine.outputNode.gain.value,.6);assert.equal(engine.codeInputNode.gain.value,.125);assert.equal(engine.songInputNode.gain.value,.125);
  assert(f.worklets[0].edges.has(engine.codeInputNode));assert(engine.codeInputNode.edges.has(engine.codeOutputNode));assert(engine.codeOutputNode.edges.has(engine.outputNode));assert(engine.outputNode.edges.has(engine.context.destination));assert(engine.songInputNode.edges.has(engine.outputNode));
  const client=await engine.getScspClient();assert.equal(await engine.getScspClient(),client);assert.equal(f.messages.filter(m=>m.method==='beginCode').length,1);
  await client.noteOn(0,'C4');engine.setVolume(1.1);assert.equal(engine.outputNode.gain.value,1.1);assert.equal(engine.codeInputNode.gain.value,.125);
  await engine.setPitchBend(.5);assert(f.messages.some(message=>message.method==='setPitchBend'&&message.args[0]===.5));
  await engine.stopCode(client);assert.throws(()=>client.noteOff(0),{name:'AbortError'});
  const fresh=await engine.getScspClient();assert.notEqual(fresh,client);assert.equal(await engine.stopCode(client),false);assert(fresh.isCurrent());
  await fresh.dispose();assert(!fresh.isCurrent());assert.equal(engine.context.state,'running');assert.equal(f.errors.length,0);
});

test('a stopped pending begin cannot escape its session or overtake a new Run',async t=>{
  const f=setup(t),engine=await createAudio();t.after(()=>engine.dispose());f.hold='beginCode';
  const pending=engine.getScspClient(),rejected=assert.rejects(pending,{name:'AbortError'});await turn();
  const stop=engine.stopCode(),fresh=engine.getScspClient();await turn();assert.equal(f.messages.filter(m=>m.method==='beginCode').length,1);
  f.release();await rejected;await stop;const current=await fresh;await current.noteOn(0,69);
  assert.deepEqual(f.messages.filter(m=>['beginCode','endCode'].includes(m.method)).map(m=>m.method),['beginCode','endCode','beginCode']);
});

test('processor failure closes only its engine and immediately invalidates borrowed clients',async t=>{
  const f=setup(t),engine=await createAudio({onError:error=>f.errors.push(error)}),client=await engine.getScspClient();
  f.worklets[0].onprocessorerror();await turn();assert.equal(f.errors.length,1);assert.equal(engine.context.state,'closed');assert(f.worklets[0].closed);
  assert.throws(()=>client.getState(),{name:'AbortError'});await assert.rejects(engine.getScspClient(),/processor failed/);await engine.dispose();
});
