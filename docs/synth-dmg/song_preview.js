// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import factory from '../generated/gameboy_apu_wasm.js';
import {createGameboySongTimeline} from './song_state.js';

export const MAX_DMG_SONG_BYTES = 64 * 1024 * 1024;
const nativeSchedule = globalThis.setTimeout.bind(globalThis), nativeCancel = globalThis.clearTimeout.bind(globalThis);
const CHUNK = 2048, LOOKAHEAD = .2, START_DELAY = .01, INTERVAL = 50;
const aborted = () => new DOMException('DMG song operation cancelled','AbortError');
const checkAbort = signal => {if(signal?.aborted)throw aborted();};
const binary = source => {
  const bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
  if (!bytes) throw new TypeError('Choose a binary VGM or VGZ file');
  if (bytes.byteLength > MAX_DMG_SONG_BYTES) throw new RangeError('VGM/VGZ file exceeds 64 MiB');
  return bytes.slice();
};

async function decode(source,signal) {
  const bytes = binary(source); checkAbort(signal);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function') throw new Error('VGZ requires browser gzip support');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => {void reader.cancel().catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  const chunks = []; let length = 0;
  try {
    for (;;) {
      checkAbort(signal); const {value,done} = await reader.read(); checkAbort(signal);
      if (done) break;
      length += value.length;
      if (length > MAX_DMG_SONG_BYTES) {await reader.cancel();throw new RangeError('Expanded VGZ exceeds 64 MiB');}
      chunks.push(value);
    }
  } finally {signal?.removeEventListener('abort',cancel);reader.releaseLock();}
  const output = new Uint8Array(length);let offset=0;
  for (const chunk of chunks) {output.set(chunk,offset);offset+=chunk.length;}
  return output;
}

/** Entire-file validation before any audio context, chip or ownership hook.
 * The existing parser does not dispatch Game Boy DAC stream type 0x13: reject
 * streams/data blocks explicitly rather than playing an incomplete song. */
export async function prepareGameboySongSource(source,{signal,yieldTask=()=>new Promise(resolve=>nativeSchedule(resolve,0))}={}) {
  let bytes = await decode(source,signal);checkAbort(signal);
  if (bytes.length < 0x84) throw new Error('Truncated VGM header: a Game Boy clock is required');
  let view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const eof = view.getUint32(4,true);
  if (eof && (eof + 4 > bytes.length || eof + 4 < 0x84)) throw new Error('Invalid or truncated VGM file size');
  if (eof && eof+4<bytes.length) {bytes=bytes.slice(0,eof+4);view=new DataView(bytes.buffer);}
  const parser = new Ym2612VGM(bytes,{logger:null}), header = parser.header;
  if (header.dataOffset < 0x84 || header.dataOffset >= bytes.length) throw new Error('Invalid DMG VGM data offset');
  if (!header.gameBoyDmgClock) throw new Error('This VGM contains no Game Boy DMG chip');
  if (header.gameBoyDmgClock & 0xc0000000) throw new Error('DMG song playback does not support dual or variant Game Boy chips');
  if (header.gameBoyDmgClock !== 4194304) throw new Error('DMG song playback requires the normal 4194304 Hz clock');
  const others = Object.entries(header).filter(([key,value]) => key.endsWith('Clock') && value && key !== 'gameBoyDmgClock').map(([key])=>key.slice(0,-5));
  if (others.length) throw new Error(`DMG song playback supports one Game Boy APU only. Unsupported chip: ${others.join(', ')}`);
  let position=header.dataOffset, count=0, totalSamples=0, ended=false, writes=0;
  while (position < bytes.length) {
    checkAbort(signal);
    if (++count > 4_000_000) throw new Error('VGM exceeds four million commands');
    const command=bytes[position];
    if (command === 0x66) {ended=true;break;}
    if (command === 0xb3) {
      if (position + 3 > bytes.length) throw new Error('Truncated Game Boy VGM register write');
      const register=bytes[position+1];
      if (register & 128) throw new Error('Second Game Boy chip writes are not supported');
      if (register > 47) throw new Error('VGM writes outside the Game Boy sound-register/Wave RAM range');
      writes++;position+=3;
    } else if (command === 0x61) {
      if (position+3>bytes.length) throw new Error('Truncated VGM wait');
      totalSamples+=view.getUint16(position+1,true);position+=3;
    } else if (command === 0x62 || command === 0x63) {totalSamples+=command===0x62?735:882;position++;}
    else if (command >= 0x70 && command <= 0x7f) {totalSamples+=(command&15)+1;position++;}
    else if (command >= 0x90 && command <= 0x95 || command === 0x67 || command === 0x68) {
      throw new Error('DMG song playback does not support DAC streams or their data blocks; the shared player does not implement Game Boy stream type 0x13');
    } else throw new Error(`DMG song playback does not support VGM command 0x${command.toString(16).padStart(2,'0')}`);
    if (count%4096===0) await yieldTask();
  }
  checkAbort(signal);
  if (!ended) throw new Error('VGM command stream has no end command');
  if (!writes || !totalSamples) throw new Error('VGM contains no timed Game Boy audio');
  return {bytes,header,totalSamples,metadata:parseVgmMetadata(bytes),
    warnings:header.loopOffset?['Reference playback plays this VGM once; its loop is not repeated.']:[]};
}

const createPreviewEngine = header => GameboyApuAudioEngine.create({moduleFactory:factory,
  clock:header.gameBoyDmgClock,outputSampleRate:44100,masterVolume:1});

/** A separate reference APU, borrowing the editor's AudioContext and calibrated
 * songInputNode. This controller never changes/closes the author's chip or
 * context. Retained PCM and its exact offset survive Pause without replay. */
export function createGameboySongPreview({getAudio,beforePlay=async()=>{},onState=()=>{},onStatus=()=>{},
  createEngine=createPreviewEngine,schedule=nativeSchedule,cancel=nativeCancel,nowMs=()=>performance.now()}={}) {
  for (const callback of [getAudio,beforePlay,onState,onStatus,createEngine,schedule,cancel,nowMs]) if (typeof callback !== 'function') throw new TypeError('DMG song preview requires host callbacks');
  let source=null,name='',active=null,generation=0,loadGeneration=0,loadController=null,loading=false,disposed=false;
  let playback='stopped',errorMessage='',positionFrames=0,sampleRate=44100,liveEnabled=true,liveVoice=0,liveSnapshot=null;
  const current = ticket => !disposed && ticket === generation;
  const position = run => {
    if (!run) return positionFrames;
    if (playback !== 'playing' || run.clockStart === null) return run.basePosition;
    return Math.min(run.renderedFrames,run.basePosition+Math.floor(Math.max(0,run.context.currentTime-run.clockStart)*run.sampleRate));
  };
  function observe(force=false) {
    if (!active || !['playing','paused'].includes(playback)) return liveSnapshot;
    const state=active.timeline.read(position(active));
    if (force || liveEnabled || !liveSnapshot) liveSnapshot=state;
    return liveSnapshot;
  }
  function read() {
    observe(); const frame=position(active), present=['playing','paused'].includes(playback);
    return {playback,playing:playback==='playing',paused:playback==='paused',busy:loading||playback==='starting',loading,
      hasSource:Boolean(source),name,errorMessage,sampleRate,positionFrames:frame,consumedFrames:frame,positionSeconds:frame/sampleRate,
      durationSeconds:(source?.totalSamples??0)/44100,totalSamples:source?.totalSamples??0,metadata:source?.metadata??null,warnings:source?.warnings??[],
      liveKind:'song',liveEnabled,liveVoice,liveActive:Boolean(present&&liveSnapshot),liveWaiting:Boolean(playback==='starting'||present&&!liveSnapshot),
      liveState:liveSnapshot,liveError:false,liveMessage:'',
      canPlay:Boolean(source&&!loading&&playback!=='starting'&&playback!=='playing'),canPause:playback==='playing',
      canResume:playback==='paused',canStop:Boolean(active||loading||playback==='starting'),
      renderedFrames:active?.renderedFrames??positionFrames,
      bufferedFrames:active?Math.max(0,active.renderedFrames-frame):0,pendingEvents:active?.timeline.pendingEvents??0};
  }
  const emit = () => {if(!disposed)onState(read());};
  const checkOpen = () => {if(disposed)throw new Error('DMG song preview is disposed');};
  function cancelTimer(run) {if(run?.timer!==null){cancel(run.timer);run.timer=null;}}
  function cancelNodes(run) {
    for (const segment of run?.segments??[]) {
      const node=segment.node;if(!node)continue;segment.node=null;node.onended=null;
      try{node.stop();}catch{}try{node.disconnect();}catch{}
    }
  }
  function release(run) {
    if(!run||run.released)return;run.released=true;cancelTimer(run);cancelNodes(run);run.segments=[];
    try{run.gain.disconnect();}finally{try{run.timeline.dispose();}finally{run.engine.dispose();}}
  }
  function stop() {
    generation++;loadGeneration++;loadController?.abort();loadController=null;loading=false;
    const old=active;active=null;release(old);positionFrames=0;liveSnapshot=null;playback='stopped';errorMessage='';emit();
    return true;
  }
  async function load(bytes,nextName='') {
    checkOpen();const ticket=++loadGeneration;loadController?.abort();
    const controller=loadController=new AbortController();loading=true;emit();
    try {
      const prepared=await prepareGameboySongSource(bytes,{signal:controller.signal});
      if(disposed||ticket!==loadGeneration)throw aborted();
      generation++;const old=active;active=null;release(old);
      source=prepared;name=String(nextName);positionFrames=0;liveSnapshot=null;playback='stopped';errorMessage='';
      return true;
    } catch(error) {
      if(!disposed&&ticket===loadGeneration&&error?.name!=='AbortError')onStatus(`VGM load failed: ${error.message}. Previous song kept.`);
      throw error;
    } finally {if(ticket===loadGeneration){loadController=null;loading=false;emit();}}
  }
  function clear() {checkOpen();stop();source=null;name='';emit();}
  function fail(error,run=null) {
    if(run&&active!==run)return;
    positionFrames=position(run??active);const old=run??active;active=null;release(old);liveSnapshot=null;
    playback='error';errorMessage=error?.message??String(error);onStatus(`VGM playback failed: ${errorMessage}`);emit();
  }
  function scheduleSegment(run,segment) {
    const offset=Math.max(0,run.basePosition-segment.firstFrame);if(offset>=segment.frames)return;
    run.clockStart??=run.context.currentTime+START_DELAY;
    const node=run.context.createBufferSource();node.buffer=segment.buffer;node.connect(run.gain);segment.node=node;
    node.onended=()=>{try{node.disconnect();}catch{}if(segment.node===node)segment.node=null;};
    const at=run.clockStart+Math.max(0,segment.firstFrame-run.basePosition)/run.sampleRate;
    node.start(at,offset/run.sampleRate);
  }
  function pump(run) {
    if(active!==run||playback!=='playing')return;
    try {
      const consumed=position(run);positionFrames=consumed;
      run.timeline.read(consumed);
      run.segments=run.segments.filter(segment=>{
        if(segment.firstFrame+segment.frames>consumed)return true;
        try{segment.node?.disconnect();}catch{}return false;
      });
      if(!run.eof&&run.clockStart!==null&&run.context.currentTime>run.clockStart+(run.renderedFrames-run.basePosition)/run.sampleRate+.02){
        // A throttled refill resumes at the first unheard frame, not a later
        // parser position. No new song events are skipped to catch up.
        run.basePosition=run.renderedFrames;run.clockStart=null;
      }
      const deadline=nowMs()+8;
      for(let chunks=0;!run.eof&&chunks<8&&nowMs()<deadline;chunks++) {
        if((run.renderedFrames-position(run))/run.sampleRate>=LOOKAHEAD)break;
        const left=new Float32Array(CHUNK),right=new Float32Array(CHUNK);
        const frames=run.player.process(left,right,CHUNK,{budgetMs:4});
        if(!Number.isInteger(frames)||frames<0||frames>CHUNK)throw new Error('Invalid DMG reference render length');
        if(frames) {
          for(let i=0;i<frames;i++)if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw new Error('DMG reference produced non-finite PCM');
          const buffer=run.context.createBuffer(2,frames,run.sampleRate);buffer.copyToChannel(left.subarray(0,frames),0);buffer.copyToChannel(right.subarray(0,frames),1);
          const segment={buffer,frames,firstFrame:run.renderedFrames,node:null};run.renderedFrames+=frames;run.segments.push(segment);scheduleSegment(run,segment);
        }
        run.eof=!run.player.isPlaying()&&run.player.queuedFrames===0;
        if(!frames)break;
      }
      observe();
      if(run.eof&&position(run)>=run.renderedFrames){
        positionFrames=run.renderedFrames;liveSnapshot=run.timeline.read(positionFrames);active=null;playback='ended';release(run);emit();return;
      }
      emit();if(active===run&&playback==='playing')run.timer=schedule(()=>{run.timer=null;pump(run);},INTERVAL);
    }catch(error){fail(error,run);}
  }
  function requestAudio() {
    const requested=getAudio();
    const context=requested&&typeof requested.then!=='function'?requested.context:null;
    const resumed=context?context.resume():undefined;
    return Promise.all([Promise.resolve(requested),Promise.resolve(resumed)]).then(([host])=>host);
  }
  function prepareHost(ticket) {
    const ready=requestAudio();
    let preparation;
    try{preparation=beforePlay({isCurrent:()=>current(ticket)});}
    catch(error){preparation=Promise.reject(error);}
    return Promise.all([ready,Promise.resolve(preparation)]);
  }
  async function play() {
    checkOpen();
    if(loading){onStatus('Wait for VGM validation, then press Play.');return false;}
    if(!source)throw new Error('Choose a valid DMG VGM/VGZ song first');
    if(playback==='paused')return resume();
    if(playback==='playing')return true;
    const ticket=++generation,selected=source;release(active);active=null;positionFrames=0;liveSnapshot=null;playback='starting';errorMessage='';emit();
    let engine=null,timeline=null,gain=null;
    try {
      // load() has already validated the entire stream. Both trusted host
      // operations begin synchronously in this Play gesture, before awaits.
      const [host]=await prepareHost(ticket);if(!current(ticket))return false;
      const context=host?.context,output=host?.songInputNode??host?.output;
      if(!context||!output||output.context!==context||context.state==='closed')throw new Error('Reference output must belong to the Synth AudioContext');
      engine=await createEngine(selected.header);if(!current(ticket)){engine.dispose();engine=null;return false;}
      const rate=engine.sampleRate();if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new Error('Invalid DMG reference sample rate');sampleRate=rate;
      timeline=createGameboySongTimeline(engine,selected.header.gameBoyDmgClock);
      const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(selected.bytes,{logger:null});player.reset();
      gain=context.createGain();gain.gain.value=1;gain.connect(output);
      const run={engine,timeline,player,context,output,gain,sampleRate:rate,basePosition:0,renderedFrames:0,clockStart:null,segments:[],timer:null,eof:false,released:false};
      active=run;engine=timeline=gain=null;playback='playing';player.play();pump(run);return playback==='playing'||playback==='ended';
    }catch(error){
      try{gain?.disconnect();}finally{try{timeline?.dispose();}finally{engine?.dispose();}}
      if(!current(ticket))return false;fail(error);return false;
    }
  }
  function pause() {
    checkOpen();const run=active;if(!run||playback!=='playing')return false;
    run.basePosition=position(run);positionFrames=run.basePosition;liveSnapshot=run.timeline.read(positionFrames);
    cancelTimer(run);cancelNodes(run);run.segments=run.segments.filter(segment=>segment.firstFrame+segment.frames>positionFrames);
    run.player.pause();playback='paused';emit();return true;
  }
  async function resume() {
    checkOpen();const run=active;if(!run||playback!=='paused')return false;
    const ticket=++generation;playback='starting';emit();
    try {
      const [host]=await prepareHost(ticket);if(!current(ticket)||active!==run)return false;
      if(host.context!==run.context||(host.songInputNode??host.output)!==run.output||run.context.state==='closed')throw new Error('Audio output changed; press Play to restart the song');
      run.clockStart=run.context.currentTime+START_DELAY;playback='playing';run.player.resume();
      for(const segment of run.segments)scheduleSegment(run,segment);
      pump(run);return playback==='playing'||playback==='ended';
    }catch(error){if(current(ticket)&&active===run)fail(error,run);return false;}
  }
  return {load,clear,play,pause,resume,stop,read,getState:read,
    setLiveEnabled(value){checkOpen();if(typeof value!=='boolean')throw new TypeError('Song Live enabled must be boolean');if(value===liveEnabled)return read();observe(true);liveEnabled=value;emit();return read();},
    setLiveVoice(value){checkOpen();if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('DMG song channel must be 0..3');if(value===liveVoice)return read();liveVoice=value;emit();return read();},
    dispose(){if(disposed)return;stop();disposed=true;source=null;name='';},
  };
}
