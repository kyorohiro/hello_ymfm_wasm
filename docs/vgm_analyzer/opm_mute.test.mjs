import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
test('OPM playback-only buttons expose eight channels and flush both control views',()=>{
 const root={children:[],innerHTML:'',append(b){this.children.push(b);}},inline={replaceChildren(...children){this.children=children;}};
 const calls=[];
 const context=vm.createContext({currentChipKind:'ym2151',opmChannelMutes:Array(8).fill(false),channelMonitor:[],
   ensureMonitorToggleHandler(){},sourcesForChip:()=>[],sourceChipKind:()=> 'ym2151',
   monitorToggles:root,inlineMonitorToggles:inline,
   document:{createElement(){return {attrs:{},setAttribute(k,v){this.attrs[k]=v;},cloneNode(){return this;}};}},
   engine:{setChannelMuted:(...args)=>calls.push(args)},flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('function renderMonitorToggles()'),source.indexOf('function ensureMonitorToggleHandler()')),context);
 vm.runInContext(source.slice(source.indexOf('function toggleOpmChannelMute('),source.indexOf('function toggleChannelMute(')),context);
 context.renderMonitorToggles();assert.equal(root.children.length,8);assert.equal(inline.children.length,8);
 assert.equal(root.children[7].textContent,'CH8 On');
 root.children=[];context.toggleOpmChannelMute(7);assert.equal(root.children[7].textContent,'CH8 Muted');
 assert.deepEqual(calls,[[7,true],'flush']);
 context.toggleOpmChannelMute(8);assert.equal(calls.length,2);
});
