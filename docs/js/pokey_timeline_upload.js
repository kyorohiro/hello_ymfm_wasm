import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {POKEY_TIMELINE_MAX_BYTES,POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM,pokeyTimelineInteger} from './pokey_timeline.js?v=pokey-prepare-1';

export const POKEY_TIMELINE_CHUNK_BYTES=16384;
export const POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM=1024;
const fail=message=>{throw new Error(`POKEY timeline: ${message}`);};
const validateRate=sampleRate=>{if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)fail('invalid output sample rate');};

/** Stage transferred chunks without scanning or copying them in a port handler.
 * The caller gives up ownership of every appended chunk and of the prepared
 * result. Only step() examines bytes; its work is bounded by both bytes and
 * completed writes. Partial deltas and register pairs survive chunk boundaries.
 * @param {any} header
 * @param {{sampleRate?:number}} [options] */
export function createPokeyTimelineUpload(header,{sampleRate}={}){
  if(!header||typeof header!=='object'||Array.isArray(header)||header.version!==1)fail('expected version 1');
  const clock=validateChipClock(header.clock),durationSamples=pokeyTimelineInteger(header.durationSamples,0xffffffff,'duration');
  const byteLength=pokeyTimelineInteger(header.byteLength,POKEY_TIMELINE_MAX_BYTES,'data byte length (8 MiB limit)');
  if(sampleRate!==undefined)validateRate(sampleRate);
  const chunks=[],window=sampleRate===undefined?null:new Float64Array(POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM);
  let pending=null,position=0,receivedBytes=0,validatedBytes=0,validatedWrites=0,finished=false,failed=false;
  let phase=0,delta=0,multiplier=1,deltaBytes=0,sample=0,register=0,sameSample=-1,sameCount=0;
  const active=()=>{if(failed)fail('upload has failed');if(finished)fail('upload is finished');};
  const result=()=>({chunkDone:pending===null,complete:validatedBytes===byteLength&&phase===0&&deltaBytes===0,validatedBytes,validatedWrites});
  return {
    get byteLength(){return byteLength;},
    get receivedBytes(){return receivedBytes;},
    get validatedBytes(){return validatedBytes;},
    get validatedWrites(){return validatedWrites;},
    append(chunk){
      active();
      if(pending!==null)fail('previous chunk is not validated');
      if(!(chunk instanceof Uint8Array)||!(chunk.buffer instanceof ArrayBuffer)||chunk.byteOffset!==0||chunk.byteLength!==chunk.buffer.byteLength)fail('expected an owned complete Uint8Array buffer');
      if(!chunk.byteLength||chunk.byteLength>POKEY_TIMELINE_CHUNK_BYTES)fail('chunk must contain 1..16384 bytes');
      if(chunk.byteLength>byteLength-receivedBytes)fail('chunk exceeds declared data byte length');
      chunks.push(chunk);pending=chunk;position=0;receivedBytes+=chunk.byteLength;
    },
    step(maxWrites=POKEY_TIMELINE_VALIDATE_WRITES_PER_QUANTUM){
      active();pokeyTimelineInteger(maxWrites,Number.MAX_SAFE_INTEGER,'validation write budget');
      let bytes=0,writes=0;
      try{
        while(pending!==null&&position<pending.byteLength&&bytes<POKEY_TIMELINE_CHUNK_BYTES&&writes<maxWrites){
          const byte=pending[position++];bytes++;validatedBytes++;
          if(phase===0){
            if(deltaBytes===4&&byte>15)fail('delta exceeds unsigned 32-bit range');
            delta+=(byte&127)*multiplier;
            if(byte&128){multiplier*=128;deltaBytes++;}
            else{
              if(deltaBytes&&!(byte&127))fail('noncanonical delta');
              sample+=delta;
              if(!Number.isSafeInteger(sample)||sample>0xffffffff)fail('sample exceeds unsigned 32-bit range');
              phase=1;
            }
          }else if(phase===1){
            register=byte;if(register>15)fail('register must be 0..15');phase=2;
          }else{
            if(sample>durationSamples)fail('write exceeds duration');
            if(sample!==sameSample){sameSample=sample;sameCount=0;}
            if(++sameCount>POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM)fail('too many writes at one sample');
            if(window!==null){
              const frame=Math.ceil(sample*sampleRate/44100),slot=validatedWrites%POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM;
              if(validatedWrites>=POKEY_TIMELINE_MAX_WRITES_PER_QUANTUM&&frame-window[slot]<128)fail('too many writes in one output quantum');
              window[slot]=frame;
            }
            validatedWrites++;writes++;phase=0;delta=0;multiplier=1;deltaBytes=0;
          }
        }
        if(pending!==null&&position===pending.byteLength){pending=null;position=0;}
        if(validatedBytes===byteLength&&(phase!==0||deltaBytes!==0))fail(phase===0?'truncated delta':'truncated register/byte pair');
        return result();
      }catch(error){failed=true;throw error;}
    },
    finish(){
      active();
      if(receivedBytes!==byteLength||validatedBytes!==byteLength||pending!==null||phase!==0||deltaBytes!==0)fail('upload is incomplete');
      finished=true;
      // Retain the list in place. Copying or freezing all its entries here would
      // make the final port command proportional to the number of chunks.
      return Object.freeze({version:1,clock,durationSamples,chunks,byteLength});
    }
  };
}

/** Allocation-free traversal of validated owned chunks. No typed-array views
 * are constructed when a record or delta crosses a chunk boundary. */
export function createPokeyChunkTimelineCursor(prepared,sampleRate){
  validateRate(sampleRate);
  const chunks=prepared.chunks;
  let chunk=chunks[0],chunkIndex=0,position=0,readBytes=0,sample=0,register=0,value=0,next=Infinity;
  function byte(){
    if(position===chunk.byteLength){chunk=chunks[++chunkIndex];position=0;}
    readBytes++;return chunk[position++];
  }
  function select(){
    if(readBytes===prepared.byteLength){next=Infinity;return;}
    let delta=0,multiplier=1,current;
    do{current=byte();delta+=(current&127)*multiplier;multiplier*=128;}while(current&128);
    sample+=delta;register=byte();value=byte();next=Math.ceil(sample*sampleRate/44100);
  }
  select();
  return {durationFrames:Math.ceil(prepared.durationSamples*sampleRate/44100),nextFrame:()=>next,advance(frame,apply){while(next<=frame){apply(register,value);select();}}};
}
