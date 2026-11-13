// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import factory from '../generated/gameboy_apu_wasm.js';
import {createGameboySongTimeline} from './song_state.js';
import {createGameboySongInteraction} from './song_interaction.js?v=dmg-vgm-manual-1';
import {patchGameboySnapshotEdit} from './code_live.js?v=dmg-vgm-manual-1';
import {readGameboyCodeEdit} from './code_parameter_edit.js';

export const MAX_DMG_SONG_BYTES = 64 * 1024 * 1024;
const nativeSchedule = globalThis.setTimeout.bind(globalThis), nativeCancel = globalThis.clearTimeout.bind(globalThis);
// Keep input latency bounded without dropping already-generated song audio.
// Live/DOM publication remains 20 Hz even though audio refills run more often.
const CHUNK = 256, LOOKAHEAD = .035, START_DELAY = .01, INTERVAL = 8, LIVE_INTERVAL = .05;
const aborted = () => new DOMException('DMG song operation cancelled','AbortError');
const checkAbort = signal => {if(signal?.aborted)throw aborted();};
const frozenSnapshot = state => {
  Object.freeze(state.registers);Object.freeze(state.voice);Object.freeze(state.observation);
  return Object.freeze(state);
};
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
  createEngine=createPreviewEngine,schedule=nativeSchedule,cancel=nativeCancel,nowMs=()=>performance.now(),
  yieldTask=()=>new Promise(resolve=>nativeSchedule(resolve,0)),seekChunkFrames=2048,seekTimeoutMilliseconds=30000}={}) {
  for (const callback of [getAudio,beforePlay,onState,onStatus,createEngine,schedule,cancel,nowMs,yieldTask]) if (typeof callback !== 'function') throw new TypeError('DMG song preview requires host callbacks');
  if(!Number.isInteger(seekChunkFrames)||seekChunkFrames<1||seekChunkFrames>2048)throw new RangeError('DMG seek slices must be 1..2048 frames');
  if(!Number.isFinite(seekTimeoutMilliseconds)||seekTimeoutMilliseconds<1||seekTimeoutMilliseconds>120000)throw new RangeError('DMG seek timeout must be 1..120000 milliseconds');
  let source=null,name='',active=null,generation=0,loadGeneration=0,loadController=null,loading=false,disposed=false;
  let playback='stopped',errorMessage='',positionFrames=0,sampleRate=44100,liveEnabled=true,liveVoice=0,liveSnapshot=null;
  let seeking=null,seekCleanup=Promise.resolve(),seekPreparing=0,seekMessage='';
  let channelMuteMask=0,nextRunId=0;
  const appliedChannelMasks=new WeakMap();
  function applyChannelMask(engine,mask=channelMuteMask,force=false) {
    const previous=appliedChannelMasks.get(engine);
    if(previous===mask&&!force)return;
    if(typeof engine.setChannelMuted!=='function') {
      if(mask)throw new Error('DMG reference engine does not support channel On/Off.');
    }else for(let channel=0;channel<4;channel++) {
      if(force||previous===undefined||((previous^mask)&(1<<channel)))engine.setChannelMuted(channel,Boolean(mask&(1<<channel)));
    }
    appliedChannelMasks.set(engine,mask);
  }
  const current = ticket => !disposed && ticket === generation;
  const position = run => {
    if (!run) return positionFrames;
    if (playback !== 'playing' || run.clockStart === null) return run.basePosition;
    return Math.min(run.renderedFrames,run.basePosition+Math.floor(Math.max(0,run.context.currentTime-run.clockStart)*run.sampleRate));
  };
  function observe(force=false) {
    if (!active || !['playing','paused'].includes(playback)) return liveSnapshot;
    const frame=position(active),groups=new Map();let state=active.timeline.read(frame);
    // Hand controls must not jump back to an older audible value between
    // consecutive key/drag steps. Overlay only their not-yet-heard fields;
    // every other field still follows the consumed song timeline.
    for(const [key,pending]of active.pendingEdits){
      if(pending.frame<=frame)active.pendingEdits.delete(key);
      else if(force||liveEnabled||!liveSnapshot){
        const {channel,changes}=pending.edit;
        if(!groups.has(channel))groups.set(channel,{channel,changes:{}});
        Object.assign(groups.get(channel).changes,changes);
      }
    }
    for(const edit of groups.values())state=patchGameboySnapshotEdit(state,edit);
    if(groups.size)state=frozenSnapshot(state);
    if (force || liveEnabled || !liveSnapshot) liveSnapshot=state;
    return liveSnapshot;
  }
  function interactionMessage(interaction=active?.interaction.read()) {
    if (disposed) return 'VGM song preview is disposed.';
    if (seeking || seekPreparing) return 'Wait for the VGM seek to finish.';
    if (loading || playback === 'starting') return 'Wait for VGM preparation to finish.';
    if (playback !== 'playing' || !active) return 'Direct VGM interaction is available while the song is playing.';
    if (active.eof || !active.player.isPlaying()) return 'Finishing song · already-rendered audio is retained.';
    if (!interaction?.initialized) return 'VGM has powered off the APU.';
    return '';
  }
  function read() {
    observe(); const frame=position(active), present=['playing','paused'].includes(playback);
    const interaction=active?{...active.interaction.read(),runId:active.runId}:null,message=interactionMessage(interaction);
    return {playback,playing:playback==='playing',paused:playback==='paused',busy:loading||playback==='starting'||Boolean(seeking)||seekPreparing>0,loading,
      hasSource:Boolean(source),name,errorMessage,sampleRate,positionFrames:frame,consumedFrames:frame,positionSeconds:frame/sampleRate,
      channelEnabled:Array.from({length:4},(_,channel)=>!(channelMuteMask&(1<<channel))),channelMuteMask,
      durationSeconds:(source?.totalSamples??0)/44100,totalSamples:source?.totalSamples??0,metadata:source?.metadata??null,warnings:source?.warnings??[],
      liveKind:'song',liveEnabled,liveVoice,liveActive:Boolean(present&&liveSnapshot),liveWaiting:Boolean(playback==='starting'||present&&!liveSnapshot),
      liveState:liveSnapshot,liveError:false,liveMessage:'',
      canInteract:!message,interactionMessage:message,interaction,
      pendingDisplayEdits:active?.pendingEdits.size??0,
      canPlay:Boolean(source&&!loading&&!seeking&&!seekPreparing&&playback!=='starting'&&playback!=='playing'),canPause:playback==='playing'&&!seeking,
      canResume:playback==='paused'&&!seeking&&!seekPreparing,canStop:Boolean(active||loading||playback==='starting'||seeking||seekPreparing),
      seeking:Boolean(seeking),seekPreparing:seekPreparing>0,canSeek:Boolean(source&&!loading&&playback!=='starting'&&(!seekPreparing||seeking)&&!seeking?.controller.signal.aborted&&!disposed),
      canCancelSeek:Boolean(seeking&&!seeking.controller.signal.aborted),seekTargetSeconds:seeking?.targetSeconds??null,
      seekTargetFrames:seeking?.targetFrame??null,seekProgressFrames:seeking?.progressFrame??0,
      seekProgressSeconds:seeking?(seeking.progressFrame/seeking.rate):0,seekMessage,
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
    run.pendingEdits.clear();
    try{run.gain?.disconnect();}finally{try{run.interaction.dispose();}finally{try{run.timeline.dispose();}finally{run.engine.dispose();}}}
  }
  function stop() {
    seeking?.controller.abort();seeking=null;seekMessage='';
    generation++;loadGeneration++;loadController?.abort();loadController=null;loading=false;
    const old=active;active=null;release(old);positionFrames=0;liveSnapshot=null;playback='stopped';errorMessage='';emit();
    return true;
  }
  async function load(bytes,nextName='') {
    checkOpen();const ticket=++loadGeneration;loadController?.abort();
    const controller=loadController=new AbortController();loading=true;emit();
    try {
      if(seeking){seeking.controller.abort();await seekCleanup;checkAbort(controller.signal);}
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
  function pump(run,forceEmit=false) {
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
        applyChannelMask(run.engine);
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
      if(run.eof&&position(run)>=run.renderedFrames){
        positionFrames=run.renderedFrames;liveSnapshot=run.timeline.read(positionFrames);active=null;playback='ended';release(run);emit();return;
      }
      if(forceEmit||run.lastEmitTime===null||run.context.currentTime-run.lastEmitTime>=LIVE_INTERVAL){run.lastEmitTime=run.context.currentTime;emit();}
      if(active===run&&playback==='playing')run.timer=schedule(()=>{run.timer=null;pump(run);},INTERVAL);
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
    if(seeking||seekPreparing){onStatus('Wait for the current seek to finish, or Stop it first.');return false;}
    if(loading){onStatus('Wait for VGM validation, then press Play.');return false;}
    if(!source)throw new Error('Choose a valid DMG VGM/VGZ song first');
    if(playback==='paused')return resume();
    if(playback==='playing')return true;
    const ticket=++generation,selected=source;release(active);active=null;positionFrames=0;liveSnapshot=null;playback='starting';errorMessage='';emit();
    let engine=null,timeline=null,interaction=null,gain=null;
    try {
      // load() has already validated the entire stream. Both trusted host
      // operations begin synchronously in this Play gesture, before awaits.
      const [host]=await prepareHost(ticket);if(!current(ticket))return false;
      const context=host?.context,output=host?.songInputNode??host?.output;
      if(!context||!output||output.context!==context||context.state==='closed')throw new Error('Reference output must belong to the Synth AudioContext');
      engine=await createEngine(selected.header);if(!current(ticket)){engine.dispose();engine=null;return false;}
      const rate=engine.sampleRate();if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new Error('Invalid DMG reference sample rate');sampleRate=rate;
      timeline=createGameboySongTimeline(engine,selected.header.gameBoyDmgClock);
      interaction=createGameboySongInteraction(engine);
      const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(selected.bytes,{logger:null});player.reset();
      applyChannelMask(engine,channelMuteMask,true);
      gain=context.createGain();gain.gain.value=1;gain.connect(output);
      const run={engine,timeline,interaction,player,context,output,gain,runId:++nextRunId,sampleRate:rate,basePosition:0,renderedFrames:0,clockStart:null,segments:[],pendingEdits:new Map(),timer:null,eof:false,released:false,lastEmitTime:null};
      active=run;engine=timeline=interaction=gain=null;playback='playing';player.play();pump(run,true);return playback==='playing'||playback==='ended';
    }catch(error){
      try{gain?.disconnect();}finally{try{interaction?.dispose();}finally{try{timeline?.dispose();}finally{engine?.dispose();}}}
      if(!current(ticket))return false;fail(error);return false;
    }
  }
  function pause() {
    checkOpen();const run=active;if(!run||playback!=='playing')return false;
    run.pendingEdits.clear();
    run.basePosition=position(run);positionFrames=run.basePosition;liveSnapshot=run.timeline.read(positionFrames);
    cancelTimer(run);cancelNodes(run);run.segments=run.segments.filter(segment=>segment.firstFrame+segment.frames>positionFrames);
    run.interaction.releaseKeyboard();
    run.player.pause();playback='paused';emit();return true;
  }
  async function resume() {
    checkOpen();const run=active;if(!run||playback!=='paused'||seeking||seekPreparing)return false;
    const ticket=++generation;playback='starting';emit();
    try {
      const [host]=await prepareHost(ticket);if(!current(ticket)||active!==run)return false;
      if(host.context!==run.context||(host.songInputNode??host.output)!==run.output||run.context.state==='closed')throw new Error('Audio output changed; press Play to restart the song');
      run.clockStart=run.context.currentTime+START_DELAY;playback='playing';run.player.resume();
      for(const segment of run.segments)scheduleSegment(run,segment);
      pump(run,true);return playback==='playing'||playback==='ended';
    }catch(error){if(current(ticket)&&active===run)fail(error,run);return false;}
  }
  function freezeRun(run) {
    const frame=position(run);
    if(run){run.pendingEdits.clear();run.basePosition=frame;cancelTimer(run);cancelNodes(run);run.segments=run.segments.filter(segment=>segment.firstFrame+segment.frames>frame);run.player.pause();run.interaction.releaseKeyboard();}
    positionFrames=frame;
    if(run)liveSnapshot=run.timeline.read(frame);
    return frame;
  }
  function restoreSeek(job) {
    const previous=job.previous;
    active=previous.run;positionFrames=previous.position;liveSnapshot=previous.snapshot;errorMessage=previous.error;
    playback=previous.phase;
    if(active&&playback==='playing') {
      active.clockStart=active.context.currentTime+START_DELAY;active.player.resume();
      for(const segment of active.segments)scheduleSegment(active,segment);
      pump(active,true);
    }else emit();
  }
  async function runSeek(job,preceding) {
    let candidate=null,engine=null,timeline=null,interaction=null;
    const valid=()=>current(job.ticket)&&seeking===job&&!job.controller.signal.aborted&&source===job.source;
    const check=()=>{if(!valid())throw aborted();if(nowMs()-job.started>seekTimeoutMilliseconds)throw new Error('DMG seek timed out; the previous song position was kept.');};
    try {
      // At most one candidate is initialized/rendered. A cancelled WASM init
      // and mutable host preparation must settle before its successor starts.
      await preceding;job.started=nowMs();check();
      seekPreparing++;emit();
      let host;
      try {
        let audioReady,hostReady;
        try{audioReady=requestAudio();}catch(error){audioReady=Promise.reject(error);}
        try{hostReady=beforePlay({isCurrent:valid});}catch(error){hostReady=Promise.reject(error);}
        const prepared=await Promise.allSettled([audioReady,hostReady]);
        const failure=prepared.find(item=>item.status==='rejected');if(failure)throw failure.reason;
        host=prepared[0].value;
      }finally{seekPreparing--;emit();}
      check();
      const context=host?.context,output=host?.songInputNode??host?.output;
      if(!context||!output||output.context!==context||context.state==='closed')throw new Error('Reference output must belong to the Synth AudioContext');
      engine=await createEngine(job.source.header);check();
      const rate=engine.sampleRate();if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new Error('Invalid DMG reference sample rate');
      job.rate=rate;job.targetFrame=Math.round(job.targetSeconds*rate);
      timeline=createGameboySongTimeline(engine,job.source.header.gameBoyDmgClock);
      interaction=createGameboySongInteraction(engine);
      const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);player.load(job.source.bytes,{logger:null});player.reset();player.play();
      applyChannelMask(engine,channelMuteMask,true);
      candidate={engine,timeline,interaction,player,context,output,gain:null,runId:++nextRunId,sampleRate:rate,basePosition:job.targetFrame,renderedFrames:job.targetFrame,clockStart:null,segments:[],pendingEdits:new Map(),timer:null,eof:false,released:false,lastEmitTime:null};
      engine=timeline=interaction=null;
      const left=new Float32Array(seekChunkFrames),right=new Float32Array(seekChunkFrames);
      let chunks=0,batchStarted=nowMs();
      while(job.progressFrame<job.targetFrame) {
        check();const requested=Math.min(seekChunkFrames,job.targetFrame-job.progressFrame);
        applyChannelMask(candidate.engine);
        const frames=player.process(left,right,requested,{budgetMs:4});
        if(!Number.isInteger(frames)||frames<0||frames>requested)throw new Error('Invalid DMG seek render length');
        for(let i=0;i<frames;i++)if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw new Error('DMG seek produced non-finite PCM');
        job.progressFrame+=frames;candidate.timeline.read(job.progressFrame);
        if(!frames&&!player.isPlaying()&&!player.queuedFrames)throw new Error('DMG seek ended before its target frame');
        if(++chunks>=8||nowMs()-batchStarted>=8||job.progressFrame===job.targetFrame) {
          emit();await yieldTask();chunks=0;batchStarted=nowMs();
        }
      }
      // Pull the target boundary's writes before observing, but retain these
      // future samples. They are never discarded or played during preparation.
      for(;;) {
        check();applyChannelMask(candidate.engine);const frames=player.process(left,right,CHUNK,{budgetMs:4});
        if(!Number.isInteger(frames)||frames<0||frames>CHUNK)throw new Error('Invalid DMG seek prefill length');
        if(frames) {
          for(let i=0;i<frames;i++)if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw new Error('DMG seek produced non-finite PCM');
          const buffer=context.createBuffer(2,frames,rate);buffer.copyToChannel(left.subarray(0,frames),0);buffer.copyToChannel(right.subarray(0,frames),1);
          candidate.segments.push({buffer,frames,firstFrame:job.targetFrame,node:null});candidate.renderedFrames+=frames;
        }
        candidate.eof=!player.isPlaying()&&player.queuedFrames===0;
        if(frames||candidate.eof)break;
        await yieldTask();
      }
      check();const snapshot=candidate.timeline.read(job.targetFrame);
      candidate.gain=context.createGain();candidate.gain.gain.value=1;candidate.gain.connect(output);
      const old=active;active=candidate;candidate=null;release(old);
      sampleRate=rate;positionFrames=job.targetFrame;liveSnapshot=snapshot;errorMessage='';seekMessage='';seeking=null;
      playback=job.previous.phase==='playing'?'playing':'paused';
      if(playback==='playing') {
        active.player.resume();for(const segment of active.segments)scheduleSegment(active,segment);pump(active,true);
      }else{active.player.pause();emit();}
      return true;
    }catch(error){
      if(current(job.ticket)&&seeking===job&&source===job.source) {
        seeking=null;seekMessage=error?.name==='AbortError'?'Seek cancelled.':`Seek failed: ${error?.message??String(error)}`;
        restoreSeek(job);if(error?.name!=='AbortError')onStatus(seekMessage);
      }
      return false;
    }finally{
      if(candidate)release(candidate);else{try{interaction?.dispose();}finally{try{timeline?.dispose();}finally{engine?.dispose();}}}
    }
  }
  async function seek(seconds) {
    checkOpen();if(!Number.isFinite(seconds))throw new TypeError('DMG seek seconds must be finite.');
    if(!source||loading||playback==='starting')return false;
    const oldJob=seeking;
    const previous=oldJob?.previous??{run:active,phase:playback,position:position(active),snapshot:liveSnapshot,error:errorMessage};
    oldJob?.controller.abort();
    if(!oldJob){previous.position=freezeRun(active);previous.snapshot??=liveSnapshot;liveSnapshot=previous.snapshot;}
    const targetSeconds=Math.max(0,Math.min(source.totalSamples/44100,seconds));
    const job={ticket:++generation,source,previous,targetSeconds,targetFrame:Math.round(targetSeconds*sampleRate),progressFrame:0,rate:sampleRate,controller:new AbortController(),started:nowMs(),promise:null};
    seeking=job;playback='seeking';seekMessage='Seeking…';
    job.promise=runSeek(job,seekCleanup);seekCleanup=job.promise.then(()=>undefined,()=>undefined);
    emit();
    return job.promise;
  }
  async function cancelSeek() {
    const job=seeking;if(!job){await seekCleanup;return false;}
    job.controller.abort();emit();await job.promise;return true;
  }
  function rememberEdits(run,edits,result){
    const frame=run.timeline.generatedFrames;
    // Validated channel:path keys bound this map to the known editor fields,
    // regardless of how many pointer/key-repeat events arrive at one frame.
    for(const value of edits){const edit=readGameboyCodeEdit(value),changes=edit.changes;
      // Sweep On/Off writes pace/shift codes; enabled is derived from them.
      // Store that actual effect instead of replaying a stale logical flag
      // over a later period-only or shift-only edit at the same audio frame.
      if(Object.hasOwn(changes,'pulse.sweep.enabled')){
        delete changes['pulse.sweep.enabled'];run.pendingEdits.delete('0:pulse.sweep.enabled');
        changes['pulse.sweep.period']=result.voice[0]>>4&7;changes['pulse.sweep.shift']=result.voice[0]&7;
      }
      if(Object.hasOwn(changes,'pulse.sweep.period'))changes['pulse.sweep.period']=result.voice[0]>>4&7;
      if(Object.hasOwn(changes,'pulse.sweep.shift'))changes['pulse.sweep.shift']=result.voice[0]&7;
      if(Object.hasOwn(changes,'pulse.sweep.direction'))changes['pulse.sweep.direction']=result.voice[0]&8?'down':'up';
      for(const [path,next]of Object.entries(edit.changes))run.pendingEdits.set(`${edit.channel}:${path}`,
        {frame,edit:{channel:edit.channel,changes:{[path]:next}}});
    }
  }
  function interact(method,args,{release=false,edits=null}={}) {
    checkOpen();
    if(!active||active.released||(!release&&interactionMessage()))return false;
    const planned=edits?.map(readGameboyCodeEdit);
    const result=active.interaction[method](...args);
    const applied=planned??result?.edits??[];
    rememberEdits(active,applied,result);
    if(!liveEnabled&&liveSnapshot&&applied.length)liveSnapshot=frozenSnapshot(applied.reduce(patchGameboySnapshotEdit,liveSnapshot));
    active.lastEmitTime=active.context.currentTime;emit();return result;
  }
  return {load,clear,play,pause,resume,stop,seek,cancelSeek,whenIdle:()=>seekCleanup,read,getState:read,
    applyEdit:edit=>interact('applyEdit',[edit],{edits:[edit]}),
    applyPreset(value,{runId,...options}={}) {
      checkOpen();if(runId!==undefined&&runId!==active?.runId)return false;
      return interact('applyPreset',[value,options]);
    },
    noteOn:(id,midi,options)=>interact('noteOn',[id,midi,options]),
    noteOff:id=>interact('noteOff',[id],{release:true}),
    releaseKeyboard:()=>interact('releaseKeyboard',[],{release:true}),
    // Releasing a wheel must clear its software bend even if the VGM just
    // powered off the APU (and has already retired every manual gate).
    setPitch:value=>interact('setPitch',[value],{release:value===0}),
    setChannelEnabled(channel,enabled) {
      checkOpen();
      if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('DMG song channel must be an integer 0..3');
      if(typeof enabled!=='boolean')throw new TypeError('DMG song channel enabled must be boolean');
      const next=enabled?channelMuteMask&~(1<<channel):channelMuteMask|(1<<channel);
      if(next===channelMuteMask)return read();
      // Output-only mixer flags: keep parser, generated/queued PCM, every
      // oscillator and the observation timeline untouched. The new mix is
      // audible after the already scheduled/queued samples have drained.
      if(active&&!active.released)applyChannelMask(active.engine,next);
      channelMuteMask=next;emit();return read();
    },
    setLiveEnabled(value){checkOpen();if(typeof value!=='boolean')throw new TypeError('Song Live enabled must be boolean');if(value===liveEnabled)return read();observe(true);liveEnabled=value;emit();return read();},
    setLiveVoice(value){checkOpen();if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('DMG song channel must be 0..3');if(value===liveVoice)return read();liveVoice=value;emit();return read();},
    dispose(){if(disposed)return;stop();disposed=true;source=null;name='';},
  };
}
