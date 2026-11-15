import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {prepareFm2608SongSource} from './song_source.js';
import {mapYm2203Register,convertYm2203VgmToYm2608} from './song_compatibility.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';

export function songFixture(commands=[0x56,0x29,0x9f,0x61,0x44,0xac,0x66],clock=8000000) {
  const bytes = new Uint8Array(256+commands.length), view = new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]); view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(0x48,clock,true);bytes.set(commands,256);return bytes;
}
export function memoryBlock(data,offset=0,memorySize=0x200000) {
  const bytes = new Uint8Array(15+data.length),view=new DataView(bytes.buffer);
  bytes.set([0x67,0x66,0x81]);view.setUint32(3,8+data.length,true);view.setUint32(7,memorySize,true);view.setUint32(11,offset,true);bytes.set(data,15);return bytes;
}
test('VGM/VGZ imports own their bytes and count actual waits',async()=>{
  const fixture=songFixture();const prepared=await prepareFm2608SongSource(fixture);
  fixture.fill(0);assert.equal(prepared.bytes[0],0x56);assert.equal(prepared.totalSamples,44100);assert.equal(prepared.format,'VGM');
  const compressed=gzipSync(songFixture());const vgz=await prepareFm2608SongSource(compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.length));
  assert.equal(vgz.format,'VGZ');assert.equal(vgz.totalSamples,44100);
});
test('S98 uses the existing converter including nondefault clock and source tag',async()=>{
  const source=new Uint8Array(64);const view=new DataView(source.buffer);source.set([83,57,56,51]);
  view.setUint32(4,1,true);view.setUint32(8,100,true);view.setUint32(0x14,48,true);view.setUint32(0x1c,1,true);view.setUint32(0x20,4,true);view.setUint32(0x24,7987200,true);
  source.set([0,0x29,0x9f,0xff,0xfd],48);
  const prepared=await prepareFm2608SongSource(source);
  assert.equal(prepared.format,'S98');assert.equal(prepared.header.ym2608Clock,7987200);assert.equal(prepared.totalSamples,441);
});
test('ADPCM-B blocks and CPU data writes remain accepted',async()=>{
  const data=Uint8Array.from({length:32},(_,index)=>index);
  const source=songFixture([...memoryBlock(data,0x100),0x57,0,0x60,0x57,8,0xab,0x61,20,0,0x66]);
  assert.equal((await prepareFm2608SongSource(source)).totalSamples,20);
});
test('unsupported devices, dual chips, commands and bad memory blocks explain rejection',async()=>{
  const other=songFixture();new DataView(other.buffer).setUint32(0x2c,7670454,true);
  await assert.rejects(prepareFm2608SongSource(other),/Unsupported chip: YM2612/);
  await assert.rejects(prepareFm2608SongSource(songFixture(undefined,0x40000000|8000000)),/dual/);
  await assert.rejects(prepareFm2608SongSource(songFixture([0x52,0x22,0,0x66])),/command 0x52/);
  await assert.rejects(prepareFm2608SongSource(songFixture([0x67,0x66,0,0,0,0,0,0x66])),/0x81/);
  const second=memoryBlock(new Uint8Array(32));second[6]|=128;
  await assert.rejects(prepareFm2608SongSource(songFixture([...second,0x66])),/Second YM2608/);
});
test('truncated timelines, missing time and cancellation do not pass validation',async()=>{
  await assert.rejects(prepareFm2608SongSource(songFixture([0x56,0x29])),/truncated|end|bounds/i);
  await assert.rejects(prepareFm2608SongSource(songFixture([0x56,0x29,0x9f,0x66])),/timed/);
  const controller=new AbortController();controller.abort();await assert.rejects(prepareFm2608SongSource(songFixture(),{signal:controller.signal}),{name:'AbortError'});
});

function opnFixture(commands=[0x55,0xb0,7,0x55,0x28,0xf4,0x61,0x44,0xac,0x66],clock=3993600) {
  const bytes=songFixture(commands,0),view=new DataView(bytes.buffer);
  view.setUint32(0x44,clock,true);return bytes;
}
function events(bytes) {
  const parser=new Ym2612VGM(bytes,{logger:null}),result=[];while(!parser.ended)result.push(parser.step());return result;
}
test('YM2203 single-chip VGM becomes a detached OPNA compatibility buffer with exact clock and source identity',async()=>{
  const bytes=opnFixture(),copy=bytes.slice(),prepared=await prepareFm2608SongSource(bytes);
  assert.deepEqual(bytes,copy);assert.equal(prepared.sourceChip,'ym2203');assert.equal(prepared.sourceClock,3993600);
  assert.equal(prepared.header.ym2203Clock,0);assert.equal(prepared.header.ym2608Clock,7987200);assert.equal(prepared.totalSamples,44100);
  assert.equal(prepared.compatibility.kind,'ym2203-to-ym2608');assert.equal(prepared.compatibility.label,'YM2203 → YM2608');
  assert.ok(prepared.warnings.some(message=>/FM DAC.*FM\/SSG/.test(message)));
  const writes=events(prepared.bytes).filter(event=>event.type==='ym2608-write');
  assert.deepEqual(writes.slice(0,5).map(({register,value})=>[register,value]),[[0x29,0x1f],[0x22,0],[0xb4,0xc0],[0xb5,0xc0],[0xb6,0xc0]]);
  assert.deepEqual(writes.at(-1),{type:'ym2608-write',port:0,register:0x28,value:0xf0});
});
test('native OPN reserved fields are ignored or masked before OPNA can enable extra features',async()=>{
  const unsafe=[0x10,0x11,0x18,0x1f,0x20,0x22,0x23,0x29,0x2a,0x2b,0x2c,0xb4,0xb5,0xb6,0xb8,0xbf,0xc0,0xff];
  for(const register of unsafe)assert.equal(mapYm2203Register(register,255),null,register.toString(16));
  for(const register of [0x33,0x3f,0x43,0x93,0x9f,0xa3,0xa7,0xab,0xaf])assert.equal(mapYm2203Register(register,255),null);
  for(const [register,mask] of [[0x30,0x7f],[0x40,0x7f],[0x50,0xdf],[0x60,0x1f],[0x70,0x1f],[0x80,0xff],[0x90,0x0f],[0xa4,0x3f],[0xac,0x3f],[0xb0,0x3f],[0x25,3]])assert.equal(mapYm2203Register(register,255).value,mask);
  assert.equal(mapYm2203Register(0x28,0xff),null);assert.equal(mapYm2203Register(0x28,0xf6).value,0xf2);
  const commands=unsafe.flatMap(register=>[0x55,register,255]);commands.push(0x55,0x60,255,0x55,0x28,0xf4,0x62,0x66);
  const prepared=await prepareFm2608SongSource(opnFixture(commands));
  const writes=events(prepared.bytes).filter(event=>event.type==='ym2608-write').slice(5);
  assert.deepEqual(writes.map(({register,value})=>[register,value]),[[0x60,31],[0x28,0xf0]]);
  assert.equal(prepared.compatibility.ignoredWrites,unsafe.length);
});
test('OPN waits, prescaler selection, Timer A/B and CSM register order are retained',async()=>{
  const writes=[[0x2d,0],[0x24,0xfe],[0x25,3],[0x26,0xc0],[0x27,0x81],[0x2e,0],[0x27,0xc1],[0x2f,0]];
  const commands=writes.flatMap(([register,value])=>[0x55,register,value]);commands.push(0x61,0x00,0,0x62,0x63,0x70,0x7f,0x61,0x34,0x12,0x66);
  const prepared=await prepareFm2608SongSource(opnFixture(commands));
  const converted=events(prepared.bytes);
  assert.deepEqual(converted.filter(event=>event.type==='ym2608-write').slice(5).map(({register,value})=>[register,value]),writes);
  assert.deepEqual(converted.filter(event=>event.type==='wait').map(event=>event.samples),[0,735,882,1,16,0x1234]);
  assert.deepEqual(prepared.bytes.slice(256+5*3+writes.length*3),Uint8Array.from(commands.slice(writes.length*3)));
});
test('GD3, total/loop samples and loop boundary survive removed writes and inserted pan initialization',async()=>{
  const commands=[0x55,0x29,255,0x55,0xb0,7,0x62,0x55,0x22,15,0x63,0x66];
  const original=opnFixture(commands),tagStrings=['OPN Original','','A game','','PC-98','','Composer','','1990','Tester','Note'];
  const text=Buffer.from(tagStrings.join('\0')+'\0','utf16le'),tag=new Uint8Array(12+text.length),tv=new DataView(tag.buffer);
  tag.set([71,100,51,32]);tv.setUint32(4,0x100,true);tv.setUint32(8,text.length,true);tag.set(text,12);
  const source=new Uint8Array(original.length+tag.length);source.set(original);source.set(tag,original.length);
  const view=new DataView(source.buffer);view.setUint32(4,source.length-4,true);view.setUint32(0x14,original.length-0x14,true);
  view.setUint32(0x18,1617,true);view.setUint32(0x1c,256+7-0x1c,true);view.setUint32(0x20,882,true);
  const prepared=await prepareFm2608SongSource(source),converted=new DataView(prepared.bytes.buffer);
  assert.deepEqual(prepared.metadata,parseVgmMetadata(source));assert.deepEqual(parseVgmMetadata(prepared.bytes),prepared.metadata);
  assert.equal(prepared.metadata.trackName,'OPN Original');assert.equal(prepared.header.totalSamples,1617);assert.equal(prepared.header.loopSamples,882);
  // The original loop starts on an ignored LFO write. It now starts on the
  // following wait at precisely the same point in the song's timeline.
  assert.equal(prepared.bytes[prepared.header.loopOffset],0x63);
  assert.deepEqual(prepared.bytes.subarray(converted.getUint32(0x14,true)+0x14),tag);
});
test('YM2203 VGZ and single-device S98 use the same compatibility route',async()=>{
  const zipped=await prepareFm2608SongSource(gzipSync(opnFixture()));assert.equal(zipped.format,'VGZ');assert.equal(zipped.sourceChip,'ym2203');
  const s98=new Uint8Array(54),view=new DataView(s98.buffer);s98.set([83,57,56,51]);
  view.setUint32(4,1,true);view.setUint32(8,100,true);view.setUint32(0x14,48,true);view.setUint32(0x1c,1,true);view.setUint32(0x20,2,true);view.setUint32(0x24,3993600,true);
  s98.set([0,0xb0,7,0xff,0xfd],48);
  const prepared=await prepareFm2608SongSource(s98);assert.equal(prepared.format,'S98');assert.equal(prepared.sourceHeader.devices[0].type,2);
  assert.equal(prepared.sourceChip,'ym2203');assert.equal(prepared.header.ym2608Clock,7987200);assert.equal(prepared.totalSamples,441);
});
test('mixed, dual, undeclared writes, malformed loops and oversized compatibility clocks fail with reasons',async()=>{
  const mixed=opnFixture();new DataView(mixed.buffer).setUint32(0x48,7987200,true);
  await assert.rejects(prepareFm2608SongSource(mixed),/Unsupported chip: YM2203/);
  const other=opnFixture();new DataView(other.buffer).setUint32(0x0c,3579545,true);
  await assert.rejects(prepareFm2608SongSource(other),/Unsupported chip: Sega PSG/);
  await assert.rejects(prepareFm2608SongSource(opnFixture(undefined,0x40000000|3993600)),/dual/);
  await assert.rejects(prepareFm2608SongSource(opnFixture(undefined,12000001)),/24 MHz/);
  await assert.rejects(prepareFm2608SongSource(opnFixture([0x56,0x22,8,0x62,0x66])),/command 0x56/);
  const loop=opnFixture();new DataView(loop.buffer).setUint32(0x1c,257-0x1c,true);
  await assert.rejects(prepareFm2608SongSource(loop),/command boundary/);
  const controller=new AbortController();controller.abort();await assert.rejects(convertYm2203VgmToYm2608(opnFixture(),{signal:controller.signal}),{name:'AbortError'});
});
test('a minimum YM2203 header grows safely to include its OPNA clock',async()=>{
  const body=[0x55,0xb0,7,0x62,0x66],source=new Uint8Array(0x48+body.length),view=new DataView(source.buffer);
  source.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,source.length-4,true);view.setUint32(8,0x151,true);view.setUint32(0x34,0x48-0x34,true);view.setUint32(0x44,4000000,true);source.set(body,0x48);
  const prepared=await prepareFm2608SongSource(source);assert.equal(prepared.header.dataOffset,0x4c);assert.equal(prepared.header.ym2608Clock,8000000);assert.equal(prepared.totalSamples,735);
});

function extraFixture({dataOffset=0xe0,extraOffset=0xc0,size=12,volumes=[[0x86,0,0x819a]],clockEntries=null}={}) {
  const body=[0x55,0xb0,7,0x55,0x28,0xf0,0x62,0x66],bytes=new Uint8Array(dataOffset+body.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x170,true);view.setUint32(0x34,dataOffset-0x34,true);view.setUint32(0x44,3993600,true);
  view.setUint32(0xbc,extraOffset-0xbc,true);view.setUint32(extraOffset,size,true);
  let position=extraOffset+size;
  if(clockEntries) {
    view.setUint32(extraOffset+4,position-extraOffset-4,true);bytes[position++]=clockEntries.length;
    for(const [id,clock] of clockEntries){bytes[position++]=id;view.setUint32(position,clock,true);position+=4;}
  }
  if(volumes && size>=12) {
    view.setUint32(extraOffset+8,position-extraOffset-8,true);bytes[position++]=volumes.length;
    for(const [id,flags,value] of volumes){bytes[position++]=id;bytes[position++]=flags;view.setUint16(position,value,true);position+=2;}
  }
  bytes.set(body,dataOffset);return bytes;
}
test('VGM 1.70 extra-volume payload ends the clock header and supplies Mixer metadata',async()=>{
  const source=extraFixture(),original=source.slice(),prepared=await prepareFm2608SongSource(source);
  assert.deepEqual(source,original);assert.equal(prepared.header.ym2608Clock,7987200);assert.equal(prepared.header.ym2203Clock,0);
  assert.equal(prepared.header.wonderswanClock,0);assert.equal(prepared.header.ymf278bClock,0);
  assert.equal(prepared.extraHeader.offset,0xc0);assert.equal(prepared.extraHeader.size,12);
  assert.deepEqual(prepared.extraHeader.volumeEntries,[{chipId:0x86,chip:'ym2203',paired:true,section:'ssg',flags:0,chipIndex:0,value:0x819a,relative:true,multiplier:1.6015625,absolute:null,applied:false}]);
  assert.deepEqual(prepared.compatibility.extraVolumeEntries,prepared.extraHeader.volumeEntries);assert.equal(prepared.compatibility.volumeAdjustmentsApplied,false);
  assert.ok(prepared.warnings.some(message=>/extra-header FM\/SSG volume.*YM2203 mode/.test(message)));
  assert.equal(new DataView(prepared.bytes.buffer).getUint32(0xbc,true),0);
  assert.ok(prepared.bytes.subarray(0xc0,0xe0).every(value=>value===0));
  assert.equal(prepared.header.dataOffset,0xe0);assert.equal(prepared.totalSamples,735);
});
test('extra volume tables accept first-YM2203 FM and paired SSG with absolute, relative and zero values',async()=>{
  const source=extraFixture({dataOffset:0x100,volumes:[[6,0,0x180],[0x86,0,0x8080],[0x86,0,0x8000]]});
  const prepared=await prepareFm2608SongSource(source),entries=prepared.compatibility.extraVolumeEntries;
  assert.deepEqual(entries.map(({section,relative,multiplier,absolute})=>({section,relative,multiplier,absolute})),[
    {section:'fm',relative:false,multiplier:null,absolute:0x180},{section:'ssg',relative:true,multiplier:.5,absolute:null},{section:'ssg',relative:true,multiplier:0,absolute:null}]);
  assert.deepEqual(events(prepared.bytes).filter(event=>event.type==='wait').map(event=>event.samples),[735]);
});
test('extra header boundaries accept minimum headers and an empty second-clock table',async()=>{
  const minimal=await prepareFm2608SongSource(extraFixture({size:4,volumes:null}));assert.equal(minimal.extraHeader.size,4);assert.deepEqual(minimal.compatibility.extraVolumeEntries,[]);
  const empty=await prepareFm2608SongSource(extraFixture({clockEntries:[],dataOffset:0x100}));assert.deepEqual(empty.extraHeader.clockEntries,[]);assert.equal(empty.compatibility.extraVolumeEntries.length,1);
});
test('extra tables never add a second chip or reinterpret genuine earlier main-header clocks',async()=>{
  await assert.rejects(prepareFm2608SongSource(extraFixture({clockEntries:[[6,3993600]],dataOffset:0x100})),/second-chip clocks/);
  await assert.rejects(prepareFm2608SongSource(extraFixture({volumes:[[0x86,1,0x8100]]})),/second-chip volume/);
  await assert.rejects(prepareFm2608SongSource(extraFixture({volumes:[[0x86,2,0x8100]]})),/reserved flags/);
  await assert.rejects(prepareFm2608SongSource(extraFixture({volumes:[[7,0,0x8100]]})),/extra volume chip 0x07/);
  const other=extraFixture();new DataView(other.buffer).setUint32(0x84,1789773,true);
  await assert.rejects(prepareFm2608SongSource(other),/Unsupported chip: NES APU/);
});
test('invalid extra-header and table pointers fail before conversion or source mutation',async()=>{
  const cases=[
    [bytes=>new DataView(bytes.buffer).setUint32(0xbc,1,true),/extra header offset/],
    [bytes=>new DataView(bytes.buffer).setUint32(0xbc,0x24,true),/extra header offset/],
    [bytes=>new DataView(bytes.buffer).setUint32(0xc0,3,true),/extra header size/],
    [bytes=>new DataView(bytes.buffer).setUint32(0xc0,0x21,true),/extra header size/],
    [bytes=>new DataView(bytes.buffer).setUint32(0xc8,1,true),/volume table offset/],
    [bytes=>new DataView(bytes.buffer).setUint32(0xc8,0x18,true),/volume table offset/],
    [bytes=>{bytes[0xcc]=255;},/Truncated.*volume table/],
    [bytes=>{new DataView(bytes.buffer).setUint32(0xc4,12,true);bytes[0xd0]=255;},/Truncated.*clock table/],
    [bytes=>new DataView(bytes.buffer).setUint32(8,0x161,true),/1.70 or newer/],
  ];
  for(const [mutate,expected] of cases){const source=extraFixture();mutate(source);const original=source.slice();await assert.rejects(prepareFm2608SongSource(source),expected);assert.deepEqual(source,original);}
});
test('OPNA extra headers retain their existing rejection and YM2203 metadata is preserved',async()=>{
  const opna=extraFixture(),view=new DataView(opna.buffer);view.setUint32(0x44,0,true);view.setUint32(0x48,7987200,true);
  await assert.rejects(prepareFm2608SongSource(opna),/does not support VGM extra/);
  const source=extraFixture({dataOffset:0x180}),sv=new DataView(source.buffer);
  const strings=['An extra-header tune','','','','','','','','','',''],text=Buffer.from(strings.join('\0')+'\0','utf16le');
  const tag=new Uint8Array(12+text.length),tv=new DataView(tag.buffer);tag.set([71,100,51,32]);tv.setUint32(4,0x100,true);tv.setUint32(8,text.length,true);tag.set(text,12);
  source.set(tag,0xe0);sv.setUint32(0x14,0xe0-0x14,true);
  const prepared=await prepareFm2608SongSource(source);assert.deepEqual(prepared.metadata,parseVgmMetadata(prepared.bytes));assert.equal(prepared.metadata.trackName,strings[0]);
  assert.ok(prepared.bytes.subarray(0xc0,0x180).every(value=>value===0));
});
