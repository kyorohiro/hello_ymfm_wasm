import {readSamplePCM,encodeAdpcmB} from './adpcm_b_sample.js';
// Control-side helpers. Preparing a preview may scan encoded data; render and
// Inspector reads only consume the bounded result, never decode sample RAM.
const MAX_MEMORY=0x200000,MAX_POINTS=512;
const range=(start,length)=>{if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(length)||length<0||length>MAX_MEMORY-start)throw new RangeError('Invalid Y8950 ADPCM preview range');};

export function snapshotY8950AdpcmSource(source){
  if(source?.channels)return {...source,channels:Array.from(source.channels,channel=>Float32Array.from(channel))};
  if(typeof source?.getChannelData==='function')return {sampleRate:source.sampleRate,channels:Array.from({length:source.numberOfChannels},(_,index)=>Float32Array.from(source.getChannelData(index)))};
  if(source instanceof Uint8Array)return Uint8Array.from(source);
  if(source instanceof ArrayBuffer)return source.slice(0);
  return source;
}

/** Prepare an admin upload on the control thread, without touching audio state. */
export async function prepareY8950AdpcmSample(source,options={},clock,decode) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Y8950 ADPCM sample options must be an object');
  const {address=0,sampleRate,signal,name='Sample'}={...options};
  range(address,1);if(address%32)throw new RangeError('Y8950 ADPCM address must be 32-byte aligned');
  if(typeof name!=='string'||!name.length||name.length>256)throw new TypeError('Sample name must contain 1..256 characters');
  if(!Number.isFinite(clock)||clock<=0)throw new RangeError('Invalid Y8950 clock');
  const deltaFor=rate=>{if(!Number.isFinite(rate)||rate<=0)throw new RangeError('Invalid Y8950 ADPCM playback rate');const value=Math.round(rate*72*65536/clock);if(value<1||value>65535)throw new RangeError('Y8950 ADPCM playback rate is outside the chip range');return value;};
  if(sampleRate!==undefined)deltaFor(sampleRate);
  if(signal!==undefined&&typeof signal?.throwIfAborted!=='function')throw new TypeError('Expected an AbortSignal');
  if(decode!==undefined&&typeof decode!=='function')throw new TypeError('Sample decoder must be a function');
  source=snapshotY8950AdpcmSource(source);
  signal?.throwIfAborted();const pcm=await (decode?decode(source):readSamplePCM(source,{signal}));signal?.throwIfAborted();
  const deltaN=deltaFor(sampleRate??Math.min(pcm.sampleRate,clock*65535/(72*65536))),actualRate=deltaN*clock/(72*65536);
  const encoded=encodeAdpcmB(pcm,actualRate,MAX_MEMORY-address),preview=createY8950AdpcmPreview(encoded.bytes,{start:address,name,source:'sample'});
  signal?.throwIfAborted();return {bytes:encoded.bytes,metadata:{start:address,end:address+encoded.bytes.length,frames:encoded.frames,paddedFrames:encoded.paddedFrames,deltaN,sampleRate:actualRate,duration:encoded.paddedFrames/actualRate,name,source:'sample',preview,clock}};
}

export function createY8950AdpcmPreview(bytes,{start=0,name='Sample',source='memory'}={}) {
  if(!(bytes instanceof Uint8Array))throw new TypeError('Y8950 ADPCM preview requires encoded bytes');
  range(start,bytes.length);if(!bytes.length)return null;
  if(typeof name!=='string'||!name.length||name.length>256)throw new TypeError('Y8950 ADPCM sample name must contain 1..256 characters');
  if(!['memory','sample'].includes(source))throw new TypeError('Invalid Y8950 ADPCM preview source');
  const frames=bytes.length*2,stride=Math.max(1,Math.ceil(frames/MAX_POINTS)),waveform=[],scales=[57,57,57,57,77,102,128,153];
  let predictor=0,step=127,peak=0;
  for(let frame=0;frame<frames;frame++){
    const code=frame&1?bytes[frame>>1]&15:bytes[frame>>1]>>4;
    const delta=Math.floor((2*(code&7)+1)*step/8)*(code&8?-1:1);
    predictor=Math.max(-32768,Math.min(32767,predictor+delta));
    step=Math.max(127,Math.min(24576,Math.floor(step*scales[code&7]/64)));
    const value=predictor/32768;if(Math.abs(value)>Math.abs(peak))peak=value;
    if((frame+1)%stride===0||frame+1===frames){waveform.push(peak);peak=0;}
  }
  return {start,end:start+bytes.length,frames,name,source,waveform};
}

export function validateY8950AdpcmPreview(preview,start,length) {
  range(start,length);if(preview===undefined||preview===null)return null;
  if(!preview||typeof preview!=='object'||preview.start!==start||preview.end!==start+length||preview.frames!==length*2||
    typeof preview.name!=='string'||!preview.name.length||preview.name.length>256||!['memory','sample'].includes(preview.source)||
    !Array.isArray(preview.waveform)||!preview.waveform.length||preview.waveform.length>MAX_POINTS||preview.waveform.some(value=>!Number.isFinite(value)||value< -1||value>1))throw new TypeError('Invalid Y8950 ADPCM compact preview');
  return {start,end:start+length,frames:length*2,name:preview.name,source:preview.source,waveform:preview.waveform.slice()};
}

/** Derive controls from applied registers; active is the authored hardware gate,
 * not a claim that EOS has not occurred. Waveforms are pre-volume decoded data.
 */
export function readY8950Adpcm(registers,clock,{memoryBytes=0,revision=0,preview=null}={}) {
  const unit=registers[8]&3?32:4,start=(registers[9]|registers[10]<<8)*unit,end=((registers[11]|registers[12]<<8)+1)*unit;
  const deltaN=registers[16]|registers[17]<<8,known=!!preview&&preview.start===start&&preview.end===end&&preview.revision===revision;
  return {start,end,deltaN,playbackRate:deltaN*clock/(72*65536),volume:registers[18],repeat:!!(registers[7]&16),
    playing:(registers[7]&0xc1)===0x80,activeSource:'applied-register-gate',addressUnit:unit,
    memorySize:memoryBytes,memoryRevision:revision,validRange:start<end&&end<=memoryBytes,
    waveformKnown:known,waveform:known?preview.waveform.slice():[],sampleName:known?preview.name:null};
}
