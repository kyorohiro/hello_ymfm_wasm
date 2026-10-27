import {PokeySynth,POKEY_CLOCK} from './pokeysynth.js?v=pokey-mode-1';
import {preparePokeyTimeline,readPokeyTimelinePoint,pokeyTimelineInteger,POKEY_TIMELINE_MAX_BYTES} from './pokey_timeline.js?v=pokey-import-1';

/** Offline authoring using the ordinary POKEY register/high-level API. No
 * audio is generated and adoptRegisterState() never inserts reset writes. */
export class PokeyTimelineBuilder extends PokeySynth{
  constructor({clock=POKEY_CLOCK,packedData=new Uint8Array()}={}){
    if(!(packedData instanceof Uint8Array)||packedData.byteLength>POKEY_TIMELINE_MAX_BYTES)throw new RangeError('POKEY timeline packed data must be Uint8Array up to 8 MiB');
    const state={sample:0,lastSample:0,length:0,capacity:1024,data:new Uint8Array(1024),finished:false};
    const append=byte=>{if(state.length>=POKEY_TIMELINE_MAX_BYTES)throw new RangeError('POKEY timeline exceeds the 8 MiB limit');if(state.length===state.capacity){const capacity=Math.min(POKEY_TIMELINE_MAX_BYTES,state.capacity*2),data=new Uint8Array(capacity);data.set(state.data);state.data=data;state.capacity=capacity;}state.data[state.length++]=byte;};
    const writeRegister=(register,value)=>{
      if(state.finished)throw new Error('POKEY timeline builder is finished');
      let delta=state.sample-state.lastSample;
      // Check the complete record before appending; failed writes are atomic.
      const bytes=delta<128?1:delta<16384?2:delta<2097152?3:delta<268435456?4:5;
      if(state.length+bytes+2>POKEY_TIMELINE_MAX_BYTES)throw new RangeError('POKEY timeline exceeds the 8 MiB limit');
      while(delta>=128){append((delta%128)|128);delta=Math.floor(delta/128);}append(delta);append(register);append(value);state.lastSample=state.sample;
    };
    super({clock,transport:{writeRegister,reset(){if(state.sample!==0||state.length)throw new Error('POKEY timeline hardware reset is only available before its first write');}}});
    this._timelineBuilderState=state;this._timelinePackedData=new Uint8Array(packedData);
  }
  at(sample){const state=this._timelineBuilderState;if(state.finished)throw new Error('POKEY timeline builder is finished');pokeyTimelineInteger(sample,0xffffffff,'sample');if(sample<state.sample)throw new RangeError('POKEY timeline samples must be ordered');state.sample=sample;return this;}
  /** Splice a prepacked run whose first delta is zero at the selected sample.
   * Validate the entire run before altering authored or packed output state. */
  packed(offset,length,count,endSample){
    const builder=this._timelineBuilderState,data=this._timelinePackedData;
    if(builder.finished)throw new Error('POKEY timeline builder is finished');
    pokeyTimelineInteger(offset,data.length,'packed offset');pokeyTimelineInteger(length,data.length,'packed length');pokeyTimelineInteger(count,0xffffffff,'packed count');pokeyTimelineInteger(endSample,0xffffffff,'packed end sample');
    if(!count||length<count*3||offset+length>data.length||endSample<builder.sample)throw new RangeError('Invalid POKEY packed run bounds');
    const cursor={position:offset,end:offset+length,sample:builder.sample};
    for(let index=0;index<count;index++){const delta=readPokeyTimelinePoint(data,cursor);if(!index&&delta)throw new Error('POKEY packed run first delta must be zero');if(cursor.sample>endSample)throw new Error('POKEY packed run exceeds its end sample');}
    if(cursor.position!==cursor.end||cursor.sample!==endSample)throw new Error('POKEY packed run byte count or end sample mismatch');
    // Only the run's first delta changes during rebasing. Reserve its exact
    // encoded growth before any register shadow or buffer is changed.
    let delta=builder.sample-builder.lastSample,deltaBytes=1;while(delta>=128){delta=Math.floor(delta/128);deltaBytes++;}
    if(builder.length+length+deltaBytes-1>POKEY_TIMELINE_MAX_BYTES)throw new RangeError('POKEY timeline exceeds the 8 MiB limit');
    cursor.position=offset;cursor.sample=builder.sample;
    for(let index=0;index<count;index++){readPokeyTimelinePoint(data,cursor);builder.sample=cursor.sample;this.writeRegister(cursor.register,cursor.value);}
    return this;
  }
  finish(durationSamples){
    const state=this._timelineBuilderState;if(state.finished)throw new Error('POKEY timeline builder is finished');pokeyTimelineInteger(durationSamples,0xffffffff,'duration');if(durationSamples<state.sample)throw new RangeError('POKEY timeline duration precedes the selected sample');
    const trace=preparePokeyTimeline({version:1,clock:this.clock,durationSamples,data:state.data.subarray(0,state.length)});state.finished=true;return trace;
  }
}

export function createPokeyTimelineBuilder(options){return new PokeyTimelineBuilder(options);}
