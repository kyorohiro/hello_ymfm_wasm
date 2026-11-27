import {writePerformanceCommand} from './pcm-performance.js';
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';

class OkiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new Oki6295AudioEngine({clock:0x80000000 + 1000000, outputSampleRate:sampleRate});
    this.port.onmessage = ({data}) => {
      if (data.rom) {
        if (!data.extended) this.chip.reset();
        this.chip.loadOki6295Rom(data.rom);
      } else if (data.voiceMutes) {
        data.voiceMutes.forEach((muted,i) => this.chip.setVoiceMuted(i,muted));
      } else if('codeAttenuation' in data || 'codeSamples' in data){
        if('codeAttenuation' in data)this.codeAttenuation=data.codeAttenuation;
        if('codeSamples' in data)this.codeSamples=data.codeSamples;
      } else if(data.code){
        const commands=data.commands.map(byte=>writePerformanceCommand(this.chip,byte,this.codeSamples,this.codeAttenuation));
        this.port.postMessage({commands});
      } else for(const byte of data.commands)this.chip.writeOki6295(0,byte);
      this.report(true);
    };
  }
  report(afterCommand=false) {
    const status = this.chip.readStatus();
    if (status !== this.status || (afterCommand && this.chip.voices.some((v,i)=>v.sample!==this.samples?.[i]))) {
      this.status = status;
      this.samples=this.chip.voices.map(voice=>voice.sample);
      this.port.postMessage({status,samples:this.samples});
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
