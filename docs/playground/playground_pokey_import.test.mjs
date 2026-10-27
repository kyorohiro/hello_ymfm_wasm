import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createPokeyImportVgm} from '../../test/helpers/pokey_vgm_fixture.mjs';
import {detectVgmImport,prepareVgmImport} from './playground_vgm_import.js';

const file=bytes=>({arrayBuffer:async()=>bytes});
const append=(input,commands)=>{const bytes=new Uint8Array(input.length-1+commands.length);bytes.set(input.subarray(0,-1));bytes.set(commands,input.length-1);new DataView(bytes.buffer).setUint32(4,bytes.length-4,true);return bytes;};
test('POKEY import detection reports physical clocks and independent single/dual channel counts',()=>{
  for(const clock of [100000,1789773,1789790,100000000])for(const dual of [false,true]){
    const result=detectVgmImport({pokeyClock:(clock|(dual?0x40000000:0))>>>0});assert.equal(result.family,'pokey');assert.equal(result.supported,true);assert.equal(result.clock,clock);assert.equal(result.chipCount,dual?2:1);assert.deepEqual(result.chips,['pokey']);assert.match(result.message,new RegExp(`${dual?8:4} physical channels`));assert.match(result.message,/same audio frame/);assert.match(result.message,/one pass|loops are not repeated/);
  }
});
test('POKEY dual support bypasses the generic dual rejection only for an isolated supported POKEY declaration',()=>{
  for(const header of [{pokeyClock:99999},{pokeyClock:100000001},{pokeyClock:0x80000000+1789790},{pokeyClock:0xc0000000+1789790},
    {pokeyClock:0x40000000+1789790,psgClock:3579545},{pokeyClock:1789790,gameBoyDmgClock:4194304},
    {wonderswanClock:0x40000000+3072000},{gameBoyDmgClock:0x40000000+4194304},{ym2612Clock:0x40000000+7670454}])assert.equal(detectVgmImport(header).supported,false,JSON.stringify(header));
  const omitted=detectVgmImport({ym2612Clock:7670454,pokeyClock:0x40000000+1789790});assert.equal(omitted.family,'opn');assert.equal(omitted.supported,true);assert.deepEqual(omitted.omittedChips,['pokey']);assert.match(omitted.message,/POKEY will be omitted/);
});
test('POKEY VGM and gzip VGZ complete preflight accepts ordinary and dense single/dual streams',async()=>{
  for(const dual of [false,true])for(const dense of [false,true]){
    const input=createPokeyImportVgm({dual,dense,seconds:.5});for(const bytes of [input,gzipSync(input)]){
      const result=await prepareVgmImport(file(bytes));assert.equal(result.detection.family,'pokey');assert.equal(result.detection.supported,true);assert.equal(result.detection.chipCount,dual?2:1);assert.equal(result.detection.clock,1789773);assert.deepEqual(new Uint8Array(result.buffer),input);
    }
  }
});
test('POKEY preflight reaches commands hidden after metadata and refuses undeclared chips before conversion',async()=>{
  const source=createPokeyImportVgm({seconds:.5});
  const invalid=[
    ['undeclared second chip',[0xbb,0x80,1,0x66],/dual-chip header/],
    ['invalid register',[0xbb,16,1,0x66],/register/],
    ['metadata then unsupported chip',[0x67,0x66,0,1,0,0,0,0x1a,0x50,0x90,0x66],/unsupported command/],
    ['metadata then invalid BB',[0x94,255,0xbb,0x90,1,0x66],/dual-chip header/],
    ['bad DAC target',[0x90,0,0x9e,0,1,0x66],/declared POKEY/],
  ];
  for(const [label,commands,error]of invalid){const bytes=append(source,commands);for(const data of [bytes,gzipSync(bytes)]){const result=await prepareVgmImport(file(data));assert.equal(result.detection.family,'pokey');assert.equal(result.detection.supported,false,label);assert.match(result.detection.message,error,label);}}
});
test('POKEY whole-file preflight rejects extra clock overrides, variants, truncated commands and declared EOF overflow',async()=>{
  const edits=[
    ['variant',bytes=>new DataView(bytes.buffer).setUint32(0xb0,0x80000000+1789773,true),/variant/],
    ['mixed clock',bytes=>new DataView(bytes.buffer).setUint32(0x0c,3579545,true),/combination/],
    ['unknown mixed clock',bytes=>new DataView(bytes.buffer).setUint32(0xf0,1000000,true),/mixed-chip clock/],
    ['extra overrides',bytes=>new DataView(bytes.buffer).setUint32(0xbc,4,true),/extra-header/],
    ['EOF beyond file',bytes=>new DataView(bytes.buffer).setUint32(4,bytes.length+4,true),/EOF|offset/],
  ];for(const [label,edit,error]of edits){const bytes=createPokeyImportVgm({seconds:.5});edit(bytes);const result=await prepareVgmImport(file(bytes));assert.equal(result.detection.supported,false,label);assert.match(result.detection.message,error,label);}
  for(const bytes of [createPokeyImportVgm({seconds:.5}).subarray(0,-1),append(createPokeyImportVgm({seconds:.5}),[0xbb,0])]){const result=await prepareVgmImport(file(bytes));assert.equal(result.detection.supported,false);assert.match(result.detection.message,/truncated|EOF|offset|end/i);}
});
test('POKEY preflight allows metadata followed by a valid direct write and a completely silent second chip',async()=>{
  const single=createPokeyImportVgm({seconds:.5}),bytes=append(single,[0x67,0x66,0,1,0,0,0,0x1a,0xbb,0,47,0x66]);new DataView(bytes.buffer).setUint32(0xb0,0x40000000+1789773,true);const result=await prepareVgmImport(file(gzipSync(bytes)));assert.equal(result.detection.family,'pokey');assert.equal(result.detection.supported,true);assert.equal(result.detection.chipCount,2);
});
