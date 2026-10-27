import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createWonderSwanVgm} from '../../test/helpers/wonderswan_vgm_fixture.mjs';
import {detectVgmImport, prepareVgmImport} from './playground_vgm_import.js';

const file = bytes => ({arrayBuffer:async () => bytes});
test('WonderSwan detection separates single-chip source clocks from variants, dual chips and unsupported combinations', () => {
  for (const clock of [100000, 3072000, 3579545, 100000000]) {
    const detection = detectVgmImport({wonderswanClock:clock});
    assert.equal(detection.family, 'wonderswan'); assert.equal(detection.clock, clock); assert.equal(detection.supported, true);
    assert.match(detection.message, /audio sample boundaries/);
  }
  for (const header of [
    {wonderswanClock:99999}, {wonderswanClock:100000001},
    {wonderswanClock:0x40000000 + 3072000}, {wonderswanClock:0x80000000 + 3072000},
    {wonderswanClock:3072000, psgClock:3579545},
  ]) assert.equal(detectVgmImport(header).supported, false);
  // Existing OPN extraction still explicitly reports omitted accompanying chips.
  const fm = detectVgmImport({wonderswanClock:3072000, ym2612Clock:7670454});
  assert.equal(fm.family, 'opn'); assert.deepEqual(fm.omittedChips, ['wonderswan']); assert.match(fm.message, /WONDERSWAN will be omitted/);
});

test('WonderSwan VGM/VGZ preflight supports all four sound modes and rejects incomplete or unsupported streams before conversion', async () => {
  for (const mode of ['wave', 'noise', 'sweep', 'voice']) {
    const input = createWonderSwanVgm({mode, seconds:.1, loop:false});
    for (const bytes of [input, gzipSync(input)]) {
      const result = await prepareVgmImport(file(bytes));
      assert.equal(result.detection.family, 'wonderswan'); assert.equal(result.detection.supported, true);
    }
  }
  for (const [name,edit] of [
    ['unsupported register', bytes => Uint8Array.from([...bytes.subarray(0,-1),0xbc,0x20,1,0x66])],
    ['truncated', bytes => bytes.subarray(0,bytes.length-1)],
    ['second chip', bytes => Uint8Array.from([...bytes.subarray(0,-1),0xbc,0x80,1,0x66])],
  ]) {
    const bytes=edit(createWonderSwanVgm({seconds:.1, loop:false}));
    // Preserve the declared end for complete deliberately unsupported streams.
    if (name !== 'truncated') new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(4,bytes.length-4,true);
    const result=await prepareVgmImport(file(bytes));
    assert.equal(result.detection.supported,false,name); assert.ok(result.detection.message,name);
  }
});
