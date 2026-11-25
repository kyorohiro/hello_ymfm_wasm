// SPDX-License-Identifier: BSD-3-Clause
import {Fm21290} from './chip.js';

import {ModulatedChip} from './modulation.js';

import {createTrace,maxEvents,TracePlayer} from './register_trace.js';

class ObservableChip extends Fm21290 {
  constructor(rate,onWrite){super(rate);this.onWrite=onWrite;}
  writeRegister(address,value){
    super.writeRegister(address,value);
    this.onWrite(address,value);
  }
}

class FmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inspectCh=0;
    this.reset();
    this.port.onmessage = ({data}) => {
      try {
        if(data.record){
          this.recording=null;
          this.reset();
          this.base=0;
          this.recording=createTrace(sampleRate);
        }else if(data.endRecord)this.finishRecording();
        else if(data.replay)this.player=new TracePlayer(data.replay,sampleRate);
        else if(data.endReplay)this.stopReplay();
        else if(data.inspectCh!==undefined)this.inspectCh=data.inspectCh;
        else if (data.reset) this.reset();
        else if (data.lfo) {
          this.controller.configure(data.lfo);
          this.controller.pitchEnvelope.configure(data.pitchEnvelope);
        }
        else if (data.bend !== undefined) this.controller.setBend(data.bend);
        else for (const command of data.writes) {
          if (Array.isArray(command)) this.chip.writeRegister(...command);
          else if (command.keyOn !== undefined) this.controller.keyOn(command.keyOn,command.basePitch);
          else this.controller.pitchEnvelope.keyOff(command.keyOff);
        }
      } catch (error) { this.port.postMessage({error:error.message}); }
    };
  }
  stopReplay(){
    if(this.player){this.player=null;this.port.postMessage({replayDone:true});}
  }
  finishRecording(full=false){
    if(!this.recording)return;
    this.recording.frames=this.base+this.chip.frame;
    this.port.postMessage({recorded:this.recording,full});
    this.recording=null;
  }
  append(event){
    if(this.recording.events.length===maxEvents)this.finishRecording(true);
    else this.recording.events.push(event);
  }
  reset() {
    this.stopReplay();
    if(this.recording){
      const frame=this.base+this.chip.frame;
      this.append([frame]);
      this.base=frame;
    }
    this.chip = new ObservableChip(sampleRate,(address,value)=>{
      if(this.recording)this.append([this.base+this.chip.frame,address,value]);
    });
    this.controller = new ModulatedChip(this.chip);
  }
  process(_, outputs) {
    this.controller.renderInto(outputs[0][0]);
    const player=this.player;
    if(player && player.renderInto(outputs[0][0]))this.stopReplay();
    if (this.chip.frame % 4096 < outputs[0][0].length){
      const shown=player?.chip??this.chip, ch=this.inspectCh, setting=shown.algorithms[ch];
      this.port.postMessage({modulation:[shown.reg[0xf0],shown.reg[0xf2],shown.reg[0xf3]],
        slots:shown.voices.map(v=>v.held?2:Number(v.active)),
        voice:{ch,algorithm:1+(setting>>3),feedback:setting&7,pitch:shown.reg[ch*2]*256+shown.reg[ch*2+1],
          stages:Array.from(shown.voices[ch].stage).reverse().map(n=>n+1),
          levels:Array.from({length:6},(_,i)=>shown.reg[0x80+16*(5-i)+ch])}});
    }
    return true;
  }
}
registerProcessor('tetorica-fm21290', FmProcessor);
