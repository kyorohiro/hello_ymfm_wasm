import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPlaygroundUi} from './playground_ui.js';

class Element {
  constructor(ownerDocument,tag='div'){this.ownerDocument=ownerDocument;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.listeners=new Map();this.hidden=false;this.textContent='';this.value='';}
  setAttribute(name,value){this.attributes[name]=value;}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  prepend(node){node.remove();node.parent=this;this.children.unshift(node);}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
  dispatch(name,extra={}){const event={preventDefault(){this.prevented=true;},...extra};for(const callback of this.listeners.get(name)??[])callback(event);return event;}
  focus(){this.focused=true;}
}
const document={createElement:tag=>new Element(document,tag)};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const plain=value=>JSON.parse(JSON.stringify(value));
function snapshot({algorithm=4,tl=13}={}){
  const registers=Array.from({length:2},()=>new Array(256).fill(0));registers[0][0x2b]=128;registers[0][0x27]=64;
  return {registers,fmState:{lfo:{enabled:true,frequency:3},channels:Array.from({length:6},(_,ch)=>({algorithm,feedback:2,ams:1,pms:5,left:ch%2===0,right:ch%2!==0,
    operators:Array.from({length:4},(_,op)=>({dt:op,multi:op+1,tl:tl+ch*4+op,rs:2,ar:31,am:true,d1r:4,d2r:7,sl:3,rr:12,ssg:op+8})),
    ...(ch===2?{specialFrequencies:Array.from({length:4},(_,op)=>({block:op+1,fnum:100+op}))}:{}),}))}};
}
function inspector(entries=[]){
  const listeners=new Set(),tokens=new Map(entries.map((entry,i)=>[entry.id,i+1]));
  return {entries,tokens,reads:[],writes:[],readResult:()=>snapshot(),invokeResult:()=>Promise.resolve(),
    list(){return this.entries;},getConnectionToken(id){if(!this.entries.some(entry=>entry.id===id)||!tokens.has(id))throw Error('Sound chip is not connected');return tokens.get(id);},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},notify(){for(const listener of listeners)listener();},
    read(id){this.reads.push(id);return this.readResult(id);},invoke(id,method,args){this.writes.push({id,method,args});return this.invokeResult(id,method,args);},
    get subscribers(){return listeners.size;},
  };
}
function setup({entries=[],primary=false,inspect=inspector(entries)}={}){
  const root=new Element(document),primaryRoot=new Element(document),button=new Element(document,'button');root.append(primaryRoot);
  const editors=[],statuses=[],targets=[],availability=[],primaryVisibility=[];
  const primaryEditor=primary?{setVisible:value=>primaryVisibility.push(value)}:null;
  const source=readFileSync(new URL('./playground_extra_fm_editor.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
  const context=vm.createContext({DOMException,createPlaygroundOperatorTab(options){
    const edits={options,channel:0,presets:[],globals:[],registered:[],removed:[],visibility:[],disposed:0,
      attachSynth(synth){this.synth=synth;},syncPreset(...args){this.presets.push(args);},syncLfo(...args){this.globals.push(['lfo',...args]);},syncDacEnabled(value){this.globals.push(['dac',value]);},
      syncChannel3SpecialMode(value){this.globals.push(['special',value]);},syncChannel3SpecialFrequency(...args){this.globals.push(['frequency',...args]);},
      getSelectedChannel(){return this.channel;},setVisible(value){this.visibility.push(value);},dispose(){this.disposed++;},
      registerPresetOption(...args){this.registered.push(args);},removePresetOption(...args){this.removed.push(args);},
    };editors.push(edits);return edits;
  }});vm.runInContext(source,context);
  let activeInspector=inspect;
  const controller=context.createPlaygroundExtraFmEditor({root,primaryRoot,primaryEditor,primaryKind:'ym2612',button,getInspector:()=>activeInspector,
    presets:{},presetOrder:[],onAvailability:value=>availability.push(value),onTargetChange:value=>targets.push(value),onStatus:value=>statuses.push(value)});
  const toolbar=root.children[0],select=toolbar.children[0].children[0],refresh=toolbar.children[1],status=toolbar.children[2],extraRoot=root.children.at(-1);
  return {root,primaryRoot,button,primaryEditor,inspect,controller,toolbar,select,refresh,status,extraRoot,editors,statuses,targets,availability,primaryVisibility,
    setInspector:value=>{activeInspector=value;},choose:id=>{select.value=id;select.dispatch('change');}};
}
const chip=(id,extra=true,kind='ym2612')=>({id,kind,connected:true,...(extra?{additional:true}:{})});

test('only explicitly additional YM2612 instances appear, including a valid ym2612 ID outside Genesis',async()=>{
  const f=setup({entries:[chip('ym2612'),chip('lead'),chip('borrowed',false),chip('other',true,'ym2203'),{...chip('gone'),connected:false}]});
  assert.deepEqual(f.select.children.map(option=>option.value),['ym2612','lead']);
  assert.equal(f.select.value,'ym2612');assert.equal(f.editors.length,1);assert.equal(f.inspect.reads.length,0,'hidden tabs perform no state reads');
  assert.equal(f.toolbar.hidden,false);assert.equal(f.primaryRoot.hidden,true);assert.equal(f.availability.at(-1),true);
  f.controller.setVisible(true);await settle();assert.deepEqual(f.inspect.reads,['ym2612']);assert.equal(f.targets.at(-1).id,'ym2612');f.controller.dispose();
});

test('visible snapshots fill the existing OPN editor with all four logical operators and chip-wide controls without writes',async()=>{
  const f=setup({entries:[chip('lead')]});f.controller.setVisible(true);await settle();
  const editor=f.editors[0];assert.equal(editor.presets.length,6);
  for(let ch=0;ch<6;ch++){
    const [channel,presetName,value]=editor.presets[ch];assert.equal(channel,ch);assert.equal(presetName,'');
    assert(Array.isArray(value.operators),'syncPreset accepts a logical operator array, not a keyed object');
    assert.deepEqual(value.operators.map(op=>op.tl),[13+ch*4,14+ch*4,15+ch*4,16+ch*4]);
    assert.deepEqual(plain(value.pan),{left:ch%2===0,right:ch%2!==0});
  }
  assert.deepEqual(plain(editor.globals),[['lfo',true,3],['dac',true],['special',true],['frequency',0,1,100],['frequency',1,2,101],['frequency',2,3,102],['frequency',3,4,103]]);
  assert.deepEqual(f.inspect.writes,[],'reading or selecting a source never rewrites its patch');
  await settle();assert.deepEqual(f.inspect.reads,['lead'],'there is no timer/polling refresh');
  f.refresh.dispatch('click');await settle();assert.deepEqual(f.inspect.reads,['lead','lead']);f.controller.dispose();
});

test('edits use the selected independent chip and publish its exact keyboard channel',async()=>{
  const f=setup({entries:[chip('lead'),chip('bass')]});f.controller.setVisible(true);await settle();
  f.choose('bass');await settle();const editor=f.editors.at(-1);editor.channel=4;f.extraRoot.dispatch('change');
  assert.deepEqual(plain(f.targets.at(-1)),{kind:'ym2612',id:'bass',channel:'fm:4'});
  editor.synth.setOperator(4,2,{tl:41});await settle();
  assert.deepEqual(plain(f.inspect.writes),[{id:'bass',method:'setOperator',args:[4,2,{tl:41}]}]);
  assert.equal(f.inspect.reads.at(-1),'bass','the edited instance receives an applied-state refresh');
  f.controller.setVisible(false);assert.equal(f.targets.at(-1),null);const count=f.inspect.reads.length;f.inspect.notify();await settle();assert.equal(f.inspect.reads.length,count);f.controller.dispose();
});

test('primary OPN remains the initial selection and resumes when the last additional instance disappears',async()=>{
  const f=setup({entries:[chip('ym2612',false),chip('lead')],primary:true});
  assert.deepEqual(f.select.children.map(option=>option.value),['','lead']);assert.equal(f.select.value,'');assert.equal(f.editors.length,0);
  f.controller.setVisible(true);await settle();assert.equal(f.primaryRoot.hidden,false);assert.equal(f.primaryVisibility.at(-1),true);assert.deepEqual(f.inspect.reads,[]);
  f.choose('lead');await settle();const old=f.editors[0];assert.equal(f.primaryRoot.hidden,true);assert.equal(f.primaryVisibility.at(-1),false);
  f.inspect.entries=[chip('ym2612',false)];f.inspect.notify();await settle();
  assert.equal(old.disposed,1);assert.equal(f.select.value,'');assert.equal(f.primaryRoot.hidden,false);assert.equal(f.primaryVisibility.at(-1),true);
  assert.equal(f.availability.at(-1),false);assert.equal(f.targets.at(-1),null);f.controller.dispose();
});

test('late old reads and queued or stale editor callbacks cannot modify a replacement with the same ID',async()=>{
  const inspect=inspector([chip('lead')]),oldRead=deferred();inspect.readResult=()=>oldRead.promise;
  const f=setup({inspect});f.controller.setVisible(true);await settle();const old=f.editors[0];
  old.synth.setAlgo(0,1,2); // Queued in the same task as replacement.
  inspect.tokens.set('lead',8);inspect.readResult=()=>snapshot({algorithm:6,tl:61});inspect.notify();await settle();
  const replacement=f.editors.at(-1);assert.notEqual(replacement,old);assert.equal(old.disposed,1);assert.deepEqual(inspect.writes,[]);
  oldRead.resolve(snapshot({algorithm:0,tl:0}));await settle();assert.equal(replacement.presets.length,6);assert.equal(replacement.presets[0][2].algorithm,6);
  old.synth.setOperator(0,0,{tl:1});await settle();assert.deepEqual(inspect.writes,[],'detached controls retain their original source token');
  replacement.synth.setAlgo(0,7,3);await settle();assert.deepEqual(plain(inspect.writes),[{id:'lead',method:'setAlgo',args:[0,7,3]}]);
  assert.deepEqual(f.statuses,[]);f.controller.dispose();
});

test('disconnect during an asynchronous read safely ignores a throwing connection-token lookup',async()=>{
  const inspect=inspector([chip('lead')]),reading=deferred();inspect.readResult=()=>reading.promise;
  const f=setup({inspect});f.controller.setVisible(true);await settle();inspect.entries=[];
  reading.reject(Error('Sound chip is not connected'));await settle();
  assert.deepEqual(f.statuses,[]);assert.equal(f.editors[0].presets.length,0);
  inspect.notify();await settle();assert.equal(f.availability.at(-1),false);assert.equal(f.controller.isExtraSelected(),false);assert.equal(f.select.value,'');f.controller.dispose();
});

test('a refresh captured before a completed edit cannot overwrite it or swallow its final refresh',async()=>{
  const inspect=inspector([chip('lead')]),reading=deferred();inspect.readResult=()=>reading.promise;
  const f=setup({inspect});f.controller.setVisible(true);await settle();const editor=f.editors[0];
  editor.synth.setAlgo(0,7,3);await settle();assert.equal(inspect.writes.length,1);assert.equal(inspect.reads.length,1,'the unfinished refresh coalesces edit completion');
  inspect.readResult=()=>snapshot({algorithm:7});reading.resolve(snapshot({algorithm:0}));await settle();
  assert.equal(inspect.reads.length,2,'one event-driven follow-up reads the applied edit');assert.equal(editor.presets.length,6);assert.equal(editor.presets[0][2].algorithm,7);
  f.controller.dispose();
});

test('a changed inspector object invalidates old reads even when ID and numeric token repeat',async()=>{
  const oldInspector=inspector([chip('lead')]),reading=deferred();oldInspector.readResult=()=>reading.promise;
  const f=setup({inspect:oldInspector});f.controller.setVisible(true);await settle();
  const next=inspector([chip('lead')]);next.readResult=()=>snapshot({algorithm:3});f.setInspector(next);f.controller.setVisible(true);await settle();
  assert.equal(f.editors.length,2);assert.deepEqual(next.reads,['lead']);reading.resolve(snapshot({algorithm:0}));await settle();
  assert.equal(f.editors[1].presets[0][2].algorithm,3);assert.deepEqual(f.statuses,[]);f.controller.dispose();
});

test('virtual preset options survive switching/recreating editors and removals stay removed',async()=>{
  const f=setup({entries:[chip('lead'),chip('bass')]});f.controller.registerPresetOption('vfs:voice','voice.vgi');
  f.choose('bass');assert.deepEqual(plain(f.editors.at(-1).registered),[['vfs:voice','voice.vgi']]);
  f.controller.removePresetOption('vfs:voice');assert.deepEqual(plain(f.editors.at(-1).removed),[['vfs:voice']]);
  f.choose('lead');assert.deepEqual(f.editors.at(-1).registered,[]);f.controller.dispose();await settle();
});

test('disposal cancels late reads/edits, releases routing and unsubscribes once',async()=>{
  const inspect=inspector([chip('lead')]),reading=deferred();inspect.readResult=()=>reading.promise;
  const f=setup({inspect});f.controller.setVisible(true);await settle();const editor=f.editors[0];editor.synth.setAlgo(0,7,2);
  f.controller.dispose();f.controller.dispose();reading.resolve(snapshot());f.controller.setVisible(true);await settle();
  assert.equal(inspect.subscribers,0);assert.equal(editor.disposed,1);assert.deepEqual(inspect.writes,[]);assert.equal(editor.presets.length,0);assert.equal(f.targets.at(-1),null);assert.equal(f.root.children.length,1);
});

for(const dockedPanels of [true,false])test(`initially hidden dynamic FM tab gains mouse/arrow navigation, and last disposal falls back to Code (${dockedPanels?'docked':'compact'})`,()=>{
  const options={dockedPanels,initialBottomTab:'console',chipTabs:[],onBottomTabChange(){}};
  for(const name of ['code','console','keyboard','operator']){options[name==='operator'?'operatorTabButton':`${name}Tab`]=new Element(document,'button');options[`${name}Panel`]=new Element(document);}
  // Compact keyboard overlay toggles these classes; only their values matter.
  for(const key of ['keyboardPanel','operatorPanel'])options[key].classList={toggle(){}};
  const ui=createPlaygroundUi(options);ui.installBottomTabHandlers();ui.setBottomTab('code');
  assert.equal(options.operatorTabButton.hidden,true);ui.setChipTabAvailable('operator',true);assert.equal(options.operatorTabButton.hidden,false);
  options.operatorTabButton.dispatch('click');assert.equal(options.operatorPanel.hidden,false);assert.equal(options.keyboardPanel.hidden,false);
  const event=options.operatorTabButton.dispatch('keydown',{key:'ArrowLeft'});assert.equal(event.prevented,true);
  assert.equal(options[dockedPanels?'codePanel':'consolePanel'].hidden,false);assert.equal(options[dockedPanels?'codeTab':'consoleTab'].focused,true);
  if(dockedPanels){options.codeTab.dispatch('keydown',{key:'ArrowRight'});assert.equal(options.operatorPanel.hidden,false);}
  else options.operatorTabButton.dispatch('click');
  ui.setChipTabAvailable('operator',false);assert.equal(options.operatorPanel.hidden,true);assert.equal(options.operatorTabButton.hidden,true);assert.equal(options.codePanel.hidden,false);
  assert.equal(options.codeTab.attributes['aria-selected'],'true');assert.equal(options.keyboardPanel.hidden,true);
});
