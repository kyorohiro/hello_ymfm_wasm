// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {installSpuFileContextMenu} from './file_context_menu.js';

class Target {
  constructor(){this.listeners=new Map();this.parentNode=null;}
  addEventListener(type,fn,capture=false){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push({fn,capture:Boolean(capture)});}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(value=>value.fn!==fn));}
}
class Element extends Target {
  constructor(doc,tag='div'){super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.style={};this.hidden=false;this.disabled=false;}
  append(...children){for(const node of children){node.remove();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...children){for(const node of [...this.children])node.remove();this.append(...children);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??(name.startsWith('data-')?this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]??null:null);}
  matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('['))return this.getAttribute(part.slice(1,-1))!==null;return part.toUpperCase()===this.tagName;});}
  closest(selector){for(let node=this;node instanceof Element;node=node.parentNode)if(node.matches(selector))return node;return null;}
  contains(target){for(let node=target;node;node=node.parentNode)if(node===this)return true;return false;}
  querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){const menu=this.id==='spuFileContextMenu',left=this.rect?.left??0,top=this.rect?.top??0;
    const width=this.rect?.width??(menu?Math.min(180,parseFloat(this.style.maxWidth)||Infinity):100),height=this.rect?.height??(menu?Math.min(this.children.length*30+8,parseFloat(this.style.maxHeight)||Infinity):20);
    return {left,top,width,height,right:left+width,bottom:top+height};}
}
function dispatch(target,type,extra={}) {
  const event={type,target,key:'',clientX:0,clientY:0,defaultPrevented:false,stopped:false,immediate:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;this.immediate=true;},...extra};
  const path=[];for(let node=target;node;node=node.parentNode)path.push(node);
  for(const capture of [true,false])for(const node of capture?[...path].reverse():path){
    for(const entry of [...(node.listeners.get(type)??[])])if(entry.capture===capture){entry.fn(event);if(event.immediate)break;}
    if(event.stopped)return event;
  }
  return event;
}
const actions=[['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete…'],['instrument','Save sound'],['new','New JS'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:id==='delete'}));
function fixture(options={}) {
  const {beforeInstall,...menuOptions}=options;
  const win=new Target();win.innerWidth=320;win.innerHeight=240;
  const doc=new Target();doc.defaultView=win;doc.parentNode=win;doc.documentElement={clientWidth:320,clientHeight:240};
  doc.createElement=tag=>new Element(doc,tag);doc.body=new Element(doc,'body');doc.body.parentNode=doc;
  const root=doc.createElement('div'),row=doc.createElement('button'),child=doc.createElement('span'),keyboard=doc.createElement('input');
  row.setAttribute('data-file-path','/presets/音色.json');row.rect={left:10,top:20,width:150,height:22};row.append(child);root.append(row);doc.body.append(root,keyboard);keyboard.focus();
  const selected=[],invoked=[],errors=[];
  beforeInstall?.(doc,win);
  const menu=installSpuFileContextMenu({root,document:doc,getActions:()=>actions,onTarget:path=>selected.push(path),
    onAction:(id,path)=>invoked.push({id,path}),onError:error=>errors.push(error),...menuOptions});
  return {win,doc,root,row,child,keyboard,selected,invoked,errors,menu};
}

test('right click only targets the file, keeps keyboard focus and builds the external six menu actions',()=>{
  const f=fixture();assert.equal(dispatch(f.child,'pointerdown',{button:2}).defaultPrevented,true);
  const event=dispatch(f.child,'contextmenu',{clientX:315,clientY:235});
  assert.equal(event.defaultPrevented,true);assert.deepEqual(f.selected,['/presets/音色.json']);assert.deepEqual(f.invoked,[]);
  assert.equal(f.doc.activeElement,f.keyboard);assert.equal(f.menu.element.getAttribute('role'),'menu');assert.equal(f.menu.element.hidden,false);
  assert.equal(f.menu.element.children.length,6);assert(f.menu.element.children.every(button=>button.getAttribute('role')==='menuitem'&&button.type==='button'));
  assert.equal(f.menu.element.children[2].disabled,true);
  assert.equal(f.menu.element.style.position,'fixed');assert.equal(f.menu.element.style.left,'136px');assert.equal(f.menu.element.style.top,'48px');
  dispatch(f.menu.element.children[0],'pointerdown');assert.equal(f.doc.activeElement,f.keyboard);
  dispatch(f.menu.element.children[0],'click');assert.deepEqual(f.invoked,[{id:'duplicate',path:'/presets/音色.json'}]);assert.equal(f.menu.element.hidden,true);f.menu.dispose();
});

test('menu capture precedes an earlier Synth document capture handler without swallowing held-note keyup',()=>{
  let stops=0,notes=0,releases=0;
  const f=fixture({beforeInstall(doc){doc.addEventListener('keydown',event=>{if(event.key==='Escape')stops++;if(event.key==='z')notes++;},true);doc.addEventListener('keyup',()=>releases++,true);}});
  dispatch(f.row,'contextmenu');dispatch(f.keyboard,'keydown',{key:'z'});assert.equal(notes,0);assert.equal(f.menu.element.hidden,false);
  dispatch(f.keyboard,'keyup',{key:'z'});assert.equal(releases,1);
  dispatch(f.keyboard,'keydown',{key:'Escape'});assert.equal(stops,0);assert.equal(f.menu.element.hidden,true);f.menu.dispose();
});

test('background path is root and viewport clamping also bounds negative coordinates and small screens',()=>{
  const f=fixture();dispatch(f.root,'contextmenu',{clientX:-40,clientY:-20});
  assert.deepEqual(f.selected,['/']);assert.equal(f.menu.element.style.left,'4px');assert.equal(f.menu.element.style.top,'4px');
  f.win.innerWidth=100;f.win.innerHeight=80;dispatch(f.root,'contextmenu',{clientX:100,clientY:80});
  assert.equal(f.menu.element.style.maxWidth,'92px');assert.equal(f.menu.element.style.maxHeight,'72px');
  assert.equal(f.menu.element.style.left,'4px');assert.equal(f.menu.element.style.top,'4px');f.menu.dispose();
});

test('keyboard navigation skips disabled items, handles Home/End/Enter/Space, and consumes synth keydown',()=>{
  const f=fixture();let notes=0;f.doc.addEventListener('keydown',()=>notes++);
  dispatch(f.row,'keydown',{key:'ContextMenu'});assert.equal(f.doc.activeElement,f.menu.element.children[0]);
  dispatch(f.doc.activeElement,'keydown',{key:'ArrowDown'});assert.equal(f.doc.activeElement,f.menu.element.children[1]);
  dispatch(f.doc.activeElement,'keydown',{key:'ArrowDown'});assert.equal(f.doc.activeElement,f.menu.element.children[3]);
  dispatch(f.doc.activeElement,'keydown',{key:'End'});assert.equal(f.doc.activeElement,f.menu.element.children[5]);
  dispatch(f.doc.activeElement,'keydown',{key:'Home'});assert.equal(f.doc.activeElement,f.menu.element.children[0]);
  dispatch(f.doc.activeElement,'keydown',{key:'ArrowUp'});assert.equal(f.doc.activeElement,f.menu.element.children[5]);
  dispatch(f.doc.activeElement,'keydown',{key:'a'});assert.equal(notes,0);
  dispatch(f.doc.activeElement,'keydown',{key:'Enter'});assert.equal(f.invoked[0].id,'folder');
  dispatch(f.row,'keydown',{key:'F10',shiftKey:true});dispatch(f.doc.activeElement,'keydown',{key:' '});assert.equal(f.invoked[1].id,'duplicate');f.menu.dispose();
});

test('Escape focuses the newly rendered matching row, while Tab and outside events simply dismiss',()=>{
  const f=fixture();let replacement;
  f.menu.dispose();const menu=installSpuFileContextMenu({root:f.root,document:f.doc,getActions:()=>actions,onAction(){},onTarget(path){
    replacement=f.doc.createElement('button');replacement.setAttribute('data-file-path',path);f.root.replaceChildren(replacement);
  }});
  dispatch(f.row,'contextmenu');assert.equal(menu.element.hidden,false);
  assert.equal(replacement.getAttribute('data-file-path'),'/presets/音色.json');
  dispatch(f.doc,'keydown',{key:'Escape'});assert.equal(menu.element.hidden,true);assert.equal(f.doc.activeElement,replacement);
  for(const [target,type,extra]of [[f.doc,'pointerdown',{}],[f.doc,'scroll',{}],[f.win,'resize',{}],[f.win,'blur',{}],[f.keyboard,'contextmenu',{}]]){
    dispatch(f.root,'contextmenu');dispatch(target,type,extra);assert.equal(menu.element.hidden,true,type);
  }
  dispatch(replacement,'keydown',{key:'ContextMenu'});const tab=dispatch(f.doc.activeElement,'keydown',{key:'Tab'});
  assert.equal(tab.defaultPrevented,false);assert.equal(tab.stopped,true);assert.equal(menu.element.hidden,true);menu.dispose();
});

test('busy and changed disabled states are checked at action time, and action rejection reaches the host',async()=>{
  let busy=false,disabled=false;const f=fixture({isBusy:()=>busy,getActions:()=>[{id:'rename',label:'Rename',disabled}],onAction:()=>Promise.reject(Error('host refused'))});
  busy=true;dispatch(f.row,'contextmenu');assert.equal(f.menu.element.hidden,true);
  busy=false;dispatch(f.row,'contextmenu');disabled=true;dispatch(f.menu.element.children[0],'click');assert.equal(f.errors.length,0);assert.equal(f.menu.element.hidden,true);
  disabled=false;dispatch(f.row,'contextmenu');busy=true;dispatch(f.menu.element.children[0],'click');assert.equal(f.errors.length,0);
  busy=false;dispatch(f.row,'contextmenu');dispatch(f.menu.element.children[0],'click');await Promise.resolve();
  assert.equal(f.errors[0].message,'host refused');assert.equal(f.menu.element.hidden,true);f.menu.dispose();
});

test('dispose removes all event listeners and its menu without touching the project',()=>{
  const f=fixture();dispatch(f.row,'contextmenu');f.menu.dispose();f.menu.dispose();
  assert.equal(f.menu.element.parentNode,null);assert.equal(f.menu.element.hidden,true);
  for(const target of [f.root,f.doc,f.win,f.menu.element])assert.equal([...target.listeners.values()].reduce((sum,list)=>sum+list.length,0),0);
  const count=f.selected.length;dispatch(f.row,'contextmenu');assert.equal(f.selected.length,count);assert.deepEqual(f.invoked,[]);
});
