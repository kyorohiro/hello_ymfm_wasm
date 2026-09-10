import test from 'node:test';
import assert from 'node:assert/strict';
import {createRf5c164Samples} from './rf5c164_samples.js';
function fixture(){
 const tracker=createRf5c164Samples(12500000);
 const w=(register,value,t=0)=>tracker.apply({type:'rf5c164-write',register,value},t);
 const load=(offset,data)=>tracker.apply({type:'rf5c164-data',offset,data:Uint8Array.from(data)},0);
 return {tracker,w,load};
}
test('banked RAM and start/loop settings, repeated enable does not retrigger',()=>{
 const {tracker:t,w,load}=fixture();w(7,1);load(0,[0x81,0x82,255]);w(7,0xc0);w(0,255);w(3,8);w(6,16);w(4,2);w(5,16);w(8,254,100);w(8,254,200);w(8,255,300);
 assert.equal(t.events.length,1);assert.equal(t.samples[0].data[4096],0x81);
 assert.equal(t.events[0].startAddress,4096);assert.equal(t.events[0].endTime,300);assert.equal(t.events[0].rate,12500000/384);
});
test('RAM replacement preserves earlier snapshot, absent loop data disables extraction',()=>{
 const {tracker:t,w,load}=fixture();load(0,[0x81,255]);w(7,0xc0);w(4,1);w(8,254);w(8,255);load(0,[0x82]);w(8,254);
 assert.equal(t.samples.length,2);assert.equal(t.samples[0].data[0],0x81);assert.equal(t.samples[1].data[0],0x82);
 const other=fixture();other.load(0,[255]);other.w(7,0xc0);other.w(4,99);other.w(8,254);assert.equal(other.tracker.samples[0].data,null);
});
test('global disable pauses, channel disable ends; independent channel usage shares snapshot',()=>{
 const {tracker:t,w,load}=fixture();load(0,[0x81,255]);w(7,0xc0);w(4,1);w(8,254);w(7,0x40,10);w(7,0xc0,20);
 assert.equal(t.events.length,1);assert.deepEqual(t.events[0].changes.map(x=>x.type),['pause','resume']);
 w(7,0xc1);w(4,1);w(8,252);assert.equal(t.samples.length,1);assert.equal(t.events[1].channel,2);
});
