import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOpmPatches} from './opm_export.js';
import {mountOpmInfo,writeOpmPreview,midiToOpmPitch,createOpmKeyboardAudio} from './opm_info.js';
function input(){const commands=[0x54,0x20,0xc7,0x54,0x60,23,0x54,8,0x78,0x61,100,0,0x54,0x60,31,0x66];const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x30,3579545,true);v.setUint32(0x34,204,true);b.set(commands,256);return b;}
test('history snapshots remain independent and preview routes four operators to CH8',()=>{
 const p=extractOpmPatches(input(),{includeSnapshots:true});assert.equal(p.length,2);assert.equal(p[0].snapshot.channels[0].operators[0].tl,23);assert.equal(p[1].snapshot.channels[0].operators[0].tl,31);
 const writes=[];let reg;writeOpmPreview({reset(){writes.push('reset');},write(port,v){if(!port)reg=v;else writes.push([reg,v]);}},p[0]);
 assert.equal(writes[0],'reset');assert.ok(writes.some(x=>Array.isArray(x)&&x[0]===0x67&&x[1]===23));
 assert.deepEqual(writes.at(-1),[8,127]);assert.ok(writes.some(x=>Array.isArray(x)&&x[0]===0x27&&x[1]===0xc7));
 assert.equal(extractOpmPatches(input())[0].snapshot,undefined);
});
function node(){return {value:'0',handlers:{},children:[],addEventListener(t,f){this.handlers[t]=f;},replaceChildren(){this.children=[];},append(o){this.children.push(o);}};}
test('preview voice generates finite, non-silent audio with the real YM2151 core',async()=>{
 const {Ym2151}=await import('../js/ym2151.js');const {default:moduleFactory}=await import('../generated/ym2151_wasm.js');
 const chip=await Ym2151.create({moduleFactory});
 try{const p=extractOpmPatches(input(),{includeSnapshots:true})[0];for(const op of p.snapshot.channels[0].operators){op.ar=31;op.mul=1;op.tl=32;op.rr=15;}
 writeOpmPreview(chip,p);const audio=chip.generateStereo(4096);assert.ok(audio.left.every(Number.isFinite));assert.ok(audio.left.some(v=>Math.abs(v)>0.0001));assert.deepEqual(audio.left,audio.right);
 }finally{chip.dispose();}
});

test('keyboard pitch uses gapped KC and clock-adjusted KF',()=>{
 assert.deepEqual(midiToOpmPitch(69),{kc:0x4a,kf:0});
 assert.deepEqual(midiToOpmPitch(60),{kc:0x3e,kf:0});
 assert.deepEqual(midiToOpmPitch(61),{kc:0x40,kf:0});
 assert.deepEqual(midiToOpmPitch(69,3579545*2),{kc:0x3a,kf:0});
 assert.throws(()=>midiToOpmPitch(0),RangeError);
});
test('keyboard audio holds until key-off and stops all queued buffers',()=>{
 const patch=extractOpmPatches(input(),{includeSnapshots:true})[0],writes=[],sources=[];let reg;
 const chip={reset(){},write(p,v){if(!p)reg=v;else writes.push([reg,v]);},sampleRate:()=>48000,generateStereo:n=>({left:new Float32Array(n),right:new Float32Array(n)})};
 const context={currentTime:0,createGain:()=>({gain:{},connect(){},disconnect(){}}),createBuffer:(_c,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource(){const s={connect(){},start(){},stop(){this.stopped=true;}};sources.push(s);return s;}};
 const audio=createOpmKeyboardAudio(chip,context,()=>patch,()=>0.3);
 try{audio.noteOnMidi(0,69);assert.deepEqual(writes.at(-1),[8,127]);assert.equal(sources.length,3);audio.noteOff();assert.deepEqual(writes.at(-1),[8,7]);audio.stop();assert.ok(sources.every(s=>s.stopped));}finally{audio.dispose();}
});
test('OPM view uses shared keyboard and clears it on voice/file/tab changes',()=>{
 const old=globalThis.document;globalThis.document={createElement:node};
 try{const elements=new Map(),views=[];let options;
 const root={querySelector(s){if(!elements.has(s))elements.set(s,node());return elements.get(s);}};
 const view=mountOpmInfo({root,onStatus(){},createKeyboard:o=>{options=o;return {setView:v=>views.push(v),dispose(){}};}});
 view.loadVgm(input());view.setVisible(true);assert.equal(elements.get('select').children.length,2);assert.equal(views.at(-1),'operator');assert.equal(options.idPrefix,'opm-');
 view.setVisible(false);assert.equal(views.at(-1),'code');view.loadVgm(null);assert.equal(elements.get('.opm-save').disabled,true);assert.equal(elements.get('.opm-voice').textContent,'');
 }finally{globalThis.document=old;}
});
