// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {QSOUND_PCM_RATE} from '../js/qsoundpcm.js';

export function inspectSong(bytes) {
  const parser=new Ym2612VGM(bytes);
  const clock=parser.header.qsoundClock;
  if (!clock || clock>8000000 || Object.entries(parser.header).some(([key,value])=>key.endsWith('Clock') && key!=='qsoundClock' && value))
    throw Error('Choose a single-chip QSound VGM.');
  let ticks=0,rom=false,loopStart=null;
  while (!parser.ended) {
    const pos=parser.position,cmd=bytes[pos];
    if (pos===parser.header.loopOffset) loopStart=ticks;
    if (!(cmd===0xc4 || (cmd===0x67 && bytes[pos+2]===0x8f) || [0x61,0x62,0x63,0x66].includes(cmd) || (cmd>=0x70 && cmd<=0x7f)))
      throw Error('Unsupported QSound VGM command at '+pos);
    const event=parser.step();
    if (event.type==='wait') ticks+=event.samples;
    if (event.type==='qsound-rom-data' && event.data.length) rom=true;
  }
  if (!rom || !ticks) throw Error('The song needs embedded QSound ROM data and playback time.');
  const canLoop=loopStart!==null && loopStart<ticks;
  return {ticks,canLoop,loopTick:canLoop?loopStart:null};
}

export function applyRomBlock(rom,event){
  if(rom.length!==event.memorySize)rom=new Uint8Array(event.memorySize);
  rom.set(event.data,event.offset);
  return rom;
}

// Reads the validated stream incrementally. Use absolute VGM ticks so that
// resampling thousands of short waits does not accumulate rounding error.
export class SongTransport {
  constructor(bytes,chip,starts) {
    this.parser=new Ym2612VGM(bytes);
    this.chip=chip;
    chip.tickRate=QSOUND_PCM_RATE*this.parser.header.qsoundClock/4000000;
    this.starts=starts;
    this.frames=this.ticks=this.nextFrame=0;
    this.paused=false;
    this.loop=false;this.looped=false;
    this.loopStart=null;
  }
  restore(state) {
    const {chip,starts,position,ended,frames,ticks,nextFrame,loopStart}=state;
    Object.assign(this.chip,chip);
    this.starts.set(starts);
    Object.assign(this,{frames,ticks,nextFrame,loopStart});
    Object.assign(this.parser,{position,ended});
  }
  applyDueEvents(holdEnd=false) {
    while (!this.parser.ended && this.frames>=this.nextFrame) {
      if(holdEnd && this.parser.bytes[this.parser.position]===0x66)break;
      if(this.parser.position===this.parser.header.loopOffset)this.loopStart=this.ticks;
      const e=this.parser.step();
      if(e.type==='end' && this.loop && this.loopStart!==null && this.ticks>this.loopStart){
        this.looped=true;this.parser.position=this.parser.header.loopOffset;
        this.parser.ended=false;
      }
      if(e.type==='wait'){
        this.ticks+=e.samples;
        this.nextFrame=Math.round(this.ticks*this.chip.sampleRate/44100);
      } else if(e.type==='qsound-write'){
        this.chip.writeRegister(e.register,e.value);
        if(e.register<128 && (e.register&7)===1)this.starts[e.register>>3]=e.value;
      } else if(e.type==='qsound-rom-data'){
        this.chip.rom=applyRomBlock(this.chip.rom,e);
      }
    }
  }
  render(left,right) {
    let offset=0;
    while (!this.paused && offset<left.length && !this.parser.ended) {
      this.applyDueEvents();
      if(this.parser.ended)break;
      const n=Math.min(left.length-offset,this.nextFrame-this.frames);
      this.chip.render(left.subarray(offset,offset+n),right.subarray(offset,offset+n));
      offset+=n;this.frames+=n;
    }
    left.fill(0,offset);right.fill(0,offset);
  }
}
