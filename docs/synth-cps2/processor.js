// SPDX-License-Identifier: BSD-3-Clause
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoRom, demoTracks} from './demo.js';

class Cps2Preview extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new QSoundPcm(demoRom(), sampleRate);
    this.starts = new Uint16Array(16);
    this.events = [];
    this.index = 0;
    this.frame = 0;
    this.port.onmessage = ({data}) => {
      if (data?.type === 'echo-delay') {
        this.chip.writeRegister(0xd9,this.chip.echoBase + data.ticks);
        return;
      }
      if (data?.type === 'inspect') {
        const v = this.chip.voices[data.channel];
        this.port.postMessage({...data,address:v.address & 65535,rate:v.rate,end:v.end,loop:v.loop,
          send:v.echoSend,feedback:this.chip.echoFeedback,delay:this.chip.echoEnd-this.chip.echoBase,
          active:v.volume !== 0,finished:this.index === this.events.length,start:this.starts[data.channel]});
        return;
      }
      if (typeof data === 'string' && (data === 'stop' || Object.hasOwn(demoTracks,data))) {
        this.chip = new QSoundPcm(this.chip.rom, sampleRate);
        this.events = (data === 'stop' ? [] : demoTracks[data].score()).map(e=>({...e,frame:Math.round(e.t*sampleRate/44100)}));
        this.starts.fill(0);
        this.frame = this.index = 0;
      } else this.apply(data);
    };
  }
  apply(writes) {
    for (const [reg,value] of writes) {
      if (reg < 0x80 && (reg & 7) === 1) this.starts[reg >> 3] = value;
      this.chip.writeRegister(reg,value);
    }
  }
  process(_, outputs) {
    const [left,right] = outputs[0];
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
