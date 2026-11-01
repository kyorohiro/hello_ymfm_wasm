// SPDX-License-Identifier: BSD-3-Clause
// Original synthetic ADPCM/VAB, no game data or recordings.
import {createVabFixture} from './spu_vab_fixture.mjs';

export function createLoopRepeatFixture({loopBlock=2,marker=true,repeatBit=false}={}) {
  if(!Number.isInteger(loopBlock)||loopBlock<0||loopBlock>2)throw new RangeError('loopBlock0..2');
  const blocks=loopBlock+4,adpcm=new Uint8Array(blocks*16);
  for(let block=0;block<blocks;block++) {
    const at=block*16;adpcm[at]=1; // Filter0, shift1: no predictive-history ambiguity.
    adpcm[at+1]=block===loopBlock?(marker?4:0)|(repeatBit?2:0):0;
    if(block===blocks-1)adpcm[at+1]|=3;
    for(let i=0;i<28;i++) {
      const value=block<loopBlock?3:Math.round(7*Math.sin(2*Math.PI*((block-loopBlock)*28+i)/112));
      adpcm[at+2+(i>>1)]|=(value&15)<<((i&1)*4);
    }
  }
  return {adpcm,loopStartSamples:loopBlock*28,baseFrequencyHz:440*2**((60-69)/12),
    preset:{volumeLeft:.75,volumeRight:.5,adsr1:15,adsr2:0,pitch:4096,reverb:false}};
}

export function createLoopRepeatVabFixture(options={}) {
  const sample=createLoopRepeatFixture(options),vh=createVabFixture().vh.slice();
  const sampleBytes=sample.adpcm.length+16,vb=new Uint8Array(16+sampleBytes+32),view=new DataView(vh.buffer);
  view.setUint32(12,vh.length+vb.length,true);view.setUint16(0xc22,sampleBytes/8,true);
  vb.set(sample.adpcm,16);vb[16+sampleBytes]=4;vb[17+sampleBytes]=1;vb.fill(0x23,18+sampleBytes,32+sampleBytes);
  const vab=new Uint8Array(vh.length+vb.length);vab.set(vh);vab.set(vb,vh.length);
  return {...sample,vh,vb,vab};
}
