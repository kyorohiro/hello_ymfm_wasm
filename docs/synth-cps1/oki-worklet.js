import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';

class OkiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new Oki6295AudioEngine({clock:0x80000000 + 1000000, outputSampleRate:sampleRate});
    this.port.onmessage = ({data}) => {
      if (data.rom) {
        this.chip.reset();
        this.chip.loadOki6295Rom(data.rom);
      } else if (data.voiceMutes) {
        data.voiceMutes.forEach((muted,i) => this.chip.setVoiceMuted(i,muted));
      } else for (const byte of data.commands) this.chip.writeOki6295(0,byte);
      this.report();
    };
  }
  report() {
    const status = this.chip.readStatus();
    if (status !== this.status) {
      this.status = status;
      this.port.postMessage(status);
    }
  }
  process(inputs,outputs) {
    const [left,right] = outputs[0];
    const pcm = this.chip.processFrames(left.length);
    left.set(pcm.left); right.set(pcm.right);
    this.report();
    return true;
  }
}
registerProcessor('cps1-oki',OkiProcessor);
