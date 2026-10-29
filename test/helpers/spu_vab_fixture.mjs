// SPDX-License-Identifier: BSD-3-Clause
// Original synthetic Sony-format bank. No game data or external recordings.
import {createPs1InitSample} from '../../web/ps1synth.js';

export function createVabFixture() {
  const vh = new Uint8Array(0xe20), vb = new Uint8Array(128);
  const view = new DataView(vh.buffer);
  const word = (at, value) => view.setUint16(at, value, true);
  const long = (at, value) => view.setUint32(at, value, true);
  vh.set([0x70,0x42,0x41,0x56]); long(4,7); long(8,23); long(12,vh.length+vb.length);
  word(0x12,2); word(0x14,3); word(0x16,2); vh[0x18]=127; vh[0x19]=64;
  // Sparse program IDs: 3 and 11. Packed tone tables at 0x820 and 0xa20.
  for (const [index, count] of [[3,2],[11,1]]) {
    const at=0x20+index*16; vh[at]=count; vh[at+1]=127; vh[at+4]=64;
  }
  for (const [at, program, sample, center, shift] of [[0x820,3,1,60,0],[0x840,3,1,60,64],[0xa20,11,2,69,0]]) {
    vh[at+2]=100; vh[at+3]=64; vh[at+4]=center; vh[at+5]=shift; vh[at+6]=24; vh[at+7]=96;
    word(at+16,15); word(at+18,0); word(at+20,program); word(at+22,sample);
  }
  word(0xc20,2); // 16-byte body prefix.
  word(0xc22,10); // sample 1: 64 audible bytes plus 16 bytes after END.
  word(0xc24,4); // sample 2: one packet plus padding.
  vb.set(createPs1InitSample().adpcm,16);
  vb[96]=4; vb[97]=1; vb.fill(0x23,98,112);
  const vab=new Uint8Array(vh.length+vb.length); vab.set(vh); vab.set(vb,vh.length);
  return {vh,vb,vab};
}
