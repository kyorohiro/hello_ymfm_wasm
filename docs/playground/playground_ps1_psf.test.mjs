// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readPsfFile,readPsfFileSet,composePsfRam,extractPsfVabs,findPsfVabs,psfCrc32} from './playground_ps1_psf.js';
import {prepareVabTone} from './playground_ps1_vab.js';
import {createPsfFixture,createPsfConflictFixture,makePsf,psfFromExe,psfFile,fixtureCrc32} from '../../test/helpers/spu_psf_fixture.mjs';
import {createPsfSplitVabFixture} from '../../test/helpers/spu_psf_split_vab_fixture.mjs';
import {createVabFixture} from '../../test/helpers/spu_vab_fixture.mjs';

test('compressed CRC and zlib data produce two bounded VABs with original Tone bytes',async()=>{
  assert.equal(psfCrc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const {standalone}=createPsfFixture(),set=await readPsfFileSet([psfFile('demo.psf',standalone)]);
  const result=await extractPsfVabs(set,'demo.psf');
  assert.deepEqual(result.banks.map(found=>[found.address,found.bank.id]),[[0x10000,23],[0x20000,24]]);
  assert.equal(result.rejected,0);assert.equal(result.banks[0].bank.tones[1].shift,64);
  const tone=prepareVabTone(result.banks[0].bank,1);assert.equal(tone.options.baseFrequencyHz,440*2**((59.5-69)/12));assert.equal(tone.adpcm.length,64);
});

test('MiniPSF resolves backslashes and overlays primary library, own text and _lib2 in order across RAM aliases',async()=>{
  const {files}=createPsfFixture(),set=await readPsfFileSet(files),image=await composePsfRam(set,'Demo/track.minipsf');
  assert.deepEqual(image.loadedFiles,['Demo/lib/Bank.psflib','Demo/track.minipsf','Demo/patch.psflib']);
  assert.equal(image.ram[0x10845],64);assert.equal(findPsfVabs(image).banks.length,2);
  // An absent _lib2 stops the sequence, even if a stray _lib3 is present.
  const extra=makePsf(Uint8Array.of(0),0x80010845,'_lib=Bank.psflib\n_lib3=missing.psflib\n');
  const stopped=await readPsfFileSet([psfFile('a.psf',extra),psfFile('Bank.psflib',files[1]&&new Uint8Array(await files[1].arrayBuffer()))]);
  assert.equal((await composePsfRam(stopped,'a.psf')).ram[0x10845],0);
});

test('library failures distinguish missing, cyclic, escaping, duplicate and ambiguous paths',async()=>{
  const empty=new Uint8Array();
  const cases=[
    [[psfFile('a.psf',makePsf(empty,0,'_lib=missing.psflib'))],/missing PSFLib/],
    [[psfFile('a.psf',makePsf(empty,0,'_lib=b.psflib')),psfFile('b.psflib',makePsf(empty,0,'_lib=a.psf'))],/cyclic/],
    [[psfFile('a.psf',makePsf(empty,0,'_lib=../escape.psflib'))],/escapes/],
    [[psfFile('a.psf',makePsf(empty,0,'_lib=bank.psflib')),psfFile('Bank.psflib',makePsf(empty,0)),psfFile('BANK.psflib',makePsf(empty,0))],/ambiguous/],
  ];
  for(const [files,pattern] of cases){const set=await readPsfFileSet(files);await assert.rejects(composePsfRam(set,'a.psf'),pattern);}
  await assert.rejects(readPsfFileSet([psfFile('same.psf',makePsf(empty,0)),psfFile('same.psf',makePsf(empty,0))]),/duplicate path/);
  assert.throws(()=>readPsfFile(makePsf(empty,0,'_lib=a\n_LIB=b')),/duplicate/);
});

test('case-insensitive fallback is unique, nested _lib references are relative to their own directory',async()=>{
  const files=[psfFile('song.psf',makePsf(Uint8Array.of(3),0x80003000,'_lib=lib/Bank.psflib'),'Set/song.psf'),
    psfFile('BANK.PSFLIB',makePsf(Uint8Array.of(2),0x80002000,'_lib=../common.psflib'),'Set/lib/BANK.PSFLIB'),
    psfFile('common.psflib',makePsf(Uint8Array.of(1),0x80001000),'Set/common.psflib')];
  const image=await composePsfRam(await readPsfFileSet(files),'Set/song.psf');
  assert.deepEqual([image.ram[0x1000],image.ram[0x2000],image.ram[0x3000]],[1,2,3]);
});

test('bad versions, truncated sections and compressed CRC failures reject before decompression',()=>{
  const psf=makePsf(Uint8Array.of(1)),view=new DataView(psf.buffer);
  const version=psf.slice();version[3]=2;assert.throws(()=>readPsfFile(version),/PSF2/);
  const bad=psf.slice();bad[16]^=1;assert.throws(()=>readPsfFile(bad),/CRC/);
  assert.throws(()=>readPsfFile(psf.slice(0,-1)),/truncated/);
  const reserved=psf.slice();new DataView(reserved.buffer).setUint32(4,0xffffffff,true);assert.throws(()=>readPsfFile(reserved),/truncated/);
  const withReserved=makePsf(Uint8Array.of(1),0,'title=ok',{reserved:Uint8Array.of(1,2,3)});assert.equal(readPsfFile(withReserved).tags.get('title'),'ok');
  assert.equal(view.getUint32(12,true),fixtureCrc32(psf.subarray(16)));
});

test('EXE signature, text size, RAM bounds and expansion bombs have explicit limits',async()=>{
  const invalidExe=new Uint8Array(2048);
  const textSize=new Uint8Array(2048);textSize.set(new TextEncoder().encode('PS-X EXE'));new DataView(textSize.buffer).setUint32(0x1c,1,true);
  for(const [bytes,pattern] of [[psfFromExe(invalidExe),/not a PS-X EXE/],[psfFromExe(textSize),/truncated/],[makePsf(Uint8Array.of(1),0xbf801000),/outside PS1 RAM/],[makePsf(new Uint8Array(64),0x801ffff0),/crosses/],[makePsf(new Uint8Array(2033664)),/expanded/]]){
    const set=await readPsfFileSet([psfFile('bad.psf',bytes)]);await assert.rejects(composePsfRam(set,'bad.psf'),pattern);
  }
});

test('zlib checksum is checked even with a valid compressed CRC, cancellation never returns a partial bank',async()=>{
  const bytes=makePsf(Uint8Array.of(1));bytes[bytes.length-1]^=1;new DataView(bytes.buffer).setUint32(12,fixtureCrc32(bytes.subarray(16)),true);
  const set=await readPsfFileSet([psfFile('bad.psf',bytes)]);await assert.rejects(composePsfRam(set,'bad.psf'),/zlib/);
  const controller=new AbortController();controller.abort();await assert.rejects(readPsfFileSet([psfFile('bad.psf',bytes)],{signal:controller.signal}),{name:'AbortError'});
  const valid=await readPsfFileSet(createPsfFixture().files);await assert.rejects(extractPsfVabs(valid,'Demo/track.minipsf',{signal:controller.signal}),{name:'AbortError'});
});

test('no-bank result is distinct from malformed input; false magic and unloaded sample holes are rejected',async()=>{
  const plain=makePsf(new Uint8Array(4096)),set=await readPsfFileSet([psfFile('plain.psf',plain)]);
  assert.equal((await extractPsfVabs(set,'plain.psf')).banks.length,0);
  const fixture=createPsfFixture(),image=await composePsfRam(await readPsfFileSet([psfFile('a.psf',fixture.standalone)]),'a.psf');
  image.coverage[0x10000+0xe20+20]=0;
  image.ram.set(new TextEncoder().encode('pBAV'),0x50000);
  const result=findPsfVabs(image);assert.equal(result.banks.length,1);assert.equal(result.rejected,2);
});

test('dependency depth and selected input budgets cannot expand unboundedly',async()=>{
  const files=Array.from({length:11},(_,i)=>psfFile(`${i}.psf`,makePsf(new Uint8Array(),0,i<10?`_lib=${i+1}.psf`:'')));
  const set=await readPsfFileSet(files);await assert.rejects(composePsfRam(set,'0.psf'),/depth/);
  await assert.rejects(readPsfFileSet(Array(513).fill(files[0])),/512/);
  await assert.rejects(readPsfFileSet([{...files[0],size:4*1024*1024+1}]),/4 MiB/);
});

test('another validated VAB header inside an assumed body rejects the outer bank, even after its first END',async()=>{
  const f=createPsfConflictFixture('vab'),set=await readPsfFileSet([psfFile('overlap.psf',f.psf)]);
  const result=await extractPsfVabs(set,'overlap.psf');
  assert.deepEqual(result.banks.map(b=>b.address),[0x10000+f.embeddedOffset]);
  assert.equal(result.rejected,1);
  assert.equal(result.diagnostics[0].code,'ambiguous-vab-body');
  assert.equal(result.diagnostics[0].conflictAddress,0x10000+f.embeddedOffset);
});

test('structured SEQ inside an assumed body rejects a bank with otherwise playable Tones',async()=>{
  for(const rhythm of ['specified','unset']) {
    const f=createPsfConflictFixture('seq');
    if(rhythm==='unset'){f.data[f.embeddedOffset+13]=0;f.data[f.embeddedOffset+14]=0;}
    const set=await readPsfFileSet([psfFile('sequence.psf',makePsf(f.data))]);
    const result=await extractPsfVabs(set,'sequence.psf');
    assert.equal(result.banks.length,0);assert.equal(result.rejected,1);
    assert.equal(result.diagnostics[0].code,'ambiguous-seq-body');
  }
});

test('an embedded valid VH still conflicts when its own body is uncovered or its Tones are unsupported',async()=>{
  for(const kind of ['uncovered','unsupported']) {
    const f=createPsfConflictFixture('vab'),image=await composePsfRam(await readPsfFileSet([psfFile('a.psf',f.psf)]),'a.psf');
    const at=0x10000+f.embeddedOffset;
    if(kind==='unsupported') {
      image.ram[at+0xe20+16]=0xf0;image.ram[at+0xe20+96]=0xf0;
    } else {
      // Leave the nested header loaded; its body extends beyond the outer bank.
      const v=new DataView(image.ram.buffer);v.setUint32(at+12,0x3000,true);
      image.coverage[at+0x2fff]=0;
    }
    assert.equal(findPsfVabs(image).diagnostics[0].code,'ambiguous-vab-body');
  }
});

test('magic alone, invalid SEQ timing, or uncovered SEQ headers do not reject a valid body',async()=>{
  for(const kind of ['vab','seq']) {
    const f=createPsfConflictFixture(kind),image=await composePsfRam(await readPsfFileSet([psfFile('a.psf',f.psf)]),'a.psf');
    const at=0x10000+f.embeddedOffset;
    if(kind==='vab')image.ram[at+4]=99;else image.ram[at+8]=image.ram[at+9]=0;
    assert.equal(findPsfVabs(image).banks[0].address,0x10000);
  }
  const f=createPsfConflictFixture('seq'),image=await composePsfRam(await readPsfFileSet([psfFile('a.psf',f.psf)]),'a.psf');
  image.coverage[0x10000+f.embeddedOffset+10]=0;
  const result=findPsfVabs(image);assert.equal(result.banks.length,0);
  assert.equal(result.diagnostics[0].code,'unloaded-or-invalid-range');
});

test('a structured SEQ outside the bank and genuine short samples remain accepted',async()=>{
  const {vab}=await import('../../test/helpers/spu_vab_fixture.mjs').then(m=>m.createVabFixture());
  const seq=createPsfConflictFixture('seq'),data=new Uint8Array(vab.length+seq.embeddedBytes+32);
  data.set(vab);data.set(seq.data.subarray(seq.embeddedOffset,seq.embeddedOffset+seq.embeddedBytes),vab.length+16);
  const result=await extractPsfVabs(await readPsfFileSet([psfFile('a.psf',makePsf(data))]),'a.psf');
  assert.equal(result.banks.length,1);assert.equal(result.rejected,0);
  assert.equal(prepareVabTone(result.banks[0].bank,2).adpcm.length,16);
});

const splitImage=async options=>{
  const fixture=createPsfSplitVabFixture(options);
  return {fixture,image:await composePsfRam(await readPsfFileSet(fixture.files),'split.psf')};
};

test('a unique separated body matches exact packet boundaries rather than the zero-filled contiguous gap',async()=>{
  for(const coverGap of [true,false]) {
    const {fixture,image}=await splitImage({coverGap}),result=findPsfVabs(image);
    assert.equal(result.banks.length,1);assert.equal(result.rejected,0);
    const found=result.banks[0];
    assert.equal(found.address,fixture.headerAddress);assert.equal(found.bodyAddress,fixture.bodyAddress);
    assert.equal(found.layout,'split');assert.equal(found.headerBytes,fixture.vh.length);assert.equal(found.bodyBytes,fixture.vb.length);
    assert.equal(found.bodyMatch,'unique-structural');
    assert.deepEqual(found.bank,fixture.bank);
    assert.deepEqual(prepareVabTone(found.bank,2).adpcm,fixture.vb.slice(80));
  }
});

test('missing bytes in a separated sample body or its header never produce a partial bank',async()=>{
  for(const at of ['header','body']) {
    const {fixture,image}=await splitImage();
    image.coverage[(at==='header'?fixture.headerAddress:fixture.bodyAddress)+20]=0;
    const result=findPsfVabs(image);assert.equal(result.banks.length,0);assert.equal(result.rejected,1);
  }
  const {image}=await splitImage({missingBody:true});assert.equal(findPsfVabs(image).banks.length,0);
});

test('split matching requires each sample END at its own declared boundary',async()=>{
  for(const kind of ['missing-end','early-end','invalid-header','unsupported-flags','multiple-markers']) {
    const {fixture,image}=await splitImage({coverGap:false}),at=fixture.bodyAddress+16;
    if(kind==='missing-end')image.ram[at+49]&=~1;
    if(kind==='early-end')image.ram[at+17]|=1;
    if(kind==='invalid-header')image.ram[at]=0x50;
    if(kind==='unsupported-flags')image.ram[at+1]|=8;
    if(kind==='multiple-markers')image.ram[at+17]|=4;
    assert.equal(findPsfVabs(image).banks.length,0,kind);
  }
});

test('two separated candidate bodies remain ambiguous instead of choosing the first match',async()=>{
  const {image}=await splitImage({duplicateBody:true}),result=findPsfVabs(image);
  assert.equal(result.banks.length,0);assert.equal(result.diagnostics[0].code,'ambiguous-vb-candidates');
});

test('structural inference excludes an early-END origin but does not claim proof of driver pointers',async()=>{
  const {fixture,image}=await splitImage();
  image.ram[fixture.bodyAddress+16+17]|=1;
  // These bytes now also form a different, structurally valid stream starting
  // 32 bytes earlier. There is no pointer in VH proving which one a driver used.
  const result=findPsfVabs(image);assert.equal(result.banks.length,1);
  assert.equal(result.banks[0].bodyAddress,fixture.bodyAddress-32);
  assert.equal(result.banks[0].bodyMatch,'unique-structural');
  image.coverage[fixture.bodyAddress-32]=0;
  assert.equal(findPsfVabs(image).banks.length,0,'unloaded prefix cannot support that alternate candidate');
});

test('a valid contiguous body and a different strict body are also an ambiguous mapping',async()=>{
  const {fixture,image}=await splitImage();
  image.ram.set(fixture.vb,fixture.headerAddress+fixture.vh.length);
  const result=findPsfVabs(image);assert.equal(result.banks.length,0);
  assert.equal(result.diagnostics[0].code,'ambiguous-vb-candidates');
});

test('two unclaimed headers cannot both establish ownership of the same separated body',async()=>{
  const {fixture,image}=await splitImage(),other=0x20000;
  image.ram.set(fixture.vh,other);new DataView(image.ram.buffer).setUint32(other+8,99,true);
  const result=findPsfVabs(image);assert.equal(result.banks.length,0);
  assert.deepEqual(result.diagnostics.map(item=>item.code),['ambiguous-shared-vb','ambiguous-shared-vb']);
});

test('overlapping separated bodies are ambiguous even when their prefix addresses differ',async()=>{
  const {fixture,image}=await splitImage(),other=0x20000;
  image.ram.set(fixture.vh,other);const view=new DataView(image.ram.buffer);
  view.setUint32(other+8,99,true);view.setUint32(other+12,fixture.vh.length+fixture.vb.length-8,true);
  view.setUint16(other+0xc20,1,true);
  const result=findPsfVabs(image);assert.equal(result.banks.length,0);
  assert.deepEqual(result.diagnostics.map(item=>item.code),['ambiguous-shared-vb','ambiguous-shared-vb']);
});

test('independent exact contiguous banks do not borrow each other\'s owned bodies',()=>{
  const fixture=createPsfSplitVabFixture(),ram=new Uint8Array(2*1024*1024),coverage=new Uint8Array(ram.length);
  for(const at of [0x10000,0x40000]){ram.set(fixture.vab,at);coverage.fill(1,at,at+fixture.vab.length);}
  const result=findPsfVabs({ram,coverage});assert.equal(result.rejected,0);
  assert.deepEqual(result.banks.map(bank=>[bank.address,bank.layout]),[[0x10000,'contiguous'],[0x40000,'contiguous']]);
});

test('unsupported packets stay per-Tone diagnostics in an otherwise located contiguous bank',async()=>{
  const {vh,vab}=createVabFixture();vab[vh.length+16]=0xf0;
  const result=await extractPsfVabs(await readPsfFileSet([psfFile('bad-sample.psf',makePsf(vab))]),'bad-sample.psf');
  assert.equal(result.banks.length,1);assert.equal(result.banks[0].layout,'contiguous');
  assert.throws(()=>prepareVabTone(result.banks[0].bank,0),/predictor/);
  assert.equal(prepareVabTone(result.banks[0].bank,2).adpcm.length,16);
});

test('a separated body cannot contain another validated structured file',async()=>{
  const {fixture,image}=await splitImage(),seq=createPsfConflictFixture('seq');
  image.ram.set(seq.data.subarray(seq.embeddedOffset,seq.embeddedOffset+seq.embeddedBytes),fixture.bodyAddress+18);
  assert.equal(findPsfVabs(image).banks.length,0);
});

test('a loaded header near the end of RAM can reference a separated body before it',async()=>{
  const {fixture,image}=await splitImage({headerAddress:0x1ff000,bodyAddress:0x10000,coverGap:false});
  const result=findPsfVabs(image);assert.equal(result.banks.length,1);
  assert.equal(result.banks[0].address,fixture.headerAddress);assert.equal(result.banks[0].bodyAddress,fixture.bodyAddress);
});

test('separated bodies with legacy END padding are not guessed from a partial stream',async()=>{
  const {vh,vb}=createVabFixture(),ram=new Uint8Array(2*1024*1024),coverage=new Uint8Array(ram.length);
  ram.set(vh,0x10000);coverage.fill(1,0x10000,0x10000+vh.length);
  ram.set(vb,0x30000);coverage.fill(1,0x30000,0x30000+vb.length);
  assert.equal(findPsfVabs({ram,coverage}).banks.length,0);
});

test('metadata parsing has a finite total body-validation budget',()=>{
  const {vh}=createVabFixture(),header=vh.slice(),ram=new Uint8Array(2*1024*1024),coverage=new Uint8Array(ram.length).fill(1);
  new DataView(header.buffer).setUint32(12,header.length+524288,true);
  for(let index=0;index<65;index++)ram.set(header,0x1000+index*0x1000);
  assert.throws(()=>findPsfVabs({ram,coverage}),/metadata validation budget/);
});

test('many END-like packets cannot create an unbounded candidate search',()=>{
  const {vh}=createVabFixture(),ram=new Uint8Array(2*1024*1024),coverage=new Uint8Array(ram.length).fill(1);
  for(let at=0;at<ram.length;at+=16){ram[at]=12;ram[at+1]=1;}
  for(let index=0;index<8;index++)ram.set(vh,0x10000+index*0x10000);
  assert.throws(()=>findPsfVabs({ram,coverage}),/candidate search budget/);
});

test('matching-body lists also have a bounded ambiguity limit',()=>{
  const {vh}=createVabFixture(),header=vh.slice(),view=new DataView(header.buffer);
  view.setUint16(0xc22,2,true);view.setUint16(0xc24,2,true);view.setUint32(12,header.length+48,true);
  const ram=new Uint8Array(2*1024*1024),coverage=new Uint8Array(ram.length).fill(1);
  for(let at=0;at<ram.length;at+=16){ram[at]=12;ram[at+1]=1;}
  ram.set(header,0x10000);
  assert.throws(()=>findPsfVabs({ram,coverage}),/too many matching VB candidates/);
});
