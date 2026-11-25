// SPDX-License-Identifier: BSD-3-Clause
import {Fm21290,integer,validRegister} from './chip.js';

export const maxEvents=200000;
export function createTrace(sampleRate) {
  return {format:'tetorica-fm21290-trace',version:1,sampleRate,frames:0,events:[]};
}
export function validateTrace(trace,rate) {
  if(trace?.format!=='tetorica-fm21290-trace' || trace.version!==1)
    throw Error('Unknown FM21290 trace format');
  integer(trace.sampleRate,8000,384000,'sample rate');
  if(rate!==undefined && trace.sampleRate!==rate)throw Error('Trace sample rate differs from audio output');
  integer(trace.frames,0,Number.MAX_SAFE_INTEGER,'duration');
  if(!Array.isArray(trace.events) || trace.events.length>maxEvents)throw Error('Invalid trace event count');
  let last=0;
  for(const event of trace.events){
    if(!Array.isArray(event) || (event.length!==1 && event.length!==3))throw Error('Invalid trace event');
    last=integer(event[0],last,trace.frames,'event frame');
    if(event.length===3){validRegister(event[1]);integer(event[2],0,255,'register byte');}
  }
  return trace;
}

export class TracePlayer {
  constructor(trace,rate){
    this.trace=validateTrace(trace,rate);
    this.chip=new Fm21290(rate);
    this.frame=0;
    this.index=0;
  }
  renderInto(output){
    const {events,frames,sampleRate}=this.trace;
    const end=Math.min(frames,this.frame+output.length);
    let offset=0;
    while(this.frame<=end){
      const event=events[this.index];
      if(event && event[0]===this.frame){
        if(event.length===1)this.chip=new Fm21290(sampleRate);
        else this.chip.writeRegister(event[1],event[2]);
        this.index++;
        continue;
      }
      if(this.frame===end)break;
      const next=Math.min(end,event?.[0]??end);
      const length=next-this.frame;
      this.chip.renderInto(output.subarray(offset,offset+length));
      this.frame=next;
      offset+=length;
    }
    output.fill(0,offset);
    return this.frame===frames;
  }
}
