import {
  PCM_ENCODING, PCM_PRESET_VERSION, PCM_PRESET_KIND, PCM_MAX_FRAMES,
  PCM_MIN_SAMPLE_RATE, PCM_MAX_SAMPLE_RATE, createSynthPcmVoice,
} from './synth_pcm.js?v=pcm-release-1';

const RAM_BYTES=65536;
const capturedSamples=new WeakMap();
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
const address=value=>'$'+value.toString(16).toUpperCase().padStart(4,'0');

function sourceVoice(snapshot,channel) {
  if(snapshot?.kind!=='rf5c164'||!integer(channel,7)||!snapshot.channels?.[channel]) {
    throw Error('No Mega CD PCM channel snapshot.');
  }
  const byteArray=value=>Array.isArray(value)||value instanceof Uint8Array;
  if(!Number.isInteger(snapshot.clockHz)||snapshot.clockHz<=0||snapshot.clockHz>100000000||
    !byteArray(snapshot.ram)||!byteArray(snapshot.known)||
    typeof snapshot.enabled!=='boolean'||snapshot.ram?.length!==RAM_BYTES||snapshot.known?.length!==RAM_BYTES) {
    throw Error('Invalid Mega CD PCM snapshot.');
  }
  const voice=snapshot.channels[channel];
  if(voice.channel!==channel||!integer(voice.volume,255)||!integer(voice.panLeft,15)||
    !integer(voice.panRight,15)||!integer(voice.step,65535)||!integer(voice.start,65535)||
    voice.start%256||!integer(voice.loopStart,65535))throw Error('Invalid Mega CD PCM channel settings.');
  return voice;
}

function sourceByte(snapshot,index) {
  if(index>=RAM_BYTES)throw Error('PCM sample or end guard wraps the 64 KiB RAM boundary.');
  if(snapshot.known[index]!==1)throw Error(`PCM sample RAM is incomplete at ${address(index)}.`);
  const value=snapshot.ram[index];
  if(!integer(value,255))throw Error('Invalid Mega CD PCM sample byte.');
  return value;
}

function base64(bytes) {
  const parts=[];
  for(let offset=0;offset<bytes.length;offset+=8192)parts.push(String.fromCharCode(...bytes.subarray(offset,offset+8192)));
  return btoa(parts.join(''));
}

/**
 * Only a bounded contiguous instrument can be moved into the Synth's guarded
 * bank. A song can instead jump to a disjoint loop, wrap RAM, stream new bytes,
 * or omit its end marker; those programs are not inferred from one snapshot.
 */
function sampleCapture(snapshot,voice) {
  let cache;
  if(Object.isFrozen(snapshot.ram)&&Object.isFrozen(snapshot.known)) {
    let knownCaches=capturedSamples.get(snapshot.ram);
    if(!knownCaches)capturedSamples.set(snapshot.ram,knownCaches=new WeakMap());
    cache=knownCaches.get(snapshot.known);
    if(!cache)knownCaches.set(snapshot.known,cache=new Map());
  }
  // The guard requirement follows the recorded speed, not a later key bend.
  // Cache by RAM identity and sample registers, never by advancing UI frames.
  const guard=Math.max(1,Math.ceil(voice.step/2048));
  const key=`${voice.start}:${voice.loopStart}:${guard}`;
  if(cache?.has(key)) {
    const cached=cache.get(key);
    if(cached.error)throw Error(cached.error);
    return cached;
  }
  try {
    let end=voice.start;
    while(sourceByte(snapshot,end)!==255) {
      if(end-voice.start>=PCM_MAX_FRAMES)throw Error(`PCM sample exceeds the Synth limit of ${PCM_MAX_FRAMES} frames.`);
      end++;
    }
    const frames=end-voice.start;
    if(!frames)throw Error('This PCM start address points directly to an end marker.');
    for(let offset=0;offset<guard;offset++) {
      if(sourceByte(snapshot,end+offset)!==255) {
        throw Error('PCM end marker has no safe guard at the recorded playback speed.');
      }
    }
    const loopByte=sourceByte(snapshot,voice.loopStart);
    const loopEnabled=loopByte!==255;
    if(loopEnabled&&(voice.loopStart<voice.start||voice.loopStart>=end)) {
      throw Error('This PCM loop jumps outside the contiguous sample; Copy and keyboard audition are unavailable.');
    }
    const bytes=Uint8Array.from(snapshot.ram.slice(voice.start,end));
    const result={bytes,data:base64(bytes),frames,start:voice.start,end,
      sourceLoopStart:voice.loopStart,loopStart:loopEnabled?voice.loopStart-voice.start:0,loopEnabled};
    if(cache) {
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(key,result);
    }
    return result;
  } catch(error) {
    if(cache) {
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(key,{error:error.message});
    }
    throw error;
  }
}

/** Detached source bytes for inspection, including currently muted channels. */
export function captureSynthPcmSongSample(snapshot,channel) {
  const voice=sourceVoice(snapshot,channel),capture=sampleCapture(snapshot,voice);
  return {...capture,bytes:capture.bytes.slice(),sampleRateHz:snapshot.clockHz/384*voice.step/2048};
}

/**
 * A display projection never changes the editor or the source chip. A valid
 * sample is still returned when Volume, Pan or the global enable is muted.
 * C4 is the reference key for recorded playback speed, not a detected pitch.
 */
export function createSynthPcmSongDisplay(snapshot,channel) {
  let voice;
  try {
    voice=sourceVoice(snapshot,channel);
    const capture=sampleCapture(snapshot,voice);
    const sampleRateHz=snapshot.clockHz/384*voice.step/2048;
    if(voice.step===0)throw Error('This PCM channel has zero playback step; no transposable sample speed.');
    if(sampleRateHz<PCM_MIN_SAMPLE_RATE||sampleRateHz>PCM_MAX_SAMPLE_RATE) {
      throw Error('This recorded PCM speed is outside the Synth sample-rate range.');
    }
    // All fields were checked above. Avoid decoding / validating the unchanged
    // base64 sample again on every Live frame; normal import still validates it.
    const preset={version:PCM_PRESET_VERSION,kind:PCM_PRESET_KIND,
      sample:{name:`PCM CH${channel+1}`,sampleRate:sampleRateHz,
      encoding:PCM_ENCODING,data:capture.data},settings:{volume:voice.volume,panLeft:voice.panLeft,
      panRight:voice.panRight,rootNote:60,loopEnabled:capture.loopEnabled,
      loopStart:capture.loopStart,loopEnd:capture.frames}};
    const reason=!snapshot.enabled?'The recorded PCM chip is globally disabled.':
      voice.volume===0?'This PCM channel has zero volume.':
      !voice.panLeft&&!voice.panRight?'This PCM channel has both pan outputs muted.':'';
    return {...voice,channel,preset,frames:capture.frames,playable:!reason,reason,
      sourceStart:capture.start,sourceEnd:capture.end,sourceLoopStart:capture.sourceLoopStart,
      loopEnabled:capture.loopEnabled,sampleRateHz};
  } catch(error) {
    return {...voice,channel,preset:null,frames:0,playable:false,reason:error.message,
      sourceStart:voice?.start,sourceEnd:null,sourceLoopStart:voice?.loopStart,
      sampleRateHz:voice?snapshot.clockHz/384*voice.step/2048:undefined};
  }
}

export function describeSynthPcmSongVoice(snapshot,channel) {
  const {preset,...description}=createSynthPcmSongDisplay(snapshot,channel);
  return description;
}

/** Copy one moment's hardware sample/settings, without its song's program. */
export function createSynthPcmSongCopyPreset(snapshot,channel) {
  const display=createSynthPcmSongDisplay(snapshot,channel);
  if(!display.playable)throw Error(display.reason);
  return display.preset;
}

/** A separate, asynchronously prepared keyboard endpoint, never the song chip. */
export async function createSynthPcmSongVoice(pcm,snapshot,channel,{getPitchClock=()=>7670454,signal}={}) {
  const preset=createSynthPcmSongCopyPreset(snapshot,channel);
  if(typeof getPitchClock!=='function'||['loadMemory','keyOff','keyOn','setChannel','setPitch'].some(name=>typeof pcm?.[name]!=='function')) {
    throw TypeError('PCM audition needs a keyboard endpoint and pitch clock.');
  }
  signal?.throwIfAborted();
  const voice=createSynthPcmVoice({getPcm:()=>pcm,getPitchClock,preset});
  await voice.install();
  signal?.throwIfAborted();
  return {
    ...describeSynthPcmSongVoice(snapshot,channel),
    getChannels:()=>[channel],
    getPreset:()=>voice.getPreset(),
    isReady:()=>voice.isReady(),
    noteOn(_channel,block,fnum) {return voice.noteOn(channel,block,fnum);},
    noteOff() {return voice.noteOff(channel);},
    setFrequency(_channel,block,fnum) {return voice.setFrequency(channel,block,fnum);},
    stop() {voice.stop();},
  };
}
