import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,exportSource} from '../cli/index.js';
import {extractTfiPatchesFromVgm} from '../docs/vgm_analyzer/tfi_extract.js';
import {createVgiFromPreset} from '../docs/js/vgi.js';
import {createTfiFromPreset} from '../docs/js/tfi.js';
import {createOpmTfiFiles} from '../docs/vgm_analyzer/opm_tfi.js';
import {createStoredZipBytes} from '../docs/vgm_analyzer/stored_zip.js';
const fixture=name=>new URL(`./fixtures/${name}.vgz`,import.meta.url);
function entries(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset),result=[];let pos=0;
 while(v.getUint32(pos,true)===0x04034b50){
   const size=v.getUint32(pos+18,true),n=v.getUint16(pos+26,true);
   result.push({name:new TextDecoder().decode(bytes.subarray(pos+30,pos+30+n)),data:bytes.slice(pos+30+n,pos+30+n+size)});pos+=30+n+size;
 }
 assert.equal(v.getUint32(pos,true),0x02014b50);assert.equal(v.getUint32(bytes.length-22,true),0x06054b50);
 assert.equal(v.getUint16(bytes.length-12,true),result.length);
 assert.equal(new Set(result.map(f=>f.name)).size,result.length);
 return result;
}
test('TFI ZIP matches Browser voice bytes for all OPN families and OPM conversion metadata',async()=>{
 for(const name of ['ym2203-fm','ym2608-fm','ym2610-fm','ym2610b-fm','opn-tone','opm-audible']){
   const source=await readSource(fixture(name)),result=exportSource(source,{format:'tfi-zip',fileName:name});
   const expected=name==='opm-audible'?createOpmTfiFiles({buffer:source,fileName:name}).files:extractTfiPatchesFromVgm(source).map(p=>({name:p.label+'.tfi',data:createTfiFromPreset(p.preset)}));
   assert.deepEqual(entries(result.bytes),expected);assert(result.count>0);
   assert.deepEqual(result.bytes,exportSource(source,{format:'tfi-zip',fileName:name}).bytes);
   if(name==='opm-audible'){assert.match(result.warnings.join(' '),/Approximate/);assert(expected.some(f=>f.name==='conversion.json'));}
 }
});
test('TFI ZIP rejects empty/unsupported inputs, dual and mixed FM; ZIP rejects duplicate names',async()=>{
 for(const name of ['psg-tone','ym2203-ssg']){
  const source=await readSource(fixture(name));assert.throws(()=>exportSource(source,{format:'tfi-zip'}),/requires|No keyed/);
 }
 const source=await readSource(fixture('ym2203-fm'));
 for(const [offset,value] of [[0x44,0x40000000+4000000],[0x30,3579545]]){
  const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);assert.throws(()=>exportSource(bad,{format:'tfi-zip'}),/dual|exactly/);
 }
 assert.throws(()=>createStoredZipBytes([{name:'a',data:new Uint8Array()},{name:'a',data:new Uint8Array()}]),/duplicate/);
});

test('VGI ZIP matches Browser bytes for all OPN families and is deterministic',async()=>{
 for(const name of ['ym2203-fm','ym2608-fm','ym2610-fm','ym2610b-fm','opn-tone']){
  const source=await readSource(fixture(name)),result=exportSource(source,{format:'vgi-zip'});
  const expected=extractTfiPatchesFromVgm(source).map(p=>({name:p.label+'.vgi',data:createVgiFromPreset(p.preset)}));
  assert.deepEqual(entries(result.bytes),expected);assert.equal(result.count,expected.length);assert(result.count>0);
  assert.deepEqual(result.bytes,exportSource(source,{format:'vgi-zip'}).bytes);
  assert.match(result.warnings.join(' '),/LFO/);
 }
});
test('VGI ZIP rejects OPM, empty tones, dual and mixed FM configurations',async()=>{
 for(const name of ['opm-audible','psg-tone','ym2203-ssg']){
  const source=await readSource(fixture(name));assert.throws(()=>exportSource(source,{format:'vgi-zip'}),/not supported|requires|No keyed/);
 }
 const source=await readSource(fixture('ym2203-fm'));
 for(const [offset,value] of [[0x44,0x40000000+4000000],[0x30,3579545]]){
  const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);
  assert.throws(()=>exportSource(bad,{format:'vgi-zip'}),/dual|exactly/);
 }
});
