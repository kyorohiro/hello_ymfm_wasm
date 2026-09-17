import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
for (const [chip,count] of [['ym2151',8],['ymf262',18],['ym2413',9],['ym3526',9],['ym3812',9]]) test(`${chip} playback-only channel buttons and flush`,()=>{
 const root={children:[],innerHTML:'',append(b){this.children.push(b);}},inline={replaceChildren(...children){this.children=children;}};
 const calls=[];
 const channelMutesByChip={ym2151:Array(8).fill(false),ymf262:Array(18).fill(false),ym2413:Array(9).fill(false),ym3526:Array(9).fill(false),ym3812:Array(9).fill(false)};
 const context=vm.createContext({currentChipKind:chip,opmChannelMutes:channelMutesByChip.ym2151,opl3ChannelMutes:channelMutesByChip.ymf262,opllChannelMutes:channelMutesByChip.ym2413,
   ym3526ChannelMutes:channelMutesByChip.ym3526,ym3812ChannelMutes:channelMutesByChip.ym3812,channelMonitor:[],
   CHANNEL_MUTE_CHIPS:['ym2151','ymf262','ym2413','ym3526','ym3812'],channelMutesForChip:(k)=>channelMutesByChip[k]??null,
   ensureMonitorToggleHandler(){},sourcesForChip:()=>[],sourceChipKind:()=> 'ym2151',hasOkiSource:()=>false,
   monitorToggles:root,inlineMonitorToggles:inline,
   document:{createElement(){return {attrs:{},setAttribute(k,v){this.attrs[k]=v;},cloneNode(){return this;}};}},
   engine:{setChannelMuted:(...args)=>calls.push(args)},flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('function renderMonitorToggles()'),source.indexOf('function ensureMonitorToggleHandler()')),context);
 vm.runInContext(source.slice(source.indexOf('function toggleOpmChannelMute('),source.indexOf('function toggleChannelMute(')),context);
 context.renderMonitorToggles();assert.equal(root.children.length,count);assert.equal(inline.children.length,count);
 assert.equal(root.children[7].textContent,'CH8 On');
 root.children=[];context.toggleOpmChannelMute(7);assert.equal(root.children[7].textContent,'CH8 Off');
 assert.deepEqual(calls,[[7,true],'flush']);
 context.toggleOpmChannelMute(count);assert.equal(calls.length,2);
});
