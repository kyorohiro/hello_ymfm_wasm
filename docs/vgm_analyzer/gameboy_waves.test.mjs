import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSamples, exportSamples, listSamples} from './sample_core.js';
import {gameboyWaveCode} from './gameboy_waves.js';
import {appendGameboyWave} from './gameboy_wave_view.js';
const w=(r,v)=>[0xb3,r,v],wait=[0x61,0x44,0xac];
function vgm(commands){
 const bytes=new Uint8Array(256+commands.length);bytes.set([86,103,109,32]);const view=new DataView(bytes.buffer);
 view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x80,4194304,true);bytes.set(commands,256);return bytes;
}
const ram=(base=0)=>Array.from({length:16},(_,i)=>w(0x20+i+base,i*16+(15-i))).flat();
test('32 points unpack high nibble first; write batches deduplicate and partial updates retain memory',async()=>{
 const bytes=vgm([...ram(),...wait,...w(0x0e,128),...wait,...w(0x20,0xff),...wait,...w(0x20,0x0f),0x66]);
 const r=await extractSamples(bytes);
 assert.equal(r.samples.length,2);assert.equal(r.events.length,4);
 assert.deepEqual(r.samples[0].waveform.slice(0,6),[0,15,1,14,2,13]);
 assert.deepEqual(r.samples[1].waveform.slice(0,4),[15,15,1,14]);
 assert.deepEqual(r.events.map(e=>[e.sampleId,e.startTime]),[[1,0],[1,44100],[2,88200],[1,132300]]);
 let copied;new Function('gb',gameboyWaveCode(r.samples[0]))({wave:{setWaveform(v){copied=v;}}});
 assert.deepEqual(copied,r.samples[0].waveform);
 const exported=await exportSamples(bytes,{id:1});assert.match(exported.name,/\.json$/);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(exported.bytes)).waveform,copied);
 assert.equal((await listSamples(bytes)).samples[0].representation,'written-wave-ram');
});
test('incomplete initial data is not filled with invented zeros; unsupported dual-chip input rejects',async()=>{
 const r=await extractSamples(vgm([...w(0x20,0xff),...wait,...ram(),...wait,...w(0x0e,128),0x66]));
 assert.equal(r.samples.length,1);assert.ok(r.events.every(e=>e.chipIndex===0));
 assert.ok(r.warnings.some(w=>w.includes('incomplete')));
 await assert.rejects(extractSamples(vgm([...ram(128),0x66])), /Second Game Boy/);
});
test('wave writes at EOF are retained and unsupported WAV fails clearly',async()=>{
 const bytes=vgm([...ram(),0x66]);
 assert.equal((await extractSamples(bytes)).samples.length,1);
 await assert.rejects(exportSamples(bytes,{id:1,format:'wav'}),/export as JSON/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(extractSamples(bytes,{signal:controller.signal}),{name:'AbortError'});
});
test('wave UI exposes reusable code, graph, JSON and copy fallback',async()=>{
 const r=await extractSamples(vgm([...ram(),0x66]));const old=globalThis.document;let lines=0,selected=false;
 const node=tag=>({tag,children:[],style:{},append(...v){this.children.push(...v);},setAttribute(){},addEventListener(t,fn){this[t]=fn;},focus(){},select(){selected=true;},getContext(){return {beginPath(){},moveTo(){},lineTo(){lines++;},stroke(){}};}});
 globalThis.document={createElement:node};
 try {
  const root=node('div');appendGameboyWave(root,r.samples[0],r.events);const row=root.children[0];
  row.open=true;row.toggle();assert.equal(lines,63);
  const code=row.children.find(x=>x.tag==='textarea');assert.match(code.value,/gb.wave.setWaveform/);
  await row.children.find(x=>x.textContent==='Copy setWaveform JavaScript').onclick();assert.equal(selected,true);
  assert.ok(row.children.some(x=>x.textContent==='Save waveform JSON'));
 }finally{globalThis.document=old;}
});
