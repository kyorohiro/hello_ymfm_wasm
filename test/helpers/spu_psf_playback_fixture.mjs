// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Original executable PSF fixture. No game driver, recording or BIOS data.
import {psfFromExe, psfFile} from './spu_psf_fixture.mjs';

export const PSF_FIXTURE_PC = 0x80010000;
export const PSF_FIXTURE_SPU_ADDRESS = 0x2000;

/** A PS-X EXE loading one text overlay, with explicit CPU entry registers. */
export function playbackExe(text, address=PSF_FIXTURE_PC) {
  const exe=new Uint8Array(0x800+text.length), view=new DataView(exe.buffer);
  exe.set(new TextEncoder().encode('PS-X EXE'));
  view.setUint32(0x10,PSF_FIXTURE_PC,true);
  view.setUint32(0x14,0x80020000,true);
  view.setUint32(0x18,address,true);
  view.setUint32(0x1c,text.length,true);
  view.setUint32(0x30,0x801fff00,true);
  exe.set(text,0x800);
  return exe;
}

/** Four predictor-zero ADPCM blocks; a smooth 112-sample repeating cycle. */
export function playbackAdpcm() {
  const data=new Uint8Array(64);
  for(let block=0;block<4;block++) {
    data[block*16]=2; // predictor 0, shift 2
    data[block*16+1]=block===0?6:block===3?3:0;
    for(let pair=0;pair<14;pair++) {
      const index=block*28+pair*2;
      const nibble=n=>Math.round(7*Math.sin(2*Math.PI*n/112))&15;
      data[block*16+pair+2]=nibble(index)|(nibble(index+1)<<4);
    }
  }
  return data;
}

/**
 * A small R3000 program writes the SPU data port and channel registers, keys
 * voice 0 on, then holds it. It needs no BIOS calls or external library code.
 * The MiniPSF replaces only the initial pitch instruction in its library.
 */
export function createPsfPlaybackFixture({pitch=0x1000,miniPitch=0x1400}={}) {
  for(const value of [pitch,miniPitch])if(!Number.isInteger(value)||value<1||value>0x3fff)throw new RangeError('Fixture pitch must be 1–0x3fff');
  const words=[];
  const emit=value=>words.push(value>>>0);
  const lui=(rt,value)=>emit((0x0f<<26)|(rt<<16)|(value&0xffff));
  const ori=(rt,rs,value)=>emit((0x0d<<26)|(rs<<21)|(rt<<16)|(value&0xffff));
  const sh=(rt,base,offset)=>emit((0x29<<26)|(base<<21)|(rt<<16)|(offset&0xffff));
  const write=(offset,value)=>{ori(9,0,value);sh(9,8,offset);};
  lui(8,0x1f80);ori(8,8,0x1c00); // t0 = SPU register base
  write(0x1aa,0xc010); // SPU enabled, unmuted, manual transfer
  write(0x1ac,4);      // regular transfer control
  write(0x1a6,PSF_FIXTURE_SPU_ADDRESS/8);
  const adpcm=playbackAdpcm(), pcmView=new DataView(adpcm.buffer);
  for(let index=0;index<adpcm.length;index+=2)write(0x1a8,pcmView.getUint16(index,true));
  // Allow manual FIFO transfer to complete before leaving transfer mode.
  ori(10,0,4096);
  emit((0x09<<26)|(10<<21)|(10<<16)|0xffff); // addiu t2,t2,-1
  emit((0x05<<26)|(10<<21)|0xfffe);         // bne t2,zero,-2
  emit(0);                                // branch delay slot
  write(0x1aa,0xc000);
  write(0x180,0x3fff);write(0x182,0x3fff); // master L/R
  write(0x184,0);write(0x186,0);           // reverb return off
  write(0x190,0);write(0x192,0);           // PMON off
  write(0x194,0);write(0x196,0);           // noise off
  write(0x198,0);write(0x19a,0);           // reverb send off
  write(0x000,0x2000);write(0x002,0x1000); // distinguishable stereo
  const pitchInstruction=words.length*4;
  write(0x004,pitch);
  write(0x006,PSF_FIXTURE_SPU_ADDRESS/8);
  write(0x008,0x000f);write(0x00a,0x1fc0); // fast attack, held sustain
  write(0x00e,PSF_FIXTURE_SPU_ADDRESS/8);
  write(0x188,1);                          // key on CH1
  emit(0x1000ffff);emit(0);                // beq zero,zero,-1; nop
  const text=new Uint8Array(words.length*4), view=new DataView(text.buffer);
  words.forEach((word,index)=>view.setUint32(index*4,word,true));
  const exe=playbackExe(text);
  const tags='title=Tetorica original PSF test\nartist=Tetorica\nlength=0:04\nfade=0:00\n';
  const standalone=psfFromExe(exe,tags);
  const library=psfFromExe(exe,'title=Tetorica original playback library\n');
  const patch=new Uint8Array(4);
  new DataView(patch.buffer).setUint32(0,(0x0d<<26)|(9<<16)|miniPitch,true);
  const miniExe=playbackExe(patch,(PSF_FIXTURE_PC+pitchInstruction)>>>0);
  const mini=psfFromExe(miniExe,`_lib=lib/driver.psflib\n${tags}`);
  return {exe,text,adpcm,standalone,library,mini,pitchInstruction,
    standaloneFiles:[psfFile('standalone.psf',standalone)],
    files:[psfFile('track.minipsf',mini,'Demo/track.minipsf'),psfFile('driver.psflib',library,'Demo/lib/driver.psflib')]};
}
