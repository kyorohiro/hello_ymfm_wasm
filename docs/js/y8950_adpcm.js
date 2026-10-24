import {readSamplePCM,encodeAdpcmB} from './adpcm_b_sample.js';
import {createY8950AdpcmPreview} from './y8950_adpcm_preview.js?v=y8950-adpcm-ui-1';

export const Y8950_ADPCM_MEMORY_BYTES=0x200000;
const integer=(value,max,label)=>{if(!Number.isSafeInteger(value)||value<0||value>max)throw new RangeError(`Y8950 ADPCM ${label} must be 0..${max}`);return value;};

/** Snapshot encoded bytes before an asynchronous upload. Addresses are bytes. */
export function copyY8950AdpcmMemory(bytes,address=0) {
  if(bytes instanceof ArrayBuffer)bytes=new Uint8Array(bytes);
  if(!(bytes instanceof Uint8Array))throw new TypeError('Y8950 ADPCM memory requires Uint8Array or ArrayBuffer');
  integer(address,Y8950_ADPCM_MEMORY_BYTES,'address');
  if(bytes.length>Y8950_ADPCM_MEMORY_BYTES-address)throw new RangeError('Y8950 ADPCM memory exceeds 2 MiB');
  return Uint8Array.from(bytes);
}

function snapshotSource(source) {
  if(source?.channels)return {...source,channels:Array.from(source.channels,channel=>Float32Array.from(channel))};
  if(typeof source?.getChannelData==='function')return {sampleRate:source.sampleRate,channels:Array.from({length:source.numberOfChannels},(_,index)=>Float32Array.from(source.getChannelData(index)))};
  if(source instanceof Uint8Array)return Uint8Array.from(source);
  if(source instanceof ArrayBuffer)return source.slice(0);
  return source;
}

/** One mono ADPCM-B voice on a Y8950. The parent owns the register image, clock
 * and lifecycle. Native/Worker transports may bind an asynchronous operation to
 * its original owner with captureContext/checkCurrent/withContext. RAM uploads
 * atomically stop only ADPCM on apply. They are acknowledged before loadSample
 * writes its new range; no playback starts. Raw Y8950 memory access is separate.
 */
export function attachY8950Adpcm(client,{loadMemory,clearMemory,captureContext=()=>undefined,
  checkCurrent=()=>{},withContext=(_scope,callback)=>callback(),decodeAudio}={}) {
  if(typeof loadMemory!=='function'||typeof clearMemory!=='function')throw new TypeError('Y8950 ADPCM needs memory upload and clear transports');
  const base={captureContext,checkCurrent,withContext,decodeAudio};let external=null,activeOperation=null,loadEpoch=0,cancelReason='Y8950 ADPCM loading was cancelled';
  Object.defineProperty(client,'_cancelAdpcmLoads',{value:reason=>{loadEpoch++;cancelReason=typeof reason==='string'?reason:reason?.message??'Y8950 ADPCM loading was cancelled';}});
  Object.defineProperty(client,'_setAdpcmLifecycle',{value:options=>{external={...options};}});
  function captureOperation(){
    const hooks=external,scope=base.captureContext(),extraScope=hooks?.captureContext?.(),epoch=loadEpoch;
    const operation={scope,decodeAudio:hooks?.decodeAudio??base.decodeAudio,
      check(){if(epoch!==loadEpoch)throw new DOMException(cancelReason,'AbortError');base.checkCurrent(scope);hooks?.checkCurrent?.(extraScope);},
      run(callback){
        operation.check();const previous=activeOperation;activeOperation=operation;
        try{return base.withContext(scope,()=>hooks?.withContext?hooks.withContext(extraScope,callback):callback());}
        finally{activeOperation=previous;}
      }};
    return operation;
  }
  const write=(register,value)=>{if(activeOperation)activeOperation.check();else{base.checkCurrent();external?.checkCurrent?.();}client.writeRegister(register,value);};
  const clock=()=>client.clock;
  const deltaFor=(rate,inputClock=clock())=>{
    if(!Number.isFinite(rate)||rate<=0)throw new RangeError('Invalid Y8950 ADPCM playback rate');
    const delta=Math.round(rate*72*65536/inputClock);
    if(delta<1||delta>65535)throw new RangeError('Y8950 ADPCM playback rate is outside the chip range');
    return delta;
  };
  const api={
    async loadMemory(bytes,address=0){
      const copy=copyY8950AdpcmMemory(bytes,address),operation=captureOperation();operation.check();
      const preview=createY8950AdpcmPreview(copy,{start:address,source:'memory'});
      await operation.run(()=>loadMemory(copy,address,operation.scope,preview));operation.check();
    },
    async clearMemory(){
      const operation=captureOperation();operation.check();
      await operation.run(()=>{api.keyOff();return clearMemory(operation.scope);});operation.check();
    },
    async loadSample(source,options={}){
      if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Y8950 ADPCM sample options must be an object');
      const operation=captureOperation();
      const {address=0,sampleRate,signal,decodeAudio:decoder=operation.decodeAudio}={...options};
      integer(address,Y8950_ADPCM_MEMORY_BYTES-1,'address');
      if(address%32)throw new RangeError('Y8950 ADPCM address must be 32-byte aligned');
      if(sampleRate!==undefined)deltaFor(sampleRate);
      if(decoder!==undefined&&typeof decoder!=='function')throw new TypeError('Y8950 ADPCM decodeAudio must be a function');
      const capturedSource=snapshotSource(source);operation.check();signal?.throwIfAborted();
      const pcm=await readSamplePCM(capturedSource,{signal,decodeAudio:decoder?bytes=>operation.run(()=>decoder(bytes)):undefined});operation.check();signal?.throwIfAborted();
      const encodedClock=clock(),requested=sampleRate??Math.min(pcm.sampleRate,encodedClock*65535/(72*65536));
      const deltaN=deltaFor(requested,encodedClock),actualRate=deltaN*encodedClock/(72*65536),encoded=encodeAdpcmB(pcm,actualRate,Y8950_ADPCM_MEMORY_BYTES-address);
      operation.check();signal?.throwIfAborted();
      const preview=createY8950AdpcmPreview(encoded.bytes,{start:address,source:'sample'});
      await operation.run(()=>{api.keyOff();return loadMemory(encoded.bytes,address,operation.scope,preview);});operation.check();signal?.throwIfAborted();
      if(clock()!==encodedClock)throw new Error('Y8950 clock changed while loading an ADPCM sample; load it again at the new clock');
      operation.run(()=>{operation.check();signal?.throwIfAborted();api.setSample({start:address,end:address+encoded.bytes.length});api.setDeltaN(deltaN);});
      return {start:address,end:address+encoded.bytes.length,frames:encoded.frames,paddedFrames:encoded.paddedFrames,
        sampleRate:actualRate,deltaN,duration:encoded.paddedFrames/actualRate};
    },
    setSample({start,end}){
      integer(start,Y8950_ADPCM_MEMORY_BYTES-1,'start');integer(end,Y8950_ADPCM_MEMORY_BYTES,'end');
      if(end<=start||start%32||end%32)throw new RangeError('Y8950 ADPCM range must be nonempty and 32-byte aligned');
      const first=start/32,last=end/32-1;
      // Register 08 shares CSM/note-select with FM. ADPCM is mono: the native
      // core forces its left output bit, rather than offering fictitious pan.
      write(8,(client.getRegisterSnapshot()[8]&0xc0)|2);
      write(9,first&255);write(10,first>>8);write(11,last&255);write(12,last>>8);
    },
    setDeltaN(value){integer(value,65535,'Delta-N');if(!value)throw new RangeError('Y8950 ADPCM Delta-N must be positive');write(16,value&255);write(17,value>>8);},
    setPlaybackRate(rate){const delta=deltaFor(rate);api.setDeltaN(delta);return delta*clock()/(72*65536);},
    setVolume(value){write(18,integer(value,255,'volume'));},
    keyOn({repeat=false}={}){if(typeof repeat!=='boolean')throw new TypeError('Y8950 ADPCM repeat must be boolean');write(7,repeat?0xb0:0xa0);},
    keyOff(){write(7,1);},
    reset(){
      client._cancelAdpcmLoads();api.keyOff();write(8,client.getRegisterSnapshot()[8]&0xc0);
      // 0d/0e are prescale registers, 0f is the CPU data port. Y8950 does not
      // expose the YM2608/2610 limit registers at 0x13/0x14; never write those here.
      for(const register of [9,10,11,12,13,14,16,17,18,21,22,23])write(register,0);
    },
  };
  const allNotesOff=client.allNotesOff?.bind(client);
  if(allNotesOff)client.allNotesOff=()=>{api.keyOff();return allNotesOff();};
  Object.defineProperty(client,'adpcm',{value:api,enumerable:true});return api;
}
