import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2203Synth} from '../../web/ym2203synth.js';
import {ym2203HighOperation} from './ym2203_high.js';
import {exportYm2203FullVgm} from './playground_vgm_import.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function input(events){
 const commands=[];let previous=0;
 for(const [sample,r,v]of events){if(sample>previous)commands.push(0x61,(sample-previous)&255,(sample-previous)>>8);commands.push(0x55,r,v);previous=sample;}
 commands.push(0x61,100,0,0x66);
 const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);
 bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x161,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x44,4000000,true);bytes.set(commands,0x100);return bytes;
}
async function trace(bytes,mode){
 let time=0,loop;const writes=[];
 const opn=new YM2203Synth({transport:{reset(){writes.push([time,'reset']);},write(p,r,v){writes.push([time,p,r,v]);}}});
 opn.setClock=async()=>{};writes.length=0;
 const code=exportYm2203FullVgm(bytes,{mode});
 await new AsyncFunction('useSoundChip','liveLoop','sleepSamples',code)(async()=>opn,(_,fn)=>{loop=fn;},async n=>{time+=n;});
 await loop();await loop();return {writes,time,code};
}
test('YM2203 High exactly preserves FM/SSG writes and waits over repeated loops',async()=>{
 const events=[[0,7,63],[0,0,123],[0,1,2],[0,7,62],[0,8,15],[0,6,3],[0,7,46],[0,9,16],
 [10,11,12],[10,12,3],[10,13,9],[10,0xa4,34],[10,0xa0,123],[10,0x28,0xf0],[15,0x28,0],
 [16,2,200],[16,3,4],[20,0xb0,23],[20,0x30,0x71],[20,0x40,70],[20,0x50,0xdf],[20,0x60,0x9f],[20,0x70,13],[20,0x80,0xff],[20,0x90,9],
 [30,0x40,130],[30,0x27,64],[30,8,31],[30,14,255]];
 const bytes=input(events),write=await trace(bytes,'write'),high=await trace(bytes,'high');
 assert.deepEqual(high.writes,write.writes);assert.equal(high.time,write.time);
 for(const method of ['ssg.setTonePeriod','ssg.tone','ssg.noise','ssg.setEnvelope','setFrequency','keyOn','keyOff','setAlgo','setOperator'])assert.ok(high.code.includes(method),method);
 assert.match(high.code,/opn.write\(0, 0x40, 0x82\)/);
});
test('single-write High replacements reproduce every byte, including reserved bits',()=>{
 const writes=[];const synth=new YM2203Synth({transport:{reset(){},write(p,r,v){writes.push([r,v]);}}});
 const registers=new Uint8Array(256);
 for(let r=0;r<256;r++)for(let v=0;v<256;v++){
  const op=ym2203HighOperation([[0,r,v]],0,registers);
  if(op){writes.length=0;new Function('opn',op.code)(synth);assert.deepEqual(writes,[[r,v]],`${r}:${v}`);}
  synth.write(0,r,v);registers[r]=v;
 }
});
test('High does not group frequency or envelope writes across waits',()=>{
 const code=exportYm2203FullVgm(input([[0,0xa4,34],[1,0xa0,123],[1,11,12],[2,12,3],[2,13,9]]),{mode:'high'});
 assert.ok(!code.includes('setFrequency'));assert.ok(!code.includes('setEnvelope'));
});
