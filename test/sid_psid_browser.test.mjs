import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as browser from '../tetorica_src/runtime/sid_psid.js';
import * as cli from '../tetorica_src/cli/sid_psid.mjs';
import * as mirror from '../docs/js/sid_psid.js';
import {createSidReferenceFixture,SID_REFERENCE_FIXTURES} from './fixtures/sid-reference/fixture.mjs';

const modified=(change,options)=>{const bytes=createSidReferenceFixture('melody-filter',options).bytes;change(new DataView(bytes.buffer),bytes);return bytes;};
const unsupported=(bytes,pattern)=>assert.throws(()=>browser.validateBrowserPsid(bytes),error=>error instanceof browser.SidPsidError&&error.code==='PSID_UNSUPPORTED'&&pattern.test(error.message));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('the CLI compatibility entry retains every shared parser export',()=>{
  assert.deepEqual(Object.keys(cli),Object.keys(browser));
  assert.deepEqual(Object.keys(browser).sort(),['PSID_HEADER_BYTES','PSID_MAX_FILE_BYTES','PSID_SPECIFICATION_URL','SidPsidError','parsePsid','validateBrowserPsid'].sort());
  for(const key of Object.keys(browser))assert.equal(cli[key],browser[key],key);
  for(const profile of SID_REFERENCE_FIXTURES){
    const fixture=createSidReferenceFixture(profile),parsed=browser.validateBrowserPsid(fixture.bytes);
    assert.equal(parsed.subtune,1);assert.equal(parsed.version,2);assert.equal(parsed.clockHz,985248);
    assert.equal(parsed.sidCount,1);assert.equal(parsed.model,'6581');assert.equal(parsed.flags,0x14);
    assert.equal(parsed.selectedClock,'pal');assert.equal(parsed.selectedModel,'6581');
    assert.deepEqual(parsed.selection,{clock:'header',model:'header'});
    assert.deepEqual(parsed.program,fixture.program);assert.equal(parsed.metadata.name,`Tetorica ${profile}`);
  }
});

test('browser song selection is one-based, defaults to the header and never coerces input',()=>{
  const bytes=modified(view=>{view.setUint16(14,3);view.setUint16(16,2);});
  assert.equal(browser.validateBrowserPsid(bytes).subtune,2);
  for(const subtune of [1,2,3])assert.equal(browser.validateBrowserPsid(bytes,{subtune}).subtune,subtune);
  for(const subtune of [0,-1,4,1.5,NaN,Infinity,null,'2',true])assert.throws(()=>browser.validateBrowserPsid(bytes,{subtune}),RangeError);
  const max=modified(view=>{view.setUint16(14,256);view.setUint16(16,256);});
  assert.equal(browser.validateBrowserPsid(max,{subtune:256}).subtune,256);
});

test('browser execution rejects metadata-only versions, all CIA bits and relocation',()=>{
  for(const version of [3,4]){
    const bytes=createSidReferenceFixture('tone',{version}).bytes;
    assert.equal(browser.parsePsid(bytes).version,version);
    unsupported(bytes,/v2 only/);
  }
  for(const speed of [1,2,0x80000000,0xffffffff]){
    const bytes=modified(view=>view.setUint32(18,speed));
    assert.equal(browser.parsePsid(bytes).speed,speed);
    unsupported(bytes,/VBI.*CIA/);
  }
  for(const [page,length] of [[0x20,2],[255,0]])unsupported(modified((_view,bytes)=>{bytes[0x78]=page;bytes[0x79]=length;}),/relocation/);
});

test('browser program RAM bounds are inclusive at $0800 and exclusive at $D000',()=>{
  const fixture=createSidReferenceFixture('melody-filter',{embeddedLoadAddress:false});
  const relocate=load=>{
    const bytes=fixture.bytes.slice(),view=new DataView(bytes.buffer);
    view.setUint16(8,load);view.setUint16(10,load);view.setUint16(12,load+fixture.playAddress-fixture.loadAddress);
    return bytes;
  };
  assert.equal(browser.validateBrowserPsid(relocate(0x0800)).loadAddress,0x0800);
  assert.equal(browser.validateBrowserPsid(relocate(0xd000-fixture.program.length)).endAddress,0xd000);
  unsupported(relocate(0x07ff),/RAM/);
  unsupported(relocate(0xd001-fixture.program.length),/RAM/);
  const fallback=modified(view=>view.setUint16(10,0));
  assert.equal(browser.validateBrowserPsid(fallback).initAddress,fixture.loadAddress);
});

test('browser validation retains strict header, model, IRQ and malformed range failures',()=>{
  for(const flags of [0x18,0x24,0x15,0x16,0x54,0x414])unsupported(modified(view=>view.setUint16(0x76,flags)),/NTSC|8580|MUS|PlaySID|additional|reserved/);
  unsupported(modified(view=>view.setUint16(12,0)),/IRQ/);
  assert.throws(()=>browser.validateBrowserPsid(modified(view=>view.setUint16(10,0xffff))),error=>error.code==='PSID_INVALID');
  const magic=modified((_view,bytes)=>bytes.set(new TextEncoder().encode('RSID')));
  unsupported(magic,/RSID/);
  assert.throws(()=>browser.validateBrowserPsid(new Uint8Array(124)),error=>error.code==='PSID_INVALID');
});

test('browser explicit choices retain raw declarations and original bytes for every clock/model combination',()=>{
  const clocks=['unknown','pal','ntsc','any'],models=['unknown','6581','8580','any'];
  for(let clockBits=0;clockBits<4;clockBits++)for(let modelBits=0;modelBits<4;modelBits++){
    const flags=(clockBits<<2)|(modelBits<<4),bytes=modified(view=>view.setUint16(0x76,flags)),before=bytes.slice();
    if(clockBits===2||modelBits===2){
      assert.throws(()=>browser.validateBrowserPsid(bytes,{clock:'pal',model:'6581'}),error=>error.code==='PSID_UNSUPPORTED'&&/NTSC|8580/.test(error.message));
      assert.throws(()=>browser.validateBrowserPsid(bytes),error=>error.code==='PSID_UNSUPPORTED');
    }else{
      const parsed=browser.validateBrowserPsid(bytes,{clock:'pal',model:'6581'});
      assert.equal(parsed.clock,clocks[clockBits]);assert.equal(parsed.model,models[modelBits]);assert.equal(parsed.flags,flags);
      assert.equal(parsed.selectedClock,'pal');assert.equal(parsed.selectedModel,'6581');assert.equal(parsed.clockHz,985248);
      assert.deepEqual(parsed.selection,{clock:clockBits===1?'header':'explicit',model:modelBits===1?'header':'explicit'});
      assert.deepEqual(parsed.originalBytes,before);assert.deepEqual(parsed.program,before.slice(126));
      assert.equal(new DataView(parsed.originalBytes.buffer).getUint16(0x76),flags,'metadata does not patch the source header');
      if(clockBits!==1||modelBits!==1)assert.throws(()=>browser.validateBrowserPsid(bytes),error=>error instanceof browser.SidPsidError&&error.code==='PSID_CHOICE_REQUIRED');
    }
    if(clockBits===1&&modelBits===1){
      const strict=cli.parsePsid(bytes);assert.equal(strict.clock,'pal');assert.equal(strict.model,'6581');assert.equal(strict.clockHz,985248);
      assert.equal('selection' in strict,false);assert.equal('selectedClock' in strict,false);assert.equal('selectedModel' in strict,false);
    }else{
      assert.throws(()=>cli.parsePsid(bytes),error=>error.code==='PSID_UNSUPPORTED');
      assert.throws(()=>cli.parsePsid(bytes,{clock:'pal',model:'6581'}),error=>error.code==='PSID_UNSUPPORTED','CLI cannot opt out of strict declarations');
    }
    assert.deepEqual(bytes,before);
  }
});

test('only missing browser hints require corresponding explicit options, with no coercion',()=>{
  for(const flags of [0x10,0x1c]){
    const bytes=modified(view=>view.setUint16(0x76,flags));
    assert.throws(()=>browser.validateBrowserPsid(bytes),error=>error.code==='PSID_CHOICE_REQUIRED'&&/explicitly choose PAL/.test(error.message));
    assert.equal(browser.validateBrowserPsid(bytes,{clock:'pal'}).selectedClock,'pal');
  }
  for(const flags of [0x04,0x34]){
    const bytes=modified(view=>view.setUint16(0x76,flags));
    assert.throws(()=>browser.validateBrowserPsid(bytes),error=>error.code==='PSID_CHOICE_REQUIRED'&&/explicitly choose 6581/.test(error.message));
    assert.equal(browser.validateBrowserPsid(bytes,{model:'6581'}).selectedModel,'6581');
  }
  const unknown=modified(view=>{view.setUint16(0x76,0);view.setUint16(14,3);view.setUint16(16,2);});
  assert.throws(()=>browser.validateBrowserPsid(unknown,{clock:'pal'}),error=>error.code==='PSID_CHOICE_REQUIRED'&&/model/.test(error.message));
  assert.throws(()=>browser.validateBrowserPsid(unknown,{model:'6581'}),error=>error.code==='PSID_CHOICE_REQUIRED'&&/clock/.test(error.message));
  assert.equal(browser.validateBrowserPsid(unknown,{clock:'pal',model:'6581'}).subtune,2);
  assert.equal(browser.validateBrowserPsid(unknown,{clock:'pal',model:'6581',subtune:3}).subtune,3);
  for(const options of [{clock:'PAL'},{clock:'ntsc'},{clock:null},{clock:true},{model:'MOS6581'},{model:'8580'},{model:null},{model:6581}])assert.throws(()=>browser.validateBrowserPsid(unknown,options),RangeError);
  for(const subtune of [0,4,null,'2'])assert.throws(()=>browser.validateBrowserPsid(unknown,{clock:'pal',model:'6581',subtune}),RangeError);
});

test('explicit target choices cannot bypass the existing file, version, speed, relocation, RAM or entry limits',()=>{
  const options={clock:'pal',model:'6581'};
  const explicitRejects=(bytes,pattern,code='PSID_UNSUPPORTED')=>assert.throws(()=>browser.validateBrowserPsid(bytes,options),error=>error.code===code&&pattern.test(error.message));
  for(const version of [3,4])explicitRejects(modified(view=>view.setUint16(0x76,0),{version}),/v2 only/);
  explicitRejects(modified(view=>{view.setUint16(0x76,0);view.setUint32(18,1);}),/VBI/);
  explicitRejects(modified((view,bytes)=>{view.setUint16(0x76,0);bytes[0x78]=0x20;bytes[0x79]=1;}),/relocation/);
  explicitRejects(modified(view=>{view.setUint16(0x76,0);view.setUint16(8,0x0700);view.setUint16(10,0x0700);view.setUint16(12,0x0700);}),/RAM/);
  explicitRejects(modified(view=>{view.setUint16(0x76,0);view.setUint16(12,0);}),/IRQ/);
  explicitRejects(modified(view=>{view.setUint16(0x76,0);view.setUint16(10,0xffff);}),/initAddress/,'PSID_INVALID');
  for(const flags of [1,2,0x40,0x400])explicitRejects(modified(view=>view.setUint16(0x76,flags)),/MUS|PlaySID|additional|reserved/);
  const bytes=modified(view=>view.setUint16(0x76,0)),backing=new Uint8Array(browser.PSID_MAX_FILE_BYTES+100);backing.set(bytes,50);
  assert.deepEqual(browser.validateBrowserPsid(new DataView(backing.buffer,50,bytes.length),options).originalBytes,bytes);
  assert.throws(()=>browser.validateBrowserPsid(bytes,{...options,maxBytes:bytes.length-1}),error=>error.code==='PSID_LIMIT');
});

test('browser byte windows, detached output and size policies are bounded before copying',()=>{
  const bytes=createSidReferenceFixture('pulse').bytes,padded=new Uint8Array(browser.PSID_MAX_FILE_BYTES+1000);padded.set(bytes,100);
  for(const window of [padded.subarray(100,100+bytes.length),new DataView(padded.buffer,100,bytes.length)]){
    const parsed=browser.validateBrowserPsid(window,{maxBytes:bytes.length});
    assert.deepEqual(parsed.originalBytes,bytes);assert.equal(parsed.fileSize,bytes.length);
    parsed.originalBytes.fill(0);parsed.program.fill(0);assert.equal(padded[100],0x50);
  }
  assert.throws(()=>browser.validateBrowserPsid(padded),error=>error.code==='PSID_LIMIT');
  assert.throws(()=>browser.validateBrowserPsid(bytes,{maxBytes:bytes.length-1}),error=>error.code==='PSID_LIMIT');
  for(const maxBytes of [0,124,Infinity,125.5,browser.PSID_MAX_FILE_BYTES+1])assert.throws(()=>browser.validateBrowserPsid(bytes,{maxBytes}),RangeError);
});

test('the served parser is byte-identical, standalone browser JS with the same behavior',async()=>{
  const canonical=await readFile(new URL('../tetorica_src/runtime/sid_psid.js',import.meta.url),'utf8');
  const served=await readFile(new URL('../docs/js/sid_psid.js',import.meta.url),'utf8');
  assert.equal(served,canonical);
  assert.doesNotMatch(canonical,/\b(?:import|require)\s*(?:\(|[{'"*])/);
  assert.doesNotMatch(canonical,/\b(?:Buffer|process|node:)\b/);
  const savedDecoder=globalThis.TextDecoder;
  let workletSafe;
  try{
    globalThis.TextDecoder=undefined;
    workletSafe=await import(`data:text/javascript;base64,${Buffer.from(canonical).toString('base64')}`);
  }finally{globalThis.TextDecoder=savedDecoder;}
  for(const profile of SID_REFERENCE_FIXTURES){
    const bytes=createSidReferenceFixture(profile).bytes;
    assert.deepEqual(mirror.validateBrowserPsid(bytes),browser.validateBrowserPsid(bytes));
    assert.deepEqual(workletSafe.validateBrowserPsid(bytes),browser.validateBrowserPsid(bytes));
  }
  const unspecified=modified(view=>view.setUint16(0x76,0)),options={clock:'pal',model:'6581'};
  assert.deepEqual(workletSafe.validateBrowserPsid(unspecified,options),browser.validateBrowserPsid(unspecified,options));
});

test('pure JavaScript metadata decoding retains every Windows-1252 C1 mapping and full byte fields',()=>{
  const bytes=createSidReferenceFixture('tone').bytes;
  bytes.set(Uint8Array.from({length:32},(_,i)=>0x80+i),0x16);
  bytes.set(Uint8Array.from({length:32},(_,i)=>0xe0+i),0x36);
  const parsed=browser.validateBrowserPsid(bytes),decoder=new TextDecoder('windows-1252');
  assert.equal(parsed.metadata.name,decoder.decode(bytes.subarray(0x16,0x36)));
  assert.equal(parsed.metadata.author,decoder.decode(bytes.subarray(0x36,0x56)));
  bytes.set([0x81,0x8d,0x8f,0x90,0x9d,0,0xff],0x16);
  assert.equal(browser.parsePsid(bytes).metadata.name,'\u0081\u008d\u008f\u0090\u009d');
});

test('local demo files and provenance reproduce exactly from the original self-authored builder',async()=>{
  const directory=new URL('../docs/sid-player/demos/',import.meta.url),manifest=JSON.parse(await readFile(new URL('provenance.json',directory),'utf8'));
  const original=await readFile(new URL('./fixtures/sid-reference/fixture.mjs',import.meta.url));
  const local=await readFile(new URL('fixture.mjs',directory));
  assert.deepEqual(local,original);assert.equal(manifest.generator.sha256,sha256(original));
  assert.equal(manifest.format,'tetorica-sid-player-demos');assert.equal(manifest.license,'BSD-3-Clause');
  assert.deepEqual(manifest.files.map(file=>file.profile),SID_REFERENCE_FIXTURES);
  for(const file of manifest.files){
    const bytes=await readFile(new URL(file.name,directory)),fixture=createSidReferenceFixture(file.profile);
    assert.deepEqual(bytes,Buffer.from(fixture.bytes));assert.equal(file.bytes,bytes.length);assert.equal(file.sha256,sha256(bytes));
    const parsed=browser.validateBrowserPsid(bytes);
    assert.equal(parsed.loadAddress,file.loadAddress);assert.equal(parsed.initAddress,file.initAddress);assert.equal(parsed.playAddress,file.playAddress);
    assert.equal(parsed.songs,file.songs);assert.equal(parsed.startSong,file.startSong);
  }
  const license=await readFile(new URL('LICENSE.txt',directory),'utf8');
  assert.match(license,/2026 kyorohiro and Tetorica contributors/);assert.match(license,/BSD 3-Clause License/);
  assert.match(license,/THIS SOFTWARE IS PROVIDED/);
});
