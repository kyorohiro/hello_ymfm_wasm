// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import {createPsfFixture, psfFromExe, psfFile} from '../../test/helpers/spu_psf_fixture.mjs';
import {createPsfPlaybackFixture, playbackExe, PSF_FIXTURE_PC} from '../../test/helpers/spu_psf_playback_fixture.mjs';

function withHeader(exe,{pc,gp,sp,region}={}) {
  const result=exe.slice(),view=new DataView(result.buffer);
  for(const [offset,value] of [[0x10,pc],[0x14,gp],[0x30,sp]])if(value!==undefined)view.setUint32(offset,value,true);
  if(region!==undefined) {
    result.fill(0,0x4c,0x100);
    result.set(new TextEncoder().encode(region),0x4c);
  }
  return result;
}

test('runnable PSF preserves loaded text and CPU startup registers',async()=>{
  const fixture=createPsfPlaybackFixture(),set=await readPsfFileSet(fixture.standaloneFiles);
  const source=await preparePsfSongSource(set,'standalone.psf');
  assert.equal(source.pc,PSF_FIXTURE_PC);
  assert.equal(source.gp,0x80020000);
  assert.equal(source.sp,0x801fff00);
  assert.equal(source.refresh,60);
  assert.deepEqual(source.loadedFiles,['standalone.psf']);
  assert.deepEqual(source.ram.subarray(0x10000,0x10000+fixture.text.length),fixture.text);
  assert.ok(source.coverage.subarray(0x10000,0x10000+fixture.text.length).every(Boolean));
});

test('MiniPSF overlays its library without replacing its CPU startup',async()=>{
  const fixture=createPsfPlaybackFixture(),set=await readPsfFileSet(fixture.files);
  const source=await preparePsfSongSource(set,'Demo/track.minipsf');
  const pitch=new DataView(source.ram.buffer).getUint32(0x10000+fixture.pitchInstruction,true);
  assert.equal(pitch,0x34091400);
  assert.equal(source.pc,PSF_FIXTURE_PC);
  assert.equal(source.gp,0x80020000);
  assert.equal(source.sp,0x801fff00);
  assert.deepEqual(source.loadedFiles,['Demo/lib/driver.psflib','Demo/track.minipsf']);
});

test('primary library supplies PC/GP/SP; auxiliary overlays cannot replace them',async()=>{
  const fixture=createPsfPlaybackFixture();
  const root=withHeader(playbackExe(Uint8Array.of(0),0x80030000),{pc:0x80030000,gp:123,sp:456,region:'North America'});
  const lib=withHeader(fixture.exe,{pc:PSF_FIXTURE_PC,gp:0x80040000,sp:0x801ff000,region:'Europe'});
  const aux=withHeader(playbackExe(Uint8Array.of(1),0x80030001),{pc:0x80050000,gp:0x1111,sp:0x2222,region:'Europe'});
  const set=await readPsfFileSet([
    psfFile('root.minipsf',psfFromExe(root,'_lib=driver.psflib\n_lib2=aux.psflib\n')),
    psfFile('driver.psflib',psfFromExe(lib)),psfFile('aux.psflib',psfFromExe(aux)),
  ]);
  const source=await preparePsfSongSource(set,'root.minipsf');
  assert.equal(source.pc,PSF_FIXTURE_PC);assert.equal(source.gp,0x80040000);assert.equal(source.sp,0x801ff000);
  assert.equal(source.ram[0x30000],0);assert.equal(source.ram[0x30001],1);
  assert.equal(source.refresh,60,'root EXE region controls fallback timing');
  assert.deepEqual(source.loadedFiles,['driver.psflib','root.minipsf','aux.psflib']);
});

test('_refresh is accepted in root-first visitation order before dependencies',async()=>{
  const fixture=createPsfPlaybackFixture();
  for(const [rootRefresh,libraryRefresh,expected] of [['50','60',50],['60','50',60],['','50',50],['bad','50',50]]) {
    const root=playbackExe(Uint8Array.of(0),0x80030000);
    const set=await readPsfFileSet([
      psfFile('root.minipsf',psfFromExe(root,`_lib=driver.psflib\n_lib2=aux.psflib\n${rootRefresh?`_refresh=${rootRefresh}\n`:''}`)),
      psfFile('driver.psflib',psfFromExe(fixture.exe,`_refresh=${libraryRefresh}\n`)),
      psfFile('aux.psflib',psfFromExe(playbackExe(Uint8Array.of(1),0x80030001),'_refresh=60\n')),
    ]);
    assert.equal((await preparePsfSongSource(set,'root.minipsf')).refresh,expected);
  }
});

test('European root region uses 50 Hz and absent stack uses the PSF fallback',async()=>{
  const fixture=createPsfPlaybackFixture();
  const exe=withHeader(fixture.exe,{sp:0,region:'Sony Computer Entertainment Inc. for Europe area'});
  const set=await readPsfFileSet([psfFile('pal.psf',psfFromExe(exe))]);
  const source=await preparePsfSongSource(set,'pal.psf');
  assert.equal(source.refresh,50);assert.equal(source.sp,0x801fff00);
});

test('bank-only demos and invalid or unloaded entry points are rejected',async()=>{
  const extraction=createPsfFixture(),demo=await readPsfFileSet([psfFile('banks.psf',extraction.standalone)]);
  await assert.rejects(preparePsfSongSource(demo,'banks.psf'),/no valid loaded entry point/);
  const fixture=createPsfPlaybackFixture();
  for(const pc of [0x80010001,0x80030000,0x1f801c00,0xbfc00000]) {
    const set=await readPsfFileSet([psfFile('invalid.psf',psfFromExe(withHeader(fixture.exe,{pc})))]);
    await assert.rejects(preparePsfSongSource(set,'invalid.psf'),/no valid loaded entry point/);
  }
  await assert.rejects(preparePsfSongSource(demo,'missing.psf'),/choose a PSF entry/);
});

test('source preparation respects cancellation and never mutates the accepted file set',async()=>{
  const fixture=createPsfPlaybackFixture(),set=await readPsfFileSet(fixture.files),controller=new AbortController();
  controller.abort();
  await assert.rejects(preparePsfSongSource(set,'Demo/track.minipsf',{signal:controller.signal}),{name:'AbortError'});
  assert.equal(set.records.size,2);
  assert.equal((await preparePsfSongSource(set,'Demo/track.minipsf')).pc,PSF_FIXTURE_PC);
});
