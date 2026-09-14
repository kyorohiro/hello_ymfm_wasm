import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('AY monitor mute controls dispatch and flush queued audio',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8'),calls=[];
 let handler;
 const context=vm.createContext({ayMonitorRoot:{},currentChipKind:'ay8910',
  mountAy8910Monitor:(_root,callback)=>{handler=callback;return {};},
  engine:{setAyMuted:v=>calls.push(['all',v]),setOpllMuted:v=>calls.push(['opll',v]),setAyChannelMuted:(ch,v)=>calls.push([ch,v])},
  renderMonitorToggles:()=>{},
  flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('const ayMonitor = mountAy8910Monitor'),source.indexOf("const tfiInfoTab =")),context);
 handler(0,true);handler('ay',false);handler('opll',true);
 assert.deepEqual(calls,[[0,true],'flush',['all',false],'flush',['opll',true],'flush']);
 context.currentChipKind='ym2612';handler(1,true);assert.equal(calls.length,6);
});

test('AY common controls retain masks, reset on load and leave Operator display read-only',async()=>{
 const {mountAy8910Monitor}=await import('./ay8910_monitor.js');
 const previous=globalThis.document;
 const tags=[],calls=[];
 const element=()=>({append(){}});
 globalThis.document={createElement(tag){tags.push(tag);return element();}};
 try {
  const monitor=mountAy8910Monitor(element(),(...args)=>calls.push(args));
  monitor.load({ay8910Clock:2000000,ay8910Type:16,ym2413Clock:3579545});
  assert.equal(monitor.controls().length,5);
  monitor.toggle('0');monitor.toggle('ay');monitor.toggle('opll');monitor.reset();
  assert.deepEqual(calls,[[0,true],['ay',true],['opll',true]]);
  const applied=[];
  monitor.applyMutes({setAyChannelMuted:(...a)=>applied.push(a),setAyMuted:v=>applied.push(['ay',v]),setOpllMuted:v=>applied.push(['opll',v])});
  assert.deepEqual(applied,[[0,true],[1,false],[2,false],['ay',true],['opll',true]]);
  const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
  const root={children:[],append(b){this.children.push(b);}},inline={replaceChildren(...children){this.children=children;}};
  const ctx=vm.createContext({currentChipKind:'ay8910',ayMonitor:monitor,ensureMonitorToggleHandler(){},monitorToggles:root,inlineMonitorToggles:inline,
   document:{createElement(){return {attrs:{},setAttribute(k,v){this.attrs[k]=v;},cloneNode(){return this;}};}}});
  vm.runInContext(source.slice(source.indexOf('function renderMonitorToggles()'),source.indexOf('function ensureMonitorToggleHandler()')),ctx);
  ctx.renderMonitorToggles();
  assert.deepEqual(root.children.map(b=>b.textContent),['AY / YM2149 Off','CH A Off','CH B On','CH C On','YM2413 Off']);
  assert.equal(inline.children.length,5);
  assert.equal(root.children[1].attrs['data-ay-control'],'0');
  assert.equal(root.children[1].attrs['aria-pressed'],'false');
  monitor.load({ay8910Clock:2000000});
  assert.equal(monitor.controls().length,4);assert(monitor.controls().every(c=>!c.muted));
  monitor.toggle('opll');monitor.toggle('bad');assert.equal(calls.length,3);
  assert(!tags.includes('input'));
 }finally{globalThis.document=previous;}
});
