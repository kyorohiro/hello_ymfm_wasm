// SPDX-License-Identifier: BSD-3-Clause
import {Fm21290} from './chip.js';

import {ModulatedChip} from './modulation.js';

class FmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.reset();
    this.port.onmessage = ({data}) => {
      try {
        if (data.reset) this.reset();
        else if (data.lfo) this.controller.configure(data.lfo);
        else if (data.keyOn) this.controller.keyOn();
        else if (data.bend !== undefined) this.controller.setBend(data.bend);
        else for (const [address,value] of data.writes) this.chip.writeRegister(address,value);
      } catch (error) { this.port.postMessage({error:error.message}); }
    };
  }
  reset() {
    this.chip = new Fm21290(sampleRate);
    this.controller = new ModulatedChip(this.chip);
  }
  process(_, outputs) {
    this.controller.renderInto(outputs[0][0]);
    if (this.chip.frame % 4096 < outputs[0][0].length)
      this.port.postMessage({modulation:[this.chip.reg[0xf0],this.chip.reg[0xf2],this.chip.reg[0xf3]],slots:this.chip.voices.map(v=>v.held?2:Number(v.active))});
    return true;
  }
}
registerProcessor('tetorica-fm21290', FmProcessor);
