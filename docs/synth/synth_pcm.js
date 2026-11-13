// Synth authoring adapter for the existing RF5C164 core. No AudioContext,
// speaker, file decoder or extra synthesis is created by this module.
import {RF5C164_CLOCK} from '../js/rf5c164.js?v=audio-stability-2';

export const PCM_PRESET_VERSION=1;
export const PCM_PRESET_KIND='tetorica-rf5c164';
export const PCM_ENCODING='rf5c164-sign-magnitude';
export const PCM_RAM_BYTES=65536;
// A maximum step advances almost 32 samples per chip tick. Keep enough 0xff
// guards that a skipped end marker cannot wrap back to the waveform's start.
export const PCM_MAX_FRAMES=65503;
export const PCM_NATIVE_RATE=RF5C164_CLOCK/384;
export const PCM_MIN_SAMPLE_RATE=PCM_NATIVE_RATE/2048;
export const PCM_MAX_SAMPLE_RATE=384000;
// Leave native mixer headroom for eight simultaneous voices. The full hardware
// range remains available; this is a default register value, not output gain.
export const PCM_SETTINGS_DEFAULTS=Object.freeze({volume:64,panLeft:15,panRight:15,rootNote:60,
  loopEnabled:true,loopStart:0,loopEnd:256});
const settingFields=Object.keys(PCM_SETTINGS_DEFAULTS);
const sampleFields=['name','sampleRate','encoding','data'];
const ownObject=(value,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError(`Invalid ${label}`);
};
const exact=(value,keys,label)=>{
  ownObject(value,label);
  if(Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new TypeError(`Invalid ${label} fields`);
};
const integer=(value,min,max,label)=>{
  if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${label} must be an integer in range ${min}..${max}`);
  return value;
};
const sampleRate=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<PCM_MIN_SAMPLE_RATE||value>PCM_MAX_SAMPLE_RATE)throw new RangeError('Invalid PCM sample rate');
  return value;
};
const sampleName=value=>{
  if(typeof value!=='string'||!value.trim()||value.length>160||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError('Invalid PCM sample name');
  return value;
};
export const isPcmPreset=value=>value?.kind===PCM_PRESET_KIND;
export const isPcmPresetPath=path=>/\.pcm\.json$/i.test(String(path));

function encodeBase64(bytes) {
  const chunks=[];
  for(let offset=0;offset<bytes.length;offset+=8192)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+8192)));
  return btoa(chunks.join(''));
}

/** Decode only the sample frames. End markers are generated from loop settings. */
export function pcmSampleBytes(sample) {
  exact(sample,sampleFields,'PCM sample');sampleName(sample.name);sampleRate(sample.sampleRate);
  if(sample.encoding!==PCM_ENCODING)throw new Error('Unsupported PCM sample encoding');
  const data=sample.data;
  if(typeof data!=='string'||!data.length||data.length>Math.ceil(PCM_MAX_FRAMES/3)*4||data.length%4||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw new TypeError('Invalid PCM base64 sample');
  let binary;try {binary=atob(data);}catch {throw new TypeError('Invalid PCM base64 sample');}
  if(!binary.length||binary.length>PCM_MAX_FRAMES||btoa(binary)!==data)throw new TypeError('Noncanonical PCM base64 sample');
  const bytes=Uint8Array.from(binary,letter=>letter.charCodeAt(0));
  if(bytes.includes(255))throw new RangeError('PCM sample contains the reserved 0xff loop marker');
  return bytes;
}

/** Runtime settings may be partial; persisted documents require every field. */
export function normalizePcmSettings(value={},frames=256) {
  integer(frames,1,PCM_MAX_FRAMES,'PCM frame count');ownObject(value,'PCM settings');
  if(Reflect.ownKeys(value).some(key=>!settingFields.includes(key)))throw new TypeError('Unknown PCM setting');
  const next={...PCM_SETTINGS_DEFAULTS,loopEnd:frames,...value};
  integer(next.volume,0,255,'PCM volume');integer(next.panLeft,0,15,'PCM left pan');integer(next.panRight,0,15,'PCM right pan');
  integer(next.rootNote,0,127,'PCM root note');
  if(typeof next.loopEnabled!=='boolean')throw new TypeError('PCM loop enabled must be a boolean');
  integer(next.loopEnd,1,frames,'PCM loop end');integer(next.loopStart,0,next.loopEnd-1,'PCM loop start');
  return next;
}

export function normalizePcmPreset(value) {
  exact(value,['version','kind','settings','sample'],'PCM preset');
  if(value.version!==PCM_PRESET_VERSION||value.kind!==PCM_PRESET_KIND)throw new Error('Unsupported PCM preset version or kind');
  exact(value.settings,settingFields,'PCM settings');
  const bytes=pcmSampleBytes(value.sample),settings=normalizePcmSettings(value.settings,bytes.length);
  return {version:PCM_PRESET_VERSION,kind:PCM_PRESET_KIND,settings,sample:{...value.sample}};
}

/** A drawn edit changes amplitudes only; instrument replacement is separate. */
export function normalizePcmSampleEdit(current,value) {
  const previous=normalizePcmPreset(current),next=normalizePcmPreset(value);
  if(pcmSampleBytes(previous.sample).length!==pcmSampleBytes(next.sample).length||
    ['name','sampleRate','encoding'].some(field=>previous.sample[field]!==next.sample[field])||
    settingFields.some(field=>previous.settings[field]!==next.settings[field]))
    throw new TypeError('PCM drawing must preserve sample length, metadata and settings');
  return next;
}

/** Build a strict self-contained instrument from a sample and partial settings. */
export function createPcmPreset({sample,settings={}}={}) {
  if(sample===undefined) {
    const builtin=createPcmBuiltinPreset('sine');
    return normalizePcmPreset({...builtin,settings:normalizePcmSettings({...builtin.settings,...settings},256)});
  }
  const frames=pcmSampleBytes(sample).length;
  return normalizePcmPreset({version:PCM_PRESET_VERSION,kind:PCM_PRESET_KIND,
    settings:normalizePcmSettings(settings,frames),sample});
}

export function parsePcmPreset(data) {
  try {
    if(typeof data!=='string') {
      if(!(data instanceof Uint8Array)&&!(data instanceof ArrayBuffer))throw new TypeError('PCM presets require UTF-8 JSON');
      if(data.byteLength>512*1024)throw new RangeError('PCM preset JSON exceeds 512 KiB');
      data=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
    }
    if(data.length>512*1024)throw new RangeError('PCM preset JSON exceeds 512 KiB');
    return normalizePcmPreset(JSON.parse(data));
  } catch(error) {throw new Error(`Invalid PCM preset: ${error.message}`);}
}
export const serializePcmPreset=value=>JSON.stringify(normalizePcmPreset(value),null,2)+'\n';

/** Whole shared RAM image; all channels use aligned start address zero. */
export function buildPcmMemory(value) {
  const preset=normalizePcmPreset(value),source=pcmSampleBytes(preset.sample);
  const memory=new Uint8Array(PCM_RAM_BYTES);memory.fill(255);
  memory.set(source.subarray(0,preset.settings.loopEnd));
  // Loop Off points at LoopEnd+1, also 0xff. The core's marker-to-marker path
  // outputs silence without advancing; a 0x80 cell here would add a spurious
  // zero tick when a high-step looping voice skipped its first marker.
  return memory;
}

function encodeFloat(value) {
  const magnitude=Math.min(126,Math.round(Math.abs(Math.max(-1,Math.min(1,value)))*126));
  return magnitude|(value>=0?128:0);
}

export function createPcmBuiltinPreset(shape='sine') {
  if(!['sine','triangle','saw','square'].includes(shape))throw new RangeError('Unknown PCM builtin waveform');
  const frames=256,bytes=new Uint8Array(frames);
  for(let index=0;index<frames;index++) {
    const phase=index/frames;
    const value=shape==='sine'?Math.sin(phase*Math.PI*2):shape==='triangle'?1-4*Math.abs(phase-.5):shape==='saw'?2*phase-1:phase<.5?1:-1;
    bytes[index]=encodeFloat(value);
  }
  const name={sine:'Sine',triangle:'Triangle',saw:'Saw',square:'Square'}[shape];
  return createPcmPreset({sample:{name,sampleRate:frames*440*2**((60-69)/12),encoding:PCM_ENCODING,data:encodeBase64(bytes)}});
}

/** Software mono / 8-bit conversion; oversized audio is resampled to fit RAM. */
export function pcmPresetFromAudio(pcm,{name='Audio',settings={},autoFit=true}={}) {
  if(typeof autoFit!=='boolean')throw new TypeError('PCM auto fit must be a boolean');
  const channels=pcm?.channels,rate=sampleRate(pcm?.sampleRate);
  if(!Array.isArray(channels)||!channels.length||channels.length>32)throw new TypeError('Invalid decoded PCM channels');
  const frames=channels[0]?.length;
  if(!Number.isSafeInteger(frames)||frames<1||channels.some(channel=>!(Array.isArray(channel)||ArrayBuffer.isView(channel))||channel.length!==frames))throw new TypeError('Invalid decoded PCM frames');
  for(const channel of channels)for(const value of channel)if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('Nonfinite decoded PCM sample');
  let outputFrames=frames,outputRate=rate;
  if(frames>PCM_MAX_FRAMES) {
    if(!autoFit)throw new RangeError('PCM exceeds free 64 KiB sample RAM; enable software fit or shorten the audio');
    const duration=frames/rate,step=Math.floor(PCM_MAX_FRAMES/duration/PCM_NATIVE_RATE*2048);
    if(step<1)throw new RangeError('Audio is too long to fit 64 KiB at the minimum hardware playback rate');
    outputRate=step*PCM_NATIVE_RATE/2048;
    outputFrames=Math.min(PCM_MAX_FRAMES,Math.max(1,Math.ceil(duration*outputRate)));
  }
  const bytes=new Uint8Array(outputFrames),ratio=rate/outputRate;
  const monoAt=index=>channels.reduce((sum,channel)=>sum+channel[index]/channels.length,0);
  for(let index=0;index<outputFrames;index++) {
    if(outputFrames===frames)bytes[index]=encodeFloat(monoAt(index));
    else {
      // Box integration suppresses aliasing while downsampling, without an
      // AudioContext or a second full-size decoded audio allocation.
      const start=index*ratio,end=Math.min(frames,(index+1)*ratio);let sum=0;
      for(let frame=Math.floor(start);frame<Math.ceil(end);frame++)sum+=monoAt(frame)*Math.max(0,Math.min(end,frame+1)-Math.max(start,frame));
      bytes[index]=encodeFloat(sum/(end-start));
    }
  }
  const preset=createPcmPreset({sample:{name:sampleName(name),sampleRate:outputRate,encoding:PCM_ENCODING,data:encodeBase64(bytes)},
    settings:{loopEnabled:false,...settings}});
  const fitted=frames!==outputFrames;
  return {preset,notice:fitted?`Software resampling: ${frames} → ${outputFrames} frames to fit shared 64 KiB RAM (${outputRate.toFixed(1)} Hz).`:
    `Software conversion: ${frames} frames of 8-bit mono PCM.`,fitted,originalFrames:frames,originalSampleRate:rate};
}

/** Eight physical channels sharing one guarded sample-RAM image. */
export function createSynthPcmVoice({getPcm,getPitchClock=()=>7670454,onState=()=>{},onCommand=()=>{},preset=createPcmBuiltinPreset('sine')}={}) {
  if([getPcm,getPitchClock,onState,onCommand].some(callback=>typeof callback!=='function'))throw new TypeError('PCM callbacks must be functions');
  let current=normalizePcmPreset(preset),frames=pcmSampleBytes(current.sample).length,revision=0;
  let installed=null,installedRevision=-1,pending=null;
  const held=new Map();
  const getPreset=()=>({...current,settings:{...current.settings},sample:{...current.sample}});
  const getSettings=()=>({...current.settings});
  const isReady=()=>Boolean(installed&&installed===getPcm()&&installedRevision===revision);
  const getState=()=>({preset:getPreset(),settings:getSettings(),frames,ready:isReady(),
    heldChannels:[...held.keys()].sort((a,b)=>a-b),voices:[...held.values()].map(value=>({...value}))});
  const emit=()=>onState(getState());
  const channel=value=>integer(value,0,7,'PCM channel');
  function silence(pcm=getPcm()) {if(pcm)for(let ch=0;ch<8;ch++)pcm.keyOff(ch);held.clear();}
  function pitch(block,fnum) {
    integer(block,0,7,'Keyboard block');integer(fnum,1,2047,'Keyboard fnum');
    const clock=getPitchClock();
    if(typeof clock!=='number'||!Number.isFinite(clock)||clock<=0||clock>1000000000)throw new RangeError('Invalid keyboard pitch clock');
    const frequencyHz=fnum*clock*2**(block-1)/(144*2**20);
    const rootHz=440*2**((current.settings.rootNote-69)/12);
    const rawStep=Math.round(current.sample.sampleRate/PCM_NATIVE_RATE*2048*frequencyHz/rootHz);
    return {block,fnum,frequencyHz,step:Math.max(1,Math.min(65535,rawStep)),pitchClamped:rawStep<1||rawStep>65535};
  }
  const loopAddress=()=>current.settings.loopEnabled?current.settings.loopStart:current.settings.loopEnd+1;
  function install(pcm=getPcm()) {
    if(!pcm)return Promise.resolve(false);
    if(isReady()&&pcm===installed)return Promise.resolve(true);
    if(pending?.pcm===pcm&&pending.revision===revision)return pending.promise;
    const selectedRevision=revision,memory=buildPcmMemory(current);
    // End edits replace only the guarded RAM image. Keep the active channel
    // mask and cursor: the next marker redirects a voice to its loop address.
    // A new sample / endpoint still needs the initial silent installation.
    if(installed!==pcm) {silence(pcm);installed=null;installedRevision=-1;}
    const owner={pcm,revision:selectedRevision,promise:null};
    owner.promise=Promise.resolve().then(()=>{
      if(revision!==selectedRevision||getPcm()!==pcm)return false;
      return pcm.loadMemory(memory,0);
    }).then(()=>{
      if(revision!==selectedRevision||getPcm()!==pcm)return false;
      installed=pcm;installedRevision=selectedRevision;emit();return true;
    }).finally(()=>{if(pending===owner)pending=null;});
    pending=owner;return owner.promise;
  }
  return {
    getPreset,getSettings,getState,isReady,install,getChannels:()=>[0,1,2,3,4,5,6,7],
    setPreset(value) {
      const next=normalizePcmPreset(value),nextFrames=pcmSampleBytes(next.sample).length;
      silence();current=next;frames=nextFrames;revision++;installed=null;installedRevision=-1;
      onCommand({type:'setPreset',preset:getPreset()});emit();return getPreset();
    },
    editSample(value) {
      const next=normalizePcmSampleEdit(current,value);
      if(next.sample.data===current.sample.data)return false;
      // Keep the installed endpoint and voice positions. install() transfers
      // the new guarded bytes in FIFO order, just like a live End edit.
      current=next;revision++;
      onCommand({type:'editSample',preset:getPreset()});emit();return true;
    },
    setSettings(patch,{applyHardware=true}={}) {
      if(typeof applyHardware!=='boolean')throw new TypeError('PCM applyHardware must be boolean');
      ownObject(patch,'PCM settings patch');
      const next=normalizePcmSettings({...current.settings,...patch},frames),previous=current.settings;
      if(settingFields.every(field=>next[field]===previous[field]))return getSettings();
      if(next.loopEnd!==previous.loopEnd)revision++;
      current={...current,settings:next};
      const pcm=getPcm();
      if(pcm&&installed===pcm)for(const [ch,note] of held) {
        const changed=pitch(note.block,note.fnum);
        if(applyHardware)pcm.setChannel(ch,{volume:next.volume,pan:{left:next.panLeft,right:next.panRight},loopStart:loopAddress(),step:changed.step});
        held.set(ch,{channel:ch,...changed});
      }
      onCommand({type:'setSettings',settings:getSettings()});emit();return getSettings();
    },
    noteOn(ch,block,fnum) {
      channel(ch);const note=pitch(block,fnum),pcm=getPcm();if(!pcm||!isReady())return null;
      pcm.setChannel(ch,{start:0,loopStart:loopAddress(),step:note.step,volume:current.settings.volume,
        pan:{left:current.settings.panLeft,right:current.settings.panRight}});
      pcm.keyOn(ch);held.set(ch,{channel:ch,...note});onCommand({type:'noteOn',channel:ch,block,fnum});emit();return {channel:ch,...note};
    },
    noteOff(ch) {
      channel(ch);if(!held.has(ch))return false;
      const pcm=getPcm();
      if(typeof pcm?.releaseNote==='function')pcm.releaseNote(ch);else pcm?.keyOff(ch);
      held.delete(ch);onCommand({type:'noteOff',channel:ch});emit();return true;
    },
    forgetNote(ch){channel(ch);const removed=held.delete(ch);if(removed)emit();return removed;},
    setFrequency(ch,block,fnum) {
      channel(ch);const note=pitch(block,fnum),pcm=getPcm();if(!pcm||installed!==pcm)return null;
      pcm.setPitch(ch,note.step);if(held.has(ch))held.set(ch,{channel:ch,...note});
      onCommand({type:'setFrequency',channel:ch,block,fnum});emit();return {channel:ch,...note};
    },
    stop() {silence();onCommand({type:'stop'});emit();},
  };
}
