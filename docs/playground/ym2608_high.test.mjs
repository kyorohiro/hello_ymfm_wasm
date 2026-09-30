import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2608Synth} from '../../web/ym2608synth.js';
import {ym2608HighOperation} from './ym2608_high.js';
const event=(port,register,value,time=0)=>({type:'ym2608-write',port,register,value,time});
test('all single-byte high replacements preserve exact writes on both ports',()=>{
 const writes=[];const chip=new YM2608Synth({transport:{reset(){},write(p,r,v){writes.push([p,r,v]);}}});
 const regs=[new Uint8Array(256),new Uint8Array(256)];
 for(let p=0;p<2;p++)for(let r=0;r<256;r++)for(let v=0;v<256;v++){
  const op=ym2608HighOperation([event(p,r,v)],0,regs);
  if(op){writes.length=0;new Function('opna',op.code)(chip);assert.deepEqual(writes,[[p,r,v]],`${p}:${r}:${v}`);}
  chip.write(p,r,v);regs[p][r]=v;
 }
});
test('pairs preserve ADPCM rate and upper FM pitch; memory and waits are barriers',()=>{
 const writes=[];const chip=new YM2608Synth({transport:{reset(){},write(p,r,v){writes.push([p,r,v]);}}});
 for(const events of [[event(1,9,34),event(1,10,12)],[event(1,0xa4,34),event(1,0xa0,56)]]){
  const op=ym2608HighOperation(events,0,[new Uint8Array(256),new Uint8Array(256)]);assert.equal(op.count,2);writes.length=0;
  new Function('opna',op.code)(chip);assert.deepEqual(writes,events.map(e=>[e.port,e.register,e.value]));
  events[1].time=1;assert.equal(ym2608HighOperation(events,0,[[],[]]),null);
  events[1]={type:'ym2608-adpcm-b-data',time:0};assert.equal(ym2608HighOperation(events,0,[[],[]]),null);
 }
});
