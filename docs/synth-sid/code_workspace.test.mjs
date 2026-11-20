import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setupSynthExpandedTabs} from '../synth/synth_expanded_tabs.js';
import {createSidCodeProject,SID_PROJECT_FILE_BYTES} from './code_project.js';
import {createChannelSettings} from './channel_settings.js';

class Element {
  constructor(doc,tagName='div'){
    this.ownerDocument=doc;this.tagName=tagName;this.children=[];this.parentNode=null;
    this.attributes={};this.dataset={};this.listeners=new Map();this.hidden=false;this.disabled=false;
    const classes=new Set();
    this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name),
      toggle:(name,on)=>{if(on??!classes.has(name))classes.add(name);else classes.delete(name);}};
  }
  append(...nodes){for(const node of nodes){node.remove();this.children.push(node);node.parentNode=this;}}
  insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  get firstChild(){return this.children[0]??null;}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]??null;}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='class'){this.className=String(value);this.classList.add(...value.split(/\s+/));}if(key==='id')this.id=value;if(key==='hidden')this.hidden=true;if(key==='disabled')this.disabled=true;
    if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase())]=value;}
  getAttribute(key){return this.attributes[key]??null;}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  closest(selector){if(selector==='[role="tab"]'&&this.getAttribute('role')==='tab'||selector.startsWith('.')&&this.classList.contains(selector.slice(1)))return this;return this.parentNode?.closest(selector)??null;}
  focus(){this.ownerDocument.activeElement=this;}
  fire(type,extra={}){const event={target:this,key:'',prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const fn of this.listeners.get(type)??[]){fn(event);if(event.stopped)break;}return event;}
}
const walk=node=>[node,...node.children.flatMap(walk)];
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const hostSource=(await readFile(new URL('./code_host.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\n/gm,'').replace(/^export /gm,'');

// Parse the actual SID element/attribute hierarchy. No parallel handwritten
// product DOM is used: moving a heading or putting a slot inside the hidden
// editor breaks these tests as well as the browser workspace.
function documentFromHtml(){
  const doc={activeElement:null,createElement:tag=>new Element(doc,tag),createComment:()=>new Element(doc,'#comment')};
  const root=new Element(doc,'#document'),stack=[root],ids=new Map();
  const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const token of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)){
    const name=token[1]?.toLowerCase();if(!name)continue;
    if(token[0].startsWith('</')){assert.equal(stack.at(-1).tagName,name,'balanced explicit SID markup: '+name);stack.pop();continue;}
    const element=new Element(doc,name);
    for(const attribute of token[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g))element.setAttribute(attribute[1],attribute[2]??'');
    stack.at(-1).append(element);if(element.id){assert(!ids.has(element.id),'unique SID id: '+element.id);ids.set(element.id,element);}
    if(!voids.has(name)&&!token[0].endsWith('/>'))stack.push(element);
  }
  assert.equal(stack.length,1);doc.getElementById=id=>ids.get(id)??null;doc.root=root;
  return doc;
}
function fixture(t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),doc=documentFromHtml();globalThis.document=doc;
  const byId=id=>{const node=doc.getElementById(id);assert(node,'existing SID mount: '+id);return node;};
  const editor=byId('sidSynthEditor'),sid=byId('sidChipTab'),code=byId('synthInputCodeTab'),keyboard=byId('synthInputKeyboardTab');
  const section=byId('synthInputSection'),tabs=byId('sidChipTabs'),heading=code.parentNode.parentNode;
  const transport=byId('synthCodeRunButton').parentNode,master=byId('masterVolume').closest('.master-control');
  // Shared Code controls move their existing transport above Keyboard and own
  // the section's expansion anchor; the workspace helper owns everything else.
  section.insertBefore(transport,byId('synthKeyboardPanel'));
  const home=doc.createComment();section.parentNode.insertBefore(home,section);
  const originals=new Map([master,tabs,code,keyboard,byId('synthCodeExpandButton'),transport].map(node=>[node,node.parentNode]));
  const calls={modes:[],expanded:[],chips:[],layouts:0},input={mode:'keyboard',expanded:false};let workspace;
  const controls={isCodeMode:()=>input.mode==='code',isExpanded:()=>input.expanded,layoutEditor:()=>calls.layouts++,
    async setMode(mode,options){calls.modes.push([mode,options]);input.mode=mode;byId('synthCodePanel').hidden=mode!=='code';byId('synthKeyboardPanel').hidden=mode!=='keyboard';workspace.showInput(mode);return true;},
    async setExpanded(value){calls.expanded.push(value);input.expanded=Boolean(value);if(value)byId('synthExpandedCodeSlot').append(section);else home.parentNode.insertBefore(section,home.nextSibling);workspace.setExpanded(value);return value;}};
  const selectChip=tab=>{assert.equal(tab,sid);calls.chips.push(tab);workspace.showChip(tab);return true;};
  workspace=setupSynthExpandedTabs({codeControls:controls,selectChip,elements:{editor,chipTabs:[sid],volume:master},getChipView:tab=>tab.dataset.sidChip});
  t.after(()=>{workspace.dispose();home.remove();previous?Object.defineProperty(globalThis,'document',previous):delete globalThis.document;});
  return{doc,byId,editor,sid,code,keyboard,section,tabs,heading,transport,master,originals,calls,input,controls,workspace,selectChip};
}
const selected=tabs=>tabs.filter(tab=>tab.getAttribute('aria-selected')==='true');

test('actual SID markup forms one persistent Code / SID / Keyboard workspace with attached Master and headings',async t=>{
  const f=fixture(t),all=[f.code,f.sid,f.keyboard];
  assert.equal(f.heading.className,'sid-input-heading');
  assert.equal(f.byId('synthExpandedTabsSlot').parentNode,f.byId('sidSynthMain'));
  assert.equal(f.byId('synthExpandedVolumeSlot').parentNode,f.byId('sidSynthMain'));
  assert.equal(f.editor.parentNode,f.byId('sidSynthMain'));
  f.byId('synthWorkspaceCodeButton').fire('click');await settle();
  assert.deepEqual(f.tabs.children,all);assert.equal(f.tabs.getAttribute('aria-label'),'Synth workspace');
  assert.equal(f.input.expanded,true);assert.deepEqual(selected(all),[f.code]);
  for(const view of ['sid','keyboard','code']){
    if(view==='sid')f.selectChip(f.sid);else await f.controls.setMode(view,{focusEditor:false});
    assert.equal(f.input.expanded,true,'selecting '+view+' retains layout');
    assert.equal(f.byId('synthExpandedTabsSlot').dataset.view,view);
    assert.equal(f.editor.hidden,view!=='sid');assert.equal(f.byId('synthExpandedCodeSlot').hidden,view==='sid');
    assert.equal(f.transport.parentNode,f.byId('synthExpandedTabsSlot'));
    assert.equal(f.master.parentNode,f.byId('synthExpandedVolumeSlot'));
    assert.equal(f.byId('synthExpandedVolumeSlot').hidden,false);
    assert.deepEqual(selected(all),[view==='sid'?f.sid:view==='keyboard'?f.keyboard:f.code]);
    assert.equal(f.byId('synthWorkspaceCodeButton').getAttribute('aria-pressed'),'true');
  }
  assert.deepEqual(f.calls.expanded,[true]);
});

test('SID workspace moves original Master, transport, editor and Files content without copying them',async t=>{
  const f=fixture(t),master=f.byId('masterVolume'),readout=f.byId('masterVolumeValue'),model=f.byId('synthCodeEditorHost');
  let changes=0;master.value='1.4';readout.textContent='140%';master.addEventListener('input',()=>changes++);
  f.byId('synthCodeEditor').value='/* working SID code */';
  f.byId('sidFilesPanel').dataset.unsaved='true';
  for(let round=0;round<3;round++){
    f.byId('synthWorkspaceCodeButton').fire('click');await settle();
    f.workspace.showChip(f.sid);await f.controls.setMode('keyboard');
    assert.equal(f.byId('masterVolume'),master);assert.equal(f.byId('synthCodeEditorHost'),model);
    assert.equal(f.byId('synthCodeEditor').value,'/* working SID code */');
    assert.equal(f.byId('sidFilesPanel').dataset.unsaved,'true');
    for(const id of ['masterVolume','masterVolumeValue','synthCodeRunButton','synthCodeEditorHost','synthCodeEditor'])assert.equal(walk(f.doc.root).filter(node=>node.id===id).length,1,id+' exists once');
    master.fire('input');f.byId('synthWorkspaceSynthButton').fire('click');await settle();
    for(const[node,parent]of f.originals)assert.equal(node.parentNode,parent,'original parent for '+node.id);
    assert.equal(master.value,'1.4');assert.equal(readout.textContent,'140%');
    assert.equal(f.byId('synthExpandedVolumeSlot').hidden,true);assert.equal(f.editor.hidden,false);
  }
  assert.equal(changes,3,'each event reaches only the original Master listener');
});

test('SID expanded tab keyboard navigation wraps with Home / End and retains one selected focusable tab',async t=>{
  const f=fixture(t),all=[f.code,f.sid,f.keyboard];
  f.byId('synthWorkspaceCodeButton').fire('click');await settle();
  for(let index=0;index<all.length;index++){
    const event=f.tabs.fire('keydown',{key:'ArrowRight',target:all[index]});await settle();
    const next=all[(index+1)%all.length];assert(event.prevented&&event.stopped);
    assert.equal(f.doc.activeElement,next);assert.deepEqual(selected(all),[next]);assert.deepEqual(all.filter(tab=>tab.tabIndex===0),[next]);
  }
  f.tabs.fire('keydown',{key:'End',target:f.code});await settle();assert.equal(f.doc.activeElement,f.keyboard);
  f.tabs.fire('keydown',{key:'Home',target:f.keyboard});await settle();assert.equal(f.doc.activeElement,f.code);
  assert.equal(f.calls.chips.length,1,'one SID selection per arrow-key destination');
  assert(f.calls.modes.every(([,options])=>options?.focusEditor===false));
  const modified=f.tabs.fire('keydown',{key:'ArrowRight',target:f.code,ctrlKey:true});assert.equal(modified.prevented,false);
});

test('SID restore and disposal return attached controls and remove only workspace listeners',async t=>{
  const f=fixture(t),codeLayout=f.byId('synthWorkspaceCodeButton'),synthLayout=f.byId('synthWorkspaceSynthButton');
  const originalInputChildren=[...f.code.parentNode.children],originalHeading=f.heading.hidden;
  codeLayout.fire('click');await settle();await f.controls.setMode('keyboard');
  const modeChanges=f.calls.modes.length;synthLayout.fire('click');await settle();
  assert.equal(f.calls.modes.length,modeChanges,'Synth is a layout change, not an input/performance replacement');
  assert.equal(f.doc.activeElement,synthLayout);assert.deepEqual(f.code.parentNode.children,originalInputChildren);
  assert.equal(f.heading.hidden,originalHeading);assert.deepEqual(selected([f.code,f.keyboard]),[f.keyboard]);
  codeLayout.fire('click');await settle();f.workspace.dispose();
  for(const[node,parent]of f.originals)assert.equal(node.parentNode,parent);
  assert.equal(f.tabs.listeners.get('keydown').size,0);assert.equal(codeLayout.listeners.get('click').size,0);
  assert.equal(synthLayout.listeners.get('keydown').size,0);
});

test('SID host opts into persistent layout notifications without opening audio or retiring its running Code',async()=>{
  const events=[],files={ready:Promise.resolve(),markSoundDirty(){}},audio={fx:{},open:()=>events.push('open'),prepare:async()=>events.push('prepare'),beforeStop(){},stop:async()=>events.push('audio-stop'),dispose:async()=>{}};
  let options,runtimeOptions,running=true;
  const context=vm.createContext({createSidCodeProject,SID_PROJECT_FILE_BYTES,
    createSidCodeAudio:()=>audio,setupSidCodeFiles:()=>files,
    setupSynthCodeControls:value=>{options=value;return{ready:files.ready,isCodeMode:()=>true,stop:async()=>events.push('controls-stop'),dispose(){},appendLog(){}};},
    createPlaygroundCodeRuntime:value=>{runtimeOptions=value;return{getState:()=>({running}),stop:async()=>events.push('runtime-stop')};},
    selectSidCodeDeclarations:()=>{},DOMException,
  });
  vm.runInContext(hostSource+'\nglobalThis.makeHost=setupSidCodeHost;',context);
  const onViewChange=mode=>events.push(['view',mode]),onExpandedChange=value=>events.push(['expanded',value]);
  const host=context.makeHost({getSettings:createChannelSettings,getAudio:()=>null,ensureAudio:async()=>events.push('ensure-audio'),
    stopKeyboard:async()=>events.push('keyboard-stop'),stopSong:async()=>events.push('song-stop'),applySettings:async()=>{},
    onViewChange,onExpandedChange});
  assert.equal(options.persistentExpanded,true);assert.equal(options.keepRunningOnKeyboard,true);assert.equal(options.allowTextFiles,true);
  assert.equal(options.onViewChange,onViewChange);assert.equal(options.onExpandedChange,onExpandedChange);
  assert.deepEqual(events,[],'constructing the layout creates no sound or performance');
  options.getRuntime();events.length=0;
  await options.onModeChange('keyboard');options.onViewChange('keyboard');options.onExpandedChange(true);options.onViewChange('code');
  assert.deepEqual(events,[['view','keyboard'],['expanded',true],['view','code']]);assert.equal(host.isRunning(),true);
  assert.deepEqual(Array.from(runtimeOptions.supportedSoundChips),['sid']);
  running=false;assert.equal(host.isRunning(),false);
});
