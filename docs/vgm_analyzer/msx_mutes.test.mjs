import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {msxMuteControls,applyMsxMute} from './msx_mutes.js';
const header={ay8910Clock:1789773,ym2413Clock:3579545,y8950Clock:3579545};
test('MSX controls route to registered chips, including individual channels',()=>{
 const calls=[];const entries=new Map();
 for(const chip of ['ay8910','ym2413','y8950'])entries.set(`${chip}:0`,{engine:new Proxy({}, {get:(_,method)=>(...args)=>calls.push([chip,method,...args])})});
 const engine={entries,setChipMuted:(...args)=>calls.push(['mixer',...args])};
 const controls=msxMuteControls('msx',header);assert.equal(controls.length,25);
 for(const c of controls)applyMsxMute(engine,'msx',c,true);
 assert(calls.some(c=>JSON.stringify(c)===JSON.stringify(['y8950','setAdpcmMuted',true])));
 assert(calls.some(c=>JSON.stringify(c)===JSON.stringify(['ym2413','setChannelMuted',8,true])));
 assert(calls.some(c=>JSON.stringify(c)===JSON.stringify(['ay8910','setAyChannelMuted',2,true])));
 assert(calls.some(c=>JSON.stringify(c)===JSON.stringify(['mixer','ym2413',0,true])));
 assert.equal(calls.length,25);
 assert.equal(msxMuteControls('msx',{ay8910Clock:1}).length,4);
 assert.equal(msxMuteControls('y8950',{}).length,11);
 assert.equal(msxMuteControls('y8950',{psgClock:1}).length,12);
 entries.delete('y8950:0');assert.throws(()=>applyMsxMute(engine,'msx',controls.at(-1),true),/Missing/);
});
test('MSX common and inline buttons dispatch, reflect state and flush audio',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 class Button {constructor(){this.attrs={};}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}closest(){return this;}cloneNode(){return this;}}
 const root=()=>({children:[],set innerHTML(v){this.children=[];},append(b){this.children.push(b);},replaceChildren(...c){this.children=c;},addEventListener(_,fn){this.handler=fn;}});
 const main=root(),inline=root(),calls=[];
 const ctx=vm.createContext({Element:Button,currentChipKind:'msx',noteishHeader:header,msxMutes:new Map(),msxMuteControls,applyMsxMute:(...args)=>calls.push(args.slice(1)),engine:{},monitorToggleHandlerBound:false,monitorToggles:main,inlineMonitorToggles:inline,document:{createElement:()=>new Button()},flushPendingAudio:()=>calls.push('flush')});
 vm.runInContext(source.slice(source.indexOf('function renderMonitorToggles()'),source.indexOf('function createChannelMonitorState()')),ctx);
 ctx.renderMonitorToggles();assert.equal(main.children.length,25);assert.equal(inline.children.length,25);
 const button=inline.children.find(b=>b.textContent==='Y8950 ADPCM On');
 inline.handler({target:button,preventDefault(){}});
 assert.equal(calls[0][0],'msx');assert.equal(calls[0][1].method,'setAdpcmMuted');assert.equal(calls[0][2],true);assert.equal(calls[1],'flush');
 assert(main.children.some(b=>b.textContent==='Y8950 ADPCM Off'&&b.attrs['aria-pressed']==='false'));
 ctx.currentChipKind='y8950';ctx.renderMonitorToggles();assert.equal(main.children.length,11);
});
