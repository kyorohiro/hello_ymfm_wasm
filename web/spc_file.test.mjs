import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpcFile,SPC_MIN_FILE_SIZE,SPC_FILE_SIZE} from './spc_file.js';
function image(size = SPC_FILE_SIZE) {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode('SNES-SPC700 Sound File Data v0.30'));
  b.set([0x1a,0x1a,0x1a,30,0x34,0x12,1,2,3,4,5],0x21);
  return b;
}
const text = (b, at, s) => b.set(new TextEncoder().encode(s),at);
function xid(entries) {
  const chunks = entries.map(([id,type,value]) => {
    const data = type === 1 ? new TextEncoder().encode(value + '\0') : type === 4 ? new Uint8Array(4) : new Uint8Array();
    const out = new Uint8Array(4 + data.length + ((4 - data.length % 4) % 4));
    out[0]=id; out[1]=type;
    new DataView(out.buffer).setUint16(2,type === 0 ? value : data.length,true);
    if (type === 4) new DataView(data.buffer).setInt32(0,value,true);
    out.set(data,4); return out;
  });
  const b = image(SPC_FILE_SIZE + 8 + chunks.reduce((n,c)=>n+c.length,0));
  text(b,SPC_FILE_SIZE,'xid6');
  new DataView(b.buffer).setUint32(SPC_FILE_SIZE+4,b.length-SPC_FILE_SIZE-8,true);
  let at=SPC_FILE_SIZE+8; for(const c of chunks) {b.set(c,at);at+=c.length;}
  return b;
}
test('SPC validates signature, terminators, tag flag and minimum RAM/DSP size',()=>{
  assert.throws(()=>parseSpcFile(null),TypeError);
  assert.throws(()=>parseSpcFile(new Uint8Array(16*1024*1024+1)),/16 MiB/);
  assert.throws(()=>parseSpcFile(new Uint8Array(SPC_MIN_FILE_SIZE-1)),RangeError);
  for(const offset of [0,26,0x21,0x22,0x23]) {const b=image();b[offset]=0;assert.throws(()=>parseSpcFile(b),TypeError);}
  const short=parseSpcFile(image(SPC_MIN_FILE_SIZE));
  assert.equal(short.extraRam,null);assert.ok(short.warnings.some(s=>s.includes('Short')));
  const b=image(); b[0x23]=0x1b;assert.equal(parseSpcFile(b).id666.present,false);
});
test('SPC copies original, CPU state, full RAM/DSP/extraRAM independently including subarray inputs',()=>{
  const b=image();b[0x100]=11;b[0x10100]=22;b[0x101c0]=33;
  const wrapped=new Uint8Array(b.length+10);wrapped.set(b,5);
  const p=parseSpcFile(wrapped.subarray(5,5+b.length));
  assert.deepEqual(p.cpu,{pc:0x1234,a:1,x:2,y:3,psw:4,sp:5});
  assert.equal(p.ram.length,65536);assert.equal(p.dsp.length,128);assert.equal(p.extraRam.length,64);
  assert.equal(p.ram[0],11);assert.equal(p.dsp[0],22);assert.equal(p.extraRam[0],33);
  wrapped.fill(0);assert.deepEqual(p.originalBytes,b);p.ram[0]=99;assert.equal(p.originalBytes[0x100],11);
  assert.equal(p.version,30);
});
test('text ID666 fields keep seconds separate from millisecond fade and expose total duration',()=>{
  const b=image();text(b,0x2e,'Example');text(b,0x4e,'Original synthetic');text(b,0x6e,'Tester');
  text(b,0x7e,'No game data');text(b,0x9e,'10/18/2026');text(b,0xa9,'123');text(b,0xac,'01500');text(b,0xb1,'Composer');
  b[0xd1]=4;b[0xd2]=2;
  const p=parseSpcFile(b);
  assert.equal(p.id666.layout,'text');assert.equal(p.metadata.title,'Example');assert.equal(p.metadata.artist,'Composer');
  assert.equal(p.metadata.dumpDate,'10/18/2026');assert.equal(p.metadata.playSeconds,123);assert.equal(p.metadata.fadeSeconds,1.5);
  assert.equal(p.metadata.durationSeconds,124.5);assert.equal(p.metadata.mutedChannels,4);assert.equal(p.metadata.emulator,2);
});
test('binary ID666 decodes full 24-bit length, 32-bit fade, date and different artist offset',()=>{
  const b=image(),v=new DataView(b.buffer);
  v.setUint32(0x9e,20261018,true);b.set([0x45,0x23,0x01],0xa9);v.setUint32(0xac,1234,true);text(b,0xb0,'Binary artist');b[0xd0]=8;b[0xd1]=1;
  const p=parseSpcFile(b);assert.equal(p.id666.layout,'binary');assert.equal(p.metadata.artist,'Binary artist');
  assert.equal(p.metadata.playSeconds,0x12345);assert.equal(p.metadata.fadeSeconds,1.234);assert.equal(p.metadata.dumpDate,20261018);
  assert.equal(p.metadata.mutedChannels,8);assert.equal(p.metadata.emulator,1);
});
test('unmarked ambiguous ID666 is reported, layout and legacy encoding can be overridden',()=>{
  const b=image();b[0xa9]=48;b[0x2e]=0xe9;
  const p=parseSpcFile(b);assert.equal(p.id666.layout,'text');assert.equal(p.id666.ambiguous,true);assert.equal(p.metadata.title,'é');
  assert.ok(p.warnings.some(s=>s.includes('ambiguous')));
  assert.equal(parseSpcFile(b,{id666Format:'binary'}).metadata.playSeconds,48);
  assert.throws(()=>parseSpcFile(b,{id666Format:'unknown'}),TypeError);
  assert.throws(()=>parseSpcFile(b,{textEncoding:'invalid-encoding'}),RangeError);
});
test('xid6 typed fields override display metadata, retain unknown fields and preserve raw bytes',()=>{
  const b=xid([[1,1,'Long title'],[3,1,'Composer'],[0x11,0,2],[0x12,0,0x0341],[0x14,0,2026],
    [0x30,4,64000],[0x31,4,128000],[0x32,4,-32000],[0x33,4,16000],[0x35,0,3],[0x36,4,65536],[0xee,1,'unknown']]);
  text(b,0x2e,'Old title');text(b,0xa9,'120');
  const p=parseSpcFile(b);assert.equal(p.metadata.title,'Long title');assert.equal(p.metadata.artist,'Composer');assert.equal(p.metadata.disc,2);
  assert.equal(p.metadata.track,0x0341);assert.equal(p.metadata.year,2026);assert.equal(p.metadata.introSeconds,1);assert.equal(p.metadata.loopSeconds,2);
  assert.equal(p.xid6.tags.find(tag=>tag.id===0x32).value,-32000);assert.equal(p.metadata.endSeconds,-0.5);assert.equal(p.metadata.fadeSeconds,0.25);assert.equal(p.metadata.playSeconds,6.5);
  assert.equal(p.metadata.durationSeconds,6.75);assert.equal(p.metadata.amplification,1);
  assert.equal(p.xid6.tags.at(-1).id,0xee);assert.equal(p.xid6.tags.at(-1).value,'unknown');assert.deepEqual(p.originalBytes,b);
});
test('xid6 loop timing without count does not invent a playback duration',()=>{
  const b=xid([[0x31,4,128000]]);b[0x23]=0x1b;
  const p=parseSpcFile(b);assert.equal(p.metadata.loopSeconds,2);assert.equal(p.metadata.playSeconds,undefined);assert.equal(p.metadata.durationSeconds,undefined);
});
test('malformed xid6 lengths, integer type and unknown trailing bytes do not execute or read out of bounds',()=>{
  const b=xid([[1,1,'ok'],[0x30,4,64000]]),v=new DataView(b.buffer);
  v.setUint32(SPC_FILE_SIZE+4,0xffffffff,true);
  const p=parseSpcFile(b);assert.equal(p.metadata.title,'ok');assert.ok(p.warnings.some(s=>s.includes('Truncated')));
  const truncated=b.slice(0,b.length-2);assert.doesNotThrow(()=>parseSpcFile(truncated));
  const unknown=image(SPC_FILE_SIZE+3);unknown.set([1,2,3],SPC_FILE_SIZE);assert.ok(parseSpcFile(unknown).warnings.some(s=>s.includes('trailing')));
  const invalid=xid([[1,1,'ok']]);invalid[SPC_FILE_SIZE+9]=4;assert.doesNotThrow(()=>parseSpcFile(invalid));
  assert.equal(parseSpcFile(invalid).metadata.title,'');
});

test('xid6 duplicate and unknown field count is bounded while originals remain intact',()=>{
  const b=xid(Array.from({length:5000},()=>[0xee,0,1]));const p=parseSpcFile(b);
  assert.equal(p.xid6.tags.length,4096);assert.ok(p.warnings.some(s=>s.includes('field limit')));assert.deepEqual(p.originalBytes,b);
});
