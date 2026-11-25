// SPDX-License-Identifier: BSD-3-Clause
import {createRegisterTimedProcessor} from '../js/register_timed_processor.js';
import {timedFormat} from './timed.js';
import {Fm21290,EVENT} from './chip.js';

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
    this.frame=0;
    this.gates=new Map();
    this.reset();
    this.timed=createRegisterTimedProcessor({
      nowFrame:()=>this.frame,sampleRate,defaultOwner:'fm21290:client',
      checkAvailable:()=>{if(this.player)throw Error('Stop register replay before scheduling a phrase');},
      write:(register,value,owner)=>this.writeGate(register,value,owner),
      release:(name,filter)=>this.releaseGates(name,filter),
      reportError:detail=>this.port.postMessage({error:detail.message}),
    },timedFormat);
    this.port.onmessage = ({data}) => {
      try {
        if(data.timed){
          try{this.port.postMessage({timedReply:data.id,value:this.timed.request(data.timed)});}
          catch(error){this.port.postMessage({timedReply:data.id,error:error.message});}
        }else if(data.record){
          this.recording=null;
          this.reset();
          this.base=0;
          this.recording=createTrace(sampleRate);
        }else if(data.endRecord)this.finishRecording();
        else if(data.replay){this.timed.clear();this.player=new TracePlayer(data.replay,sampleRate);}
        else if(data.endReplay)this.stopReplay();
        else if(data.inspectCh!==undefined)this.inspectCh=data.inspectCh;
        else if (data.reset) this.reset();
        else if (data.lfo) {
          this.controller.configure(data.lfo);
          this.controller.pitchEnvelope.configure(data.pitchEnvelope);
        }
        else if(data.modWheel)this.controller.setWheel(data.modWheel);
        else if (data.bend !== undefined) this.controller.setBend(data.bend);
        else for (let i=0;i<data.writes.length;i++) {
          const command=data.writes[i];
          // A late key-up from the keyboard cannot close a newer scheduled gate.
          // Direct EVENT writes still act on the physical slot unconditionally.
          if(Array.isArray(command) && command[0]===EVENT && (command[1]&3)===2){
            const ch=command[1]>>2&15;
            if(data.writes[i+1]?.keyOff===ch && this.gates.has(ch)){i++;continue;}
          }
          if (Array.isArray(command)) this.writeGate(...command);
          else if (command.keyOn !== undefined) this.controller.keyOn(command.keyOn,command.basePitch);
          else this.controller.pitchEnvelope.keyOff(command.keyOff);
        }
      } catch (error) { this.port.postMessage({error:error.message}); }
    };
  }
  writeGate(register,value,owner){
    if(register===EVENT){
      const ch=value>>2&15, gate=value&3, previous=this.gates.get(ch);
      if(gate===1){
        if(owner)this.gates.set(ch,owner);else this.gates.delete(ch);
      }else if(gate===2){
        if(owner && (owner.owner!==previous?.owner || owner.patternName!==previous?.patternName))return;
        this.gates.delete(ch);
      }
    }
    this.chip.writeRegister(register,value);
  }
  releaseGates(name,filter={}){
    let released=false;
    for(const [ch,owner] of this.gates){
      if((name===undefined||name===owner.patternName) &&
          (filter.owner===undefined||filter.owner===owner.owner) &&
          (filter.session===undefined||filter.session===owner.session)){
        this.writeGate(EVENT,ch*4+2,owner);released=true;
      }
    }
    return released;
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
    this.timed?.clear();this.gates.clear();
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
    const buffer=outputs[0][0];
    this.timed.render(buffer.length,(offset,count)=>{
      this.controller.renderInto(offset===0 && count===buffer.length?buffer:buffer.subarray(offset,offset+count));
    });
    this.frame+=buffer.length;
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
