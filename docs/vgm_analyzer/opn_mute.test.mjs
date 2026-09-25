import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('YM2203 channel buttons use output mute without issuing key-off',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8'),calls=[];
 const context=vm.createContext({currentChipKind:'ym2203',channelMonitor:[{muted:false,changedAt:{}}],channelMuteStates:[],
  performance,requestChannelMonitorRender(){},renderMonitorToggles(){},engine:{setChannelMuted:(...args)=>calls.push(args)},
  baseEngineWriteYm2203:()=>assert.fail('must not alter key-on'),flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('function toggleChannelMute('),source.indexOf('function flushPendingAudio(')),context);
 context.toggleChannelMute(0);context.toggleChannelMute(0);
 assert.deepEqual(calls,[[0,true],'flush',[0,false],'flush']);
 // Execute the production register wrapper itself: a muted CH must retain key-on.
 const writes=[];context.applyYm2203WriteToMonitor=()=>{};context.baseEngineWriteYm2203=(...args)=>writes.push(args);
 const start=source.indexOf('engine.writeYm2203 = (register, value) =>');
 vm.runInContext(source.slice(start,source.indexOf('};',start)+2),context);
 context.channelMonitor[0].muted=true;context.engine.writeYm2203(0x28,0xf0);
 assert.deepEqual(writes,[[0x28,0xf0]]);
});

for(const connected of [false,true])test(`CH toggles refresh both panels without Operator Info rendering (engine=${connected})`,()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const root={children:[],set innerHTML(v){this.children=[];},append(b){this.children.push(b);}};
 const inline={children:[],replaceChildren(...b){this.children=b;}};
 const writes=[];
 const context=vm.createContext({currentChipKind:'ym2612',channelMonitor:[{channel:0,muted:false,b4Value:0xc0,changedAt:{}}],channelMuteStates:[],
  performance,requestChannelMonitorRender(){},engine:connected?{}:null,
  monitorToggles:root,inlineMonitorToggles:inline,ensureMonitorToggleHandler(){},CHANNEL_MUTE_CHIPS:[],
  sourcesForChip:()=>[],sourceChipKind:()=> 'megacd',hasOkiSource:()=>false,
  document:{createElement(){return {attrs:{},setAttribute(k,v){this.attrs[k]=v;},cloneNode(){return {...this,attrs:{...this.attrs}};}};}},
  baseEngineWriteYm2612:(...args)=>writes.push(args),flushPendingAudio(){},effectivePanValue:c=>c.muted?c.b4Value&63:c.b4Value});
 vm.runInContext(source.slice(source.indexOf('function renderMonitorToggles()'),source.indexOf('function ensureMonitorToggleHandler()')),context);
 vm.runInContext(source.slice(source.indexOf('function toggleChannelMute('),source.indexOf('function flushPendingAudio(')),context);
 context.renderMonitorToggles();
 for(const [label,pressed] of [['Off','false'],['On','true']]){
  context.toggleChannelMute(0);
  for(const panel of [root,inline]){assert.equal(panel.children[0].textContent,`CH1 ${label}`);assert.equal(panel.children[0].attrs['aria-pressed'],pressed);}
 }
 assert.deepEqual(writes,connected?[[0,0xb4,0],[0,0xb4,0xc0]]:[]);
});
