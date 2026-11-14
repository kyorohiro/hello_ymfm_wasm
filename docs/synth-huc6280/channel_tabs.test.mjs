// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupHuc6280ChannelTabs} from './channel_tabs.js';

class Node extends EventTarget {
  constructor(value,id){super();this.dataset={hucChannel:value};this.id=id;this.attrs=new Map();this.focused=false;this.tabIndex=-1;}
  setAttribute(key,value){this.attrs.set(key,value);}
  getAttribute(key){return this.attrs.get(key)??null;}
  focus(){this.focused=true;}
  blur(){this.focused=false;}
}
function fixture({onSelect,onError}={}) {
  const tabs=['synth','0','1','2','3','4','5'].map((value,index)=>new Node(value,'tab'+index));
  const panel=new Node(),changes=[];
  const root={querySelectorAll:()=>tabs};
  let controls;
  controls=setupHuc6280ChannelTabs({root,panel,onSelect:onSelect??(value=>{changes.push(value);controls.sync(value);}),onError});
  controls.sync('synth');
  return{tabs,panel,changes,controls};
}
function key(node,value){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value});node.dispatchEvent(event);return event;}

test('channel observation updates active tabs without requesting a sound operation',()=>{
  const f=fixture();
  for(const value of ['3','synth',0,5]) {
    f.controls.sync(value);
    const active=f.tabs.filter(tab=>tab.getAttribute('aria-selected')==='true');
    assert.equal(active.length,1);assert.equal(active[0].dataset.hucChannel,String(value));
    assert.equal(f.panel.getAttribute('aria-labelledby'),active[0].id);
    assert.deepEqual(f.tabs.filter(tab=>tab.tabIndex===0),active);
  }
  assert.deepEqual(f.changes,[],'observing normal, Code or VGM state does not load/copy another sound');
  assert.throws(()=>f.controls.sync(6),/Choose Auto or CH1/);
  f.controls.dispose();
});

test('pointer selection uses the existing channel target and reselecting it keeps held notes intact',()=>{
  const f=fixture(),target=f.tabs[4];
  const down=new Event('pointerdown',{cancelable:true});Object.defineProperty(down,'button',{value:0});
  target.dispatchEvent(down);assert(down.defaultPrevented,'pointer editing does not steal keyboard focus');
  target.focus();target.dispatchEvent(new Event('click'));
  assert.equal(target.focused,false);assert.deepEqual(f.changes,['3']);
  target.dispatchEvent(new Event('click'));assert.deepEqual(f.changes,['3'],'clicking an already selected tab does not release/reallocate notes');
  f.tabs[0].dispatchEvent(new Event('click'));assert.deepEqual(f.changes,['3','synth']);
  f.controls.dispose();
});

test('arrow keys wrap; Home/End select the channel and leave an accessible focus target',()=>{
  const f=fixture();
  assert(key(f.tabs[0],'ArrowLeft').defaultPrevented);assert.equal(f.tabs[6].focused,true);assert.equal(f.changes.at(-1),'5');
  key(f.tabs[6],'ArrowRight');assert.equal(f.changes.at(-1),'synth');
  key(f.tabs[0],'End');assert.equal(f.changes.at(-1),'5');
  key(f.tabs[6],'Home');assert.equal(f.changes.at(-1),'synth');
  const before=f.changes.length;assert(!key(f.tabs[0],'a').defaultPrevented);assert.equal(f.changes.length,before,'musical letter keys remain available to the shared keyboard');
  f.controls.dispose();
});

test('selection errors reach the host, and disposed tabs cannot select or publish changes',async()=>{
  const errors=[],failure=Error('channel no longer available');
  const f=fixture({onSelect:()=>Promise.reject(failure),onError:error=>errors.push(error)});
  f.tabs[1].dispatchEvent(new Event('click'));await Promise.resolve();assert.deepEqual(errors,[failure]);
  f.controls.dispose();f.controls.dispose();
  f.tabs[2].dispatchEvent(new Event('click'));f.controls.sync(2);await Promise.resolve();assert.deepEqual(errors,[failure]);
  assert.equal(f.tabs[0].getAttribute('aria-selected'),'true');
  let reject;
  const pending=fixture({onSelect:()=>new Promise((_,fail)=>{reject=fail;}),onError:error=>errors.push(error)});
  pending.tabs[1].dispatchEvent(new Event('click'));pending.controls.dispose();reject(failure);await Promise.resolve();
  assert.deepEqual(errors,[failure],'a retired selection cannot publish a late page error');
});
