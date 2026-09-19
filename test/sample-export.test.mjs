import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,exportSourceSamples} from '../cli/index.js';
import {extractSamples} from '../docs/vgm_analyzer/sample_explorer.js';
import {pwmCaptureJson} from '../docs/vgm_analyzer/pwm_samples.js';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const fixture=name=>new URL('./fixtures/'+name+'.vgz',import.meta.url);
function unzip(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset),files=new Map();let p=0;
 while(v.getUint32(p,true)===0x04034b50){
  const size=v.getUint32(p+18,true),n=v.getUint16(p+26,true),name=new TextDecoder().decode(bytes.slice(p+30,p+30+n));
  assert(!files.has(name));files.set(name,bytes.slice(p+30+n,p+30+n+size));p+=30+n+size;
 }
 return files;
}
test('Native samples and batch manifest preserve Browser raw bytes and timed PWM captures',async()=>{
 for(const name of ['ym2610-adpcm-a','ym2610-adpcm-b','pwm-all']){
  const source=await readSource(fixture(name)),browser=await extractSamples(source);
  const batch=await exportSourceSamples(source,{all:true}),files=unzip(batch.bytes);
  assert.equal(batch.count,browser.samples.length);
  assert.equal(files.size,batch.count+1);
  const manifest=JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  assert.deepEqual(manifest.events,browser.events);
  for(const sample of browser.samples){
   const saved=await exportSourceSamples(source,{id:sample.id});
   const expected=sample.kind==='pwm'?new TextEncoder().encode(pwmCaptureJson(sample,browser.events.find(e=>e.sampleId===sample.id).startTime)):sample.data;
   assert.deepEqual(saved.bytes,expected);assert.deepEqual(files.get(saved.name),expected);
  }
  assert.deepEqual(batch.bytes,(await exportSourceSamples(source,{all:true})).bytes);
 }
});
test('Sample export rejects invalid selection, empty tracks and unavailable memory',async()=>{
 const source=await readSource(fixture('psg-tone'));
 for(const options of [{},{id:0},{id:1.5},{id:1,all:true},{all:true},{id:1}])await assert.rejects(exportSourceSamples(source,options));
 const b=new Uint8Array(263),v=new DataView(b.buffer);b.set([86,103,109,32]);
 v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x4c,8000000,true);
 b.set([0x59,0x20,0,0x59,0,1,0x66],256);
 for(const options of [{id:1},{all:true}])await assert.rejects(exportSourceSamples(b,options),/missing\/partial/);
});
test('CLI sample export protects existing files, handles force and rejects invalid IDs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sample-export-'));
 try{
  const input=fixture('ym2610-adpcm-a').pathname,output=join(dir,'sample.bin');
  const cli=(...args)=>spawnSync(process.execPath,['cli/main.js','samples',input,...args],{encoding:'utf8'});
  const args=['--id','1','--output',output];
  assert.equal(cli(...args).status,0);const before=readFileSync(output);
  assert.equal(cli(...args).status,1);assert.equal(cli(...args,'--force').status,0);
  assert.equal(cli('--id','999','--output',output,'--force').status,1);
  assert.deepEqual(readFileSync(output),before);
  assert.equal(cli('--all','--output',join(dir,'all.zip')).status,0);
  assert.equal(cli('--id','1','--all','--output',output,'--force').status,1);
  assert.equal(cli('--id','1','--json','--output',output).status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('DAC native export retains write timing rather than pretending to be a WAV',async()=>{
 const cmds=[0x52,0x2b,128,0x52,0x2a,64,0x61,10,0,0x52,0x2a,192,0x61,10,0,0x66];
 const b=new Uint8Array(256+cmds.length),v=new DataView(b.buffer);b.set([86,103,109,32]);
 v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x2c,7670454,true);b.set(cmds,256);
 const saved=await exportSourceSamples(b,{id:1});
 assert.match(saved.name,/\.json$/);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(saved.bytes)),{timebase:44100,startTime:0,duration:20,boundary:'VGM end',times:[0,0,10],values:[128,64,192]});
});
