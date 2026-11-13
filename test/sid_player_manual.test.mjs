// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidPlayerManual} from '../docs/sid-player/manual.js';
import {SidPlayerCore} from '../docs/sid-player/core.js';
import {RsidPlayerCore} from '../docs/sid-player/rsid_core.js';
import {Sid8580PlayerCore} from '../docs/sid-player/core8580.js';
import {createSidReferenceFixture} from './fixtures/sid-reference/fixture.mjs';

function fixture(){
  const registers=Array(32).fill(0),revisions=Array(32).fill(0),writes=[];
  registers[4]=registers[11]=registers[18]=0x21;registers[24]=8;
  const core={getState:()=>({loaded:true,playing:true,model:'6581',clockHz:985248,registers:[...registers]}),
    readSourceRevisions:()=>[...revisions],manualWriteRegister(r,v){writes.push([r,v]);registers[r]=v;}};
  return {core,manual:new SidPlayerManual(core),registers,revisions,writes,
    source(r,v){registers[r]=v;revisions[r]++;},clear(){writes.length=0;}};
}
test('song edits preserve latest packed fields, physical Gate and unrelated channels',()=>{
  const f=fixture();f.registers[5]=0xa7;f.registers[6]=0xe9;f.registers[3]=0xb5;
  f.registers[23]=0xcd;f.registers[24]=0xb8;
  f.manual.edit(0,{voice:{decay:2,sustain:3,pulseWidth:0xabc},modulation:{sync:true},filter:{cutoff:511,resonance:6}});
  assert.equal(f.registers[5],0xa2);assert.equal(f.registers[6],0x39);assert.equal(f.registers[3],0xba);
  assert.equal(f.registers[4],0x23);assert.equal(f.registers[11],0x21);assert.equal(f.registers[18],0x21);
  assert.equal(f.registers[23],0x6d);assert.equal(f.registers[24],0xb8);
  f.clear();f.manual.edit(1,{filter:{enabled:true}});assert.deepEqual(f.writes,[[23,0x6f]]);
  f.clear();f.manual.edit(0,{filter:{enabled:false}});assert.deepEqual(f.writes,[[23,0x6e]]);
});
test('click masks merge waveform and LP/BP/HP subbits into the newest song state',()=>{
  const f=fixture();f.source(4,0xc7);f.source(24,0xe9);
  f.manual.edit(0,{voice:{waveform:'triangle'},filter:{mode:'lowpass'}},{waveformBits:1,filterModeBits:1});
  assert.equal(f.registers[4],0xd7,'only Triangle is enabled; latest Pulse/Noise, Sync/Ring/Gate remain');
  assert.equal(f.registers[24],0xf9,'latest HP/BP, voice3off and hardware level remain');
  f.source(24,0x39);f.source(23,4);
  f.manual.edit(0,{filter:{mode:'off',enabled:false}},{filterModeBits:1});
  assert.equal(f.registers[24],0x29,'a stale LP-only display disables LP but retains newly enabled BP');
  assert.equal(f.registers[23],5,'remaining current BP enables the selected voice without removing CH3 routing');
  f.source(24,0x19);f.source(23,0);
  f.manual.edit(1,{filter:{mode:'lowpass+bandpass'}},{filterModeBits:2});
  assert.equal(f.registers[23],2,'an output click enables the latest selected routing even when displayed enabled stayed true');
  assert.equal(f.registers[24],0x39);
});
test('invalid fields, masks, ratio and unrepresentable multi-key pitch are transactional',()=>{
  const f=fixture();f.manual.noteOn('high',0,90);f.manual.noteOn('low',1,48);f.clear();
  for(const run of [()=>f.manual.edit(0,{voice:{attack:1,decay:18}}),()=>f.manual.edit(0,{filter:{volume:4,enabled:1}}),
    ()=>f.manual.edit(0,{modulation:{ratio:9}}),()=>f.manual.edit(0,{voice:{waveform:'saw'}},{waveformBits:16}),
    ()=>f.manual.edit(0,{voice:{waveform:'saw'},surprise:{}}),()=>f.manual.setPitch(24)]){
    assert.throws(run);assert.equal(f.writes.length,0);
  }
});
test('later same-value source Gate writes revoke old key-up and Pitch ownership',()=>{
  const f=fixture();f.manual.noteOn('old',0,60);f.source(4,f.registers[4]);f.clear();
  assert.equal(f.manual.describe().manualVoices[0].gateOwned,false);
  f.manual.setPitch(2);f.manual.noteOff('old');assert.equal(f.writes.length,0);assert.equal(f.registers[4]&1,1);
});
test('source frequency writes steal Pitch only; latest ADSR/wave edits keep the hand gate',()=>{
  const f=fixture();f.manual.noteOn('key',0,60);f.source(0,f.registers[0]);f.clear();
  assert.equal(f.manual.describe().manualVoices[0].pitchOwned,false);
  f.manual.setPitch(2);assert.equal(f.writes.length,0);
  f.manual.edit(0,{voice:{waveform:'pulse',attack:4}});assert.equal(f.registers[4]&1,1);
  f.clear();f.manual.noteOff('key');assert.deepEqual(f.writes,[[4,0x40]]);
});
test('new keys supersede older same-CH release and modulator ratio changes only predecessor frequency',()=>{
  const f=fixture();f.manual.noteOn('older',0,60);f.manual.noteOn('newer',0,64);f.clear();
  f.manual.noteOff('older');assert.equal(f.writes.length,0);
  f.manual.noteOn('source',2,48);const before=f.registers.slice();f.clear();
  f.manual.edit(0,{modulation:{ratio:.5}});
  assert.deepEqual(f.writes.map(([r])=>r),[14,15]);assert.equal(f.registers[18],before[18]);
  assert.equal(f.manual.describe().manualVoices.find(v=>v.id==='source').pitchOwned,false);
  f.clear();f.manual.setPitch(1);assert.deepEqual(f.writes.map(([r])=>r),[0,1]);
  f.manual.release();assert.equal(f.registers[4]&1,0);assert.equal(f.registers[18]&1,0);assert.deepEqual(f.manual.describe().manualVoices,[]);
});

const binaries=await Promise.all(['sid-player/sid-player.wasm','sid-rsid/sid-rsid.wasm','sid8580-machine/sid8580-endpoint.wasm','sid8580-machine/sid8580-machine.wasm']
  .map(path=>readFile(new URL('../docs/generated/'+path,import.meta.url))));
for(const [name,Core,options,load]of [['direct6581',SidPlayerCore,{wasmBinary:binaries[0]},{}],
  ['c646581',RsidPlayerCore,{wasmBinary:binaries[1]},{vbiBackend:'c64'}],
  ['c648580',Sid8580PlayerCore,{endpointBinary:binaries[2],machineBinary:binaries[3]},{modelSelection:'8580'}]]){
  test(`${name}: actual native edits are non-clocking, leave CPU program/RAM intact and later source writes win`,async()=>{
    const core=await Core.create(options),bytes=createSidReferenceFixture('melody-filter').bytes;
    if(name==='c648580')new DataView(bytes.buffer).setUint16(118,0x24);
    try{
      core.load(bytes,load);core.render(8192);const manual=new SidPlayerManual(core),before=core.getState(),revisions=core.readSourceRevisions();
      manual.edit(0,{voice:{pulseWidth:1234,attack:3},filter:{resonance:7}});
      const after=core.getState();assert.equal(after.cycles,before.cycles);assert.equal(after.positionFrames,before.positionFrames);
      assert.equal(after.playCalls,before.playCalls);assert.equal(after.pc,before.pc);assert.equal(after.registers[2]|(after.registers[3]&15)<<8,1234);
      assert.equal(after.registers[5]&15,before.registers[5]&15);assert.deepEqual(core.readSourceRevisions(),revisions,'manual writes are not CPU-source events');
      manual.noteOn('hand',0,60);const owned=manual.describe();assert.equal(owned.manualVoices[0].gateOwned,true);
      core.readTrace({clear:true});core.render(4096);
      assert.equal(manual.describe().manualVoices[0].gateOwned,false,'C64 control writes revoked the manual key');
      const state=core.getState();manual.noteOff('hand');assert.deepEqual(core.getState(),state,'old release cannot alter a later song note');
      assert(core.readSourceRevisions()[4]>revisions[4]);
    }finally{core.dispose();}
  });
}
