import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseRsid,validateBrowserRsid,SidRsidError,RSID_HEADER_BYTES,RSID_MAX_FILE_BYTES} from '../tetorica_src/runtime/sid_rsid.js';
import {parsePsid} from '../tetorica_src/cli/sid_psid.mjs';

// Layout-only original data, deliberately not a playable RSID or C64 ROM.
// Real timer/raster fixture programs are maintained independently by B.
function input({load=0x1000,length=16,init=load,flags=0x14,songs=1,startSong=1}={}){
  const bytes=new Uint8Array(126+length),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RSID'));view.setUint16(4,2);view.setUint16(6,124);
  view.setUint16(10,init);view.setUint16(14,songs);view.setUint16(16,startSong);view.setUint16(0x76,flags);view.setUint16(124,load,true);
  bytes.set(new TextEncoder().encode('Original layout test'),0x16);bytes.set(new TextEncoder().encode('Tetorica contributors'),0x36);
  bytes.set(new TextEncoder().encode('2026 BSD-3-Clause'),0x56);bytes[126]=0x60;
  return bytes;
}
function changed(change,options){const bytes=input(options);change(new DataView(bytes.buffer),bytes);return bytes;}
const rejects=(bytes,pattern,code='RSID_INVALID')=>assert.throws(()=>parseRsid(bytes),error=>error instanceof SidRsidError&&error.code===code&&pattern.test(error.message));

test('RSID layout keeps reserved speed/play semantics and detached metadata without altering the legacy PSID parser',()=>{
  const bytes=input(),parsed=parseRsid(bytes);
  assert.equal(parsed.format,'RSID');assert.equal(parsed.version,2);assert.equal(parsed.programOffset,126);
  assert.equal(parsed.loadAddress,0x1000);assert.equal(parsed.initAddress,0x1000);assert.equal(parsed.playAddress,0);assert.equal(parsed.speed,0);
  assert.equal(parsed.loadAddressEmbedded,true);assert.equal(parsed.timing,'c64-irq');assert.equal(parsed.sidAddress,0xd400);assert.equal(parsed.sidCount,1);
  assert.equal(parsed.clock,'pal');assert.equal(parsed.model,'6581');assert.equal(parsed.basic,false);assert.equal(parsed.clockHz,985248);
  assert.deepEqual(parsed.metadata,{name:'Original layout test',author:'Tetorica contributors',released:'2026 BSD-3-Clause'});
  assert.equal('songSpeeds' in parsed,false,'RSID speed=0 does not mean VBI subroutine calls');
  assert.throws(()=>parsePsid(bytes),error=>error.code==='PSID_UNSUPPORTED');
  parsed.originalBytes.fill(0);parsed.program.fill(0);assert.equal(bytes[0],0x52);assert.equal(bytes[126],0x60);
});

test('byte windows, input size and maxBytes are checked before copying',()=>{
  const bytes=input(),backing=new Uint8Array(RSID_MAX_FILE_BYTES+100);backing.set(bytes,19);
  for(const window of [bytes,bytes.buffer,Buffer.from(bytes),backing.subarray(19,19+bytes.length),new DataView(backing.buffer,19,bytes.length)])assert.deepEqual(parseRsid(window).originalBytes,bytes);
  assert.equal(parseRsid(bytes,{maxBytes:bytes.length}).fileSize,bytes.length);
  assert.throws(()=>parseRsid(bytes,{maxBytes:bytes.length-1}),error=>error.code==='RSID_LIMIT');
  assert.throws(()=>parseRsid(backing),error=>error.code==='RSID_LIMIT');
  for(const maxBytes of [0,126,127.5,Infinity,NaN,RSID_MAX_FILE_BYTES+1,'1000'])assert.throws(()=>parseRsid(bytes,{maxBytes}),RangeError);
  for(const value of [null,{},[],123,'RSID'])assert.throws(()=>parseRsid(value),TypeError);
});

test('RSID version/signature/header prefixes and mandatory reserved values are strict',()=>{
  const bytes=input();for(const length of [0,1,3,4,5,6,123])rejects(bytes.slice(0,length),/truncated/);
  for(const version of [0,1,3,4,5,0xffff])rejects(changed(view=>view.setUint16(4,version)),/v2 only/,'RSID_UNSUPPORTED');
  rejects(changed((_view,data)=>data.set(new TextEncoder().encode('PSID'))),/separate PSID/,'RSID_UNSUPPORTED');
  rejects(changed((_view,data)=>data[0]=0),/signature/);
  for(const offset of [0,118,123,125,0xffff])rejects(changed(view=>view.setUint16(6,offset)),/dataOffset/);
  for(const [offset,value] of [[8,0x1000],[12,0x1003]])rejects(changed(view=>view.setUint16(offset,value)),/reserved/);
  for(const speed of [1,0x80000000,0xffffffff])rejects(changed(view=>view.setUint32(18,speed)),/reserved speed/);
  rejects(bytes.slice(0,125),/embedded/);rejects(bytes.slice(0,126),/empty/);
  assert.equal(RSID_HEADER_BYTES,124);
});

test('MUS, newer flags and multi-SID fields are rejected rather than played as one SID',()=>{
  rejects(input({flags:0x15}),/MUS/,'RSID_UNSUPPORTED');
  for(const flags of [0x54,0x114,0x314])rejects(input({flags}),/additional SID/,'RSID_UNSUPPORTED');
  for(const flags of [0x414,0x814,0x1014,0x8014])rejects(input({flags}),/reserved|newer/,'RSID_UNSUPPORTED');
  for(const offset of [0x7a,0x7b])for(const address of [1,0x42,0xfe])rejects(changed((_view,bytes)=>{bytes[offset]=address;}),/reserved.*SID/);
});

test('the payload may extend through $FFFF, while machine-code init cannot enter ROM/I/O',()=>{
  assert.equal(parseRsid(input({load:0x07e8,length:1})).loadAddress,0x07e8);
  rejects(input({load:0x07e7,length:1}),/at least/);
  assert.equal(parseRsid(input({load:0xcfff,length:0x3001})).endAddress,0x10000);
  rejects(input({load:0xcfff,length:0x3002}),/load range/);
  for(const load of [0xa000,0xbfff,0xd000,0xffff])rejects(input({load,length:1}),/ROM\/I\/O/);
  for(const load of [0x9fff,0xc000,0xcfff])assert.equal(parseRsid(input({load,length:1})).initAddress,load);
  assert.equal(parseRsid(input({init:0})).initAddress,0x1000);
  for(const init of [0x0fff,0x1010,0xffff])rejects(input({init}),/inside/);
  const wide=input({load:0x8000,length:0x8000,init:0xc000});assert.equal(parseRsid(wide).endAddress,0x10000);
  for(const init of [0xa000,0xbfff,0xd000,0xffff])rejects(input({load:0x8000,length:0x8000,init}),/ROM\/I\/O/);
});

test('BASIC is valid metadata with init zero and is explicitly gated by the execution environment',()=>{
  const bytes=input({flags:0x16,init:0,load:0x0801}),parsed=parseRsid(bytes);
  assert.equal(parsed.basic,true);assert.equal(parsed.initAddress,0);assert.equal(parsed.headerInitAddress,0);
  rejects(input({flags:0x16,init:0x1000}),/BASIC.*zero/);
  assert.throws(()=>validateBrowserRsid(bytes),error=>error.code==='RSID_ROM_REQUIRED'&&/three valid/.test(error.message));
  const selected=validateBrowserRsid(bytes,{environment:'rom'});assert.equal(selected.environment,'rom');assert.equal(selected.initAddress,0);
  assert.equal(selected.subtune,1);assert.equal(selected.basic,true);
});

test('unknown/either hints need an explicit target; known NTSC or 8580 can never be silently overridden',()=>{
  for(const clockBits of [0,3]){
    const bytes=input({flags:0x10|(clockBits<<2)}),parsed=parseRsid(bytes);
    assert.equal(parsed.clock,clockBits===0?'unknown':'any');assert.equal(parsed.clockHz,null);
    assert.throws(()=>validateBrowserRsid(bytes),error=>error.code==='RSID_CHOICE_REQUIRED'&&/clock/.test(error.message));
    const selected=validateBrowserRsid(bytes,{clock:'pal'});assert.equal(selected.clock,parsed.clock);assert.equal(selected.selectedClock,'pal');assert.equal(selected.selection.clock,'explicit');assert.equal(selected.clockHz,985248);
  }
  for(const modelBits of [0,3]){
    const bytes=input({flags:4|(modelBits<<4)}),parsed=parseRsid(bytes);
    assert.equal(parsed.model,modelBits===0?'unknown':'any');
    assert.throws(()=>validateBrowserRsid(bytes),error=>error.code==='RSID_CHOICE_REQUIRED'&&/model/.test(error.message));
    const selected=validateBrowserRsid(bytes,{model:'6581'});assert.equal(selected.model,parsed.model);assert.equal(selected.selectedModel,'6581');assert.equal(selected.selection.model,'explicit');
  }
  const bothUnknown=input({flags:0});assert.throws(()=>validateBrowserRsid(bothUnknown,{clock:'pal'}),error=>error.code==='RSID_CHOICE_REQUIRED');
  assert.deepEqual(validateBrowserRsid(bothUnknown,{clock:'pal',model:'6581'}).selection,{clock:'explicit',model:'explicit'});
  for(const flags of [0x18,0x24,0x28])for(const options of [{},{clock:'pal',model:'6581'}])assert.throws(()=>validateBrowserRsid(input({flags}),options),error=>error.code==='RSID_UNSUPPORTED');
  assert.deepEqual(validateBrowserRsid(input()).selection,{clock:'header',model:'header'});
});

test('subtunes and target/environment options are bounded and never coerced',()=>{
  for(const songs of [0,257,0xffff])rejects(input({songs}),/songs/);
  for(const startSong of [0,2,0xffff])rejects(input({startSong}),/startSong/);
  const bytes=input({songs:256,startSong:256});assert.equal(validateBrowserRsid(bytes).subtune,256);
  for(const subtune of [1,2,256])assert.equal(validateBrowserRsid(bytes,{subtune}).subtune,subtune);
  for(const subtune of [0,257,-1,1.5,NaN,Infinity,null,'1',true])assert.throws(()=>validateBrowserRsid(bytes,{subtune}),RangeError);
  for(const options of [{clock:'ntsc'},{clock:null},{model:'8580'},{model:null},{environment:'auto'},{environment:null}])assert.throws(()=>validateBrowserRsid(input(),options),RangeError);
});

test('relocation page metadata cannot overlap payload, reserved low memory or ROM/I/O',()=>{
  const relocate=(page,length)=>changed((_view,bytes)=>{bytes[0x78]=page;bytes[0x79]=length;});
  for(const pair of [[0,0],[255,0],[4,1],[0x20,2],[0xc0,0x10]])assert.deepEqual(parseRsid(relocate(...pair)).relocation,{startPage:pair[0],pageLength:pair[1]});
  for(const pair of [[0,1],[255,1],[254,3],[0x20,0]])rejects(relocate(...pair),/relocation/);
  rejects(relocate(0x10,1),/payload/);
  for(const pair of [[1,1],[3,2],[0xa0,1],[0x9f,2],[0xbf,2],[0xcf,2],[0xd0,1],[0xff,0]]){
    if(pair[0]===0xff)continue;
    rejects(relocate(...pair),/reserved|ROM\/I\/O/);
  }
});

test('metadata is Windows-1252 and the standalone module imports with no TextDecoder global',async()=>{
  const bytes=input();bytes.set(Uint8Array.from({length:32},(_,i)=>0x80+i),0x16);bytes.fill(0xff,0x36,0x56);
  const parsed=parseRsid(bytes),decoder=new TextDecoder('windows-1252');
  assert.equal(parsed.metadata.name,decoder.decode(bytes.subarray(0x16,0x36)));assert.equal(parsed.metadata.author,'ÿ'.repeat(32));
  bytes.set([0x81,0x8d,0,0xff],0x16);assert.equal(parseRsid(bytes).metadata.name,'\u0081\u008d');
  const source=await readFile(new URL('../tetorica_src/runtime/sid_rsid.js',import.meta.url),'utf8');
  const mirror=await readFile(new URL('../docs/js/sid_rsid.js',import.meta.url),'utf8');assert.equal(mirror,source);
  assert.doesNotMatch(source,/\b(?:import|require)\s*(?:\(|[{'"*])/);assert.doesNotMatch(source,/\b(?:Buffer|process|node:)\b/);
  const saved=globalThis.TextDecoder;
  try{globalThis.TextDecoder=undefined;const worklet=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);assert.deepEqual(worklet.parseRsid(bytes),parsedMetadata(bytes));}
  finally{globalThis.TextDecoder=saved;}
});
const parsedMetadata=bytes=>parseRsid(bytes);
