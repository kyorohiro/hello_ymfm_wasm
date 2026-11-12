import {normalizePcmSettings,PCM_RAM_BYTES,PCM_MAX_FRAMES} from './synth_pcm.js?v=pcm-live-draw-1';

export const PCM_RECORDING_MAX_COMPILED_BYTES=32*1024*1024;
export const PCM_RECORDING_COMPILED_KIND='tetorica-pcm-recording-compiled-v1';
const MAX_COMMANDS=100000,MAX_SECONDS=86400;
const integer=(value,min,max,label)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`Invalid PCM ${label}`);
  return value;
};
const positive=(value,max,label)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>max)throw new RangeError(`Invalid PCM ${label}`);
  return value;
};
const sessionNumber=value=>integer(value,1,Number.MAX_SAFE_INTEGER,'playback session');

/** Validate the private, already-decoded transfer before retiring a sound. */
function validatePrepared(value,sampleRate) {
  if(value?.kind!==PCM_RECORDING_COMPILED_KIND||value.version!==1||value.sampleRate!==sampleRate)throw new TypeError('Invalid prepared PCM recording');
  const durationFrames=integer(value.durationFrames,0,Math.round(MAX_SECONDS*sampleRate),'duration frames');
  if(!Array.isArray(value.banks)||!value.banks.length||value.banks.length*PCM_RAM_BYTES>PCM_RECORDING_MAX_COMPILED_BYTES||
    value.byteLength!==value.banks.length*PCM_RAM_BYTES||value.banks.some(bank=>!(bank instanceof Uint8Array)||bank.length!==PCM_RAM_BYTES)) {
    throw new TypeError('Invalid prepared PCM sample banks');
  }
  function configuration(config) {
    integer(config?.bank,0,value.banks.length-1,'bank reference');
    integer(config.frames,1,PCM_MAX_FRAMES,'source frames');
    const fields=['volume','panLeft','panRight','rootNote','loopEnabled','loopStart','loopEnd'];
    if(!config.settings||typeof config.settings!=='object'||Array.isArray(config.settings)||
      Reflect.ownKeys(config.settings).length!==fields.length||fields.some(field=>!Object.hasOwn(config.settings,field))) {
      throw new TypeError('Prepared PCM configurations require complete settings');
    }
    normalizePcmSettings(config.settings,config.frames);
    if(!Array.isArray(config.pitchFactors)||config.pitchFactors.length!==8||
      config.pitchFactors.some(factor=>typeof factor!=='number'||!Number.isFinite(factor)||factor<=0))throw new TypeError('Invalid PCM pitch factors');
    if(value.banks[config.bank][config.settings.loopEnd]!==255)throw new TypeError('Missing prepared PCM end marker');
  }
  configuration(value.initial);
  if(!Array.isArray(value.events)||!value.events.length||value.events.length>MAX_COMMANDS)throw new TypeError('Invalid prepared PCM event count');
  let previous=0,preceding=value.initial;
  for(const event of value.events) {
    integer(event?.frame,previous,durationFrames,'event frame');previous=event.frame;
    if(['setPreset','setSettings','editSample'].includes(event.type)){
      configuration(event.configuration);
      if(event.type==='editSample'&&(event.configuration.frames!==preceding.frames||
        Object.keys(preceding.settings).some(field=>event.configuration.settings[field]!==preceding.settings[field])||
        preceding.pitchFactors.some((value,index)=>value!==event.configuration.pitchFactors[index])))
        throw new TypeError('Prepared PCM sample editing must preserve the preceding sample shape and settings');
      preceding=event.configuration;continue;
    }
    if(event.type==='stop')continue;
    if(!['noteOn','noteOff','setFrequency'].includes(event.type))throw new TypeError('Invalid prepared PCM event type');
    integer(event.channel,0,7,'channel');
    if(event.type!=='noteOff'){integer(event.block,0,7,'keyboard block');integer(event.fnum,1,2047,'keyboard fnum');}
  }
  return value;
}

/**
 * Sample-clock playback on a dedicated synchronous RF5C164 API. The supplied
 * renderer advances that same private chip. No JSON, base64 or bank allocation
 * occurs in render(); all source banks arrive prepared from the main thread.
 */
export function createSynthPcmRecordingPlayer({sampleRate,pcm,onEnded=()=>{}}={}) {
  positive(sampleRate,768000,'render sample rate');
  if(typeof onEnded!=='function'||['reset','loadMemory','setChannel','setPitch','keyOn','keyOff'].some(name=>typeof pcm?.[name]!=='function')) {
    throw new TypeError('PCM playback needs a synchronous chip API and completion callback');
  }
  let latestSession=0,playing=false,prepared=null,configuration=null,head=0,frame=0,cycle=0,cycleFrames=0,loop=false,notesEnded=false;
  const held=new Map();
  const softwareRelease=typeof pcm.releaseNote==='function';
  const release=channel=>softwareRelease?pcm.releaseNote(channel):pcm.keyOff(channel);
  function silence() {for(let channel=0;channel<8;channel++)pcm.keyOff(channel);held.clear();}
  const step=(block,fnum)=>Math.max(1,Math.min(65535,Math.round(fnum*configuration.pitchFactors[block])));
  const loopAddress=()=>configuration.settings.loopEnabled?configuration.settings.loopStart:configuration.settings.loopEnd+1;
  function settings(next,force=false) {
    if(force||!configuration) {
      silence();configuration=next;pcm.loadMemory(prepared.banks[next.bank],0);return;
    }
    // End is a sample-RAM marker. Replacing its guarded bank does not require
    // keyOff/keyOn, so held voices retain their hardware playback positions.
    if(configuration.bank!==next.bank)pcm.loadMemory(prepared.banks[next.bank],0);
    configuration=next;
    for(const [channel,note]of held)pcm.setChannel(channel,{volume:next.settings.volume,
      pan:{left:next.settings.panLeft,right:next.settings.panRight},loopStart:loopAddress(),step:step(note.block,note.fnum)});
  }
  function startCycle() {
    silence();pcm.reset();configuration=null;head=frame=0;notesEnded=false;cycle++;
    settings(prepared.initial,true);
  }
  function apply(event) {
    if(event.type==='stop'){silence();return;}
    if(event.type==='editSample') {
      if(configuration.bank!==event.configuration.bank)pcm.loadMemory(prepared.banks[event.configuration.bank],0);
      configuration=event.configuration;return;
    }
    if(event.type==='setPreset'||event.type==='setSettings'){settings(event.configuration,event.type==='setPreset');return;}
    const channel=event.channel;
    if(event.type==='noteOn') {
      pcm.setChannel(channel,{start:0,loopStart:loopAddress(),step:step(event.block,event.fnum),volume:configuration.settings.volume,
        pan:{left:configuration.settings.panLeft,right:configuration.settings.panRight}});
      pcm.keyOn(channel);held.set(channel,{block:event.block,fnum:event.fnum});
    } else if(event.type==='noteOff') {
      if(held.has(channel)){release(channel);held.delete(channel);}
    } else {
      pcm.setPitch(channel,step(event.block,event.fnum));
      if(held.has(channel))held.set(channel,{block:event.block,fnum:event.fnum});
    }
  }
  function stop(session) {
    if(session!==undefined){sessionNumber(session);if(session<latestSession)return false;latestSession=session;}
    playing=false;silence();prepared=configuration=null;head=frame=0;return true;
  }
  return {
    play(value,{session,loop:repeat=false}={}) {
      const next=validatePrepared(value,sampleRate);sessionNumber(session);
      if(typeof repeat!=='boolean')throw new TypeError('PCM recording loop must be a boolean');
      if(session<=latestSession)return false;
      silence();latestSession=session;prepared=next;loop=repeat;
      cycleFrames=Math.max(1,next.durationFrames)+Math.max(1,Math.round(.01*sampleRate));
      cycle=0;playing=true;startCycle();return true;
    },
    stop,
    render(left,right,renderAudio) {
      if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||typeof renderAudio!=='function') {
        throw new TypeError('PCM playback needs stereo arrays and a renderer');
      }
      let offset=0;
      while(offset<left.length) {
        if(!playing){left.fill(0,offset);right.fill(0,offset);return;}
        while(head<prepared.events.length&&prepared.events[head].frame<=frame)apply(prepared.events[head++]);
        // Imported takes may omit the final key releases. Close those voices
        // at the performed end and let the private software tail finish inside
        // the existing cycle padding. Raw chip APIs retain their exact path.
        if(softwareRelease&&!notesEnded&&frame>=prepared.durationFrames) {
          for(const channel of held.keys())release(channel);
          held.clear();notesEnded=true;
        }
        if(frame>=cycleFrames) {
          if(loop){startCycle();continue;}
          const ended=latestSession;stop(ended);onEnded(ended);continue;
        }
        const next=Math.min(cycleFrames,head<prepared.events.length?prepared.events[head].frame:Infinity,
          softwareRelease&&!notesEnded?prepared.durationFrames:Infinity);
        const count=Math.min(left.length-offset,next-frame);
        renderAudio(left.subarray(offset,offset+count),right.subarray(offset,offset+count));frame+=count;offset+=count;
      }
    },
    snapshot:()=>({playing,session:latestSession,frame,cycle,cycleFrames,pendingEvents:prepared?prepared.events.length-head:0,
      preparedBytes:prepared?.byteLength??0,heldChannels:[...held.keys()].sort((a,b)=>a-b)}),
  };
}
