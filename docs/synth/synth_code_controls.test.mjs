// No AudioContext or browser is used: test source ownership and async controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthProject} from './synth_project.js';
import {setupSynthCodeControls} from './synth_code_controls.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>queueMicrotask(resolve));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await turn();}assert.fail('control operation did not settle');}
class Element {
  constructor(){this.listeners=new Map();this.attributes={};this.dataset={};this.style={};this.value='';this.textContent='';this.hidden=false;this.children=[];this.parentNode=null;
    const classes=new Set();this.classList={toggle:(name,on)=>{on??=!classes.has(name);on?classes.add(name):classes.delete(name);return on;},contains:name=>classes.has(name)};}
  append(...nodes){for(const node of nodes){node.remove();this.children.push(node);node.parentNode=this;}}
  insertBefore(node,before){if(node===before)return;node.remove();const i=before?this.children.indexOf(before):-1;this.children.splice(i<0?this.children.length:i,0,node);node.parentNode=this;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  focus(){this.focused=true;}
  fire(type,extra={}){const event={key:'',code:'',prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const fn of this.listeners.get(type)??[])fn(event);return event;}
}
function fixture({source,storedState=null,journal=new Map(),factory,before,save=true,project=createSynthProject(),monaco=false,stopRuntime=async()=>{},hostOptions={}}={}) {
  const names=['document','localStorage'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const elements=new Map(),byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const home=new Element(),upperEditor=new Element();
  byId('synthWorkspace').append(upperEditor,byId('synthExpandedCodeSlot'));
  upperEditor.append(home);home.append(byId('synthInputSection'));
  byId('synthInputSection').append(byId('synthKeyboardPanel'),byId('synthCodePanel'));
  byId('synthCodePanel').append(byId('synthCodeEditor'),byId('synthCodeEditorHost'));
  byId('synthExpandedCodeSlot').hidden=true;
  byId('synthCodeExpandButton').hidden=true;
  globalThis.document={getElementById:byId,createComment:()=>new Element()};
  globalThis.localStorage={getItem:key=>journal.get(key)??null,setItem:(key,value)=>journal.set(key,String(value)),removeItem:key=>journal.delete(key)};
  if(source!==undefined)project.fs.writeText('/index.js',source);
  const calls={editors:0,factories:0,runs:[],applies:[],stops:0,modes:[],messages:[],saves:0,visibility:[],layouts:0,disposals:0,editorOptions:[]};
  let state=storedState,runtimeState={state:'idle',loopNames:[]};
  const context={marker:'same context'},editor={layout:()=>calls.layouts++,dispose:()=>calls.disposals++,onDidChangeModelContent(){},addCommand(){}};
  const runtime={
    async run(text,options){calls.runs.push({text,options});runtimeState={state:'running',loopNames:[]};},
    async apply(text,options){calls.applies.push({text,options});runtimeState={state:'running',loopNames:[]};},
    async stop(){calls.stops++;await stopRuntime();runtimeState={state:'stopped',loopNames:[]};},getState:()=>runtimeState,getContext:()=>context,
  };
  const files={ready:Promise.resolve(),workspaceId:'workspace-a',setCodeControls(){},getCodeState:()=>state,
    rememberCodeState:value=>{state=structuredClone(value);},persistCode:async()=>{calls.saves++;return save;},
    setVisible:value=>{calls.visibility.push(value);}};
  const controls=setupSynthCodeControls({project,files,
    getRuntime:()=>{calls.factories++;return factory?factory(runtime):runtime;},
    onBeforeRun:before??(async()=>{}),onModeChange:value=>calls.modes.push(value),setStatus:value=>calls.messages.push(value),
    loadEditor:async()=>{calls.editors++;return{initializePlaygroundMonaco:async options=>{
      calls.editorOptions.push(options);
      options.setEditorNote(monaco?'Monaco test':'Plain editor test');
      if(monaco)options.onMonacoEditorReady({monaco:{KeyMod:{CtrlCmd:1,Shift:2},KeyCode:{Enter:4}},monacoEditor:editor});
    }};},...hostOptions});
  return {project,files,controls,calls,byId,journal,runtime,editor,home,upperEditor,get storedState(){return state;},
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

test('host editor/declaration options and recovery journals stay independent from the default FM Synth',async()=>{
  const fmKey='tetorica-fm2612-synth-pending-code',sidKey='tetorica-sid-synth-pending-code';
  const entry=source=>JSON.stringify({workspaceId:'workspace-a',path:'/index.js',source});
  const journal=new Map([[fmKey,entry('// FM recovery')],[sidKey,entry('// SID recovery')]]);
  const transform=source=>'// SID\n'+source;
  const f=fixture({journal,source:'// old SID',storedState:{mode:'code',path:'/index.js'},hostOptions:{
    editorChip:'c64',transformDeclarations:transform,journalKey:sidKey,definitionRuntimeFile:'sid-runtime.js',
  }});
  try {
    await f.controls.ready;await until(()=>f.calls.editorOptions.length);
    assert.equal(f.byId('synthCodeEditor').value,'// SID recovery');
    const options=f.calls.editorOptions[0];assert.equal(options.chip,'c64');assert.equal(options.transformDeclarations,transform);
    assert.equal(options.definitionRuntimeFile,'sid-runtime.js');
    f.byId('synthCodeEditor').value='// changed SID';f.byId('synthCodeEditor').fire('input');
    assert.equal(JSON.parse(journal.get(sidKey)).source,'// changed SID');assert.equal(JSON.parse(journal.get(fmKey)).source,'// FM recovery');
    await f.controls.flush();assert.equal(journal.has(sidKey),false);assert(journal.has(fmKey));
  }finally{f.cleanup();}
  const next=fixture({journal,storedState:{mode:'code',path:'/index.js'}});
  try {
    await next.controls.ready;await until(()=>next.calls.editorOptions.length);
    assert.equal(next.byId('synthCodeEditor').value,'// FM recovery');assert.equal(next.calls.editorOptions[0].chip,'ym2612');
    assert.equal(next.calls.editorOptions[0].definitionRuntimeFile,'playground_code_runtime.js');
  }finally{next.cleanup();}
});

test('a host-supplied starter is seeded verbatim without replacing an existing authored entry',async()=>{
  const source="const sid = await useSoundChip('sid');\n",f=fixture({hostOptions:{getStarterCode:()=>source}});
  try {
    await f.controls.ready;await f.controls.setMode('code');assert.equal(f.project.fs.get('/index.js').data,source);
  }finally{f.cleanup();}
  const next=fixture({source:'// existing',hostOptions:{getStarterCode:()=>source}});
  try {await next.controls.ready;await next.controls.setMode('code');assert.equal(next.byId('synthCodeEditor').value,'// existing');}
  finally{next.cleanup();}
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

test('first Code visit seeds the requested minor-pentatonic phrase without an implicit play helper',async()=>{
  const f=fixture();
  try {
    await f.controls.ready;await f.controls.setMode('code');
    assert.equal(f.project.fs.get('/index.js').data,`const fm = await useSoundChip("ym2612");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("E1", "minorPentatonic", 3);
  fm.noteOn(CH1, choose(notes));
  await sleep(0.1);
  fm.noteOff(CH1);
  await beat(0.025);
});
`);
  }finally{f.cleanup();}
});

test('maximize and restore move the same editor beside Files without altering the source or live session',async()=>{
  const f=fixture({source:'context.marker = "playing";',monaco:true});
  try {
    await f.controls.ready;assert.equal(f.byId('synthCodeExpandButton').hidden,true);
    await f.controls.setMode('code');await until(()=>f.calls.editors===1);
    f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
    await until(()=>!f.byId('synthCodeRunButton').disabled);
    const section=f.byId('synthInputSection'),host=f.byId('synthCodeEditorHost'),context=f.runtime.getContext();
    const modes=[...f.calls.modes];
    f.byId('synthCodeExpandButton').fire('click');await until(()=>f.controls.isExpanded());
    assert.equal(section.parentNode,f.byId('synthExpandedCodeSlot'));
    assert.equal(host.parentNode,f.byId('synthCodePanel'),'the existing editor DOM is retained');
    assert.equal(f.byId('synthExpandedCodeSlot').hidden,false);
    assert(f.byId('synthWorkspace').classList.contains('is-code-expanded'));
    assert.deepEqual(f.calls.visibility,[true]);
    assert.equal(f.byId('synthCodeExpandButton').attributes['aria-pressed'],'true');
    assert.equal(f.byId('synthCodeExpandButton').attributes['aria-label'],'Restore Code');
    assert.deepEqual(f.controls.captureState(),{mode:'code',path:'/index.js'},'layout expansion is not persisted');
    assert.equal(f.project.fs.get('/index.js').data,'context.marker = "playing";');
    assert.equal(f.runtime.getContext(),context);assert.equal(f.calls.stops,0);assert.equal(f.calls.factories,1);
    assert.deepEqual(f.calls.modes,modes,'layout changes do not change performance ownership');

    await f.controls.setExpanded(false);
    assert.equal(section.parentNode,f.home);assert.equal(f.byId('synthExpandedCodeSlot').hidden,true);
    assert(!f.byId('synthWorkspace').classList.contains('is-code-expanded'));
    assert.equal(f.byId('synthCodeExpandButton').attributes['aria-pressed'],'false');
    assert.equal(f.calls.stops,0);assert.equal(f.calls.runs.length,1);assert.equal(f.calls.editors,1);assert.equal(f.calls.disposals,0);
    assert(f.calls.layouts>=2,'the same Monaco editor is laid out for both sizes');

    await f.controls.setExpanded(true);await f.controls.setMode('keyboard');
    assert.equal(section.parentNode,f.home);assert.equal(f.controls.isExpanded(),false);
    assert.equal(f.byId('synthCodeExpandButton').hidden,true);assert.equal(f.calls.stops,1);
  }finally{f.cleanup();}
});

test('workspace replacement and disposal return an expanded editor to its original location',async()=>{
  const f=fixture({source:'// authored'});
  try {
    await f.controls.ready;await f.controls.setExpanded(true);
    await f.controls.workspaceReplaced();
    assert.equal(f.controls.isExpanded(),false);assert.equal(f.controls.isCodeMode(),false);
    assert.equal(f.byId('synthInputSection').parentNode,f.home);
    await f.controls.setExpanded(true);f.controls.dispose();
    assert.equal(f.byId('synthInputSection').parentNode,f.home);
    assert.deepEqual(f.home.children,[f.byId('synthInputSection')],'disposal removes the home anchor');
  }finally{f.cleanup();}
});

test('workspace replacement keeps Code ownership and its editor until the delayed output stop completes',async()=>{
  const fade=deferred(),f=fixture({source:'// current performance',stopRuntime:()=>fade.promise});
  try {
    await f.controls.ready;await f.controls.setExpanded(true);
    f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
    const replacing=f.controls.workspaceReplaced();await until(()=>f.calls.stops===1);
    assert.equal(f.controls.isCodeMode(),true);assert.equal(f.controls.activePath,'/index.js');
    assert.equal(f.controls.isExpanded(),true);assert.equal(f.byId('synthCodeEditor').value,'// current performance');
    assert.deepEqual(f.calls.modes,['code'],'Keyboard cannot reopen the output gate during a Code fade');
    fade.resolve();assert.equal(await replacing,true);
    assert.equal(f.controls.isCodeMode(),false);assert.equal(f.controls.activePath,null);
    assert.equal(f.controls.isExpanded(),false);assert.deepEqual(f.calls.modes,['code','keyboard']);
  }finally{fade.resolve();f.cleanup();}
});

test('a delayed workspace reset cannot close a newer Code file or touch a disposed editor',async()=>{
  for(const newer of ['file','disposed']) {
    const fade=deferred(),f=fixture({source:'// previous',stopRuntime:()=>fade.promise});
    try {
      await f.controls.ready;await f.controls.setMode('code');
      f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
      const replacing=f.controls.workspaceReplaced();await until(()=>f.calls.stops===1);
      if(newer==='file') {
        f.project.fs.writeText('/next.js','// newer choice');await f.controls.openFile('/next.js');
      }else f.controls.dispose();
      fade.resolve();assert.equal(await replacing,false);
      assert.deepEqual(f.calls.modes,['code'],'the stale reset never emits Keyboard');
      if(newer==='file') {
        assert.equal(f.controls.activePath,'/next.js');assert.equal(f.controls.isCodeMode(),true);
        assert.equal(f.byId('synthCodeEditor').value,'// newer choice');
      }
    }finally{fade.resolve();f.cleanup();}
  }
});
