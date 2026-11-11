// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Original executable PSF fixture. No game driver, recording or BIOS data.
import {psfFromExe, psfFile} from './spu_psf_fixture.mjs';
import {PS1_REVERB_PRESETS} from '../../tetorica_src/runtime/ps1_parameters.js';

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

/**
 * A second, original R3000 program exercises the CPU/SPU bus, not an audio
 * fixture copied from a game. All sample bytes and executed instructions are
 * authored here. The DMA variant verifies all 64 uploaded/read-back bytes in
 * the CPU before it will key a voice on; a broken DMA path remains silent.
 *
 * The final optional steps are CPU-authored register changes after busy waits.
 * A bus trace records their actual native frame, allowing a sample-exact
 * replay through the ordinary standalone SPU without estimating CPU timing.
 */
export function createPsfSpuFeatureFixture({
  transfer='pio', pitch=0x1000, mainLeft=0x3fff, mainRight=0x3fff,
  noise=false, noiseClock=40, pmon=false, pair=pmon, carrier=pair?1:0, modulatorPitch=0x1800,
  reverb=false, returnLeft=0x2000, returnRight=0x1000, oneShot=false,
  irq=false, irqLifecycle=false, byteBus=false, dmaWriteControl=0x01000201, steps=[],
}={}) {
  if(!['pio','stopped-pio','dma-roundtrip'].includes(transfer))throw new RangeError('Unknown fixture transfer');
  if(!Number.isInteger(carrier)||carrier<0||carrier>23||pair&&carrier===0)throw new RangeError('Invalid fixture PMON carrier');
  if(!Number.isInteger(noiseClock)||noiseClock<0||noiseClock>63)throw new RangeError('Invalid fixture noise clock');
  const words=[],labels=new Map(),branches=[],registerWrites=[];
  const emit=value=>words.push(value>>>0);
  const lui=(rt,value)=>emit((0x0f<<26)|(rt<<16)|(value&0xffff));
  const ori=(rt,rs,value)=>emit((0x0d<<26)|(rs<<21)|(rt<<16)|(value&0xffff));
  const and=(rd,rs,rt)=>emit((rs<<21)|(rt<<16)|(rd<<11)|0x24);
  const addiu=(rt,rs,value)=>emit((0x09<<26)|(rs<<21)|(rt<<16)|(value&0xffff));
  const mem=(op,rt,base,offset)=>emit((op<<26)|(base<<21)|(rt<<16)|(offset&0xffff));
  const li=(rt,value)=>{lui(rt,value>>>16);ori(rt,rt,value);};
  const label=name=>labels.set(name,words.length);
  const branch=(op,rs,rt,target)=>{branches.push({at:words.length,target});emit((op<<26)|(rs<<21)|(rt<<16));emit(0);};
  const write=(offset,value)=>{
    if(!Number.isInteger(offset)||offset<0||offset>0x3fe||(offset&1)||!Number.isInteger(value)||value<0||value>0xffff)
      throw new RangeError('Invalid fixture register write');
    registerWrites.push([offset,value]);ori(9,0,value);mem(0x29,9,8,offset);
  };
  let waits=0;
  const wait=iterations=>{
    if(!Number.isInteger(iterations)||iterations<1||iterations>0xffff)throw new RangeError('Invalid fixture busy wait');
    const name=`wait-${waits++}`;ori(10,0,iterations);label(name);addiu(10,10,-1);branch(0x05,10,0,name);
  };
  const cpuSourceAddress=0x18000,cpuReadbackAddress=0x19000,mailboxAddress=0x1a000;
  const adpcm=playbackAdpcm();
  if(oneShot){adpcm[1]=4;adpcm[49]=1;}
  const pcmView=new DataView(adpcm.buffer);
  li(8,0x1f801c00); // t0 = SPU register base
  write(0x1ac,4);
  if(transfer!=='dma-roundtrip') {
    write(0x1aa,transfer==='stopped-pio'?0xc000:0xc010);write(0x1a6,PSF_FIXTURE_SPU_ADDRESS/8);
    for(let index=0;index<adpcm.length;index+=2)write(0x1a8,pcmView.getUint16(index,true));
    if(transfer==='stopped-pio'){wait(65535);write(0x1aa,0xc010);}
    else wait(4096);
  } else {
    li(11,0x1f801000); // DMAC register page
    const dmaWrite=(offset,value)=>{li(9,value);mem(0x2b,9,11,offset);};
    dmaWrite(0xf0,0x00090000); // enable DMA4, priority 1
    const dma=(read,physicalAddress)=>{
      write(0x1aa,read?0xc030:0xc020);write(0x1a6,PSF_FIXTURE_SPU_ADDRESS/8);
      dmaWrite(0xc0,physicalAddress);dmaWrite(0xc4,0x00010010);dmaWrite(0xc8,read?0x01000200:dmaWriteControl);
      const name=read?'dma-read-wait':'dma-write-wait';li(12,0x01000000);
      label(name);mem(0x23,9,11,0xc8);emit(0);and(9,9,12);branch(0x05,9,0,name);
    };
    dma(false,cpuSourceAddress);dma(true,cpuReadbackAddress);
    li(12,0x80000000+cpuSourceAddress);li(13,0x80000000+cpuReadbackAddress);
    for(let offset=0;offset<adpcm.length;offset+=4) {
      mem(0x23,14,12,offset);mem(0x23,15,13,offset);emit(0);branch(0x05,14,15,'failed');
    }
  }
  const control=0xc000|(noiseClock<<8)|(reverb?0x80:0)|(irq?0x40:0);
  write(0x1aa,control);
  // SW/LW must preserve both adjacent 16-bit SPU registers, not truncate the
  // upper half as the historical Play! memory-map shortcut did.
  registerWrites.push([0x180,mainLeft],[0x182,mainRight]);
  li(9,((mainRight<<16)|mainLeft)>>>0);mem(0x2b,9,8,0x180);
  mem(0x23,9,8,0x180);emit(0);li(12,0x80000000+mailboxAddress);mem(0x2b,9,12,4);
  if(byteBus) {
    // PS1's 16-bit SPU bus has unusual SB semantics: an even SB writes the
    // CPU source register's complete low halfword, while an odd SB is ignored.
    // Ordinary CPU RAM still receives only the low byte of that same register.
    li(9,0x12345678);mem(0x28,9,8,0x180);registerWrites.push([0x180,0x5678]);
    mem(0x28,9,8,0x183);mem(0x28,9,12,40);
    for(const [address,destination,operation] of [[0x180,24,0x24],[0x181,28,0x24],[0x182,32,0x25],[0x180,36,0x23]]) {
      mem(operation,9,8,address);emit(0);mem(0x2b,9,12,destination);
    }
  }
  write(0x184,reverb?returnLeft:0);write(0x186,reverb?returnRight:0);
  const mask=(offset,value)=>{write(offset,value&0xffff);write(offset+2,(value>>>16)&0xff);};
  mask(0x190,pmon?2**carrier:0);mask(0x194,noise?2**carrier:0);mask(0x198,reverb?2**carrier:0);
  if(reverb) {
    const room=PS1_REVERB_PRESETS.find(preset=>preset.id==='room');
    room.registers.forEach((value,index)=>write(0x1c0+index*2,value));
  }
  const voice=(channel,left,right,rate)=>{
    const offset=channel*16;
    for(const [at,value] of [[0,left],[2,right],[4,rate],[6,PSF_FIXTURE_SPU_ADDRESS/8],
      [8,0x000f],[10,0x1fc0],[14,PSF_FIXTURE_SPU_ADDRESS/8]])write(offset+at,value);
  };
  if(pair)voice(carrier-1,0,0,modulatorPitch);
  voice(carrier,0x2000,0x1000,pitch);
  if(irq)write(0x1a4,PSF_FIXTURE_SPU_ADDRESS/8);
  mask(0x188,2**carrier|(pair?2**(carrier-1):0));
  for(const step of steps){wait(step.delay??4096);for(const [offset,value] of step.writes)write(offset,value);}
  if(irq) {
    li(11,0x1f801070);li(12,0x80000000+mailboxAddress);
    if(irqLifecycle) {
      const observe=offset=>{mem(0x23,9,11,0);emit(0);mem(0x2b,9,12,offset);};
      // Include at least one complete 112-sample loop: the fixed core may
      // report a start-address IRQ when playback reaches its loop boundary.
      wait(65535);observe(0);
      mem(0x25,9,8,0x1ae);emit(0);mem(0x2b,9,12,8); // initial SPUSTAT
      write(0x1aa,control&~0x40);observe(12); // deassert SPU, keep CPU latch
      mem(0x25,9,8,0x1ae);emit(0);mem(0x2b,9,12,16);
      mem(0x2b,0,11,0);observe(20); // CPU acknowledges its own I_STAT
      label('irq-finished');branch(0x04,0,0,'irq-finished');
    } else {
      label('irq-observe');mem(0x23,9,11,0);emit(0);mem(0x2b,9,12,0);branch(0x04,0,0,'irq-observe');
    }
  } else {label('hold');branch(0x04,0,0,'hold');}
  label('failed');branch(0x04,0,0,'failed');
  for(const {at,target} of branches) {
    const displacement=labels.get(target)-(at+1);
    if(!Number.isInteger(displacement)||displacement< -32768||displacement>32767)throw new Error('Fixture branch out of range');
    words[at]=(words[at]|(displacement&0xffff))>>>0;
  }
  // Include a CPU RAM source for DMA. Its zero-filled gap is also original data.
  const text=new Uint8Array(transfer==='dma-roundtrip'?cpuSourceAddress-(PSF_FIXTURE_PC&0x1fffffff)+adpcm.length:words.length*4);
  if(words.length*4>text.length)throw new Error('Fixture code overlaps sample data');
  const view=new DataView(text.buffer);words.forEach((word,index)=>view.setUint32(index*4,word,true));
  if(transfer==='dma-roundtrip')text.set(adpcm,cpuSourceAddress-(PSF_FIXTURE_PC&0x1fffffff));
  const exe=playbackExe(text),standalone=psfFromExe(exe,'title=Tetorica original SPU bus conformance\nartist=Tetorica\nlength=0:04\nfade=0:00\n');
  return {exe,text,adpcm,standalone,registerWrites,cpuSourceAddress,cpuReadbackAddress,mailboxAddress,
    standaloneFiles:[psfFile('spu-conformance.psf',standalone)]};
}
