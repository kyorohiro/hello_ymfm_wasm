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
      const answer=()=>{let value=true;if(message.method==='beginCode')value={session:++this.session,channels:32,operators:6,sampleRate:44100};else if(message.method==='code')value=f.codeReply?f.codeReply(message.args[1],message.args[2]):{session:message.args[0],method:message.args[1],args:message.args[2]};queueMicrotask(()=>this.port.onmessage?.({data:{id:message.id,value,...(f.replyFields?.(message)??{})}}));};
      if(f.hold===message.method)f.held.push(answer);else answer();
    },close:()=>{this.closed=true;}};f.worklets.push(this);queueMicrotask(()=>this.port.onmessage?.({data:{ready:true}}));}
  };
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
  f.release=()=>{f.hold=null;for(const reply of f.held.splice(0))reply();};
  t.after(()=>{for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  return f;
}

test('engine exposes one compensated SCSP route, final Master and session-fenced borrowed clients',async t=>{
  const f=setup(t),engine=await createAudio({onError:error=>f.errors.push(error)});t.after(()=>engine.dispose());
  assert.equal(f.contexts.length,1);assert.equal(f.worklets.length,1);assert.equal(f.contexts[0].modules.length,1);
  assert.equal(engine.outputNode.gain.value,.6);assert.equal(engine.codeInputNode.gain.value,.125);assert.equal(engine.songInputNode.gain.value,.125);
  const [compensation]=engine.codeOutputNode.edges;
  assert.equal(compensation.gain.value,8);assert.equal(engine.codeOutputNode.edges.size,1);assert.equal(engine.songInputNode.edges.size,1);
  assert(f.worklets[0].edges.has(engine.codeInputNode));assert(engine.codeInputNode.edges.has(engine.codeOutputNode));assert(compensation.edges.has(engine.outputNode));assert(engine.outputNode.edges.has(engine.context.destination));assert(engine.songInputNode.edges.has(compensation));
  const client=await engine.getScspClient();assert.equal(await engine.getScspClient(),client);assert.equal(f.messages.filter(m=>m.method==='beginCode').length,1);
  await client.noteOn(0,'C4');engine.setVolume(1.1);assert.equal(engine.outputNode.gain.value,1.1);assert.equal(engine.codeInputNode.gain.value,.125);
  await engine.setPitchBend(.5);assert(f.messages.some(message=>message.method==='setPitchBend'&&message.args[0]===.5));
  await engine.stopCode(client);assert.throws(()=>client.noteOff(0),{name:'AbortError'});
  const fresh=await engine.getScspClient();assert.notEqual(fresh,client);assert.equal(await engine.stopCode(client),false);assert(fresh.isCurrent());
  await fresh.dispose();assert(!fresh.isCurrent());assert.equal(engine.context.state,'running');assert.equal(f.errors.length,0);
});

test('application output restores native level once for Code, keyboard/audition and songs without changing FX drive',async t=>{
  const f=setup(t),engine=await createAudio();
  t.after(()=>engine.dispose());
  const signal=(node,value)=>node===engine.context.destination?value:
    [...node.edges].reduce((sum,next)=>sum+signal(next,node.transform?node.transform(value):value*node.gain.value),0);
  const raw=.15;
  for(const master of [0,.6,1,3.8]){
    engine.setVolume(master);
    assert(Math.abs(signal(f.worklets[0],raw)-raw*master)<1e-12,'one native-output gain for worklet, including its audition mix');
    assert(Math.abs(signal(engine.songInputNode,raw)-raw*master)<1e-12,'same native-output gain for songs');
    assert.equal(engine.codeInputNode.gain.value,.125,'Master never changes the existing FX input');
    assert.equal(engine.songInputNode.gain.value,.125);
  }
  engine.setVolume(.6);
  const fx=engine.context.createGain();fx.transform=value=>Math.tanh(value*4);
  engine.codeInputNode.disconnect(engine.codeOutputNode);engine.codeInputNode.connect(fx);fx.connect(engine.codeOutputNode);
  const expected=Math.tanh(raw*.125*4)*8*.6;
  assert(Math.abs(signal(f.worklets[0],raw)-expected)<1e-12,'compensation follows nonlinear Code FX');
  assert(Math.abs(signal(f.worklets[0],raw)-Math.tanh(raw*4)*.6)>.01,'raising input drive is observably different');
  engine.codeFadeNode.gain.value=0;
  assert.equal(signal(f.worklets[0],raw),0,'Code Stop fade still reaches silence');
  assert(Math.abs(signal(engine.songInputNode,raw)-raw*.6)<1e-12,'Code fade does not silence songs');
  const [compensation]=engine.codeOutputNode.edges;
  await engine.dispose();assert.equal(compensation.edges.size,0);assert.equal(engine.outputNode.edges.size,0);
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

test('Code DSP ACK reaches Main before resolving, without program polling during coefficient motion',async t=>{
  const f=setup(t),changes=[],events=[],engine=await createAudio({onDspChange:change=>{changes.push(change);events.push('ack');}});
  t.after(()=>engine.dispose());const client=await engine.getScspClient();
  const snapshot={words:Array(512).fill(0),custom:true,revision:1,coefficients:{codes:[4095,3840,256],feedback:3840/4096}};
  f.codeReply=method=>method==='applyDspProgram'?snapshot:{codes:[4095,3072,1024],feedback:.75};
  assert.equal(await client.applyDspProgram(snapshot.words).then(value=>{events.push('resolved');return value;}),snapshot);
  assert.deepEqual(events,['ack','resolved']);assert.equal(changes[0].value,snapshot);
  const before=f.messages.length;await client.setDspCoefficients({1:3072,2:1024});
  assert.deepEqual(changes[1],{method:'setDspCoefficients',value:{codes:[4095,3072,1024],feedback:.75}});
  assert.equal(f.messages.length,before+1);assert.equal(f.messages.at(-1).args[1],'setDspCoefficients');
  await client.getDspProgram();assert.equal(changes.length,2,'reads do not publish mutations');
  f.codeReply=()=>({enabled:true,timeMs:200,feedback:-.5,send:15,returnLevel:6});
  await client.setEffect({feedback:-.5});assert.equal(changes[2].method,'setEffect');assert.equal(changes[2].value.feedback,-.5);
});

test('a committed DSP ACK updates its same-engine memo even when Stop has retired the client',async t=>{
  const f=setup(t),changes=[],engine=await createAudio({onDspChange:change=>changes.push(change)});
  t.after(()=>engine.dispose());const client=await engine.getScspClient();f.hold='code';
  const pending=client.setDspCoefficients({1:0}),rejected=assert.rejects(pending,{name:'AbortError'});
  await engine.stopCode(client);f.release();await rejected;assert.equal(changes.length,1);
  const fresh=await engine.getScspClient();await fresh.setDspCoefficients({1:1});assert.equal(changes.length,2);
});

test('acknowledged Code config reaches the portable-save gate before resolving without renderer polling',async t=>{
  const f=setup(t),events=[],config={mode:'fm2',fm:{algorithm:'cycle2',cycle2:{outputs:[1]}}};
  const engine=await createAudio({onConfigChange:change=>{events.push(change);if(change.method==='setConfig')change.value.fm.cycle2.outputs[0]=0;}});
  t.after(()=>engine.dispose());const client=await engine.getScspClient();
  f.codeReply=method=>method==='setConfig'?config:true;
  const before=f.messages.length;
  const returned=await client.setConfig(config).then(value=>{assert.equal(events.length,1);return value;});
  assert.deepEqual(returned,config);assert.deepEqual(returned.fm.cycle2.outputs,[1],'observer owns its copy');
  assert.equal(f.messages.length,before+1,'configuration does not trigger a renderer poll');
  await client.loadPatch({});assert.deepEqual(events[1],{method:'loadPatch',value:true});
  await client.getState();assert.equal(events.length,2,'reads do not alter the save gate');
});

test('a display callback failure does not reject an acknowledged DSP mutation or stop audio',async t=>{
  const f=setup(t),saved=console.error,logs=[];console.error=(...args)=>logs.push(args);t.after(()=>{console.error=saved;});
  const engine=await createAudio({onError:error=>f.errors.push(error),onDspChange:()=>{throw Error('display failed');}});
  t.after(()=>engine.dispose());const client=await engine.getScspClient();
  await client.setDspCoefficients({2:300});assert.equal(logs.length,1);assert.equal(f.errors.length,0);assert.equal(engine.context.state,'running');
});

test('routing ACK metadata reaches the restart memo before the command resolves, including opt-out',async t=>{
  const f=setup(t),events=[],routing={overrides:{sources:Array(6).fill(null),slots:Array(32).fill(null)},returns:[{level:6,pan:31},{level:7,pan:15}]};
  const engine=await createAudio({onDspChange:change=>events.push(change)});t.after(()=>engine.dispose());
  f.replyFields=()=>({dspRoutingState:structuredClone(routing)});
  await engine.command('physicalNoteOn',['key',6,69]).then(()=>{
    assert.equal(events.length,1);assert.deepEqual(events[0],{method:'routingState',value:routing});
  });
  f.replyFields=()=>({dspRoutingState:null});
  await engine.command('loadPatch',[{}]);
  assert.deepEqual(events[1],{method:'routingState',value:null});
  f.replyFields=()=>({});await engine.command('readDspSetup');
  assert.equal(events.length,2,'legacy responses do not manufacture routing metadata');
});
