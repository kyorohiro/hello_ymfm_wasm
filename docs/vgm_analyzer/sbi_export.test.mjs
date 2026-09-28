import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createSbi, extractSbiPatches, snapshotSbiPatches, exportSbiZip} from './sbi_export.js';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';

const chips = {ym3526:[0x54,0x5b], ym3812:[0x50,0x5a], y8950:[0x58,0x5c], ymf262:[0x5c,0x5e], ymf278b:[0x60,0xd0]};
function vgm(kind, writes, clock = 14318180) {
  const [clockOffset, code] = chips[kind];
  const commands = writes.flatMap(e => e === 'wait' ? [0x61,100,0] : kind === 'ymf278b' ? [code,e[2]??0,e[0],e[1]] : [code+(e[2]??0), e[0],e[1]]);
  const bytes = new Uint8Array(257+commands.length), view = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);
  view.setUint32(clockOffset,clock,true);bytes.set([...commands,0x66],256);
  return bytes;
}

test('DOS SBI byte layout, operator ordering, name and padding', () => {
  const regs = new Uint8Array(256);
  regs[1]=32;
  for (const [i, base] of [0x20,0x40,0x60,0x80,0xe0].entries()) {
    regs[base+18]=[0xf1,0xc2,0xa3,0xb4,3][i];
    regs[base+21]=[0x52,0x83,0x94,0xa5,2][i];
  }
  regs[0xc8]=0xff;
  const data=createSbi(regs,'ym3812',8,'A'.repeat(50));
  assert.equal(data.length,52);
  assert.deepEqual([...data.slice(0,4)],[83,66,73,26]);
  assert.equal(data[34],0);assert.equal(data[35],0);
  assert.deepEqual([...data.slice(36)],[0xf1,0x52,0xc2,0x83,0xa3,0x94,0xb4,0xa5,3,2,15,0,0,0,0,0]);
  regs[1]=0;assert.equal(createSbi(regs,'ym3812',8)[44],0);
  for(const kind of ['ym3526','y8950'])assert.equal(createSbi(regs,kind,8)[44],0);
  assert.throws(()=>createSbi(regs,'ym3812',9),/channel/);
});

test('all six OPL3 4op pairs and algorithms preserve operator order and Furnace feedback', () => {
  const slots=[0,1,2,8,9,10];
  for(let bank=0;bank<2;bank++)for(let pair=0;pair<3;pair++)for(let alg=0;alg<4;alg++) {
    const regs=new Uint8Array(512), base=bank*256;
    regs[0x105]=1;regs[0x104]=1<<(bank*3+pair);
    const offsets=[slots[pair],slots[pair]+3,slots[pair+3],slots[pair+3]+3];
    offsets.forEach((offset,i)=>{regs[base+0x20+offset]=i+1;regs[base+0xe0+offset]=i+4;});
    regs[base+0xc0+pair]=10|(alg&1);
    regs[base+0xc3+pair]=2|(alg>>1);
    const data=createSbi(regs,'ymf262',bank*9+pair);
    assert.equal(data.length,60);assert.deepEqual([...data.slice(0,4)],[52,79,80,26]);
    assert.deepEqual([data[36],data[37],data[47],data[48]],[1,2,3,4]);
    assert.deepEqual([data[44],data[45],data[55],data[56]],[4,5,6,7]);
    // Independent decoding of Furnace loadSBI's connection and feedback fields.
    assert.equal((data[46]&1)|((data[57]&1)<<1),alg);
    assert.equal((data[57]>>1)&7,5);assert.equal((data[46]>>1)&7,5);
    assert.deepEqual([...data.slice(58)],[0,0]);
    assert.throws(()=>createSbi(regs,'ymf262',bank*9+pair+3),/leading/);
  }
});

for(const kind of Object.keys(chips)) test(`${kind}: extraction, deduplication, held changes, snapshot and ZIP`, () => {
  const source=vgm(kind,[[0x20,1],[0xb0,32],'wait',[0xa0,90],[0xb0,33],[0x20,2],'wait',[0xb0,0],[0x20,3],'wait']);
  const patches=extractSbiPatches(source);
  assert.equal(patches.length,2);assert.deepEqual(patches.map(p=>p.data[36]),[1,2]);
  assert.deepEqual(patches.map(p=>p.sample),[0,100]);
  assert.equal(snapshotSbiPatches(source,99)[0].data[36],1);
  assert.equal(snapshotSbiPatches(source,100)[0].data[36],2);
  assert.equal(snapshotSbiPatches(source,300)[0].data[36],3);
  assert.throws(()=>snapshotSbiPatches(source,301),/track end/);
  assert.throws(()=>snapshotSbiPatches(source,-1),/sample/);
  const zip=exportSbiZip(source), view=new DataView(zip.bytes.buffer);
  assert.equal(zip.count,2);assert.equal(view.getUint32(0,true),0x04034b50);
  const length=view.getUint32(18,true),start=30+view.getUint16(26,true);
  assert.deepEqual(zip.bytes.slice(start,start+length),patches[0].data);
  assert.throws(()=>extractSbiPatches(vgm(kind,[],14318180|0x40000000)),/non-dual/);
});

test('rhythm, CSM and key-off edits do not become melodic patches', () => {
  const source=vgm('ym3812',[[0xbd,32],[0xb6,32],[8,128],[0xb0,32],'wait',[0xb0,0],[8,0],[0x20,7],'wait']);
  assert.equal(extractSbiPatches(source).length,0);
  assert.throws(()=>exportSbiZip(source),/No keyed/);
  assert.equal(snapshotSbiPatches(source,0).length,0);
  assert.equal(snapshotSbiPatches(source,100).length,6);
});

test('OPL3 bank aliasing, waveform mask, pairing and OPL4 PCM omission', () => {
  const alias=extractSbiPatches(vgm('ymf262',[[0xe0,7,1],[0xb0,32,1],'wait']));
  assert.equal(alias.length,1);assert.equal(alias[0].channel,0);assert.equal(alias[0].data[44],3);
  for(const kind of ['ymf262','ymf278b']) {
    const source=vgm(kind,[[5,1,1],[4,8,1],[0xe0,7,1],[0xb0,32,1],[0xb3,32,1],...(kind==='ymf278b'?[[0x20,255,2]]:[]),'wait']);
    const patches=extractSbiPatches(source);
    assert.equal(patches.length,1);assert.equal(patches[0].channel,9);assert.equal(patches[0].fourOp,true);
    assert.equal(patches[0].data[44],7);
  }
  const mixed=vgm('ym3812',[]);new DataView(mixed.buffer).setUint32(0x5c,14318180,true);
  assert.throws(()=>extractSbiPatches(mixed),/one non-dual/);
});

test('SBI UI controls follow chip support, file availability and dual-chip flags', () => {
  const source=fs.readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function updateChipSupport()'),source.indexOf('\nfunction buildParseInfo'));
  for(const kind of ['ym3526','ym3812','y8950','ymf262','ymf278b','ym2612']) {
    const context={...chipSupportContext(),currentChipKind:kind,currentBuffer:new Uint8Array(1),setOutputTab(){}};
    vm.runInNewContext(fn+'\nupdateChipSupport();',context);
    for(const id of ['exportAllSbiButton','exportSbiButton','exportSnapshotSbiButton']) {
      assert.equal(context.document.getElementById(id).hidden,kind==='ym2612');
      assert.equal(context.document.getElementById(id).disabled,kind==='ym2612');
    }
    context.noteishHeader[kind+'Clock']=0x40000000;context.updateChipSupport();
    assert.equal(context.document.getElementById('exportSbiButton').disabled,true);
    context.currentBuffer=null;context.updateChipSupport();
    assert.equal(context.document.getElementById('exportAllSbiButton').disabled,true);
  }
});

test('2op to 4op transitions retain distinct voices and suppress the partner only while paired', () => {
  const source=vgm('ymf262',[[5,1,1],[0x20,1],[0x28,2],[0xb0,32],[0xb3,32],
    'wait',[4,1,1],'wait',[0x28,3],'wait',[4,0,1],'wait']);
  const patches=extractSbiPatches(source);
  assert.deepEqual(patches.map(p=>[p.channel,p.sample,p.fourOp]),[
    [0,0,false],[3,0,false],[0,100,true],[0,200,true],[3,300,false],
  ]);
  assert.equal(patches[2].data[47],2);
  assert.equal(patches[3].data[47],3,'partner operator edit belongs to the leading 4op voice');
  assert.equal(patches[4].data[36],3);
  assert.equal(snapshotSbiPatches(source,99).length,18);
  assert.equal(snapshotSbiPatches(source,100).length,17,'one enabled pair removes one partner');
  assert.equal(snapshotSbiPatches(source,300).length,18);
});

test('retrigger, pitch, pan and global depth deduplicate, while TL changes remain distinct per channel', () => {
  const source=vgm('ymf262',[[5,1,1],[0x20,1],[0x21,1],[0xb0,32],
    'wait',[0xb0,0],[0xb0,32],[0xa0,123],[0xc0,0x30],[0xbd,0xc0],[0xb1,32],
    'wait',[0x40,10],'wait',[0x40,0],'wait']);
  const patches=extractSbiPatches(source);
  assert.deepEqual(patches.map(p=>[p.name,p.channel,p.sample]),[
    ['CH1_001.sbi',0,0],['CH2_001.sbi',1,100],['CH1_002.sbi',0,200],
  ]);
  assert.deepEqual(patches.map(p=>p.data[38]),[0,0,10]);
  assert.deepEqual(extractSbiPatches(source),patches,'each scan starts with fresh deduplication state');
});

test('waveform enable changes while keyed capture only audible waveform changes', () => {
  const source=vgm('ym3812',[[0xe0,3],[0xb0,32],'wait',[1,32],'wait',[0xe0,7],'wait',[1,0],'wait']);
  const patches=extractSbiPatches(source);
  assert.deepEqual(patches.map(p=>[p.sample,p.data[44]]),[[0,0],[100,3]]);
  assert.equal(snapshotSbiPatches(source,200)[0].data[44],3);
  assert.equal(snapshotSbiPatches(source,300)[0].data[44],0);
});

test('mixed 2op/4op ZIP has matching local/central records, CRCs, names and complete payloads', () => {
  const source=vgm('ymf262',[[5,1,1],[4,1,1],[0x20,1],[0x28,2],[0xb0,32],[0xb8,32],'wait']);
  const {bytes,count}=exportSbiZip(source), view=new DataView(bytes.buffer);
  const end=bytes.length-22, decoder=new TextDecoder();
  assert.equal(count,2);
  assert.equal(view.getUint32(end,true),0x06054b50);
  assert.equal(view.getUint16(end+10,true),2);
  const directory=view.getUint32(end+16,true);
  assert.equal(directory+view.getUint32(end+12,true),end);
  let cursor=directory;
  for(const [index,name] of ['CH1_001.sbi','CH9_001.sbi'].entries()) {
    assert.equal(view.getUint32(cursor,true),0x02014b50);
    const length=view.getUint32(cursor+24,true), nameLength=view.getUint16(cursor+28,true);
    const local=view.getUint32(cursor+42,true);
    assert.equal(decoder.decode(bytes.slice(cursor+46,cursor+46+nameLength)),name);
    assert.equal(view.getUint32(local,true),0x04034b50);
    assert.equal(view.getUint16(local+8,true),0,'stored ZIP requires no decompression');
    assert.equal(view.getUint32(local+18,true),length);
    assert.equal(view.getUint32(local+22,true),length);
    assert.equal(decoder.decode(bytes.slice(local+30,local+30+nameLength)),name);
    const payload=bytes.slice(local+30+nameLength,local+30+nameLength+length);
    assert.equal(length,index===0?60:52);
    assert.deepEqual([...payload.slice(0,4)],index===0?[52,79,80,26]:[83,66,73,26]);
    assert.equal(payload[36],index===0?1:0);
    if(index===0)assert.equal(payload[47],2);
    // Bitwise CRC reference, independent of the production lookup table.
    let crc=0xffffffff;
    for(const byte of payload) {
      crc^=byte;
      for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;
    }
    crc=(crc^0xffffffff)>>>0;
    assert.equal(view.getUint32(local+14,true),crc);
    assert.equal(view.getUint32(cursor+16,true),crc);
    cursor+=46+nameLength+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
  }
  assert.equal(cursor,end);
});
