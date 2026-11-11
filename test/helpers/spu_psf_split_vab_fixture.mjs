// SPDX-License-Identifier: BSD-3-Clause
// Original separated VH/VB fixture, including a one-shot LOOP START.
import {createVabFixture} from './spu_vab_fixture.mjs';
import {makePsf,psfFile} from './spu_psf_fixture.mjs';
import {readVab} from '../../docs/playground/playground_ps1_vab.js';

export function createPsfSplitVabFixture({duplicateBody=false,missingBody=false,
  headerAddress=0x10000,bodyAddress=0x30000,coverGap=true}={}) {
  const original=createVabFixture(),vh=original.vh.slice(),vb=new Uint8Array(112);
  const view=new DataView(vh.buffer);
  // A 16-byte reservation followed by two exact samples, without END padding.
  view.setUint32(12,vh.length+vb.length,true);
  view.setUint16(0xc22,8,true);view.setUint16(0xc24,4,true);
  vb.set(original.vb.subarray(16,80),16);
  vb[80]=4;vb[81]=4;vb.fill(0x23,82,96);
  vb[96]=4;vb[97]=1;vb.fill(0x12,98,112);
  const duplicateAddress=bodyAddress+0x10000;
  const start=Math.min(headerAddress,bodyAddress);
  const finish=missingBody?headerAddress+vh.length:Math.max(headerAddress+vh.length,(duplicateBody?duplicateAddress:bodyAddress)+vb.length);
  const data=new Uint8Array(finish-start);data.set(vh,headerAddress-start);
  if(!missingBody){data.set(vb,bodyAddress-start);if(duplicateBody)data.set(vb,duplicateAddress-start);}
  const psf=makePsf(data,0x80000000+start,'title=Original split VAB fixture\n');
  let files=[psfFile('split.psf',psf)];
  if(!coverGap&&!missingBody) {
    files=[psfFile('split.psf',makePsf(vh,0x80000000+headerAddress,'_lib=body.psflib\ntitle=Original sparse split VAB fixture\n')),
      psfFile('body.psflib',makePsf(vb,0x80000000+bodyAddress))];
    if(duplicateBody)throw new Error('Sparse fixture duplication is not needed by this helper');
  }
  const vab=new Uint8Array(vh.length+vb.length);vab.set(vh);vab.set(vb,vh.length);
  return {vh,vb,vab,psf,files,headerAddress,bodyAddress,duplicateAddress,bank:readVab(vh,vb)};
}
