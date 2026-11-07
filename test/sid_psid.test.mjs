import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePsid,SidPsidError,PSID_HEADER_BYTES,PSID_MAX_FILE_BYTES} from '../tetorica_src/cli/sid_psid.mjs';
import {createSidReferenceFixture,SID_REFERENCE_FIXTURES} from './fixtures/sid-reference/fixture.mjs';

const modified=(change,options)=>{const bytes=createSidReferenceFixture('melody-filter',options).bytes;change(new DataView(bytes.buffer),bytes);return bytes;};
const rejects=(bytes,pattern,code)=>assert.throws(()=>parsePsid(bytes),error=>error instanceof SidPsidError&&pattern.test(error.message)&&(!code||error.code===code));

test('PSID v2/v3/v4 header and embedded/explicit load layouts retain original payload and metadata',()=>{
  for(const version of [2,3,4])for(const embeddedLoadAddress of [false,true]){
    const fixture=createSidReferenceFixture('melody-filter',{version,embeddedLoadAddress}),before=fixture.bytes.slice(),parsed=parsePsid(fixture.bytes);
    assert.equal(parsed.version,version);assert.equal(parsed.format,'PSID');assert.equal(parsed.dataOffset,124);
    assert.equal(parsed.programOffset,embeddedLoadAddress?126:124);assert.equal(parsed.loadAddressEmbedded,embeddedLoadAddress);
    assert.equal(parsed.loadAddress,fixture.loadAddress);assert.equal(parsed.initAddress,fixture.initAddress);assert.equal(parsed.playAddress,fixture.playAddress);
    assert.equal(parsed.endAddress,fixture.loadAddress+fixture.program.length);assert.equal(parsed.programLength,fixture.program.length);
    assert.equal(parsed.flags,0x14);assert.equal(parsed.clock,'pal');assert.equal(parsed.clockHz,985248);assert.equal(parsed.model,'6581');
    assert.equal(parsed.sidCount,1);assert.equal(parsed.sidAddress,0xd400);assert.equal(parsed.songs,1);assert.equal(parsed.startSong,1);assert.equal(parsed.speed,0);assert.deepEqual(parsed.songSpeeds,['vbi']);
    assert.deepEqual(parsed.metadata,{name:'Tetorica melody-filter',author:'Tetorica contributors',released:'2026 BSD-3-Clause'});
    assert.deepEqual(parsed.program,fixture.program);assert.deepEqual(parsed.originalBytes,before);assert.deepEqual(fixture.bytes,before);
  }
});

test('all supported byte views respect offset/length and parsed output never aliases caller memory',()=>{
  const bytes=createSidReferenceFixture('tone').bytes,padded=new Uint8Array(bytes.length+19);padded.set(bytes,11);
  for(const source of [bytes,bytes.buffer,Buffer.from(bytes),padded.subarray(11,11+bytes.length),new DataView(padded.buffer,11,bytes.length)])assert.equal(parsePsid(source).metadata.name,'Tetorica tone');
  const parsed=parsePsid(bytes),first=bytes[126];parsed.program[0]^=255;assert.equal(bytes[126],first);assert.equal(parsed.originalBytes[126],first);parsed.originalBytes[0]=0;assert.equal(bytes[0],0x50);
  for(const value of [null,{},[],123,'PSID'])assert.throws(()=>parsePsid(value),TypeError);
});

test('bounded input rejects oversize before parsing or copying and validates maxBytes policy',()=>{
  const bytes=createSidReferenceFixture('tone').bytes;
  assert.throws(()=>parsePsid(bytes,{maxBytes:bytes.length-1}),error=>error.code==='PSID_LIMIT');
  assert.equal(parsePsid(bytes,{maxBytes:bytes.length}).fileSize,bytes.length);
  assert.throws(()=>parsePsid(new Uint8Array(PSID_MAX_FILE_BYTES+1)),error=>error.code==='PSID_LIMIT');
  for(const maxBytes of [0,124,Infinity,NaN,125.5,PSID_MAX_FILE_BYTES+1,'1000'])assert.throws(()=>parsePsid(bytes,{maxBytes}),RangeError);
  const largeBacking=new Uint8Array(PSID_MAX_FILE_BYTES+200);largeBacking.set(bytes,100);assert.equal(parsePsid(largeBacking.subarray(100,100+bytes.length)).fileSize,bytes.length);
});

test('signature, fixed header offset and payload prefixes fail explicitly when malformed',()=>{
  const bytes=createSidReferenceFixture().bytes;
  for(const size of [0,1,3,4,5,6,100,123])rejects(bytes.slice(0,size),/truncated/);
  rejects(modified((_view,data)=>data.set([0x56,0x67,0x6d,0x20])),/signature/);
  for(const offset of [0,0x76,0x7b,0x7d,0xffff])rejects(modified(view=>view.setUint16(6,offset)),/dataOffset/);
  rejects(bytes.slice(0,125),/embedded/);rejects(bytes.slice(0,126),/empty/);
  const explicit=createSidReferenceFixture('tone',{embeddedLoadAddress:false}).bytes;rejects(explicit.slice(0,PSID_HEADER_BYTES),/empty/);
});

test('unsupported versions, RSID/BASIC and player-specific extensions are distinct from valid target PSID',()=>{
  for(const version of [0,1,5,0xffff])rejects(modified(view=>view.setUint16(4,version)),/version/,'PSID_UNSUPPORTED');
  rejects(modified((view,data)=>{data.set(new TextEncoder().encode('RSID'));view.setUint16(0x76,0x16);}),/RSID\/BASIC/,'PSID_UNSUPPORTED');
  rejects(modified(view=>view.setUint16(0x76,0x15)),/MUS/,'PSID_UNSUPPORTED');
  rejects(modified(view=>view.setUint16(0x76,0x16)),/PlaySID-specific/,'PSID_UNSUPPORTED');
  for(const flags of [0x414,0x814,0x1014,0x8014])rejects(modified(view=>view.setUint16(0x76,flags)),/reserved|v5-only/,'PSID_UNSUPPORTED');
});

test('target requires explicit PAL and 6581 and rejects all secondary SID fields',()=>{
  for(const flags of [0x10,0x18,0x1c])rejects(modified(view=>view.setUint16(0x76,flags)),/PAL/,'PSID_UNSUPPORTED');
  for(const flags of [0x04,0x24,0x34])rejects(modified(view=>view.setUint16(0x76,flags)),/6581/,'PSID_UNSUPPORTED');
  for(const flags of [0x54,0x114,0x314])rejects(modified(view=>view.setUint16(0x76,flags)),/additional SID model/,'PSID_UNSUPPORTED');
  for(const version of [2,3,4])for(const offset of [0x7a,0x7b])for(const address of [1,0x42,0xe0])rejects(modified((_view,data)=>{data[offset]=address;},{version}),/SID.*field/);
});

test('song counts are one-based and CIA speed bits use bit 31 for every later song',()=>{
  for(const songs of [0,257,0xffff])rejects(modified(view=>view.setUint16(14,songs)),/songs/);
  for(const start of [0,2,0xffff])rejects(modified(view=>view.setUint16(16,start)),/startSong/);
  const parsed=parsePsid(modified(view=>{view.setUint16(14,64);view.setUint16(16,64);view.setUint32(18,0x80000001);}));
  assert.equal(parsed.speed,0x80000001);assert.equal(parsed.startSong,64);assert.equal(parsed.songSpeeds.length,64);
  assert.equal(parsed.songSpeeds[0],'cia');assert.equal(parsed.songSpeeds[1],'vbi');assert.equal(parsed.songSpeeds[30],'vbi');
  for(const index of [31,32,63])assert.equal(parsed.songSpeeds[index],'cia');
  const max=parsePsid(modified(view=>{view.setUint16(14,256);view.setUint16(16,256);}));assert.equal(max.songSpeeds.length,256);
});

test('effective load address is little-endian, init zero defaults to load, and load limits have no off-by-one',()=>{
  const shifted=modified((view,bytes)=>{bytes[124]=0x34;bytes[125]=0x12;view.setUint16(10,0);view.setUint16(12,0x1234+0xba);});
  const parsed=parsePsid(shifted);assert.equal(parsed.loadAddress,0x1234);assert.equal(parsed.initAddress,0x1234);
  const end=createSidReferenceFixture('tone',{embeddedLoadAddress:false}).bytes.slice(0,125),view=new DataView(end.buffer);
  view.setUint16(8,0xffff);view.setUint16(10,0);view.setUint16(12,0xffff);end[124]=0x60;
  assert.equal(parsePsid(end).endAddress,0x10000);
  rejects(modified(view=>{view.setUint16(8,0xfff0);view.setUint16(10,0xfff0);view.setUint16(12,0xfff0);}),/load range/);
});

test('entrypoint constraints reject malformed init and explicitly unsupported IRQ or generated play routines',()=>{
  const fixture=createSidReferenceFixture(),end=fixture.loadAddress+fixture.program.length;
  for(const address of [fixture.loadAddress-1,end,0xffff])rejects(modified(view=>view.setUint16(10,address)),/initAddress/,'PSID_INVALID');
  const fallback=parsePsid(modified(view=>view.setUint16(10,0)));assert.equal(fallback.initAddress,fixture.loadAddress);
  rejects(modified(view=>view.setUint16(12,0)),/IRQ/,'PSID_UNSUPPORTED');
  for(const address of [fixture.loadAddress-1,end,0xffff])rejects(modified(view=>view.setUint16(12,address)),/playAddress outside/,'PSID_UNSUPPORTED');
});

test('relocation metadata is checked for sentinel consistency, overflow and payload overlap',()=>{
  const relocate=(start,length)=>modified((_view,bytes)=>{bytes[0x78]=start;bytes[0x79]=length;});
  assert.deepEqual(parsePsid(relocate(0x20,2)).relocation,{startPage:0x20,pageLength:2});
  assert.deepEqual(parsePsid(relocate(255,0)).relocation,{startPage:255,pageLength:0});
  for(const pair of [[0,1],[255,1],[254,3],[0x20,0]])rejects(relocate(...pair),/relocation/);
  rejects(relocate(0x10,1),/overlap/);assert.equal(parsePsid(relocate(0x0f,1)).relocation.startPage,0x0f);assert.equal(parsePsid(relocate(0x12,1)).relocation.startPage,0x12);
});

test('fixed 32-byte metadata uses Windows-1252, allows full fields, and ignores bytes after first NUL',()=>{
  const bytes=modified((_view,data)=>{data.fill(0x41,0x16,0x36);data.fill(0,0x36,0x56);data.set([0x80,0x93,0x78,0x94,0,0xff],0x36);});
  const parsed=parsePsid(bytes);assert.equal(parsed.metadata.name,'A'.repeat(32));assert.equal(parsed.metadata.author,'€“x”');assert.equal(parsed.metadata.released,'2026 BSD-3-Clause');
});

// A tiny non-timing opcode executor validates only our assembled fixtures.
// It does not handle a real PSID, C64 hardware, flags, interrupts or CPU cycles.
function fixtureExecutor(fixture){
  const memory=new Uint8Array(65536);memory.set(fixture.program,fixture.loadAddress);
  return address=>{
    let pc=address,a=0,x=0;const writes=[];
    const byte=()=>memory[pc++],word=()=>{const lo=byte();return lo|(byte()<<8);};
    for(let count=0;count<512;count++){
      const opcode=byte();
      if(opcode===0x60)return writes;
      if(opcode===0xa9)a=byte();
      else if(opcode===0x8d){const at=word();memory[at]=a;if(at>=0xd400&&at<=0xd418)writes.push({address:at,register:at-0xd400,value:a});}
      else if(opcode===0xee){const at=word();memory[at]=(memory[at]+1)&255;}
      else if(opcode===0xad)a=memory[word()];
      else if(opcode===0x29)a&=byte();
      else if(opcode===0x4a)a>>>=1;
      else if(opcode===0xaa)x=a;
      else if(opcode===0xbd)a=memory[(word()+x)&65535];
      else assert.fail(`Fixture has an unexpected opcode 0x${opcode.toString(16)}`);
    }
    assert.fail('Fixture did not return within 512 instructions');
  };
}

test('all original diagnostic bytecode produces its expected init and 96 play-call write sequences',()=>{
  for(const profile of SID_REFERENCE_FIXTURES){
    const fixture=createSidReferenceFixture(profile),run=fixtureExecutor(fixture),parsed=parsePsid(fixture.bytes);
    assert.equal(parsed.metadata.name,`Tetorica ${profile}`);assert.deepEqual(run(fixture.initAddress),fixture.expectedInitWrites,profile);
    for(let call=0;call<96;call++)assert.deepEqual(run(fixture.playAddress),fixture.expectedPlayWrites(call),`${profile} play ${call}`);
    assert.equal(fixture.expectedInitWrites.some(write=>'cycle' in write),false,'CPU timestamps are external observations');
    assert.equal(fixture.program.length<512,true,'fixtures remain small and bounded');
  }
});

test('fixture profiles are independently authored and invalid generator requests fail explicitly',()=>{
  const seen=new Set(SID_REFERENCE_FIXTURES.map(profile=>Buffer.from(createSidReferenceFixture(profile).bytes).toString('hex')));assert.equal(seen.size,4);
  const tone=createSidReferenceFixture('tone');assert.deepEqual(tone.expectedPlayWrites(0),tone.expectedPlayWrites(31));
  assert(createSidReferenceFixture('pulse').expectedPlayWrites(0).some(write=>write.register===2));assert(createSidReferenceFixture('melody-filter').expectedPlayWrites(0).some(write=>write.register===23));
  assert.throws(()=>createSidReferenceFixture('game-rip'),/profile/);assert.throws(()=>createSidReferenceFixture('tone',{version:5}),/version/);assert.throws(()=>createSidReferenceFixture('tone',{embeddedLoadAddress:1}),TypeError);
  for(const index of [-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>tone.expectedPlayWrites(index),RangeError);
});
