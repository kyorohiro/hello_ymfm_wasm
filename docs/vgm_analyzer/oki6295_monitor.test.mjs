// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOki6295Cursor} from './oki6295_monitor.js';

import {bankedSong} from '../../scripts/fixtures/oki6295_banked_vgm.mjs';
test('accepted starts retain the sample, attenuation and original ROM across bank switches and overwrites',()=>{
  const c = createOki6295Cursor(bankedSong());
  c.seek(0);
  const first = c.hits[0];
  assert.equal(first.bytes()[0], 0x33);
  c.seek(4410);
  assert.equal(c.hits[0],first); // Busy voice ignored simultaneous retrigger.
  const second = c.hits[1];
  assert.deepEqual([first.sample,second.sample,second.attenuation,second.address],[0,0,2,0x40400]);
  c.seek(48510);
  assert.equal(first.bytes()[0],0x33);
  assert.equal(second.bytes()[0],0xbb);
  assert.equal(c.chip.voices[1].playing,false);
});
