import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOpmPatches} from './opm_export.js';
import {mountOpmInfo,writeOpmPreview} from './opm_info.js';
function input(){const commands=[0x54,0x20,0xc7,0x54,0x60,23,0x54,8,0x78,0x61,100,0,0x54,0x60,31,0x66];const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x30,3579545,true);v.setUint32(0x34,204,true);b.set(commands,256);return b;}
test('history snapshots remain independent and preview routes four operators to CH8',()=>{
 const p=extractOpmPatches(input(),{includeSnapshots:true});assert.equal(p.length,2);assert.equal(p[0].snapshot.channels[0].operators[0].tl,23);assert.equal(p[1].snapshot.channels[0].operators[0].tl,31);
 const writes=[];let reg;writeOpmPreview({reset(){writes.push('reset');},write(port,v){if(!port)reg=v;else writes.push([reg,v]);}},p[0]);
 assert.equal(writes[0],'reset');assert.ok(writes.some(x=>Array.isArray(x)&&x[0]===0x67&&x[1]===23));
 assert.deepEqual(writes.at(-1),[8,127]);assert.ok(writes.some(x=>Array.isArray(x)&&x[0]===0x27&&x[1]===0xc7));
 assert.equal(extractOpmPatches(input())[0].snapshot,undefined);
});
function node(){return {value:'0',handlers:{},children:[],addEventListener(t,f){this.handlers[t]=f;},replaceChildren(){this.children=[];},append(o){this.children.push(o);}};}
test('OPM view lazily lists patches, auditions independently and cancels pending playback',async()=>{
 const old=globalThis.document;globalThis.document={createElement:node};
 try{
 const elements=new Map(),root={querySelector(s){if(!elements.has(s))elements.set(s,node());return elements.get(s);}};
 let started=0,stopped=0,disposed=0,closed=0,resolveChip;
 const chip={reset(){},write(){},sampleRate(){return 48000;},generateStereo(n){return {left:new Float32Array(n),right:new Float32Array(n)};},dispose(){disposed++;}};
 const context={async resume(){},createBuffer(ch,n){return {getChannelData(){return new Float32Array(n);}};},createGain(){return {gain:{},connect(){},disconnect(){}};},createBufferSource(){return {connect(){},start(){started++;},stop(){stopped++;}};},async close(){closed++;}};
 const errors=[];const view=mountOpmInfo({root,onStatus:s=>errors.push(s),createContext:()=>context,createChip:()=>new Promise(r=>resolveChip=r)});
 view.loadVgm(input());assert.equal(elements.get('select').children.length,0);
 view.setVisible(true);assert.equal(elements.get('select').children.length,2);assert.match(elements.get('.opm-voice').textContent,/23/);
 const pending=elements.get('.opm-play').handlers.click();await Promise.resolve();view.setVisible(false);resolveChip(chip);await pending;assert.equal(started,0);
 view.setVisible(true);await elements.get('.opm-play').handlers.click();assert.equal(started,1);
 view.loadVgm(null);assert.equal(stopped,1);assert.equal(elements.get('.opm-save').disabled,true);assert.equal(elements.get('.opm-voice').textContent,'');
 await view.dispose();assert.equal(disposed,1);assert.equal(closed,1);assert.deepEqual(errors,[]);
 }finally{globalThis.document=old;}
});
test('preview voice generates finite, non-silent audio with the real YM2151 core',async()=>{
 const {Ym2151}=await import('../js/ym2151.js');const {default:moduleFactory}=await import('../generated/ym2151_wasm.js');
 const chip=await Ym2151.create({moduleFactory});
 try{const p=extractOpmPatches(input(),{includeSnapshots:true})[0];for(const op of p.snapshot.channels[0].operators){op.ar=31;op.mul=1;op.tl=32;op.rr=15;}
 writeOpmPreview(chip,p);const audio=chip.generateStereo(4096);assert.ok(audio.left.every(Number.isFinite));assert.ok(audio.left.some(v=>Math.abs(v)>0.0001));assert.deepEqual(audio.left,audio.right);
 }finally{chip.dispose();}
});
