import {validateChipClock} from './playground_chip_clock.js?v=pokey-mode-1';

export const POKEY_TIMELINE_MAX_BYTES=8*1024*1024;
export const POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM=512;
const fail=message=>{throw new Error(`POKEY timeline: ${message}`);};
export function pokeyTimelineInteger(value,maximum,label){if(!Number.isSafeInteger(value)||value<0||value>maximum)fail(`${label} is out of range`);return value;}

/** Decode one canonical unsigned delta and register/byte pair into owned state.
 * The same decoder is used by preparation, builders and the render cursor. */
export function readPokeyTimelinePoint(data,state){
  let delta=0,multiplier=1,byte=0;
  for(let index=0;index<5;index++){
    if(state.position>=state.end)fail('truncated delta');
    byte=data[state.position++];
    if(index===4&&byte>15)fail('delta exceeds unsigned 32-bit range');
    delta+=(byte&127)*multiplier;
    if(!(byte&128)){if(index&&!(byte&127))fail('noncanonical delta');break;}
    multiplier*=128;
  }
  if(byte&128||state.position+2>state.end)fail('truncated register/byte pair');
  state.sample+=delta;
  if(!Number.isSafeInteger(state.sample)||state.sample>0xffffffff)fail('sample exceeds unsigned 32-bit range');
  state.register=data[state.position++];state.value=data[state.position++];
  if(state.register>15)fail('register must be 0..15');
  return delta;
}

/** Own a compact single-chip trace. Times always use 44100-Hz VGM samples;
 * clock is the physical chip clock, never the output scheduling rate.
 * @param {any} trace
 * @param {{sampleRate?:number}} [options] */
export function preparePokeyTimeline(trace,{sampleRate}={}){
  if(!trace||typeof trace!=='object'||Array.isArray(trace)||trace.version!==1)fail('expected version 1');
  const clock=validateChipClock(trace.clock),durationSamples=pokeyTimelineInteger(trace.durationSamples,0xffffffff,'duration');
  if(!(trace.data instanceof Uint8Array))fail('expected Uint8Array data');
  if(trace.data.byteLength>POKEY_TIMELINE_MAX_BYTES)fail('data exceeds the 8 MiB limit');
  if(sampleRate!==undefined&&(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000))fail('invalid output sample rate');
  const data=new Uint8Array(trace.data),state={position:0,end:data.length,sample:0},window=new Float64Array(POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM);
  let count=0,sameSample=-1,sameCount=0;
  while(state.position<state.end){
    readPokeyTimelinePoint(data,state);
    if(state.sample>durationSamples)fail('write exceeds duration');
    if(state.sample!==sameSample){sameSample=state.sample;sameCount=0;}
    if(++sameCount>POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM)fail('too many writes at one sample');
    if(sampleRate!==undefined){
      const frame=Math.ceil(state.sample*sampleRate/44100),slot=count%POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM;
      if(count>=POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM&&frame-window[slot]<128)fail('too many writes in one output quantum');
      window[slot]=frame;
    }
    count++;
  }
  return {version:1,clock,durationSamples,data};
}

/** Allocation-free traversal after preparation. Same-time writes retain their
 * byte order and fractional sample boundaries round up to the next frame. */
export function createPokeyTimelineCursor(prepared,sampleRate){
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)fail('invalid output sample rate');
  const state={position:0,end:prepared.data.length,sample:0,register:0,value:0};
  let next=Infinity;
  function select(){if(state.position>=state.end){next=Infinity;return;}readPokeyTimelinePoint(prepared.data,state);next=Math.ceil(state.sample*sampleRate/44100);}
  select();
  return {durationFrames:Math.ceil(prepared.durationSamples*sampleRate/44100),nextFrame:()=>next,advance(frame,apply){while(next<=frame){apply(state.register,state.value);select();}}};
}
