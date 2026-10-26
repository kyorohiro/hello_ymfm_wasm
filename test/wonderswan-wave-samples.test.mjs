import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createWonderSwanSampleVgm,WONDER_SWAN_SAMPLE_WAVES} from './helpers/wonderswan_sample_vgm_fixture.mjs';
import {extractSamples,listSamples,exportSamples} from '../docs/vgm_analyzer/sample_core.js';
import {inspectSourceSupport} from '../docs/vgm_analyzer/analyzer_core.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {WonderSwan} from '../web/wonderswan.js';
import {WonderSwanSynth,WonderSwanDirectTransport} from '../web/wonderswansynth.js';
import {wonderswanWaveCode} from '../docs/vgm_analyzer/wonderswan_waves.js';

function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map();let at=0;
  while(view.getUint32(at,true)===0x04034b50){
    const size=view.getUint32(at+18,true),length=view.getUint16(at+26,true);
    const name=new TextDecoder().decode(bytes.slice(at+30,at+30+length));
    files.set(name,bytes.slice(at+30+length,at+30+length+size));at+=30+length+size;
  }return files;
}
test('WonderSwan native JSON/ZIP and inventory preserve deduplicated waves and their physical observations',async()=>{
  const bytes=createWonderSwanSampleVgm(),result=await extractSamples(bytes);
  assert.equal(result.samples.length,2);assert.deepEqual(result.samples.map(s=>[...s.data]),WONDER_SWAN_SAMPLE_WAVES);
  assert.deepEqual(result.samples[0].waveform.slice(0,6),[1,2,3,4,5,6]);
  assert(result.events.some(e=>e.channel===2&&e.startTime===88200&&e.address===0x1210));
  const inventory=await listSamples(bytes);assert(inventory.samples.every(s=>s.representation==='written-wave-ram'&&s.exportable&&!('data'in s)));
  const zip=await exportSamples(bytes,{all:true}),files=unzip(zip.bytes);
  assert.equal(zip.count,2);assert.equal(files.size,3);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))),inventory);
  for(const sample of result.samples){
    const saved=await exportSamples(bytes,{id:sample.id}),json=JSON.parse(new TextDecoder().decode(saved.bytes));
    assert.deepEqual(files.get(saved.name),saved.bytes);assert.deepEqual(json.packedBytes,[...sample.data]);
    assert.deepEqual(json.observations,result.events.filter(e=>e.sampleId===sample.id));
  }
  assert.deepEqual((await exportSamples(bytes,{all:true})).bytes,zip.bytes);
  assert.equal((await inspectSourceSupport(bytes)).samples.status,'available');
});

test('Copied waveform code roundtrips through the real Playground Synth and WASM RAM',async()=>{
  const result=await extractSamples(createWonderSwanSampleVgm());
  const chip=await WonderSwan.create({moduleFactory:await getNodePlaybackFactory('wonderswan')});
  try{
    const ws=new WonderSwanSynth({transport:new WonderSwanDirectTransport(chip)});ws.initialize();
    new Function('ws',wonderswanWaveCode(result.samples[0],3))(ws);
    assert.deepEqual(Array.from({length:16},(_,i)=>chip.readMemory(3*16+i)),WONDER_SWAN_SAMPLE_WAVES[0]);
    ws.setNote(3,'A4');ws.keyOn(3);assert(chip.generateStereo(4096).left.some(Boolean));
    ws.dispose();
  }finally{chip.dispose();}
});

test('Selected-occurrence WAV and CLI exports use the same bounded real preview',async()=>{
  const bytes=createWonderSwanSampleVgm(),result=await extractSamples(bytes);
  const wav=await exportSamples(bytes,{id:1,format:'wav',occurrence:2,getFactory:getNodePlaybackFactory});
  assert.equal(wav.seconds,1);assert.equal(wav.bytes.length,176444);assert(wav.bytes.subarray(44).some(Boolean));
  assert(wav.warnings.some(w=>w.includes('isolated waveform preview')));
  await assert.rejects(exportSamples(bytes,{id:1,format:'wav',occurrence:999,getFactory:getNodePlaybackFactory}),/occurrence/);
  const directory=await mkdtemp(join(tmpdir(),'ws-wave-cli-'));
  try{
    const {writeFile}=await import('node:fs/promises');const input=join(directory,'original.vgm'),output=join(directory,'wave.json');await writeFile(input,bytes);
    const cli=(...args)=>spawnSync(process.execPath,['cli/main.js','samples',input,...args],{encoding:'utf8'});
    const listing=cli('--json');assert.equal(listing.status,0,listing.stderr);assert.deepEqual(JSON.parse(listing.stdout),await listSamples(bytes));
    const native=cli('--id','1','--output',output);assert.equal(native.status,0,native.stderr);
    assert.deepEqual(new Uint8Array(await readFile(output)),(await exportSamples(bytes,{id:1})).bytes);
    const wavPath=join(directory,'wave.wav'),rendered=cli('--id','1','--format','wav','--occurrence','2','--output',wavPath);
    assert.equal(rendered.status,0,rendered.stderr);assert.deepEqual(new Uint8Array(await readFile(wavPath)),wav.bytes);
    assert(result.samples[0].data.length===16);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('Incomplete waves, cancellation and unsupported headers fail without fabricated sample data',async()=>{
  const bytes=createWonderSwanSampleVgm(),dual=bytes.slice(),missing=bytes.slice();
  new DataView(dual.buffer).setUint32(0xc0,0x40000000+3072000,true);
  await assert.rejects(extractSamples(dual),/single chip/);
  new DataView(missing.buffer).setUint32(0xc0,0,true);await assert.rejects(extractSamples(missing),/declared clock/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractSamples(bytes,{signal:controller.signal}),{name:'AbortError'});
});
