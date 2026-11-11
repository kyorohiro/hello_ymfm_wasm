// SPDX-License-Identifier: BSD-3-Clause
// CPU startup data comes from the primary library; bank extraction stays static.
import {composePsfRam} from '../playground/playground_ps1_psf.js?v=psf-split-vab-1';

export async function preparePsfSongSource(set,entry,{signal}={}) {
  const image=await composePsfRam(set,entry,{signal});
  signal?.throwIfAborted();
  const {pc,gp,sp}=image.registers??{},physical=pc&0x1fffffff,offset=physical&0x1fffff;
  const ramAlias=pc<0x800000||(pc>=0x80000000&&pc<0x80800000)||(pc>=0xa0000000&&pc<0xa0800000);
  if(!Number.isInteger(pc)||!ramAlias||physical>=0x800000||(pc&3)||offset>0x1ffffc||!image.coverage.subarray(offset,offset+4).every(value=>value===1)) {
    throw new Error('PSF song has no valid loaded entry point. A VAB extraction demo is not an executable song.');
  }
  return {ram:image.ram,coverage:image.coverage,pc,gp,sp:sp||0x801fff00,refresh:image.refresh,loadedFiles:image.loadedFiles};
}
