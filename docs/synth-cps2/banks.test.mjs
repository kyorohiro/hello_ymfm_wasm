// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {bankLibrary,editSlot,factoryBanks,padFromPcm} from './banks.js';
import {cabinetPluck} from './sample-duet.js';

test('raw ROM imports keep every original byte when a slot is added, replaced and deleted',()=>{
  const raw=new Uint8Array(32766).fill(0x97);
  const first=editSlot(raw,[],3,cabinetPluck(),'PCM','custom.wav');
  const item=first.library.items.get('slot:3');
  assert.equal(item.offset,32768);assert.deepEqual(first.library.rom.slice(0,raw.length),raw);
  const changed=editSlot(first.library.rom,first.slots,3,cabinetPluck(),'PCM','replacement.wav');
  assert.equal(changed.slots[3].offset,item.offset);
  const empty=editSlot(changed.library.rom,changed.slots,3,null);
  assert.deepEqual(empty.library.rom.slice(0,raw.length),raw);assert.equal(empty.library.items.size,0);
});

test('factory Code paths resolve to PCM and ADPCM bytes in raw ROM; additional pad encoding preserves the PCM',()=>{
  const [,bank]=factoryBanks()[0],lib=bankLibrary(bank.rom,bank.slots);
  const pluck=lib.items.get('/samples/cabinet-pluck.wav');
  assert(lib.padItems.has('/samples/cabinet-snare.wav'));
  const converted=padFromPcm(bank.rom,bank.slots,pluck);
  assert.deepEqual(converted.library.rom.slice(0,bank.rom.length),bank.rom);
  assert(converted.library.padItems.get(pluck.path).length>0);
});
