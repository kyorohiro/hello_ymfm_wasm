// SPDX-License-Identifier: BSD-3-Clause
import {Ym2151Processor} from '../js/playground_ym2151_worklet.js';
import {createChipTimeline} from './timed-audio.js';

class Cps1FmProcessor extends Ym2151Processor {
  constructor(options){
    super(options);
    this.gates=new Map();
    this.mutes=[];
    this.updates=[];
    this.timeline=createChipTimeline('ym2151',(r,v,owner)=>{
      this.scheduledWrite(r,v);
      if(r===8 && (v&120))this.gates.set(v&7,owner);
    },(name,scope)=>{
      for(const [ch,gate] of this.gates){
        if((name===undefined||gate.patternName===name)&&(!scope?.owner||gate.owner===scope.owner))this.scheduledWrite(8,ch);
      }
    },{postMessage:message=>this.remote?.postMessage(message)});
  }
  scheduledWrite(r,v){
    this.apply({method:'writeRegister',args:[r,r>=32&&r<40&&this.mutes[r-32]?v&63:v]},this.port);
    this.updates.push([r,v]);
  }
  apply(data,...args){
    if(data.method==='writeRegister' && data.args[0]===8)this.gates.delete(data.args[1]&7);
    super.apply(data,...args);
  }
  receive(data,port){
    if(data.fmMutes){this.mutes=data.fmMutes;return;}
    if(!this.timeline.receive(data,port))super.receive(data,port);
  }
  process(inputs,outputs){
    if(this.dead)return false;
    const [left,right]=outputs[0];
    this.timeline.render(left.length,(offset,n)=>this.renderFrames(left,right,offset,n));
    if(this.updates.length){this.remote?.postMessage({timedWrites:this.updates});this.updates.length=0;}
    return true;
  }
}
registerProcessor('cps1-fm',Cps1FmProcessor);
