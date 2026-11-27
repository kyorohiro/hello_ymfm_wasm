// SPDX-License-Identifier: BSD-3-Clause
import {SongTransport} from './song.js';
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoRom, demoTracks} from './demo.js';

class Cps2Preview extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new QSoundPcm(demoRom(), sampleRate);
    this.mutes=Array(19).fill(false);
    this.starts = new Uint16Array(16);
    this.events = [];
    this.index = 0;
    this.frame = 0;
    this.port.onmessage = ({data}) => {
      if (data?.type === 'mute-voices') {this.mutes=data.mask;this.applyMutes();return;}
      if (data?.type === 'song') {
        this.chip=new QSoundPcm(new Uint8Array(),sampleRate);
        this.applyMutes();
        this.starts.fill(0);
        this.song=new SongTransport(data.bytes,this.chip,this.starts);
        this.events=[];
        return;
      }
      if (data?.type === 'pause-song') {if(this.song)this.song.paused=data.paused;return;}
      if (data?.type === 'echo-delay') {
        this.chip.writeRegister(0xd9,this.chip.echoBase + data.ticks);
        return;
      }
      if (data?.type === 'inspect') {
        const v = this.chip.voices[data.channel];
        let view;
        if (this.song) {
          const start=this.starts[data.channel], end=v.end & 65535;
          const span=((end-start)&65535)||256;
          const wave=new Uint8Array(256);
          for(let i=0;i<256;i++) wave[i]=this.chip.rom[v.bank*65536+((start+Math.floor(i*span/256))&65535)]??0;
          view={wave,start,span,bank:v.bank,ended:this.song.parser.ended,pan:v.pan,volume:v.volume};
        }
        this.port.postMessage({...data,view,address:v.address & 65535,rate:v.rate,end:v.end,loop:v.loop,
          send:v.echoSend,feedback:this.chip.echoFeedback,delay:this.chip.echoEnd-this.chip.echoBase,
          active:v.volume !== 0,finished:this.index === this.events.length,start:this.starts[data.channel]});
        return;
      }
      if (typeof data === 'string' && (data === 'stop' || Object.hasOwn(demoTracks,data))) {
        this.song=null;
        this.chip = new QSoundPcm(demoRom(), sampleRate);
        this.events = (data === 'stop' ? [] : demoTracks[data].score()).map(e=>({...e,frame:Math.round(e.t*sampleRate/44100)}));
        this.applyMutes();
        this.starts.fill(0);
        this.frame = this.index = 0;
      } else this.apply(data);
    };
  }
  applyMutes() {
    this.mutes.forEach((muted,i)=>this.chip.setChannelMuted(i,muted));
  }
  apply(writes) {
    for (const [reg,value] of writes) {
      if (reg < 0x80 && (reg & 7) === 1) this.starts[reg >> 3] = value;
      this.chip.writeRegister(reg,value);
    }
  }
  process(_, outputs) {
    const [left,right] = outputs[0];
    if(this.song){this.song.render(left,right);return true;}
    let offset = 0;
    while (offset < left.length) {
      const event = this.events[this.index];
      if (event && event.frame <= this.frame) {this.apply(event.writes); this.index++; continue;}
      const count = Math.min(left.length-offset, event ? event.frame-this.frame : Infinity);
      if (offset===0 && count===left.length) this.chip.render(left,right);
      else this.chip.render(left.subarray(offset,offset+count),right.subarray(offset,offset+count));
      offset += count;
      this.frame += count;
    }
    return true;
  }
}
registerProcessor('tetorica-cps2-preview',Cps2Preview);
