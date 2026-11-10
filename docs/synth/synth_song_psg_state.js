// Written PSG registers at the audible reference-song position. This observes
// source writes, not the synth editor, internal LFSR bits or software ADSR.
const DEFAULT_CLOCK=3579545;
const ENVELOPE=Object.freeze({enabled:false,attackMs:10,decayMs:180,sustain:70,releaseMs:180});
const integer=(value,max,label)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);
  return value;
};
function stateArray(value,length,max,label) {
  if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==length)throw new TypeError(`Invalid ${label}`);
  return Array.from(value,item=>integer(item,max,label));
}

/** Sega PSG latch/data decoding, including data bytes for volume/noise. */
export function createPsgRegisterState(clockHz=DEFAULT_CLOCK) {
  if(typeof clockHz!=='number'||!Number.isFinite(clockHz)||clockHz<=0)throw new RangeError('PSG clock must be positive');
  const periods=new Uint16Array(3),attenuations=new Uint8Array(4),lastAttenuations=new Uint8Array(4);
  let latched=0,noiseMode=0,noiseWriteCount=0,revision=0,cached=null;
  function reset() {
    periods.fill(0);attenuations.fill(15);lastAttenuations.fill(15);
    latched=noiseMode=noiseWriteCount=0;revision++;cached=null;
  }
  function write(value) {
    integer(value,255,'PSG byte');
    if(value&128)latched=(value>>4)&7;
    const channel=latched>>1;
    if(latched&1) {
      attenuations[channel]=value&15;
      if((value&15)!==15)lastAttenuations[channel]=value&15;
    } else if(channel===3) {noiseMode=value&7;noiseWriteCount++;}
    else if(value&128)periods[channel]=(periods[channel]&0x3f0)|(value&15);
    else periods[channel]=(periods[channel]&15)|((value&63)<<4);
    revision++;cached=null;return true;
  }
  function snapshot(frame=0) {
    if(!cached) {
      const noiseType=noiseMode&4?'white':'periodic',noiseRate=['low','medium','high','tone3'][noiseMode&3];
      const channels=Array.from({length:4},(_,channel)=>{
        const source=channel===3?'noise':'tone';
        const period=channel===3?(noiseRate==='tone3'?periods[2]:[16,32,64][noiseMode&3]):periods[channel];
        const noiseClockHz=channel===3?clockHz/(32*Math.max(1,period)):null;
        // The current Sega core treats tone periods 0/1 as constant output.
        // Noise has a clock, but white noise has no single musical pitch.
        const constantOutput=channel<3&&period<=1;
        const frequencyHz=channel===3?(noiseType==='periodic'?noiseClockHz/16:null):constantOutput?null:clockHz/(32*period);
        const midi=frequencyHz>0?69+12*Math.log2(frequencyHz/440):null;
        return Object.freeze({channel,source,period,attenuation:attenuations[channel],lastAttenuation:lastAttenuations[channel],
          active:attenuations[channel]<15,frequencyHz,midi,constantOutput,noiseType,noiseRate,noiseClockHz,
          preset:Object.freeze({source,attenuation:attenuations[channel],noiseType,noiseRate,envelope:ENVELOPE})});
      });
      cached=Object.freeze({kind:'segapsg',present:true,clockHz,revision,latched,noiseMode,noiseWriteCount,
        periods:Object.freeze([...periods]),attenuations:Object.freeze([...attenuations]),lastAttenuations:Object.freeze([...lastAttenuations]),
        channels:Object.freeze(channels)});
    }
    return Object.freeze({...cached,frame});
  }
  function saveState() {return {version:1,clockHz,revision,latched,noiseMode,noiseWriteCount,
    periods:periods.slice(),attenuations:attenuations.slice(),lastAttenuations:lastAttenuations.slice()};}
  function loadState(state) {
    if(state?.version!==1||state.clockHz!==clockHz)throw new TypeError('Invalid PSG decoder state');
    const next={revision:integer(state.revision,Number.MAX_SAFE_INTEGER,'PSG revision'),latched:integer(state.latched,7,'PSG latch'),
      noiseMode:integer(state.noiseMode,7,'PSG noise mode'),noiseWriteCount:integer(state.noiseWriteCount,Number.MAX_SAFE_INTEGER,'PSG noise writes'),
      periods:stateArray(state.periods,3,1023,'PSG periods'),attenuations:stateArray(state.attenuations,4,15,'PSG attenuations'),
      lastAttenuations:stateArray(state.lastAttenuations,4,15,'PSG last attenuation')};
    if(next.noiseWriteCount>next.revision)throw new TypeError('Invalid PSG noise write count');
    periods.set(next.periods);attenuations.set(next.attenuations);lastAttenuations.set(next.lastAttenuations);
    ({revision,latched,noiseMode,noiseWriteCount}=next);cached=null;
  }
  reset();return {write,reset,snapshot,saveState,loadState};
}

/**
 * Observe only original writes on this reference engine. Generated samples can
 * be ahead of the speaker; ordered writes become visible only when read(frame)
 * reaches their audible position. The pending window participates in seeks.
 */
export function createPsgSongTimeline(engine,clockHz=DEFAULT_CLOCK) {
  const shadow=createPsgRegisterState(clockHz);
  const original={write:engine.writePsg,process:engine.processFrames,reset:engine.reset};
  if(Object.values(original).some(value=>typeof value!=='function'))throw new TypeError('PSG timeline needs a reference engine');
  let generatedFrames=0,lastReadFrame=0,events=[],head=0,disposed=false;
  function write(value) {
    integer(value,255,'PSG byte');
    const result=original.write.call(this,value);
    if(!disposed)events.push({frame:generatedFrames,value});return result;
  }
  function process(frames) {const result=original.process.call(this,frames);generatedFrames+=frames;return result;}
  function reset(...args) {
    const result=original.reset.apply(this,args);generatedFrames=lastReadFrame=0;events=[];head=0;shadow.reset();return result;
  }
  engine.writePsg=write;engine.processFrames=process;engine.reset=reset;
  function read(frame) {
    if(typeof frame!=='number'||!Number.isFinite(frame))throw new TypeError('PSG audible frame must be finite');
    const next=Math.max(0,Math.min(generatedFrames,Math.floor(frame)));
    if(next<lastReadFrame)throw new Error('Audible PSG state cannot move backwards without resetting');
    while(head<events.length&&events[head].frame<=next)shadow.write(events[head++].value);
    lastReadFrame=next;
    if(head===events.length){events=[];head=0;}else if(head>256){events=events.slice(head);head=0;}
    return shadow.snapshot(next);
  }
  return {read,
    saveState() {
      if(disposed)throw new Error('PSG timeline is disposed');
      return {version:1,generatedFrames,lastReadFrame,decoder:shadow.saveState(),events:events.slice(head).map(event=>({...event}))};
    },
    loadState(state) {
      if(disposed)throw new Error('PSG timeline is disposed');
      if(state?.version!==1||!Array.isArray(state.events))throw new TypeError('Invalid PSG timeline state');
      const nextGenerated=integer(state.generatedFrames,Number.MAX_SAFE_INTEGER,'PSG generated frames');
      const nextRead=integer(state.lastReadFrame,nextGenerated,'PSG audible frame');let preceding=nextRead;
      const pending=state.events.map(event=>{
        const frame=integer(event?.frame,nextGenerated,'PSG event frame'),value=integer(event?.value,255,'PSG event byte');
        if(frame<preceding)throw new TypeError('Invalid PSG pending event order');preceding=frame;return {frame,value};
      });
      shadow.loadState(state.decoder);generatedFrames=nextGenerated;lastReadFrame=nextRead;events=pending;head=0;
    },
    get pendingEvents(){return events.length-head;},
    dispose() {
      if(disposed)return;disposed=true;events=[];head=0;
      if(engine.writePsg===write)engine.writePsg=original.write;
      if(engine.processFrames===process)engine.processFrames=original.process;
      if(engine.reset===reset)engine.reset=original.reset;
    },
  };
}
