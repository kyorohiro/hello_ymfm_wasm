import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSynthExpandedTabs} from './synth_expanded_tabs.js';

class Element {
  constructor(id='') {
    this.id=id;this.children=[];this.parentNode=null;this.hidden=false;this.disabled=false;this.attributes={};this.dataset={};this.listeners=new Map();
    const classes=new Set();this.classList={toggle:(name,value)=>value?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};
  }
  append(...nodes){for(const node of nodes){node.remove();this.children.push(node);node.parentNode=this;}}
  insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]??null;}
  get firstChild(){return this.children[0]??null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,fn,capture=false){if(!this.listeners.has(type))this.listeners.set(type,new Map());this.listeners.get(type).set(fn,capture);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  closest(selector){return selector==='[role="tab"]'&&this.getAttribute('role')==='tab'||selector==='.volume-control'&&this.classList.contains('volume-control')?this:this.parentNode?.closest(selector);}
  focus(){this.focused=true;globalThis.document.activeElement=this;}
  fire(type,extra={}) {
    const event={target:this,key:'',prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
    for(const fn of this.listeners.get(type)?.keys()??[]){fn(event);if(event.stopped)break;}
    return event;
  }
}
function fixture({huc=false}={}) {
  const old=Object.getOwnPropertyDescriptor(globalThis,'document'),elements=new Map();
  const byId=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const workspace=byId('synthWorkspace'),editor=new Element('editor'),main=new Element('main');
  const header=new Element('header');header.append(byId('synthWorkspaceCodeButton'),byId('synthWorkspaceSynthButton'));
  workspace.append(header,main);main.append(byId('synthExpandedVolumeSlot'),byId('synthExpandedTabsSlot'),editor,byId('synthExpandedCodeSlot'));
  const tablist=new Element('chipTabs'),inputTablist=new Element('inputTabs'),inputHeading=new Element('inputHeading'),transport=new Element('transport');
  const chipIds=huc?['huc6280ChipTab','msm5205ChipTab','cddaChipTab','mixerChipTab']:['synthChipTabYm2612','synthChipTabPsg','synthChipTabPcm','synthChipTabCdda','synthChipTabPwm','synthSongMixButton'];
  const chipTabs=chipIds.map(byId),code=byId('synthInputCodeTab'),keyboard=byId('synthInputKeyboardTab');
  for(const [i,tab]of chipTabs.entries()){tab.dataset[huc?'hucChipTab':'synthChip']=(huc?['huc6280','msm5205','cdda','mixer']:['ym2612','psg','pcm','cdda','pwm','mixer'])[i];tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(i===0));tab.tabIndex=i===0?0:-1;}
  for(const tab of [code,keyboard])tab.setAttribute('role','tab');
  code.setAttribute('aria-selected','true');keyboard.setAttribute('aria-selected','false');
  tablist.setAttribute('aria-label','Sound chip editor');tablist.append(...chipTabs);
  const volumeRow=new Element('volumeRow'),volume=new Element('volume');volume.classList.toggle('volume-control',true);
  volume.append(byId('masterVolumeRange'),byId('masterVolumeValue'));volumeRow.append(volume);
  const section=byId('synthInputSection');
  if(huc){header.append(volumeRow);editor.append(tablist,section);}else editor.append(volumeRow,tablist,section);
  section.append(inputHeading,transport,byId('synthKeyboardPanel'),byId('synthCodePanel'));
  inputHeading.append(inputTablist,byId('synthCodeExpandButton'));inputTablist.append(keyboard,code);
  transport.append(byId('synthCodeRunButton'),byId('synthCodeApplyButton'),byId('synthCodeStopButton'));
  byId('synthExpandedVolumeSlot').hidden=true;byId('synthExpandedTabsSlot').hidden=true;byId('synthExpandedCodeSlot').hidden=true;
  globalThis.document={getElementById:id=>huc&&['synthExpandedVolumeSlot','masterVolumeRange'].includes(id)?null:byId(id),querySelector:selector=>!huc&&selector==='#synthWorkspace .synth-editor'?editor:null,
    createElement:()=>new Element(),createComment:()=>new Element('comment'),activeElement:null};
  const calls={chips:[],modes:[],expansions:[],layouts:0},originalChildren={editor:[...editor.children],section:[...section.children],heading:[...inputHeading.children],input:[...inputTablist.children]};
  let inputMode='code',expanded=false,controls;
  const codeControls={isCodeMode:()=>inputMode==='code',isExpanded:()=>expanded,layoutEditor:()=>calls.layouts++,
    async setExpanded(value){calls.expansions.push(value);expanded=value;controls.setExpanded(value);return value;},
    async setMode(mode,options){calls.modes.push([mode,options]);inputMode=mode;controls.showInput(mode);return true;}};
  const selectChip=async button=>{calls.chips.push(button);controls.showChip(button);return true;};
  controls=setupSynthExpandedTabs({codeControls,selectChip,...(huc?{elements:{editor,chipTabs},getChipView:button=>button.dataset.hucChipTab}:{})});
  return {controls,codeControls,selectChip,calls,byId,editor,tablist,inputTablist,inputHeading,section,transport,volumeRow,volume,chipTabs,code,keyboard,originalChildren,
    expand(value=true){expanded=value;controls.setExpanded(value);},
    cleanup(){controls.dispose();old?Object.defineProperty(globalThis,'document',old):delete globalThis.document;}};
}
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
const selected=tabs=>tabs.filter(tab=>tab.getAttribute('aria-selected')==='true');
const realChildren=node=>node.children.filter(child=>child.id!=='comment');

test('expanded workspace has one ordered tablist and keeps its original transport visible for every view',()=>{
  const f=fixture();
  try {
    f.expand();const all=[f.code,...f.chipTabs,f.keyboard];
    assert.deepEqual(realChildren(f.tablist),all);assert.equal(f.tablist.getAttribute('aria-label'),'Synth workspace');
    assert.equal(f.tablist.parentNode.className,'synth-expanded-heading');
    assert.equal(f.byId('synthCodeExpandButton').parentNode,f.tablist.parentNode);
    assert.equal(f.transport.parentNode,f.byId('synthExpandedTabsSlot'));assert.equal(f.inputHeading.hidden,true);
    for(const tab of all) {
      if(tab===f.code||tab===f.keyboard)f.controls.showInput(tab===f.code?'code':'keyboard');else f.controls.showChip(tab);
      assert.deepEqual(selected(all),[tab]);assert.deepEqual(all.filter(button=>button.tabIndex===0),[tab]);
      const isInput=tab===f.code||tab===f.keyboard;
      assert.equal(f.editor.hidden,isInput);assert.equal(f.byId('synthExpandedCodeSlot').hidden,!isInput);
      assert.equal(f.transport.parentNode,f.byId('synthExpandedTabsSlot'));
    }
    f.controls.showChip(f.chipTabs[1]);f.byId('synthExpandedCodeSlot').hidden=false;f.expand();
    assert.equal(f.byId('synthExpandedCodeSlot').hidden,true,'repeating expansion retains the selected chip view');
    f.controls.showInput('code');assert.equal(f.editor.hidden,true,'same input mode reveals Code after a chip view');
    assert.equal(f.calls.chips.length,0,'view updates do not reselect chips or run their handlers');
  }finally{f.cleanup();}
});

test('capture navigation traverses eight enabled tabs with wrapping, Home/End, and tab focus',async()=>{
  const f=fixture();
  try {
    f.expand();const all=[f.code,...f.chipTabs,f.keyboard];
    for(let index=0;index<all.length;index++) {
      const event=f.tablist.fire('keydown',{key:'ArrowRight',target:all[index]});await settle();
      const next=all[(index+1)%all.length];assert.equal(event.prevented,true);assert.equal(event.stopped,true);
      assert.equal(document.activeElement,next);assert.deepEqual(selected(all),[next]);
    }
    f.tablist.fire('keydown',{key:'End',target:f.code});await settle();assert.equal(document.activeElement,f.keyboard);
    f.tablist.fire('keydown',{key:'Home',target:f.keyboard});await settle();assert.equal(document.activeElement,f.code);
    f.chipTabs[0].disabled=true;f.tablist.fire('keydown',{key:'ArrowDown',target:f.code});await settle();
    assert.equal(document.activeElement,f.chipTabs[1]);
    assert(f.calls.modes.every(([,options])=>options.focusEditor===false));
    assert.equal(f.calls.chips.length,7,'each chip key navigation invokes its handler only once');
    const modified=f.tablist.fire('keydown',{key:'ArrowRight',target:f.code,ctrlKey:true});assert.equal(modified.prevented,false);
  }finally{f.cleanup();}
});

test('chip clicks keep the original handler and restoring returns every control and both tab selections',()=>{
  const f=fixture();
  try {
    f.expand();f.tablist.fire('click',{target:f.chipTabs[4]});
    assert.equal(document.activeElement,f.chipTabs[4]);assert.equal(f.calls.chips.length,0,'the original click listener owns selection');
    f.controls.showChip(f.chipTabs[4]);f.expand(false);
    assert.deepEqual(realChildren(f.editor),f.originalChildren.editor);assert.deepEqual(realChildren(f.section),f.originalChildren.section);
    assert.deepEqual(realChildren(f.inputHeading),f.originalChildren.heading);assert.deepEqual(realChildren(f.inputTablist),f.originalChildren.input);
    assert.equal(f.byId('synthExpandedTabsSlot').hidden,true);assert.equal(f.editor.hidden,false);assert.equal(f.inputHeading.hidden,false);
    assert.deepEqual(selected(f.chipTabs),[f.chipTabs[4]]);assert.deepEqual(selected([f.code,f.keyboard]),[f.code]);
    assert.equal(f.tablist.getAttribute('aria-label'),'Sound chip editor');
    f.expand();f.controls.dispose();assert.equal(f.transport.parentNode,f.section);assert.equal(f.tablist.listeners.get('keydown').size,0);
    assert.deepEqual(f.editor.children,f.originalChildren.editor,'dispose removes restoration anchors');
  }finally{f.cleanup();}
});

test('Master moves with its original slider and listeners into expanded layout and returns to its anchor',()=>{
  const f=fixture();let changes=0;
  try {
    const input=f.byId('masterVolumeRange'),readout=f.byId('masterVolumeValue');
    input.value='175';readout.textContent='175%';input.addEventListener('input',()=>{changes++;readout.textContent=input.value+'%';});
    f.expand();assert.equal(f.volume.parentNode,f.byId('synthExpandedVolumeSlot'));assert.equal(f.byId('synthExpandedVolumeSlot').hidden,false);
    assert.equal(input.parentNode,f.volume);assert.equal(input.value,'175');assert.equal(readout.textContent,'175%');
    f.controls.showChip(f.chipTabs[4]);assert.equal(f.byId('synthExpandedVolumeSlot').hidden,false,'Master stays available on expanded chip views');
    input.value='230';input.fire('input');assert.equal(changes,1);assert.equal(readout.textContent,'230%');
    f.expand(false);assert.equal(f.byId('synthExpandedVolumeSlot').hidden,true);assert.deepEqual(realChildren(f.volumeRow),[f.volume]);
    assert.equal(input.value,'230');f.expand();f.controls.dispose();assert.deepEqual(f.volumeRow.children,[f.volume]);
  }finally{f.cleanup();}
});

test('header Code and Synth switch layout while their pressed state follows expansion across all subtabs',async()=>{
  const f=fixture();
  try {
    const code=f.byId('synthWorkspaceCodeButton'),synth=f.byId('synthWorkspaceSynthButton');
    assert.equal(code.getAttribute('aria-pressed'),'false');assert.equal(synth.getAttribute('aria-pressed'),'true');
    code.fire('click');await settle();
    assert.deepEqual(f.calls.expansions,[true]);assert.equal(code.getAttribute('aria-pressed'),'true');assert.equal(synth.getAttribute('aria-pressed'),'false');
    assert.deepEqual(selected([f.code,...f.chipTabs,f.keyboard]),[f.code]);
    for(const tab of f.chipTabs)f.controls.showChip(tab);
    f.controls.showInput('keyboard');assert.equal(code.getAttribute('aria-pressed'),'true','subtab selection does not change layout selection');
    const modeChanges=f.calls.modes.length;synth.fire('click');await settle();
    assert.equal(f.calls.modes.length,modeChanges,'Synth restores layout without changing input mode or stopping its session');
    assert.deepEqual(f.calls.expansions,[true,false]);assert.equal(code.getAttribute('aria-pressed'),'false');assert.equal(synth.getAttribute('aria-pressed'),'true');
    assert.equal(document.activeElement,synth,'restoring from the header leaves focus at the Synth layout choice');
    assert.equal(code.fire('keydown',{key:'Enter'}).stopped,true);assert.equal(synth.fire('keydown',{key:' '}).stopped,true);
    f.controls.dispose();assert.equal(code.listeners.get('click').size,0);assert.equal(synth.listeners.get('keydown').size,0);
  }finally{f.cleanup();}
});

test('a delayed Synth completion cannot steal focus after a later layout choice or disposal',async()=>{
  for(const latest of ['code','dispose']) {
    const f=fixture();let resolve;
    try {
      const original=f.codeControls.setExpanded;
      f.codeControls.setExpanded=value=>{
        const result=original(value);
        return value?result:new Promise(done=>{resolve=()=>done(false);});
      };
      f.expand();f.byId('synthWorkspaceSynthButton').fire('click');
      const code=f.byId('synthWorkspaceCodeButton');code.focus();
      if(latest==='code')code.fire('click');else f.controls.dispose();
      await settle();resolve();await settle();
      assert.equal(document.activeElement,code,'the retired Synth completion keeps the newer focus');
    }finally{f.cleanup();}
  }
});

test('a delayed Code request cannot expand after a later Synth choice or disposal',async()=>{
  for(const latest of ['synth','dispose']) {
    const f=fixture();let resolve;
    try {
      f.codeControls.setMode=()=>new Promise(done=>{resolve=done;});
      f.byId('synthWorkspaceCodeButton').fire('click');
      if(latest==='synth')f.byId('synthWorkspaceSynthButton').fire('click');else f.controls.dispose();
      resolve(true);await settle();
      assert.deepEqual(f.calls.expansions,latest==='synth'?[false]:[]);
      assert.equal(f.byId('synthWorkspaceSynthButton').getAttribute('aria-pressed'),'true');
    }finally{f.cleanup();}
  }
});

test('HuC6280 overrides share six expanded tabs, header switching, navigation and restoration',async()=>{
  const f=fixture({huc:true});
  try{
    f.byId('synthWorkspaceCodeButton').fire('click');await settle();
    const all=[f.code,...f.chipTabs,f.keyboard];
    assert.deepEqual(realChildren(f.tablist),all);
    assert.deepEqual(f.chipTabs.map(tab=>tab.dataset.hucChipTab),['huc6280','msm5205','cdda','mixer']);
    for(const tab of f.chipTabs){
      f.controls.showChip(tab);
      assert.equal(f.byId('synthExpandedTabsSlot').dataset.view,tab.dataset.hucChipTab);
      assert.equal(f.editor.hidden,false);assert.equal(f.byId('synthExpandedCodeSlot').hidden,true);
      assert.deepEqual(selected(all),[tab]);assert.equal(f.byId('synthWorkspaceCodeButton').getAttribute('aria-pressed'),'true');
    }
    for(let i=0;i<all.length;i++){
      f.tablist.fire('keydown',{target:all[i],key:'ArrowRight'});await settle();
      assert.equal(document.activeElement,all[(i+1)%all.length]);assert.deepEqual(selected(all),[all[(i+1)%all.length]]);
    }
    f.tablist.fire('keydown',{target:f.code,key:'End'});await settle();assert.equal(document.activeElement,f.keyboard);
    assert.equal(f.byId('synthExpandedCodeSlot').hidden,false);assert.equal(f.editor.hidden,true);
    assert.equal(f.byId('synthWorkspaceCodeButton').getAttribute('aria-pressed'),'true','Keyboard does not leave the expanded workspace');
    assert.equal(f.transport.parentNode,f.byId('synthExpandedTabsSlot'),'transport remains reachable for every source');
    f.tablist.fire('keydown',{target:f.keyboard,key:'Home'});await settle();assert.equal(document.activeElement,f.code);
    f.controls.showChip(f.chipTabs[2]);f.byId('synthWorkspaceSynthButton').fire('click');await settle();
    assert.deepEqual(realChildren(f.editor),f.originalChildren.editor);
    assert.deepEqual(realChildren(f.inputHeading),f.originalChildren.heading);
    assert.deepEqual(realChildren(f.inputTablist),f.originalChildren.input);
    assert.deepEqual(selected(f.chipTabs),[f.chipTabs[2]]);
    assert.equal(f.transport.parentNode,f.section);assert.equal(f.editor.hidden,false);
    assert.equal(f.byId('synthWorkspaceSynthButton').getAttribute('aria-pressed'),'true');
    assert.equal(f.calls.chips.length,4,'one original selection per arrow-key chip destination');
    assert.deepEqual(f.calls.expansions,[true,false]);
  }finally{f.cleanup();}
});

test('HuC6280 keeps the original header Master when no expanded volume nodes are supplied',async()=>{
  const f=fixture({huc:true});let changes=0;
  try{
    assert.equal(document.getElementById('synthExpandedVolumeSlot'),null);
    assert.equal(document.getElementById('masterVolumeRange'),null);
    const parent=f.volumeRow.parentNode,input=f.byId('masterVolumeRange');
    input.value='70';input.addEventListener('input',()=>changes++);
    f.byId('synthWorkspaceCodeButton').fire('click');await settle();
    for(const tab of f.chipTabs){f.controls.showChip(tab);assert.equal(f.volumeRow.parentNode,parent);assert.equal(parent.hidden,false);}
    f.controls.showInput('keyboard');input.value='180';input.fire('input');
    f.byId('synthWorkspaceSynthButton').fire('click');await settle();
    assert.equal(f.volumeRow.parentNode,parent);assert.equal(input.value,'180');assert.equal(changes,1);
    assert.equal(input.parentNode,f.volume,'the existing slider and listener are retained');
  }finally{f.cleanup();}
});

test('invalid overrides and chip view mappings reject before adding anchors or changing the DOM',()=>{
  const f=fixture({huc:true});
  const tree=node=>[node,...node.children.flatMap(tree)];
  try{
    const before=tree(f.byId('synthWorkspace')).map(node=>[node,node.parentNode,[...node.children],node.hidden,{...node.attributes}]);
    const options={codeControls:f.codeControls,selectChip:f.selectChip,elements:{editor:f.editor,chipTabs:f.chipTabs},getChipView:tab=>tab.dataset.hucChipTab};
    for(const invalid of [
      {elements:null},{elements:[]},{elements:{unknown:f.editor}},
      {elements:{...options.elements,volume:new Element('detached-master')}},{elements:{...options.elements,volume:{}}},
      {elements:{...options.elements,editor:null}},{elements:{...options.elements,editor:{parentNode:{}}}},
      {elements:{...options.elements,chipTabs:[]}},{elements:{...options.elements,chipTabs:[f.chipTabs[0],f.chipTabs[0]]}},
      {elements:{...options.elements,chipTabs:[new Element('detached')]}},{elements:{...options.elements,chipTabs:[f.code]}},
      {getChipView:null},{getChipView:()=>undefined},{getChipView:()=>''},{getChipView:()=> 'code'},
      {getChipView:()=> 'same'},
    ]){
      assert.throws(()=>setupSynthExpandedTabs({...options,...invalid}),TypeError);
      assert.deepEqual(tree(f.byId('synthWorkspace')).map(node=>[node,node.parentNode,[...node.children],node.hidden,{...node.attributes}]),before);
    }
    assert.deepEqual(f.calls.chips,[]);assert.deepEqual(f.calls.expansions,[]);assert.deepEqual(f.calls.modes,[]);
  }finally{f.cleanup();}
});


test('a host-specific Master element moves intact and restores without requiring the FM slider id',()=>{
  const f=fixture();let controls;
  try{
    f.controls.dispose();
    const lookup=document.getElementById;
    document.getElementById=id=>id==='masterVolumeRange'?null:lookup(id);
    const input=f.byId('masterVolumeRange');input.id='aswanMaster';input.value='0.7';
    let changes=0;input.addEventListener('input',()=>changes++);
    controls=setupSynthExpandedTabs({codeControls:f.codeControls,selectChip:f.selectChip,
      elements:{editor:f.editor,chipTabs:f.chipTabs,volume:f.volume}});
    controls.setExpanded(true);
    assert.equal(f.volume.parentNode,f.byId('synthExpandedVolumeSlot'));
    assert.equal(input.parentNode,f.volume);
    input.value='1.8';input.fire('input');
    controls.showChip(f.chipTabs[1]);
    assert.equal(f.byId('synthExpandedVolumeSlot').hidden,false);
    controls.setExpanded(false);
    assert.equal(f.volume.parentNode,f.volumeRow);
    assert.equal(input.value,'1.8');assert.equal(changes,1);
  }finally{controls?.dispose();f.cleanup();}
});
