import {createChipTimeline} from './timed-audio.js';
import {writePerformanceCommand} from './pcm-performance.js';
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';

class OkiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new Oki6295AudioEngine({clock:0x80000000 + 1000000, outputSampleRate:sampleRate});
    this.gates=new Map();
    this.commands=[];
    this.timeline=createChipTimeline('msm6295',(_r,v,owner)=>{
      this.commands.push(this.command(v,true,owner));
    },(name,scope)=>{
      const matches=gate=>gate && (name===undefined||gate.patternName===name) && (!scope?.owner||gate.owner===scope.owner);
      if(matches(this.pendingOwner)){this.chip.pending=-1;this.pendingOwner=null;}
      for(const [voice,gate] of this.gates){
        if(matches(gate)){
          this.chip.voices[voice].playing=false;this.chip.voices[voice].output=0;
          this.gates.delete(voice);
        }
      }
    },this.port);
    this.port.onmessage = ({data}) => {
      if(this.timeline.receive(data)){if(data.clearTimeline)this.chip.pending=-1;return;}
      if (data.rom) {
        if (!data.extended) this.chip.reset();
        this.chip.loadOki6295Rom(data.rom);
      } else if (data.voiceMutes) {
        data.voiceMutes.forEach((muted,i) => this.chip.setVoiceMuted(i,muted));
      } else if('codeAttenuation' in data || 'codeSamples' in data){
        if('codeAttenuation' in data)this.codeAttenuation=data.codeAttenuation;
        if('codeSamples' in data)this.codeSamples=data.codeSamples;
      } else if(data.code){
        const commands=data.commands.map(byte=>this.command(byte,true));
        this.port.postMessage({commands});
      } else for(const byte of data.commands)this.command(byte,false);
      this.report(true);
    };
  }
  command(byte,code,owner){
    const before=this.chip.readStatus();
    const result=code?writePerformanceCommand(this.chip,byte,this.codeSamples,this.codeAttenuation):byte;
    if(!code)this.chip.command(byte);
    this.pendingOwner=this.chip.pending>=0?owner:null;
    const after=this.chip.readStatus();
    for(let i=0;i<4;i++)if((before^after)&(1<<i)){
      if(owner && (after&(1<<i)))this.gates.set(i,owner);
      else this.gates.delete(i);
    }
    return result;
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
    this.timeline.render(left.length,(offset,n)=>{
      const pcm=this.chip.processFrames(n);
      left.set(pcm.left,offset);right.set(pcm.right,offset);
    });
    if(this.commands.length){this.port.postMessage({commands:this.commands});this.commands.length=0;}
    this.report();
    return true;
  }
}
registerProcessor('cps1-oki',OkiProcessor);
