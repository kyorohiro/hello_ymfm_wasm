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
  focus(){this.focused=true;this.focusCount=(this.focusCount??0)+1;}
  fire(type,extra={}){const event={key:'',code:'',prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const fn of this.listeners.get(type)??[])fn(event);return event;}
}
function fixture({source,storedState=null,journal=new Map(),factory,before,save=true,project=createSynthProject(),monaco=false,stopRuntime=async()=>{},hostOptions={}}={}) {
  const names=['document','localStorage'],old=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const elements=new Map(),byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const home=new Element(),upperEditor=new Element();
  byId('synthWorkspace').append(upperEditor,byId('synthExpandedCodeSlot'));
  upperEditor.append(home);home.append(byId('synthInputSection'));
  byId('synthInputSection').append(byId('synthKeyboardPanel'),byId('synthCodePanel'));
  const transport=new Element();transport.append(byId('synthCodeRunButton'),byId('synthCodeApplyButton'),byId('synthCodeStopButton'),byId('synthCodeState'));
  byId('synthCodePanel').append(transport);
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

test('opt-in Keyboard is a view change with a shared transport, preserving a running session',async()=>{
  const f=fixture({source:'context.count = 1;',hostOptions:{keepRunningOnKeyboard:true}});
  try{
    await f.controls.ready;await f.controls.setMode('code');
    f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1&&!f.byId('synthCodeRunButton').disabled);
    const context=f.runtime.getContext(),transport=f.byId('synthCodeStopButton').parentNode;
    await f.controls.setMode('keyboard');
    assert.equal(f.calls.stops,0);assert.equal(f.runtime.getContext(),context);assert.equal(f.runtime.getState().state,'running');
    assert.equal(transport.parentNode,f.byId('synthInputSection'));assert.equal(transport.dataset.codeTransport,'shared');
    assert.equal(f.byId('synthKeyboardPanel').hidden,false);assert.equal(f.byId('synthCodePanel').hidden,true);
    await f.controls.setMode('code');assert.equal(f.calls.runs.length,1);assert.equal(f.calls.stops,0);
    f.byId('synthCodeStopButton').fire('click');await until(()=>f.calls.stops===1);
  }finally{f.cleanup();}
});

test('opt-in Keyboard does not cancel a Run waiting for its runtime, while workspace replacement still stops it',async()=>{
  const pending=deferred(),f=fixture({source:'// same pending Run',factory:()=>pending.promise,hostOptions:{keepRunningOnKeyboard:true}});
  try{
    await f.controls.ready;await f.controls.setMode('code');f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.factories===1);
    await f.controls.setMode('keyboard');pending.resolve(f.runtime);await until(()=>f.calls.runs.length===1);
    assert.equal(f.calls.stops,0);assert.equal(f.controls.isCodeMode(),false);
    await f.controls.workspaceReplaced();assert.equal(f.calls.stops,1);assert.equal(f.controls.activePath,null);
  }finally{f.cleanup();}
});

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

test('Code tab keeps musical focus while explicit file editing still focuses the editor',async()=>{
  for(const monaco of [false,true]){
    const f=fixture({source:'// keep my code',monaco});
    try{
      await f.controls.ready;f.byId('synthInputCodeTab').fire('click');
      await until(()=>f.controls.isCodeMode()&&f.calls.editors===1);
      assert.equal(f.byId('synthCodeEditor').focusCount??0,0,'view switching does not start typing');
      assert.equal(f.byId('synthInputCodeTab').focused,true,'clicking a tab explicitly leaves editor focus on Safari too');
      assert.equal(f.project.fs.get('/index.js').data,'// keep my code');
      assert.equal(f.calls.factories,0);assert.equal(f.calls.stops,0);
      await f.controls.openFile('/index.js');
      assert.equal(f.byId('synthCodeEditor').focusCount,1,'explicit file editing takes typing focus');
      const before=f.byId('synthCodeEditor').focusCount;
      f.byId('synthInputCodeTab').fire('keydown',{key:'Home'});
      await until(()=>!f.controls.isCodeMode()&&f.byId('synthInputKeyboardTab').focused);
      f.byId('synthInputKeyboardTab').fire('keydown',{key:'End'});
      await until(()=>f.controls.isCodeMode()&&f.byId('synthInputCodeTab').focused);
      assert.equal(f.byId('synthCodeEditor').focusCount,before,'arrow navigation focuses tabs rather than the editor');
    }finally{f.cleanup();}
  }
});

test('Code panel protects typing but lets toolbar performance keys bubble, and tab focus can Run',async()=>{
  const f=fixture({source:'// performance and typing'});
  try{
    await f.controls.ready;await f.controls.setMode('code',{focusEditor:false});
    let stopped=0;
    f.byId('synthCodePanel').fire('keydown',{key:'a',target:f.byId('synthCodeRunButton'),stopPropagation(){stopped++;}});
    assert.equal(stopped,0,'non-text toolbar focus permits musical input');
    for(const selector of ['input','textarea','select','[contenteditable]','dialog[open]','.monaco-editor','#synthCodeEditorHost']){
      f.byId('synthCodePanel').fire('keydown',{key:'a',target:{closest:query=>query.split(',').includes(selector)},stopPropagation(){stopped++;}});
    }
    assert.equal(stopped,7,'text editors and modal controls retain their keys');
    for(const key of [' ','Enter']){
      const native=f.byId('synthCodePanel').fire('keydown',{key,target:{closest:query=>query.split(',').includes('button')},stopPropagation(){stopped++;}});
      assert.equal(native.prevented,false,'native button activation remains available');
    }
    assert.equal(stopped,9);
    const event=f.byId('synthInputSection').fire('keydown',{metaKey:true,key:'Enter',target:f.byId('synthInputCodeTab')});
    assert(event.prevented);await until(()=>f.calls.runs.length===1);
    await until(()=>!f.byId('synthCodeRunButton').disabled);await f.controls.setExpanded(true);
    const expanded=f.byId('synthCodePanel').fire('keydown',{metaKey:true,shiftKey:true,key:'Enter',target:f.byId('synthCodeEditor')});
    assert(expanded.prevented);await until(()=>f.calls.applies.length===1);
    assert.equal(f.calls.runs.length,1,'expanded shortcut executes only one action');
  }finally{f.cleanup();}
});

test('an older pending flush cannot remove a newer edit recovery journal',async()=>{
  const gate=deferred(),f=fixture({source:'// original'});
  try {
    await f.controls.ready;await f.controls.setMode('code');
    const saved=[];f.files.persistCode=()=>{saved.push(f.project.fs.get('/index.js').data);return saved.length===1?gate.promise:Promise.resolve(true);};
    f.byId('synthCodeEditor').value='// old saved snapshot';f.byId('synthCodeEditor').fire('input');
    const older=f.controls.flush();assert.deepEqual(saved,['// old saved snapshot']);
    f.byId('synthCodeEditor').value='// newer unsaved source';f.byId('synthCodeEditor').fire('input');
    const newest=[...f.journal.values()][0];gate.resolve(true);await older;
    assert.equal([...f.journal.values()][0],newest,'only the older source committed; newer source keeps recovery');
    await f.controls.flush();assert.equal(f.journal.size,0);assert.equal(saved.at(-1),'// newer unsaved source');
  }finally{f.cleanup();}
});

test('a pending flush cannot clear recovery from a replacement workspace',async()=>{
  const gate=deferred(),f=fixture({source:'// first workspace'});
  try {
    await f.controls.ready;await f.controls.setMode('code');
    f.files.persistCode=()=>gate.promise;
    const pending=f.controls.flush();f.files.workspaceId='workspace-b';
    f.byId('synthCodeEditor').value='// replacement';f.byId('synthCodeEditor').fire('input');
    const journal=[...f.journal.values()][0];gate.resolve(true);await pending;
    assert.equal([...f.journal.values()][0],journal);assert.equal(JSON.parse(journal).workspaceId,'workspace-b');
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
    const event=f.byId('synthInputSection').fire('keydown',{metaKey:true,key:'Enter'});assert(event.prevented);
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
  await beat(0.2);
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

test('non-JavaScript editing is opt-in and hidden JSON opening changes no mode, focus, editor startup or runtime',async()=>{
  const defaultHost=fixture({source:'// existing JS'});
  try {
    await defaultHost.controls.ready;defaultHost.project.fs.writeText('/preset.json','{"volume":1}');
    await assert.rejects(defaultHost.controls.openFile('/preset.json'),/JavaScript/);assert.equal(defaultHost.calls.factories,0);
  }finally{defaultHost.cleanup();}
  let preparations=0;
  const f=fixture({source:'// retained JS',before:()=>{preparations++;},hostOptions:{allowTextFiles:true,maxTextLength:16*1024*1024}});
  try {
    await f.controls.ready;f.project.fs.writeText('/preset.json','{"volume":1}');
    await f.controls.openFile('/preset.json',{show:false});
    assert.equal(f.controls.isCodeMode(),false);assert.deepEqual(f.controls.captureState(),{mode:'keyboard',path:'/preset.json'});
    assert.equal(f.byId('synthCodeEditor').value,'{"volume":1}');assert.equal(f.byId('synthCodeEditor').focusCount,undefined);
    assert.equal(f.calls.editors,0);assert.deepEqual(f.calls.modes,[]);
    assert.equal(f.byId('synthCodePanel').dataset.editorKind,'text');assert.equal(f.byId('synthCodePanel').dataset.runnable,'false');
    assert.equal(f.byId('synthCodeRunButton').disabled,true);assert.equal(f.byId('synthCodeApplyButton').disabled,true);
    f.byId('synthCodeRunButton').fire('click');f.byId('synthCodeApplyButton').fire('click');
    f.byId('synthInputSection').fire('keydown',{metaKey:true,key:'Enter'});for(let i=0;i<10;i++)await turn();
    assert.equal(f.calls.factories,0);assert.equal(preparations,0);
    f.byId('synthCodeEditor').value='{"volume":2}';f.byId('synthCodeEditor').fire('input');
    assert.equal(f.project.fs.get('/preset.json').data,'{"volume":2}');
    await f.controls.setMode('code');assert.equal(f.byId('synthCodeEditor').value,'{"volume":2}');
    await f.controls.openFile('/index.js');assert.equal(f.byId('synthCodeRunButton').disabled,false);
    f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);assert.equal(preparations,1);
  }finally{f.cleanup();}
});

test('JSON display and autosave leave a running JS performance independent, including hidden saves and text deletion',async()=>{
  const f=fixture({source:'// running source',hostOptions:{allowTextFiles:true}});
  try {
    await f.controls.ready;await f.controls.setMode('code');f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
    const focus=f.byId('synthCodeEditor').focusCount,context=f.runtime.getContext(),modes=[...f.calls.modes];
    f.project.fs.writeText('/presets/saved.json','{"saved":true}');await f.controls.openFile('/presets/saved.json',{show:false});
    assert.equal(f.controls.activePath,'/presets/saved.json');assert.equal(f.controls.executionPath,'/index.js');
    assert.equal(f.byId('synthCodeEditor').focusCount,focus);assert.deepEqual(f.calls.modes,modes);
    assert.equal(f.calls.stops,0);assert.equal(f.runtime.getContext(),context);assert.equal(f.byId('synthCodeStopButton').disabled,false);
    f.byId('synthCodeEditor').value='{"saved":"edited"}';f.byId('synthCodeEditor').fire('input');await f.controls.flush();
    assert.equal(f.project.fs.get('/presets/saved.json').data,'{"saved":"edited"}');assert.equal(f.calls.applies.length,0);
    f.project.fs.remove('/presets/saved.json');f.controls.pathChanged('/presets/saved.json',null);
    assert.equal(f.controls.activePath,null);assert.equal(f.controls.executionPath,'/index.js');assert.equal(f.calls.stops,0);
    f.project.fs.writeText('/renamed.mjs',f.project.fs.get('/index.js').data);f.project.fs.remove('/index.js');f.controls.pathChanged('/index.js','/renamed.mjs');
    assert.equal(f.controls.executionPath,'/renamed.mjs');assert.equal(f.calls.stops,0);
    f.project.fs.writeText('/renamed.json',f.project.fs.get('/renamed.mjs').data);f.project.fs.remove('/renamed.mjs');f.controls.pathChanged('/renamed.mjs','/renamed.json');
    await until(()=>f.calls.stops===1&&f.controls.executionPath===null);
  }finally{f.cleanup();}
});

test('switching pending Run preparation to JSON cancels that execution without creating a runtime',async()=>{
  const before=deferred(),f=fixture({source:'globalThis.mustNotRun=true;',before:()=>before.promise,hostOptions:{allowTextFiles:true}});
  try {
    await f.controls.ready;await f.controls.setMode('code');f.project.fs.writeText('/text.json','globalThis.mustNotRun=true;');
    f.byId('synthCodeRunButton').fire('click');await until(()=>f.byId('synthCodeStopButton').disabled===false);
    await f.controls.openFile('/text.json');before.resolve();for(let i=0;i<20;i++)await turn();
    assert.equal(f.calls.factories,0);assert.equal(f.calls.runs.length,0);assert.equal(f.calls.applies.length,0);assert.equal(globalThis.mustNotRun,undefined);
    assert.equal(f.byId('synthCodeRunButton').disabled,true);assert.equal(f.byId('synthCodeApplyButton').disabled,true);
  }finally{before.resolve();f.cleanup();}
});

test('large JSON source and recovery use the opt-in text bound while JavaScript retains its 2 MiB limit',async()=>{
  const text='{"sample":"'+'a'.repeat(2*1024*1024)+'"}',journal=new Map();
  const project=createSynthProject();project.fs.writeText('/sample.json',text);
  const f=fixture({project,journal,save:false,hostOptions:{allowTextFiles:true,maxTextLength:16*1024*1024}});let state;
  try {
    await f.controls.ready;await f.controls.openFile('/sample.json',{show:false});
    f.byId('synthCodeEditor').value=text+'\n';f.byId('synthCodeEditor').fire('input');state=f.controls.captureState();
    assert.equal(project.fs.get('/sample.json').data,text+'\n');assert(journal.size);
    project.fs.writeText('/large.js','x'.repeat(2*1024*1024+1));
    await assert.rejects(f.controls.openFile('/large.js'),/JavaScript file exceeds 2 MiB/);
    assert.equal(f.controls.activePath,'/sample.json');assert.equal(f.calls.factories,0);
  }finally{f.cleanup();}
  const restored=createSynthProject();restored.fs.writeText('/sample.json',text);
  const next=fixture({project:restored,journal,storedState:state,hostOptions:{allowTextFiles:true,maxTextLength:16*1024*1024}});
  try {
    await next.controls.ready;assert.equal(next.controls.isCodeMode(),false);assert.equal(next.controls.activePath,'/sample.json');
    assert.equal(next.byId('synthCodeEditor').value,text+'\n');assert.equal(next.calls.factories,0);assert.equal(next.calls.editors,0);
  }finally{next.cleanup();}
});

test('Monaco JSON/text models and rename paths keep explicit non-executable languages, including uppercase JSON',async()=>{
  let model={path:'',source:'',language:'javascript'},changed=()=>{};const language=[];
  const editor={getModel:()=>model,layout(){},dispose(){},onDidChangeModelContent(fn){changed=fn;},addCommand(){}};
  const f=fixture({source:'// JS',hostOptions:{allowTextFiles:true,loadEditor:async()=>({initializePlaygroundMonaco:async options=>{
    options.setEditorAdapter({getValue:()=>model.source,setValue:value=>{model.source=value;changed();},
      openVirtualFile(path,source){model={path,source,language:'javascript'};changed();},focus(){},setReadOnly(){},syncVirtualFiles(){}});
    options.onMonacoEditorReady({monaco:{KeyMod:{CtrlCmd:1,Shift:2},KeyCode:{Enter:4},editor:{setModelLanguage(target,value){target.language=value;language.push(value);}}},monacoEditor:editor});
  }})}});
  try {
    await f.controls.ready;f.project.fs.writeText('/saved.JSON','{"valid":true}');await f.controls.openFile('/saved.JSON');
    await until(()=>model.path==='/saved.JSON'&&model.language==='json');assert.equal(f.calls.factories,0);
    model.source='{"valid":"edited"}';changed();assert.equal(f.project.fs.get('/saved.JSON').data,model.source);
    f.project.fs.writeText('/renamed.txt',model.source);f.project.fs.remove('/saved.JSON');f.controls.pathChanged('/saved.JSON','/renamed.txt');
    assert.equal(model.path,'/renamed.txt');assert.equal(model.language,'plaintext');assert.equal(f.byId('synthCodeRunButton').disabled,true);
    f.project.fs.writeText('/renamed.js',model.source);f.project.fs.remove('/renamed.txt');f.controls.pathChanged('/renamed.txt','/renamed.js');
    assert.equal(model.language,'javascript');assert.equal(f.byId('synthCodeRunButton').disabled,false);
    assert(language.includes('json'));assert(language.includes('plaintext'));assert.equal(f.calls.stops,0);
  }finally{f.cleanup();}
});

test('renaming the active running JS to text stops its execution while retaining the renamed editable document',async()=>{
  const fade=deferred(),f=fixture({source:'// borrowed JS',stopRuntime:()=>fade.promise,hostOptions:{allowTextFiles:true}});
  try {
    await f.controls.ready;await f.controls.setMode('code');f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
    f.project.fs.writeText('/renamed.json',f.project.fs.get('/index.js').data);f.project.fs.remove('/index.js');
    f.controls.pathChanged('/index.js','/renamed.json');assert.equal(f.calls.stops,1);
    assert.equal(f.controls.activePath,'/renamed.json');assert.equal(f.controls.executionPath,'/index.js');assert.equal(f.byId('synthCodeRunButton').disabled,true);
    fade.resolve();await until(()=>f.controls.executionPath===null);assert.equal(f.byId('synthCodeEditor').value,'// borrowed JS');
  }finally{fade.resolve();f.cleanup();}
});

test('JSON selection intent cancels an older Run even when its storage flush finishes before the JSON flush',async()=>{
  for(const show of [true,false]) {
    const runFlush=deferred(),jsonFlush=deferred();let preparations=0,saves=0;
    const f=fixture({source:'// old JS must not start',before:()=>{preparations++;},hostOptions:{allowTextFiles:true}});
    try {
      await f.controls.ready;await f.controls.setMode('code');f.project.fs.writeText('/next.json','{"selected":true}');
      f.files.persistCode=()=>++saves===1?runFlush.promise:saves===2?jsonFlush.promise:Promise.resolve(true);
      f.byId('synthCodeRunButton').fire('click');await until(()=>saves===1);
      const selection=f.controls.openFile('/next.json',{show});await until(()=>saves===2);
      assert.equal(f.controls.activePath,'/index.js','the JSON document has not loaded yet');
      assert.equal(f.byId('synthCodeRunButton').disabled,true);
      runFlush.resolve(true);for(let i=0;i<20;i++)await turn();
      assert.equal(preparations,0);assert.equal(f.calls.factories,0);assert.equal(f.calls.runs.length,0);
      f.byId('synthInputSection').fire('keydown',{metaKey:true,key:'Enter'});for(let i=0;i<10;i++)await turn();
      assert.equal(preparations,0,'execution remains blocked while the newer file open is pending');
      jsonFlush.resolve(true);assert.equal(await selection,true);assert.equal(f.controls.activePath,'/next.json');
      assert.equal(f.byId('synthCodeRunButton').disabled,true);assert.equal(f.calls.factories,0);
    }finally{runFlush.resolve(true);jsonFlush.resolve(true);f.cleanup();}
  }
});

test('Files can cancel pending execution at click intent before its own flush reaches openFile',async()=>{
  const runFlush=deferred(),fileFlush=deferred();let preparations=0,saves=0;
  const f=fixture({source:'// must not stop PSF',before:()=>{preparations++;},hostOptions:{allowTextFiles:true}});
  try {
    await f.controls.ready;await f.controls.setMode('code');f.project.fs.writeText('/preset.json','{"preset":true}');
    f.files.persistCode=()=>++saves===1?runFlush.promise:saves===2?fileFlush.promise:Promise.resolve(true);
    f.byId('synthCodeRunButton').fire('click');await until(()=>saves===1);
    assert.equal(f.controls.cancelPendingExecution(),true);
    const adapterFlush=f.controls.flush();await until(()=>saves===2);
    runFlush.resolve(true);for(let i=0;i<20;i++)await turn();
    assert.equal(f.controls.activePath,'/index.js','Files is still awaiting storage and has not called openFile');
    assert.equal(preparations,0);assert.equal(f.calls.factories,0);assert.equal(f.calls.stops,0);
    fileFlush.resolve(true);await adapterFlush;await f.controls.openFile('/preset.json');
    assert.equal(f.controls.activePath,'/preset.json');assert.equal(f.calls.runs.length,0);
    assert.equal(f.controls.cancelPendingExecution(),false);
  }finally{runFlush.resolve(true);fileFlush.resolve(true);f.cleanup();}
});

test('Run may still initialize its own first JavaScript document without cancelling that execution',async()=>{
  const f=fixture();
  try {
    await f.controls.ready;f.byId('synthCodeRunButton').fire('click');await until(()=>f.calls.runs.length===1);
    assert.equal(f.controls.activePath,'/index.js');assert.equal(f.calls.runs[0].options.path,'/index.js');
    assert.match(f.calls.runs[0].text,/useSoundChip\("ym2612"\)/);assert.equal(f.calls.factories,1);
  }finally{f.cleanup();}
});

test('a JSON selection in the same tick as initial Run cannot be replaced by its stale private JavaScript initialization',async()=>{
  for(const show of [true,false]) {
    const f=fixture({hostOptions:{allowTextFiles:true}});
    try {
      await f.controls.ready;f.project.fs.writeText('/preset.json','{"latest":"JSON"}');
      f.byId('synthCodeRunButton').fire('click');
      assert.equal(await f.controls.openFile('/preset.json',{show}),true);
      for(let i=0;i<20;i++)await turn();
      assert.equal(f.controls.activePath,'/preset.json');assert.equal(f.byId('synthCodeEditor').value,'{"latest":"JSON"}');
      assert.equal(f.project.fs.has('/index.js'),false,'the cancelled Run cannot create a replacement JS file');
      assert.equal(f.calls.factories,0);assert.equal(f.calls.runs.length,0);assert.equal(f.controls.isCodeMode(),show);
      assert.equal(f.byId('synthCodeEditor').focusCount??0,show?1:0);
    }finally{f.cleanup();}
  }
});

test('a stale first Code-tab request cannot reveal or focus its editor after a newer hidden JSON selection',async()=>{
  const f=fixture({hostOptions:{allowTextFiles:true}});
  try {
    await f.controls.ready;f.project.fs.writeText('/preset.json','{"latest":true}');
    const openingCode=f.controls.setMode('code'),openingJson=f.controls.openFile('/preset.json',{show:false});
    assert.equal(await openingCode,false);assert.equal(await openingJson,true);
    assert.equal(f.controls.activePath,'/preset.json');assert.equal(f.controls.isCodeMode(),false);
    assert.equal(f.byId('synthCodeEditor').focusCount,undefined);assert.equal(f.project.fs.has('/index.js'),false);
  }finally{f.cleanup();}
});

test('mixed JS/text Monaco disables occurrences once before attachment while default hosts remain unchanged',async()=>{
  const events=[];let model={path:'',source:''},option='multiFile';
  const editor={getModel:()=>model,getOption:id=>{assert.equal(id,78);events.push(['read',option]);return option;},
    updateOptions(value){option=value.occurrencesHighlight;events.push(['option',option]);},layout(){},dispose(){},onDidChangeModelContent(){},addCommand(){}};
  const project=createSynthProject();project.fs.writeText('/saved.json','{"restored":true}');project.fs.writeText('/index.js','// JS');
  const f=fixture({project,storedState:{mode:'code',path:'/saved.json'},hostOptions:{allowTextFiles:true,
    loadEditor:async()=>({initializePlaygroundMonaco:async options=>{
      options.setEditorAdapter({getValue:()=>model.source,setValue:source=>{model.source=source;},setReadOnly(){},focus(){},
        openVirtualFile(path,source){events.push(['attach',path,option]);model={path,source};}});
      options.onMonacoEditorReady({monaco:{KeyMod:{CtrlCmd:1,Shift:2},KeyCode:{Enter:4},editor:{EditorOption:{occurrencesHighlight:78},setModelLanguage(){}}},monacoEditor:editor});
    }})}});
  try {
    await f.controls.ready;await until(()=>model.path==='/saved.json');
    assert.deepEqual(events.slice(0,2),[['option','off'],['attach','/saved.json','off']]);
    await f.controls.openFile('/index.js');assert.deepEqual(events.at(-1),['attach','/index.js','off']);
    await f.controls.openFile('/saved.json');assert.deepEqual(events.at(-1),['attach','/saved.json','off']);
    assert.equal(events.filter(event=>event[0]==='option').length,1);assert.equal(events.filter(event=>event[0]==='read').length,0);assert.equal(f.calls.factories,0);
  }finally{f.cleanup();}
  const untouched=[];
  const defaults=fixture({source:'// default host',monaco:true,hostOptions:{loadEditor:async()=>({initializePlaygroundMonaco:async options=>{
    options.onMonacoEditorReady({monaco:{KeyMod:{CtrlCmd:1,Shift:2},KeyCode:{Enter:4},editor:{EditorOption:{occurrencesHighlight:78}}},
      monacoEditor:{layout(){},dispose(){},onDidChangeModelContent(){},addCommand(){},getOption(){untouched.push('read');},updateOptions(){untouched.push('write');}}});
  }})}});
  try{await defaults.controls.ready;await defaults.controls.setMode('code');await until(()=>defaults.byId('synthCodeEditorNote').textContent!==undefined);for(let i=0;i<10;i++)await turn();assert.deepEqual(untouched,[]);}
  finally{defaults.cleanup();}
});
