import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createYmf278bSamples,decodeYmf278bSample} from './ymf278b_samples.js';
import {extractSamples,exportSamples,listSamples} from './sample_core.js';
import {renderSamplePreview} from './sample_render.js';
const fixture=name=>readFileSync(new URL(`../../test/fixtures/ymf278b-${name}.vgm`,import.meta.url));
const write=(s,r,v,t=0)=>s.apply({type:'ymf278b-write',port:2,register:r,value:v},t);
function load(s,offset,data){s.apply({type:'opl-sample-data',chip:'ymf278b',chipIndex:0,offset,data:Uint8Array.from(data)},0);}
test('OPL4 embedded and external samples agree; missing ROM is explicit; WAV and inventory work',async()=>{
 const a=await extractSamples(fixture('embedded'));
 assert.equal(a.samples.length,1);assert.equal(a.samples[0].frameCount,256);assert.equal(a.events[0].rate,22050);
 const rom=new Uint8Array(0x200000);rom.set([0,1,0,0,0,255,0,0,0xf0,0,0x0f,0]);rom.set(a.samples[0].data,256);
 const b=await extractSamples(fixture('external'),{roms:{ymf278bWave:rom}});
 assert.deepEqual(a.samples[0].data,b.samples[0].data);
 const missing=await extractSamples(fixture('external'));assert.equal(missing.samples.length,0);assert(missing.warnings.some(w=>/header missing/.test(w)));
 const pcm=await renderSamplePreview(a.samples[0],a.events[0]);assert.equal(pcm.left.length,512);assert(pcm.left.some(v=>v!==0));
 const wav=await exportSamples(fixture('external'),{id:1,format:'wav',roms:{ymf278bWave:rom}});assert.equal(new TextDecoder().decode(wav.bytes.slice(0,4)),'RIFF');
 assert.equal((await listSamples(fixture('embedded'))).samples[0].representation,'raw-pcm');
});
test('OPL4 signed PCM packing decodes 8, 12, and 16 bit extrema',()=>{
 for(const [format,data,expected] of [[8,[128,127],[-1,127/128]],[12,[128,0xf0,127],[-1,2047/2048]],[16,[128,0,127,255],[-1,32767/32768]]])
  assert.deepEqual([...decodeYmf278bSample({format,frameCount:2,data:Uint8Array.from(data)})],expected);
});
test('OPL4 banked headers latch on low wave write; key-on snapshots preserve RAM versions and rates',()=>{
 const s=createYmf278bSamples(33868800);
 load(s,0x80000,[0,1,0,0,1,255,254,0,0,0,0,0]);load(s,256,[1,2]);
 write(s,2,4);write(s,0x20,1);write(s,8,128); // wave384, header bank1
 write(s,0x38,0x10);write(s,0x68,128);
 write(s,0x68,0,100);load(s,256,[3,4]);write(s,0x38,0xf0);write(s,0x68,128,200);s.finish(300);
 assert.equal(s.samples.length,2);assert.deepEqual([...s.samples[0].data],[1,2]);assert.deepEqual([...s.samples[1].data],[3,4]);
 assert.equal(s.samples[0].loopStart,1);assert.equal(s.events[0].rate,44100);assert.equal(s.events[1].rate,11025);
 assert.equal(s.events[0].endTime,100);assert.equal(s.events[1].startTime,200);
});
test('OPL4 partial data cannot be previewed and malformed external ROM is rejected',async()=>{
 const s=createYmf278bSamples(33868800);load(s,0,[0,1,0,0,0,255,254,0,0,0,0,0]);load(s,256,[1]);write(s,8,0);write(s,0x68,128);
 assert.equal(s.samples[0].data,null);await assert.rejects(renderSamplePreview(s.samples[0],s.events[0]),/missing/);
 assert.throws(()=>createYmf278bSamples(33868800,new Uint8Array(1)),/2097152/);
});
