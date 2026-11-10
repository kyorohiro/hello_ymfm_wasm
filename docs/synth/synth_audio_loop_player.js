// Shared sample-clock PCM layer mixing. Chip calibration and Master belong
// to each endpoint; stored source samples are never scaled here.
export const AUDIO_LOOP_MIN_SECONDS=.05;
export const AUDIO_LOOP_MAX_SECONDS=120;
export const AUDIO_LOOP_MAX_UNITS=16;
export const AUDIO_LOOP_MAX_PCM_BYTES=128*1024*1024;

/** One chip-labelled protocol, with identical bounded PCM mixing semantics. */
export function createSynthAudioLoopProtocol(label='Audio') {
  if(typeof label!=='string'||!label.length)throw new TypeError('Audio loop protocol needs a label');
  const MAX_TAIL_SECONDS=5.01;
  const integer=(value,label)=>{
    if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`Invalid ${label}`);
    return value;
  };
  const sessionNumber=value=>{integer(value,`${label} loop session`);if(value===0)throw new RangeError(`${label} loop session must be positive`);return value;};
  const rate=value=>{
    if(!Number.isInteger(value)||value<8000||value>192000)throw new RangeError(`${label} loop sample rate must be 8000..192000`);
    return value;
  };
  const object=(value,fields,label)=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
      Reflect.ownKeys(value).some(key=>!fields.includes(key)))throw new TypeError(`Invalid ${label}`);
  };
  function normalizeSynthAudioLoopConfig(value,{sampleRate=48000}={}) {
    rate(sampleRate);object(value,['loopLength','startTime'],`${label} loop configuration`);
    if(!Number.isFinite(value.loopLength)||value.loopLength<AUDIO_LOOP_MIN_SECONDS||value.loopLength>AUDIO_LOOP_MAX_SECONDS)throw new RangeError(`${label} loop length must be 0.05..120 seconds`);
    if(!Number.isFinite(value.startTime)||value.startTime<0||!Number.isSafeInteger(Math.round(value.startTime*sampleRate)))throw new RangeError(`Invalid ${label} loop start time`);
    return {loopLength:value.loopLength,startTime:value.startTime};
  }
  function normalizeSynthAudioLoopUnit(value,{sampleRate=48000,loopLength,copy=true,scan=true}={}) {
    rate(sampleRate);object(value,['id','left','right','offsetSeconds'],`${label} loop unit`);
    if(typeof value.id!=='string'||!value.id.length||value.id.length>128)throw new TypeError(`${label} loop unit needs an id`);
    if(!Number.isFinite(loopLength)||loopLength<AUDIO_LOOP_MIN_SECONDS||loopLength>AUDIO_LOOP_MAX_SECONDS)throw new RangeError(`Invalid ${label} loop length`);
    if(!Number.isFinite(value.offsetSeconds)||value.offsetSeconds<0||value.offsetSeconds>=loopLength)throw new RangeError(`${label} loop offset must be inside the loop`);
    const {left,right}=value;
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||!left.length||left.length!==right.length||
      left.length>Math.ceil((loopLength+MAX_TAIL_SECONDS)*sampleRate)||left.byteLength+right.byteLength>AUDIO_LOOP_MAX_PCM_BYTES)throw new TypeError(`Invalid ${label} loop stereo PCM`);
    for(const pcm of [left,right]) {
      if(typeof SharedArrayBuffer!=='undefined'&&pcm.buffer instanceof SharedArrayBuffer)throw new TypeError(`${label} loop PCM must not use shared memory`);
      if(scan)for(const sample of pcm)if(!Number.isFinite(sample)||Math.abs(sample)>16)throw new RangeError(`Invalid ${label} loop sample`);
    }
    return {id:value.id,left:copy?left.slice():left,right:copy?right.slice():right,offsetSeconds:value.offsetSeconds};
  }

  /** Main-only cooperative validation/preparation. No audio device is opened. */
  async function prepareSynthAudioLoopUnit(value,{sampleRate=48000,loopLength,signal,
    yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0)),chunkFrames=32768}={}) {
    signal?.throwIfAborted();
    const raw=normalizeSynthAudioLoopUnit(value,{sampleRate,loopLength,copy:false,scan:false});
    if(typeof yieldControl!=='function'||!Number.isSafeInteger(chunkFrames)||chunkFrames<1)throw new TypeError(`Invalid ${label} loop preparation scheduler`);
    const loopFrames=Math.round(loopLength*sampleRate),left=new Float32Array(raw.left.length),right=new Float32Array(raw.right.length);
    for(let begin=0;begin<left.length;begin+=chunkFrames) {
      signal?.throwIfAborted();
      const end=Math.min(left.length,begin+chunkFrames);
      for(let frame=begin;frame<end;frame++) {
        const l=raw.left[frame],r=raw.right[frame];
        if(!Number.isFinite(l)||!Number.isFinite(r)||Math.abs(l)>16||Math.abs(r)>16)throw new RangeError(`Invalid ${label} loop sample`);
        left[frame]=l+(frame>=loopFrames?left[frame-loopFrames]:0);
        right[frame]=r+(frame>=loopFrames?right[frame-loopFrames]:0);
      }
      if(end<left.length)await yieldControl();
    }
    signal?.throwIfAborted();
    return {id:raw.id,left,right,offsetSeconds:raw.offsetSeconds,frameCount:left.length,prefixCount:Math.ceil(left.length/loopFrames)};
  }

  /** The Main API has scanned/folded these transferred buffers before posting.
   * Validate bounded ownership/shape here without an audio-thread PCM scan.
   */
  function normalizeSynthAudioPreparedLoopUnit(value,{sampleRate,loopLength}={}) {
    object(value,['id','left','right','offsetSeconds','frameCount','prefixCount'],`prepared ${label} loop unit`);
    const next=normalizeSynthAudioLoopUnit({id:value.id,left:value.left,right:value.right,offsetSeconds:value.offsetSeconds},
      {sampleRate,loopLength,copy:false,scan:false});
    if(value.frameCount!==next.left.length||value.prefixCount!==Math.ceil(next.left.length/Math.round(loopLength*sampleRate)))throw new TypeError(`Invalid prepared ${label} loop frame metadata`);
    return next;
  }

  /**
   * Finite-history repetition: an added layer starts at its next phase, never
   * borrowing a Release from a cycle that has not played. Strided cumulative
   * samples make even long tails over short loops O(units * output frames).
   */
  function createSynthAudioLoopPlayer({sampleRate}={}) {
    rate(sampleRate);
    let latestSession=0,playing=false,configuration=null,startFrame=0,loopFrames=0,lastFrame=0,totalBytes=0;
    const units=new Map();
    function stop(session) {
      if(session!==undefined){sessionNumber(session);if(session<latestSession)return false;latestSession=session;}
      playing=false;configuration=null;units.clear();totalBytes=0;return true;
    }
    function addPrepared(session,next,currentFrame) {
      if(units.has(next.id))throw new Error(`${label} loop unit already exists`);
      const bytes=next.left.byteLength+next.right.byteLength;
      if(units.size>=AUDIO_LOOP_MAX_UNITS||totalBytes+bytes>AUDIO_LOOP_MAX_PCM_BYTES)throw new RangeError(`${label} loop PCM storage limit reached`);
      const offsetFrames=Math.min(loopFrames-1,Math.round(next.offsetSeconds*sampleRate));
      const phase=startFrame+offsetFrames;
      const firstStartFrame=phase+Math.max(0,Math.ceil((currentFrame-phase)/loopFrames))*loopFrames;
      if(!Number.isSafeInteger(firstStartFrame))throw new RangeError(`Invalid ${label} loop frame`);
      units.set(next.id,{...next,offsetFrames,firstStartFrame,bytes});totalBytes+=bytes;return true;
    }
    return {
      start(value,{session,currentFrame=lastFrame}={}) {
        const next=normalizeSynthAudioLoopConfig(value,{sampleRate});sessionNumber(session);integer(currentFrame,`${label} current frame`);
        if(session<=latestSession)return false;
        stop(session);configuration=next;playing=true;lastFrame=currentFrame;
        startFrame=Math.round(next.startTime*sampleRate);loopFrames=Math.round(next.loopLength*sampleRate);return true;
      },
      add(session,value,{currentFrame=lastFrame,copy=true}={}) {
        sessionNumber(session);integer(currentFrame,`${label} current frame`);
        if(!playing||session!==latestSession)return false;
        const next=normalizeSynthAudioLoopUnit(value,{sampleRate,loopLength:configuration.loopLength,copy});
        if(units.has(next.id))throw new Error(`${label} loop unit already exists`);
        const bytes=next.left.byteLength+next.right.byteLength;
        if(units.size>=AUDIO_LOOP_MAX_UNITS||totalBytes+bytes>AUDIO_LOOP_MAX_PCM_BYTES)throw new RangeError(`${label} loop PCM storage limit reached`);
        // Ownership is private after validation (or transferred from Main). The
        // original PCM is no longer needed by the audio-side cumulative mixer.
        if(next.left.buffer===next.right.buffer)next.right=next.right.slice();
        for(const pcm of [next.left,next.right])for(let index=loopFrames;index<pcm.length;index++)pcm[index]+=pcm[index-loopFrames];
        return addPrepared(session,next,currentFrame);
      },
      addPrepared(session,value,{currentFrame=lastFrame}={}) {
        sessionNumber(session);integer(currentFrame,`${label} current frame`);
        if(!playing||session!==latestSession)return false;
        const next=normalizeSynthAudioPreparedLoopUnit(value,{sampleRate,loopLength:configuration.loopLength});
        return addPrepared(session,next,currentFrame);
      },
      remove(session,id) {
        sessionNumber(session);if(typeof id!=='string')throw new TypeError(`Invalid ${label} loop unit id`);
        if(!playing||session!==latestSession)return false;
        const unit=units.get(id);if(!unit)return false;
        units.delete(id);totalBytes-=unit.bytes;return true;
      },
      stop,
      render(left,right,currentFrame=lastFrame) {
        if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length)throw new TypeError(`${label} loop render needs stereo Float32Arrays`);
        integer(currentFrame,`${label} current frame`);
        if(!Number.isSafeInteger(currentFrame+left.length))throw new RangeError(`Invalid ${label} output frame`);
        if(playing)for(const unit of units.values()) {
          const begin=Math.max(0,unit.firstStartFrame-currentFrame);
          for(let index=begin;index<left.length;index++) {
            const elapsed=currentFrame+index-unit.firstStartFrame,position=elapsed%loopFrames;
            if(position>=unit.left.length)continue;
            const history=Math.min(Math.floor(elapsed/loopFrames),Math.floor((unit.left.length-1-position)/loopFrames));
            const source=position+history*loopFrames;
            // Prepared packets originate in this app's validated Main API. If a
            // malformed direct packet ever bypasses that API, stop silently
            // rather than emitting non-finite samples into the output graph.
            if(!Number.isFinite(unit.left[source])||!Number.isFinite(unit.right[source]))throw new RangeError(`Invalid prepared ${label} loop sample`);
            left[index]+=unit.left[source];right[index]+=unit.right[source];
          }
        }
        lastFrame=currentFrame+left.length;
      },
      snapshot:()=>({playing,session:latestSession,startFrame,loopFrames,currentFrame:lastFrame,byteLength:totalBytes,
        units:[...units.values()].map(({id,offsetFrames,firstStartFrame,left,bytes})=>({id,offsetFrames,firstStartFrame,frameCount:left.length,byteLength:bytes}))}),
    };
  }
  return {normalizeSynthAudioLoopConfig,normalizeSynthAudioLoopUnit,prepareSynthAudioLoopUnit,
    normalizeSynthAudioPreparedLoopUnit,createSynthAudioLoopPlayer};
}
