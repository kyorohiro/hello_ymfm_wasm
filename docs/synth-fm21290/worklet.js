// SPDX-License-Identifier: BSD-3-Clause
import {Fm21290} from './chip.js';

class FmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new Fm21290(sampleRate);
    this.port.onmessage = ({data}) => {
      try {
        if (data.reset) this.chip = new Fm21290(sampleRate);
        else for (const [address,value] of data.writes) this.chip.writeRegister(address,value);
      } catch (error) { this.port.postMessage({error:error.message}); }
    };
  }
  process(_, outputs) {
    this.chip.renderInto(outputs[0][0]);
    if (this.chip.frame % 4096 < outputs[0][0].length)
      this.port.postMessage({slots:this.chip.voices.map(v=>v.held?2:Number(v.active))});
    return true;
  }
}
registerProcessor('tetorica-fm21290', FmProcessor);
