import test from 'node:test';
import assert from 'node:assert/strict';
import {exportYm2608FullVgm} from './ym2608_vgm_import.js';
function input(commands){
 const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);
 bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x161,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x48,7987200,true);bytes.set(commands,0x100);return bytes;
}
const block=[0x67,0x66,0x81,10,0,0,0,32,0,0,0,8,0,0,0,0x12,0x34];
test('YM2608 Write preserves both register banks, memory upload order, offset and waits',async()=>{
 const bytes=input([0x56,8,15,0x56,0x10,1,0x56,0xa0,99,0x61,10,0,...block,0x57,0,0xa0,0x61,20,0,...block,0x57,0,1,0x70,0x66]);
 const files=[];const code=exportYm2608FullVgm(bytes,{writeMemoryFile:data=>{files.push(data);return `/pcm${files.length}.dat`;}});
 let time=0,clock,loop;const events=[];
 const opna={setClock:async c=>{clock=c;},resetRegisters(){events.push([time,'reset']);},write:(...args)=>events.push([time,'write',...args]),adpcm:{loadMemory:async(data,offset)=>events.push([time,'memory',offset,...data])}};
 await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','liveLoop','sleepSamples','file',code)(async name=>{assert.equal(name,'ym2608');return opna;},(_,fn)=>{loop=fn;},async n=>{time+=n;},async path=>files[Number(path.match(/pcm(\d+)/)[1])-1]);
 await loop();assert.equal(clock,7987200);assert.equal(time,31);
 assert.deepEqual(events,[[0,'reset'],[0,'write',0,8,15],[0,'write',0,0x10,1],[0,'write',0,0xa0,99],[10,'memory',8,0x12,0x34],[10,'write',1,0,0xa0],[30,'memory',8,0x12,0x34],[30,'write',1,0,1]]);
 await loop();assert.equal(time,62);assert.equal(events.filter(e=>e[1]==='memory').length,4);
});
test('YM2608 rejects unsupported modes, streams and blocks rather than dropping data',()=>{
 assert.throws(()=>exportYm2608FullVgm(input([0x56,0,0,0x70,0x66]),{mode:'invalid'}),/Unknown YM2608 mode/);
 for(const commands of [[0x50,0,0x66],[0x67,0x66,0,0,0,0,0,0x66],[0x56,0]])assert.throws(()=>exportYm2608FullVgm(input(commands)));
 const bytes=input([0x56,0,0,0x70,0x66]);new DataView(bytes.buffer).setUint32(0x48,0x40000000|7987200,true);assert.throws(()=>exportYm2608FullVgm(bytes),/single YM2608/);
});

test('slow ADPCM acknowledgements do not stall subsequent writes or VGM waits',async()=>{
 const code=exportYm2608FullVgm(input([...block,0x57,0,0xa0,0x61,20,0,...block,0x57,0,1,0x70,0x66]));
 let loop,time=0;const events=[],complete=[];
 const opna={setClock:async()=>{},resetRegisters(){},write:(...args)=>events.push([time,'write',...args]),adpcm:{loadMemory:()=>{events.push([time,'memory']);return new Promise(resolve=>complete.push(resolve));}}};
 await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','liveLoop','sleepSamples',code)(async()=>opna,(_,fn)=>{loop=fn;},async n=>{time+=n;});
 let finished=false;const running=loop().then(()=>{finished=true;});
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(time,21);assert.equal(complete.length,2);assert.equal(finished,false);
 assert.deepEqual(events,[[0,'memory'],[0,'write',1,0,0xa0],[20,'memory'],[20,'write',1,0,1]]);
 complete.forEach(resolve=>resolve());await running;assert.equal(finished,true);
});
test('ADPCM upload failure is handled and reported by the loop',async()=>{
 const code=exportYm2608FullVgm(input([...block,0x70,0x66]));let loop;
 const opna={setClock:async()=>{},resetRegisters(){},adpcm:{loadMemory:()=>Promise.reject(new Error('upload failed'))}};
 await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','liveLoop','sleepSamples',code)(async()=>opna,(_,fn)=>{loop=fn;},async()=>{});
 await assert.rejects(loop(),/upload failed/);
});

test('Schedule prepares memory once and leaves all timed operations on the audio thread',async()=>{
 const code=exportYm2608FullVgm(input([0x56,8,15,0x61,10,0,...block,0x57,0,0xa0,0x70,0x66]),{mode:'schedule'});
 let loop,prepared,plays=0;
 const opna={setClock:async()=>{},prepareTimeline:async(...args)=>{prepared=args;},playTimeline:async()=>{plays++;}};
 await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','liveLoop',code)(async()=>opna,(_,fn)=>{loop=fn;});
 assert.deepEqual(prepared[0],[[0,0,8,15],[10,2,0,8],[10,1,0,0xa0]]);assert.deepEqual([...prepared[1][0]],[0x12,0x34]);assert.equal(prepared[2],11);
 await loop();await loop();assert.equal(plays,2);assert.ok(!code.includes('sleepSamples'));
});

import {createYm2608Client} from '../../web/playground_ym2608.js';
test('generated High matches Write across resets, repeated loops and memory transfers',async()=>{
 const bytes=input([...block,0x56,7,63,0x56,0,12,0x56,1,2,0x56,7,62,0x56,8,15,0x56,0x18,0xdf,0x56,0x11,40,0x56,0x10,1,0x57,9,10,0x57,10,2,0x57,11,200,0x57,0,0xa0,0x57,0xa4,34,0x57,0xa0,44,0x56,0x28,0xf4,0x61,100,0,0x66]);
 async function trace(mode){
  let time=0,loop;const commands=[];
  const port={start(){},close(){},postMessage(m){commands.push([time,m.method,...m.args]);if(m.id)queueMicrotask(()=>port.onmessage({data:{id:m.id}}));}};
  const opna=createYm2608Client(port);commands.length=0;
  const code=exportYm2608FullVgm(bytes,{mode});
  await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','liveLoop','sleepSamples',code)(async()=>opna,(_,fn)=>{loop=fn;},async n=>{time+=n;});
  await loop();await loop();opna.dispose();return commands;
 }
 assert.deepEqual(await trace('high'),await trace('write'));
});
