import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,exportSource} from '../cli/index.js';
import {extractOpmPatches} from '../docs/vgm_analyzer/opm_export.js';
import {createStoredZipBytes} from '../docs/vgm_analyzer/stored_zip.js';
const fixture=name=>new URL('./fixtures/'+name+'.vgz',import.meta.url);
test('OPM ZIP preserves Browser text, names and deterministic archive bytes',async()=>{
 const source=await readSource(fixture('opm-audible'));
 const patches=extractOpmPatches(source),result=exportSource(source,{format:'opm-zip'});
 assert(result.count>0);assert.equal(result.count,patches.length);
 assert.equal(new Set(patches.map(p=>p.name)).size,patches.length);
 assert.deepEqual(result.bytes,createStoredZipBytes(patches.map(p=>({name:p.name,data:new TextEncoder().encode(p.text)}))));
 assert.deepEqual(result.bytes,exportSource(source,{format:'opm-zip'}).bytes);
 assert.match(patches[0].text,/Tetorica-Source-Clock-Hz/);
 assert.match(result.warnings.join(' '),/phase/);
});
test('OPM ZIP accepts YM2164 and rejects absent, dual and silent OPM/OPP',async()=>{
 const absent=await readSource(fixture('opn-tone'));
 assert.throws(()=>exportSource(absent,{format:'opm-zip'}),/single YM2151/);
 const source=await readSource(fixture('opm-audible'));
 const opp=source.slice();
 new DataView(opp.buffer).setUint32(0x30,3579545+0x80000000,true);
 assert.equal(exportSource(opp,{format:'opm-zip'}).count,exportSource(source,{format:'opm-zip'}).count);
 for(const flag of [0x40000000,0xc0000000]){
  const bad=source.slice(),v=new DataView(bad.buffer);
  v.setUint32(0x30,3579545+flag,true);
  assert.throws(()=>exportSource(bad,{format:'opm-zip'}),/single YM2151/);
 }
 const silent=new Uint8Array(257),v=new DataView(silent.buffer);
 silent.set([86,103,109,32]);v.setUint32(8,0x171,true);
 v.setUint32(0x30,3579545,true);v.setUint32(0x34,204,true);silent[256]=0x66;
 assert.throws(()=>exportSource(silent,{format:'opm-zip'}),/No keyed tones/);
});
