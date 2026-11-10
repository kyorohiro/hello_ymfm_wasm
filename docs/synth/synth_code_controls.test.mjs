// No AudioContext or browser is used: test source ownership and async controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject} from './synth_project.js';
import {setupSynthCodeControls} from './synth_code_controls.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>queueMicrotask(resolve));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await turn();}assert.fail('control operation did not settle');}
class Element {
  constructor(){this.listeners=new Map();this.attributes={};this.dataset={};this.style={};this.value='';this.textContent='';this.hidden=false;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  focus(){this.focused=true;}
  fire(type,extra={}){const event={key:'',code:'',prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const fn of this.listeners.get(type)??[])fn(event);return event;}
}
function fixture({source,storedState=null,journal=new Map(),factory,before,save=true,project=createSynthProject()}={}) {
  const names=['document','localStorage'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const elements=new Map(),byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  globalThis.document={getElementById:byId};
  globalThis.localStorage={getItem:key=>journal.get(key)??null,setItem:(key,value)=>journal.set(key,String(value)),removeItem:key=>journal.delete(key)};
  if(source!==undefined)project.fs.writeText('/index.js',source);
  const calls={editors:0,factories:0,runs:[],applies:[],stops:0,modes:[],messages:[],saves:0};
  let state=storedState,runtimeState={state:'idle',loopNames:[]};
  const runtime={
    async run(text,options){calls.runs.push({text,options});runtimeState={state:'running',loopNames:[]};},
    async apply(text,options){calls.applies.push({text,options});runtimeState={state:'running',loopNames:[]};},
    async stop(){calls.stops++;runtimeState={state:'stopped',loopNames:[]};},getState:()=>runtimeState,
  };
  const files={ready:Promise.resolve(),workspaceId:'workspace-a',setCodeControls(){},getCodeState:()=>state,
    rememberCodeState:value=>{state=structuredClone(value);},persistCode:async()=>{calls.saves++;return save;}};
  const controls=setupSynthCodeControls({project,files,
    getRuntime:()=>{calls.factories++;return factory?factory(runtime):runtime;},
    onBeforeRun:before??(async()=>{}),onModeChange:value=>calls.modes.push(value),setStatus:value=>calls.messages.push(value),
    loadEditor:async()=>{calls.editors++;return{initializePlaygroundMonaco:async options=>options.setEditorNote('Plain editor test')};}});
  return {project,files,controls,calls,byId,journal,runtime,get storedState(){return state;},
    cleanup(){controls.dispose();for(const[name,descriptor]of old)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}};
}

test('Code opens lazily, preserves an existing index, and edits the Cassette independently from instruments',async()=>{
  const f=fixture({source:'// authored\n'});
  try {
    await f.controls.ready;assert.equal(f.calls.editors,0);assert.equal(f.controls.isCodeMode(),false);
    await f.controls.setMode('code');await until(()=>f.calls.editors===1);
    assert.equal(f.byId('synthCodeEditor').value,'// authored\n');assert.equal(f.project.fs.get('/index.js').data,'// authored\n');
    f.byId('synthCodeEditor').value='context.count = 2;\n';f.byId('synthCodeEditor').fire('input');
    assert.equal(f.project.fs.get('/index.js').data,'context.count = 2;\n');assert(f.journal.size);
    await f.controls.flush();assert.equal(f.journal.size,0);assert.deepEqual(f.storedState,{mode:'code',path:'/index.js'});
    await f.controls.setMode('keyboard');await f.controls.setMode('code');assert.equal(f.calls.editors,1);
    assert.equal(f.byId('synthCodeEditor').value,'context.count = 2;\n');
  }finally{f.cleanup();}
});

test('Stop during runtime preparation prevents late Run, and a later Run and Apply use the editor source',async()=>{
  const preparing=deferred(),f=fixture({source:'context.value = 1;',factory:()=>preparing.promise});
  try {
    await f.controls.ready;await f.controls.setMode('code');
    const event=f.byId('synthCodePanel').fire('keydown',{metaKey:true,key:'Enter'});assert(event.prevented);
    await until(()=>f.calls.factories===1);assert.equal(f.byId('synthCodeStopButton').disabled,false);
    await f.controls.stop();assert.equal(f.byId('synthCodeRunButton').disabled,false);
    preparing.resolve(f.runtime);await until(()=>f.calls.stops===1);assert.equal(f.calls.runs.length,0);
    f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
    await until(()=>!f.byId('synthCodeRunButton').disabled);
    f.byId('synthCodeEditor').value='context.value = 2;';f.byId('synthCodeEditor').fire('input');
    f.byId('synthCodeApplyButton').fire('click');await until(()=>f.calls.applies.length===1);
    assert.deepEqual(f.calls.runs,[{text:'context.value = 1;',options:{path:'/index.js'}}]);
    assert.deepEqual(f.calls.applies,[{text:'context.value = 2;',options:{path:'/index.js'}}]);
  }finally{f.cleanup();}
});

test('Stop cancels an operation awaiting the host before any runtime is created',async()=>{
  const before=deferred(),f=fixture({source:'// no late execution',before:()=>before.promise});
  try {
    await f.controls.ready;await f.controls.setMode('code');f.byId('synthCodeRunButton').fire('click');
    await until(()=>f.byId('synthCodeStopButton').disabled===false);await f.controls.stop();before.resolve();
    for(let i=0;i<20;i++)await turn();assert.equal(f.calls.factories,0);assert.equal(f.calls.runs.length,0);
  }finally{f.cleanup();}
});

test('pending code journal recovers the last characters and does not serialize runtime context',async()=>{
  const journal=new Map(),f=fixture({source:'// durable old code',journal,save:false});let state;
  try {
    await f.controls.ready;await f.controls.setMode('code');
    f.byId('synthCodeEditor').value='// last characters before reload';f.byId('synthCodeEditor').fire('input');
    state=structuredClone(f.storedState);assert(journal.size);assert.equal(f.calls.factories,0);
  }finally{f.cleanup();}
  const next=fixture({source:'// durable old code',storedState:state,journal});
  try {
    await next.controls.ready;assert.equal(next.byId('synthCodeEditor').value,'// last characters before reload');
    assert.equal(next.project.fs.get('/index.js').data,'// last characters before reload');
    assert.equal(next.calls.factories,0);assert.equal(next.controls.isCodeMode(),true);
  }finally{next.cleanup();}
});

test('code errors retain the source line in the panel while the shared status remains concise',async()=>{
  const error=new Error('Test source failure');error.stack='Error: Test source failure\n    at tetorica-code:/index.js:12:5';
  const f=fixture({source:'throw Error("Test source failure")',factory:()=>{throw error;}});
  try {
    await f.controls.ready;await f.controls.setMode('code');f.byId('synthCodeRunButton').fire('click');
    await until(()=>f.byId('synthCodeError').textContent.includes('/index.js:12:5'));
    assert.equal(f.calls.messages.at(-1),'Code: Test source failure');
  }finally{f.cleanup();}
});
