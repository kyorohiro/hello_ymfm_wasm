import test from 'node:test';
import assert from 'node:assert/strict';
import {exportSource} from '../cli/index.js';
import {parseTfi} from '../docs/js/tfi.js';
import {parseVgi} from '../docs/js/vgi.js';
import {createOpmState} from '../docs/vgm_analyzer/opm_monitor.js';
import {exportOpm} from '../docs/vgm_analyzer/opm_export.js';
function source(command,offset,clock){
 const events=[command,0x60,10,command,0x40,10,0x61,0x44,0xac,
 command,0x60,20,command,0x40,20,command,0xb4,0xd6,0x61,0x44,0xac,0x66];
 const b=new Uint8Array(256+events.length),v=new DataView(b.buffer);
 b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(offset,clock,true);b.set(events,256);return b;
}
test('OPN snapshots include boundary writes without key-on, across all OPN families',()=>{
 for(const [cmd,offset,clock] of [[0x52,0x2c,7670454],[0x55,0x44,4000000],[0x56,0x48,8000000],[0x58,0x4c,0x80000000+8000000]]){
  const b=source(cmd,offset,clock);
  for(const [format,parse] of [['tfi',parseTfi],['vgi',parseVgi]]){
   for(const [atSeconds,value] of [[0,10],[.999,10],[1,20],[2,20]]){
    const result=exportSource(b,{format,atSeconds,channel:1}),preset=parse(result.bytes);
    assert.equal(preset.operators[1].tl,value);assert.equal(result.sample,Math.floor(atSeconds*44100));
    if(format==='vgi' && atSeconds>=1)assert.equal(preset.b4,0xd6);
   }
  }
 }
});
test('OPM snapshots match Browser snapshot encoder at exact sample boundaries',()=>{
 const b=source(0x54,0x30,3579545);
 for(const [atSeconds,value] of [[0,10],[.999,10],[1,20],[2,20]]){
  const state=createOpmState(()=>0);state.write(0x60,value);state.write(0x40,value);
  if(atSeconds>=1)state.write(0xb4,0xd6);
  const result=exportSource(b,{format:'opm',atSeconds,channel:1});
  assert.equal(result.text,exportOpm(state.snapshot(),0,'CH1',{clock:3579545}));
 }
});
test('Snapshots validate time, format and hardware channel range',()=>{
 const b=source(0x55,0x44,4000000);
 for(const atSeconds of [undefined,-1,NaN,Infinity,2.001])assert.throws(()=>exportSource(b,{format:'tfi',atSeconds,channel:1}),/time/);
 for(const channel of [undefined,0,1.5,4])assert.throws(()=>exportSource(b,{format:'tfi',atSeconds:0,channel}),/channel/);
 assert.throws(()=>exportSource(b,{format:'midi',atSeconds:0,channel:1}),/Time\/channel/);
 assert.throws(()=>exportSource(b,{format:'opm',atSeconds:0,channel:1}),/YM2151/);
 const opm=source(0x54,0x30,3579545);
 assert.throws(()=>exportSource(opm,{format:'vgi',atSeconds:0,channel:1}),/OPN/);
 const opnb=source(0x58,0x4c,8000000);
 assert.throws(()=>exportSource(opnb,{format:'vgi',atSeconds:0,channel:1}),/channel/);
 assert.equal(exportSource(opnb,{format:'vgi',atSeconds:0,channel:2}).bytes.length,43);
});
