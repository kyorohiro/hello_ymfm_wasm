import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
for (const [chip,count] of [['ym2151',8],['ymf262',18],['ym2413',9]]) test(`${chip} playback-only channel buttons and flush`,()=>{
 const root={children:[],innerHTML:'',append(b){this.children.push(b);}},inline={replaceChildren(...children){this.children=children;}};
 const calls=[];
 const context=vm.createContext({currentChipKind:chip,opmChannelMutes:Array(8).fill(false),opl3ChannelMutes:Array(18).fill(false),opllChannelMutes:Array(9).fill(false),channelMonitor:[],
   ensureMonitorToggleHandler(){},sourcesForChip:()=>[],sourceChipKind:()=> 'ym2151',hasOkiSource:()=>false,
   monitorToggles:root,inlineMonitorToggles:inline,
   document:{createElement(){return {attrs:{},setAttribute(k,v){this.attrs[k]=v;},cloneNode(){return this;}};}},
   engine:{setChannelMuted:(...args)=>calls.push(args)},flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('function renderMonitorToggles()'),source.indexOf('function ensureMonitorToggleHandler()')),context);
 vm.runInContext(source.slice(source.indexOf('function toggleOpmChannelMute('),source.indexOf('function toggleChannelMute(')),context);
 context.renderMonitorToggles();assert.equal(root.children.length,count);assert.equal(inline.children.length,count);
 assert.equal(root.children[7].textContent,'CH8 On');
 root.children=[];context.toggleOpmChannelMute(7);assert.equal(root.children[7].textContent,'CH8 Muted');
 assert.deepEqual(calls,[[7,true],'flush']);
 context.toggleOpmChannelMute(count);assert.equal(calls.length,2);
});
