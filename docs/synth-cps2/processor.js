// SPDX-License-Identifier: BSD-3-Clause
import {QSoundPcm} from '../js/qsoundpcm.js';
import {demoRom, demoScore, adpcmScore} from './demo.js';

class Cps2Preview extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new QSoundPcm(demoRom(), sampleRate);
    this.events = [];
    this.index = 0;
    this.frame = 0;
    this.port.onmessage = ({data}) => {
      if (data === 'demo' || data === 'adpcm' || data === 'stop') {
        this.chip = new QSoundPcm(this.chip.rom, sampleRate);
        this.events = (data === 'stop' ? [] : data === 'adpcm' ? adpcmScore() : demoScore()).map(e=>({...e,frame:Math.round(e.t*sampleRate/44100)}));
        this.frame = this.index = 0;
      } else this.apply(data);
    };
  }
  apply(writes) {
    for (const [reg,value] of writes) this.chip.writeRegister(reg,value);
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
