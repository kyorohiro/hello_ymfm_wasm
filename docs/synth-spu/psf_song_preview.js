// SPDX-License-Identifier: BSD-3-Clause
// PSF song transport. The disposable player borrows the editor's final bus;
// it never replaces the authored instrument or owns its AudioContext.
import {SPU_SYNTH_MIX_HEADROOM} from './spu_synth_levels.js';
import {createSynthCodeOutput} from '../synth/synth_code_output.js?v=scheduled-input-1';

const abortError=()=>new DOMException('PSF playback was cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
const nativeSchedule=(callback,delay)=>setTimeout(callback,delay);
const nativeCancel=timer=>clearTimeout(timer);
const nativeNow=globalThis.performance?.now.bind(globalThis.performance)??Date.now.bind(Date);
const nativeYield=()=>new Promise(resolve=>nativeSchedule(resolve,0));
const LIVE_INTERVAL_FRAMES=2205; // 44,100 Hz / 20; independent of AudioBuffer size.
const SPU_RAM_BYTES=512*1024;

function abortable(value,signal) {
  return new Promise((resolve,reject)=>{
    const aborted=()=>{signal.removeEventListener('abort',aborted);reject(signal.reason??abortError());};
    if(signal.aborted){Promise.resolve(value).catch(()=>{});aborted();return;}
    signal.addEventListener('abort',aborted,{once:true});
    Promise.resolve(value).then(result=>{signal.removeEventListener('abort',aborted);resolve(result);},
      cause=>{signal.removeEventListener('abort',aborted);reject(cause);});
  });
}

function detachedObservation(value,frame) {
  if(!value||typeof value!=='object'||value.nativeFrames!==frame||!Array.isArray(value.channels)||value.channels.length!==24)
    throw new TypeError('PSF observation must contain all 24 voices at the current native frame');
  // Copy once at capture, not on every UI read. The public snapshot is deeply
  // immutable, so consumers cannot change either retained history or the core.
  const snapshot=structuredClone(value),seen=new WeakSet();
  function freeze(node) {
    if(node===null||typeof node!=='object'||seen.has(node))return;
    if(!Array.isArray(node)&&Object.getPrototypeOf(node)!==Object.prototype)
      throw new TypeError('PSF observation must contain plain state data');
    seen.add(node);for(const child of Object.values(node))freeze(child);Object.freeze(node);
  }
  freeze(snapshot);return snapshot;
}

function selectedSource(set,entry) {
  if(!set||!(set.records instanceof Map)||typeof entry!=='string'||!set.records.has(entry))throw new TypeError('Choose an entry in the opened PSF set');
  const record=set.records.get(entry),title=record.tags?.get?.('title')||entry;
  return {set,entry,title:String(title)};
}

/** createCore receives {set, entry, signal} and returns a disposable PSF1
 * machine with sampleRate:44100 and synchronous render(frames), producing
 * interleaved stereo Float32Array. File selection itself allocates no audio.
 * An optional synchronous observe() supplies all 24 voices and nativeFrames.
 * Optional renderWithVoices(frames) advances that same machine once and returns
 * {pcm:stereo, voices:frame-major CH1 L/R ... CH24 L/R}. Bounded lookahead owns
 * both, so the listening helper can switch its unplayed route without seeking.
 * Live captures at most 20 states per emulated second, before rendering their
 * samples, and exposes only the immutable state at/before the audible cursor.
 * Optional copySpuRam() returns a detached 512 KiB Uint8Array at that same
 * boundary. RAM stays private and is copied out only by explicit paused
 * Capture. Default lookahead retains at most seven RAM images (3.5 MiB), plus
 * at most one frozen paused image; larger configured lookahead scales the bound.
 *
 * Already rendered buffers survive Pause. Resume schedules their unconsumed
 * samples before asking the machine for new PCM, retaining the exact machine
 * position without rerunning initialization or dropping lookahead audio.
 *
 * seek(seconds) initializes one candidate, discards bounded stereo renders
 * from its beginning and yields after every slice. Only a successful candidate
 * replaces the retained run. Paused/stopped seeks stay paused; a playing seek
 * resumes. Cancel/failure restores the old route and position. The wall-time
 * limit is checked between native calls; one synchronous render cannot be
 * interrupted. No long PCM/checkpoint cache is created by seeking.
 */
export function createPsfSongPreview({getAudio,beforePlay=()=>{},beforeSeek=beforePlay,onUpdate=()=>{},createCore,
  schedule=nativeSchedule,cancel=nativeCancel,lookaheadSeconds=.2,chunkFrames=2048,
  refillMilliseconds=25,startDelaySeconds=.01,createOutput=createSynthCodeOutput,
  yieldSeek=nativeYield,seekNowMs=nativeNow,seekChunkFrames=2048,seekMaxSeconds=1800,seekTimeoutMilliseconds=30000}={}) {
  for(const fn of [getAudio,beforePlay,beforeSeek,onUpdate,createCore,schedule,cancel,createOutput,yieldSeek,seekNowMs])if(typeof fn!=='function')throw new TypeError('PSF preview needs host callbacks');
  if(!Number.isInteger(chunkFrames)||chunkFrames<1||chunkFrames>32768)throw new RangeError('PSF preview chunks must be 1..32768 frames');
  if(!Number.isFinite(lookaheadSeconds)||lookaheadSeconds<=0||lookaheadSeconds>1)throw new RangeError('PSF lookahead must be greater than zero and at most one second');
  if(!Number.isFinite(refillMilliseconds)||refillMilliseconds<1||refillMilliseconds>1000)throw new RangeError('Invalid PSF refill interval');
  if(!Number.isFinite(startDelaySeconds)||startDelaySeconds<0||startDelaySeconds>1)throw new RangeError('Invalid PSF startup delay');
  if(!Number.isInteger(seekChunkFrames)||seekChunkFrames<1||seekChunkFrames>2048)throw new RangeError('PSF seek slices must be 1..2048 frames');
  if(!Number.isFinite(seekMaxSeconds)||seekMaxSeconds<=0||seekMaxSeconds>1800)throw new RangeError('PSF seek range must be greater than zero and at most 1800 seconds');
  if(!Number.isFinite(seekTimeoutMilliseconds)||seekTimeoutMilliseconds<1||seekTimeoutMilliseconds>120000)throw new RangeError('PSF seek timeout must be 1..120000 milliseconds');
  let source=null,starting=null,run=null,generation=0,disposed=false,liveEnabled=true,liveVoice=0,monitorEnabled=false;
  let seeking=null,seekMessage='',seekCleanup=Promise.resolve(),seekCleanupPending=0;
  let message='Open a PSF set and choose an entry to play.',error=false;
  const disposals=new WeakMap(),closing=new Set(),seekPreparations=new Set();
  // One audible predecessor plus the bounded rendering lookahead and at most
  // one overhanging AudioBuffer. No history is retained for the whole song.
  const liveHistoryLimit=Math.ceil((lookaheadSeconds*44100+chunkFrames)/LIVE_INTERVAL_FRAMES)+2;
  const current=owner=>!disposed&&owner.generation===generation&&source===owner.source;
  function position(item=run) {
    if(!item)return 0;
    if(item.phase!=='playing')return item.consumed;
    const now=item.context.currentTime;let consumed=item.consumed;
    // Only scheduled PCM can have been consumed. Rendering a slow chunk must
    // not advance the song through samples which have not reached Web Audio.
    for(const segment of item.segments) {
      if(!segment.node)break;
      if(now<segment.at)return Math.max(consumed,segment.first);
      if(now<segment.until)return Math.max(consumed,segment.first+Math.floor((now-segment.at)*item.rate+1e-7));
      consumed=segment.end;
    }
    return consumed;
  }
  function read() {
    const playing=run?.phase==='playing',paused=run?.phase==='paused',resuming=run?.phase==='resuming';
    const seekPreparing=seekPreparations.size>0;
    const liveState=liveEnabled&&run?audibleObservation(run):null,liveError=liveEnabled?run?.liveError??'':'';
    const capture=captureStatus(),retained=run?retainedObservations(run):[];
    return {selection:source?{entry:source.entry,title:source.title}:null,name:source?.entry??'',
      playing,paused,resuming,starting:Boolean(starting),busy:Boolean(starting||resuming||seeking||seekPreparing),
      positionSeconds:run?position()/run.rate:0,message,error,
      canPlay:Boolean(source&&!starting&&!run&&!seeking&&!seekPreparing&&!disposed),canPause:Boolean(playing&&!seeking&&!seekPreparing),canResume:Boolean(paused&&!seeking&&!seekPreparing),
      canStop:Boolean(starting||run||seeking||seekPreparing),seeking:Boolean(seeking),seekPreparing,canSeek:Boolean(source&&!starting&&!resuming&&!seeking&&!seekPreparing&&!disposed),
      canCancelSeek:Boolean(seeking&&!seeking.controller.signal.aborted),seekMaxSeconds,
      seekTargetSeconds:seeking?seeking.targetFrame/44100:null,seekProgressSeconds:seeking?seeking.progressFrame/44100:0,seekMessage,
      liveKind:'psf',liveEnabled,liveVoice,liveState,
      liveActive:Boolean(run&&liveEnabled&&liveState&&!liveError),
      liveWaiting:Boolean(run&&liveEnabled&&!liveState&&!liveError),liveError:Boolean(liveError),liveMessage:liveError,
      liveFrame:liveState?.nativeFrames??null,liveBufferedSnapshots:retained.length,
      canCapture:capture.ready,captureMessage:capture.message,captureFrame:capture.observed?.frame??null,
      captureBufferedBytes:retained.reduce((bytes,value)=>bytes+(value.ram?.byteLength??0),0),
      monitorEnabled,monitorSwitching:Boolean(run?.monitorSwitching),monitorVoice:run?.monitorVoice??null,
      monitorAvailable:Boolean(run?.monitorAvailable),monitorError:Boolean(run?.monitorError),monitorMessage:run?.monitorError??'',
      monitorBufferedBytes:run?run.segments.reduce((bytes,value)=>bytes+(value.voices?.byteLength??0)+(value.selectedBuffer?value.selectedBuffer.length*8:0),0):0,
      liveSource:{name:source?.title??'PSF',entry:source?.entry??''}};
  }
  function emit(){if(!disposed)onUpdate(read());}
  function say(text,bad=false){message=text;error=bad;emit();}
  function disposeCore(core) {
    if(!core||typeof core.dispose!=='function')return Promise.resolve();
    if(disposals.has(core))return disposals.get(core);
    let value;try{value=core.dispose();}catch(cause){value=Promise.reject(cause);}
    const done=Promise.resolve(value);disposals.set(core,done);closing.add(done);
    void done.then(()=>closing.delete(done),()=>closing.delete(done));return done;
  }
  function stopNodes(item) {
    for(const segment of item.segments) {
      if(!segment.node)continue;
      segment.node.onended=null;try{segment.node.stop();}catch{}
      try{segment.node.disconnect();}catch{}segment.node=null;
    }
    item.nextTime=null;
  }
  function cancelRefill(item){if(item.timer!==null){cancel(item.timer);item.timer=null;}}
  function retire(item) {
    if(!item)return Promise.resolve();
    cancelRefill(item);stopNodes(item);item.controller.abort();item.phase='stopped';
    item.segments=[];clearLive(item);item.monitorOutput.dispose();try{item.monitorGate.disconnect();}catch{}try{item.output.disconnect();}catch{}
    return disposeCore(item.core);
  }
  function stop() {
    generation++;const pending=starting,previous=run,pendingSeek=seeking;starting=null;run=null;seeking=null;
    pending?.controller.abort();
    pendingSeek?.controller.abort();if(pendingSeek&&pendingSeek.deadline!==null)nativeCancel(pendingSeek.deadline);seekMessage='';
    const tasks=[...closing,...[...seekPreparations].map(task=>task.catch(()=>{}))];if(pending?.core)tasks.push(disposeCore(pending.core));if(previous)tasks.push(retire(previous));
    say(source?'Stopped. PSF selection and edited instrument kept.':'Stopped. Open a PSF set to play.');
    return Promise.all(tasks).then(()=>undefined);
  }
  function fail(item,cause) {
    if(run!==item||!current(item))return;
    run=null;generation++;void retire(item).catch(()=>{});
    say(`PSF playback failed: ${cause?.message??String(cause)}. Edited instrument and selected entry kept.`,true);
  }
  function trim(item) {
    item.consumed=position(item);
    while(item.segments.length&&item.segments[0].end<=item.consumed) {
      const segment=item.segments.shift();
      if(segment.node){segment.node.onended=null;try{segment.node.disconnect();}catch{}}
    }
    trimLive(item);
  }
  function clearLive(item,keepPaused=false) {
    item.liveHistory=[];if(!keepPaused)item.livePaused=null;item.liveError='';item.nextLiveFrame=item.rendered;
  }
  function retainedObservations(item) {
    return item.livePaused&&!item.liveHistory.includes(item.livePaused)?[...item.liveHistory,item.livePaused]:item.liveHistory;
  }
  function audibleEntry(item) {
    if(item.phase==='paused'||item.phase==='resuming')return item.livePaused;
    const frame=position(item);let snapshot=null;
    for(const observed of item.liveHistory){if(observed.frame>frame)break;snapshot=observed;}
    return snapshot;
  }
  function audibleObservation(item){return audibleEntry(item)?.state??null;}
  function captureStatus() {
    if(seeking||seekPreparations.size)return {ready:false,observed:null,message:'Wait for PSF seeking to finish before capturing a channel.'};
    if(!run)return {ready:false,observed:null,message:'Play and pause a PSF song to capture its selected channel.'};
    if(run.phase!=='paused')return {ready:false,observed:null,message:'Pause the PSF song before capturing its selected channel.'};
    if(!liveEnabled)return {ready:false,observed:null,message:'Turn PSF Live on to capture the paused channel.'};
    const observed=audibleEntry(run);
    if(!observed)return {ready:false,observed:null,message:'No matching audible PSF snapshot is available. Resume with Live on, then pause again.'};
    if(!observed.ram)return {ready:false,observed,message:observed.captureError||'PSF Capture RAM is unavailable for this snapshot.'};
    return {ready:true,observed,message:`Capture paused CH ${liveVoice+1} at native frame ${observed.frame}.`};
  }
  function capturePaused() {
    const capture=captureStatus();
    if(!capture.ready)throw new Error(capture.message);
    const observed=capture.observed;
    return {state:observed.state,ram:new Uint8Array(observed.ram),voice:liveVoice,frame:observed.frame,
      source:{entry:run.source.entry,title:run.source.title}};
  }
  function trimLive(item) {
    const frame=position(item),history=item.liveHistory;
    while(history.length>1&&history[1].frame<=frame)history.shift();
    // Normal operation fits this bound by construction. If the host clock is
    // unusual, discard distant future displays rather than retain more RAM or
    // display a future state early.
    if(history.length>liveHistoryLimit)history.length=liveHistoryLimit;
  }
  function captureLive(item,frame) {
    item.nextLiveFrame=frame+LIVE_INTERVAL_FRAMES;
    if(!liveEnabled)return;
    try {
      if(typeof item.core.observe!=='function')throw new Error('this PSF engine does not expose voice observation');
      const state=detachedObservation(item.core.observe(),frame);
      let ram=null,captureError='';
      try {
        if(typeof item.core.copySpuRam!=='function')throw new Error('this PSF engine does not expose RAM snapshots');
        const value=item.core.copySpuRam();
        if(!(value instanceof Uint8Array)||value.byteLength!==SPU_RAM_BYTES)
          throw new TypeError('the RAM snapshot must be a Uint8Array containing exactly 512 KiB');
        // copySpuRam's contract transfers a detached owned image. Keep it out
        // of the frozen/public Live state and never expose this private view.
        ram=value.byteOffset===0&&value.buffer.byteLength===SPU_RAM_BYTES?value:new Uint8Array(value);
      }catch(cause){captureError=`PSF Capture is unavailable: ${cause?.message??String(cause)}`;}
      if(run!==item||!current(item)||!liveEnabled)return;
      item.liveHistory.push({frame,state,ram,captureError});item.liveError='';trimLive(item);
    }catch(cause) {
      if(run===item&&current(item)&&liveEnabled)
        item.liveError=`PSF Live observation failed: ${cause?.message??String(cause)}`;
    }
  }
  function renderPart(item,frames) {
    // A single native pass advances all 24 voices, the CPU and shared effects.
    // Stems are passive pre-shared-reverb taps; changing the listening route
    // never rerenders a sample or changes any chip register.
    const rendered=item.monitorAvailable?item.core.renderWithVoices(frames):{pcm:item.core.render(frames),voices:null};
    const pcm=rendered?.pcm;
    if(!(pcm instanceof Float32Array)||pcm.length!==frames*2||pcm.some(value=>!Number.isFinite(value)))
      throw new Error('PSF engine returned invalid stereo PCM');
    let voices=null;
    if(item.monitorAvailable) {
      const value=rendered?.voices;
      if(!(value instanceof Float32Array)||value.length!==frames*48||value.some(sample=>!Number.isFinite(sample))) {
        item.monitorAvailable=false;item.monitorError='Selected-channel listening is unavailable: the PSF engine returned invalid voice PCM. Full song playback is kept.';
      }else voices=value;
    }
    return {pcm,voices};
  }
  function renderChunk(item) {
    const end=item.rendered+chunkFrames,pcm=new Float32Array(chunkFrames*2),voices=item.monitorAvailable?new Float32Array(chunkFrames*48):null;let at=item.rendered;
    while(at<end) {
      // A snapshot belongs to the sample about to be generated, not to the
      // later machine state at the end of a lookahead buffer.
      if(liveEnabled&&at>=item.nextLiveFrame)captureLive(item,at);
      const frames=liveEnabled?Math.min(end-at,item.nextLiveFrame-at):end-at;
      const part=renderPart(item,frames);
      pcm.set(part.pcm,(at-item.rendered)*2);if(part.voices)voices.set(part.voices,(at-item.rendered)*48);at+=frames;
    }
    return {pcm,voices:item.monitorAvailable?voices:null};
  }
  function effectiveMonitorVoice(item){return monitorEnabled&&item.monitorAvailable?liveVoice:null;}
  function segmentBuffer(item,segment) {
    if(item.monitorVoice===null)return segment.buffer;
    if(!segment.voices)throw new Error('Selected-channel PCM is unavailable for retained PSF audio');
    if(segment.selectedVoice!==item.monitorVoice) {
      const buffer=item.context.createBuffer(2,segment.end-segment.start,item.rate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);
      for(let frame=0;frame<buffer.length;frame++) {
        const offset=frame*48+item.monitorVoice*2;left[frame]=segment.voices[offset];right[frame]=segment.voices[offset+1];
      }
      // At most one selected stereo buffer accompanies each full buffer.
      segment.selectedBuffer=buffer;segment.selectedVoice=item.monitorVoice;
    }
    return segment.selectedBuffer;
  }
  function openScheduledMonitor(item) {
    if(run!==item||!current(item)||item.phase!=='playing')return;
    const first=item.segments.find(segment=>segment.node);
    // Generation and Web Audio scheduling can take longer than the fade-in.
    // Anchor the ramp to the actual new source, rather than the earlier time
    // at which we started preparing its retained audio.
    if(first)item.monitorOutput.open({notBefore:first.at,freshInput:true});
  }
  function requestMonitorSwitch(item) {
    if(run!==item||!current(item))return Promise.resolve(false);
    if(item.monitorTask)return item.monitorTask;
    if(effectiveMonitorVoice(item)===item.monitorVoice)return Promise.resolve(true);
    cancelRefill(item);item.monitorSwitching=true;emit();
    const task=(async()=>{
      do {
        await item.monitorOutput.fadeOut();
        if(run!==item||!current(item))return false;
        // Include the samples consumed during the fade, then retain the exact
        // next frame. Only Web Audio nodes/routes change; the core stays put.
        trim(item);cancelRefill(item);stopNodes(item);
        item.monitorVoice=effectiveMonitorVoice(item);
        if(item.phase==='playing') {refill(item,true);openScheduledMonitor(item);}
        else emit();
      }while(run===item&&current(item)&&effectiveMonitorVoice(item)!==item.monitorVoice);
      return run===item&&current(item);
    })().catch(cause=>{fail(item,cause);return false;}).finally(()=>{
      if(item.monitorTask===task){item.monitorTask=null;item.monitorSwitching=false;}
      if(run===item&&current(item)){
        // A request arriving between the worker's final check and this Promise
        // reaction must also settle before callers/Resume consider it ready.
        if(effectiveMonitorVoice(item)!==item.monitorVoice)return requestMonitorSwitch(item);
        emit();queue(item);
      }
    });
    item.monitorTask=task;return task;
  }
  function scheduleSegment(item,segment) {
    const offset=Math.max(0,item.consumed-segment.start),frames=segment.end-segment.start-offset;
    if(frames<=0||segment.node)return;
    const node=item.context.createBufferSource();segment.node=node;node.buffer=segmentBuffer(item,segment);
    node.connect(item.monitorGate);
    // This clock is read after generation, not before a potentially expensive
    // first JIT/render. Existing future nodes keep their times; only a newly
    // scheduled chunk can move forward across an underrun gap.
    const at=Math.max(item.nextTime??0,item.context.currentTime+startDelaySeconds);
    segment.first=segment.start+offset;segment.at=at;segment.until=at+frames/item.rate;
    item.nextTime=segment.until;node.start(at,offset/item.rate,frames/item.rate);
  }
  function queue(item) {
    if(run!==item||!current(item)||item.phase!=='playing'||item.timer!==null||item.monitorSwitching)return;
    item.timer=schedule(()=>{item.timer=null;refill(item);},refillMilliseconds);item.timer?.unref?.();
  }
  function refill(item,fromMonitor=false) {
    if(run!==item||!current(item)||item.phase!=='playing'||item.monitorSwitching&&!fromMonitor)return;
    try {
      trim(item);
      const target=item.consumed+Math.ceil(lookaheadSeconds*item.rate);
      while(item.rendered<target) {
        const {pcm,voices}=renderChunk(item);
        const buffer=item.context.createBuffer(2,chunkFrames,item.rate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);
        for(let frame=0;frame<chunkFrames;frame++){left[frame]=pcm[frame*2];right[frame]=pcm[frame*2+1];}
        item.segments.push({start:item.rendered,end:item.rendered+chunkFrames,buffer,voices,selectedVoice:null,selectedBuffer:null,node:null});item.rendered+=chunkFrames;
      }
      // AudioContext time continues advancing while synchronous emulation is
      // busy. Retire only genuinely played old nodes, retaining every newly
      // rendered, not-yet-scheduled sample for the next source.
      trim(item);
      if(effectiveMonitorVoice(item)!==item.monitorVoice){void requestMonitorSwitch(item);return;}
      for(const segment of item.segments)scheduleSegment(item,segment);
      emit();queue(item);
    }catch(cause){fail(item,cause);}
  }
  function validateCore(core) {
    if(core?.sampleRate!==44100||typeof core.render!=='function'||typeof core.dispose!=='function')
      throw new Error('PSF engine must render 44,100 Hz stereo PCM');
  }
  function makeRun(owner,audio,phase='playing',frame=0) {
    const context=audio?.context;
    if(!context||context.state==='closed'||!audio.gain)throw new Error('SPU editor audio is unavailable');
    let output,monitorGate;
    try {
      output=context.createGain();output.gain.value=1/SPU_SYNTH_MIX_HEADROOM;output.connect(audio.gain);
      monitorGate=context.createGain();monitorGate.gain.value=1;monitorGate.connect(output);
      const monitorAvailable=typeof owner.core.renderWithVoices==='function';
      const item={generation:owner.generation,source:owner.source,controller:owner.controller,core:owner.core,
        audio,context,output,monitorGate,rate:44100,segments:[],rendered:frame,consumed:frame,
        monitorAvailable,monitorVoice:monitorEnabled&&monitorAvailable?liveVoice:null,monitorSwitching:false,monitorTask:null,
        monitorError:monitorEnabled&&!monitorAvailable?'Selected-channel listening is unavailable in this PSF engine. Full song playback is kept.':'',
        nextTime:null,phase,timer:null,liveHistory:[],livePaused:null,liveError:'',nextLiveFrame:frame};
      item.monitorOutput=createOutput({getContext:()=>run===item&&current(item)?item.context:null,
        getGain:()=>run===item&&current(item)?item.monitorGate:null});
      return item;
    }catch(cause){try{monitorGate?.disconnect();}catch{}try{output?.disconnect();}catch{}throw cause;}
  }
  function seekClock() {
    const value=seekNowMs();if(!Number.isFinite(value))throw new Error('PSF seek clock must be finite');return value;
  }
  function checkSeek(owner) {
    if(seeking!==owner||!current(owner)||owner.controller.signal.aborted)throw owner.controller.signal.reason??abortError();
    if(seekClock()-owner.startedAt>=seekTimeoutMilliseconds)throw new Error('PSF seek exceeded its processing-time limit.');
  }
  async function performSeek(owner,previousCleanup) {
    let candidate=null;
    try {
      // An aborted initializer may still be completing its WASM allocation.
      // Never start a second candidate until that core has been disposed.
      await abortable(previousCleanup,owner.controller.signal);checkSeek(owner);
      const original=owner.original;
      if(original) {
        while(original.monitorTask)await abortable(original.monitorTask,owner.controller.signal);
        checkSeek(owner);
        if(original.phase==='playing') {
          owner.fadedOriginal=true;
          await abortable(original.monitorOutput.fadeOut(),owner.controller.signal);checkSeek(owner);
          pauseRun(original);
        }
      }
      owner.preparation=Promise.resolve(beforeSeek({signal:owner.controller.signal,isCurrent:()=>seeking===owner&&current(owner)&&!owner.controller.signal.aborted}));
      seekPreparations.add(owner.preparation);
      const prepared=()=>{seekPreparations.delete(owner.preparation);emit();};
      void owner.preparation.then(prepared,prepared);emit();
      await abortable(owner.preparation,owner.controller.signal);checkSeek(owner);
      owner.initialization=Promise.resolve(createCore({set:owner.source.set,entry:owner.source.entry,signal:owner.controller.signal})).then(core=>{owner.core=core;return core;});
      const core=await abortable(owner.initialization,owner.controller.signal);checkSeek(owner);validateCore(core);
      let slice=Math.min(256,seekChunkFrames),lastUpdate=owner.startedAt;
      while(owner.progressFrame<owner.targetFrame) {
        checkSeek(owner);
        const frames=Math.min(slice,owner.targetFrame-owner.progressFrame),started=seekClock();
        // No stems, AudioBuffers, RAM snapshots or accumulated PCM during
        // seeking. A native slice cannot be interrupted; yield after each.
        const pcm=core.render(frames);
        if(!(pcm instanceof Float32Array)||pcm.length!==frames*2||pcm.some(value=>!Number.isFinite(value)))
          throw new Error('PSF engine returned invalid stereo PCM while seeking');
        owner.progressFrame+=frames;
        const now=seekClock(),elapsed=Math.max(.25,now-started);
        slice=Math.max(1,Math.min(seekChunkFrames,Math.ceil(frames*2),Math.floor(frames*10/elapsed)));
        if(now-lastUpdate>=50||owner.progressFrame===owner.targetFrame) {
          lastUpdate=now;seekMessage=`Seeking ${owner.source.title}: ${(owner.progressFrame/44100).toFixed(2)} / ${(owner.targetFrame/44100).toFixed(2)} s…`;emit();
        }
        await abortable(yieldSeek(),owner.controller.signal);checkSeek(owner);
      }
      const audio=owner.original?.audio??await abortable(getAudio(),owner.controller.signal);checkSeek(owner);
      candidate=makeRun(owner,audio,'paused',owner.targetFrame);checkSeek(owner);
      // Commit only now. The original run, its unconsumed PCM and frozen
      // observation remain intact until the candidate reaches the exact frame.
      const previous=run;run=candidate;owner.committed=true;seeking=null;
      if(owner.deadline!==null){nativeCancel(owner.deadline);owner.deadline=null;}
      if(liveEnabled){captureLive(candidate,owner.targetFrame);candidate.livePaused=candidate.liveHistory.at(-1)??null;}
      if(previous)owner.retirement=retire(previous).catch(()=>{});
      seekMessage=`Seek complete at ${(owner.targetFrame/44100).toFixed(2)} s.`;
      say(`Paused ${source.title} at ${(owner.targetFrame/44100).toFixed(2)} s.`);
      if(owner.restorePlaying)return await abortable(resume(),owner.controller.signal);
      return run===candidate&&current(candidate);
    }catch(cause) {
      // Host preparation may already be mutating the authored bank. Unlike
      // an isolated WASM initializer, it cannot safely finish after Cancel
      // re-enables editing or a replacement performance takes ownership.
      if(seeking===owner&&current(owner))await Promise.resolve(owner.preparation).catch(()=>{});
      const accepted=seeking===owner&&current(owner);
      if(accepted) {
        seeking=null;
        if(candidate)await retire(candidate).catch(()=>{});
        const previous=owner.original;
        if(previous&&run===previous&&current(previous)&&owner.restorePlaying&&(previous.phase!=='playing'||owner.fadedOriginal)) {
          // Cancellation can interrupt a fade before Pause. Rebuild only the
          // scheduled route at its true audible cursor, never the machine.
          if(previous.phase==='playing')pauseRun(previous);
          await abortable(resume(),previous.controller.signal).catch(()=>{});
        }
        if(!disposed&&generation===owner.generation&&source===owner.source&&!seeking) {
          const cancelled=isAbort(cause)||owner.cancelled;
          seekMessage=cancelled?'Seek cancelled. Previous song position kept.':`PSF seek failed: ${cause?.message??String(cause)}. Previous song position kept.`;
          say(seekMessage,!cancelled);
        }
      }else if(candidate&&!owner.committed)await retire(candidate).catch(()=>{});
      return false;
    }finally {
      if(owner.deadline!==null)nativeCancel(owner.deadline);
      // Cancelling is responsive even while an initializer ignores its signal.
      // Its eventual core still belongs to this cleanup tail, which the next
      // seek/Play waits for before allocating another machine.
      void Promise.all([Promise.resolve(owner.initialization).catch(()=>{}),Promise.resolve(owner.preparation).catch(()=>{}),owner.retirement]).then(()=>owner.committed?undefined:disposeCore(owner.core)).catch(()=>{}).then(()=>{
        seekCleanupPending--;owner.releaseCleanup();
      });
    }
  }
  async function seek(seconds) {
    if(disposed)throw new Error('PSF preview is disposed');
    if(!Number.isFinite(seconds)||seconds<0||seconds>seekMaxSeconds)throw new RangeError(`PSF seek position must be 0..${seekMaxSeconds} seconds`);
    if(!source)throw new Error('Choose a PSF entry first');
    if(starting||run?.phase==='resuming')return false;
    const previous=seeking,previousCleanup=seekCleanup;
    const owner={generation,source,controller:new AbortController(),core:null,initialization:null,preparation:null,retirement:null,committed:false,cancelled:false,fadedOriginal:Boolean(previous?.fadedOriginal),
      original:previous?.original??run,restorePlaying:previous?.restorePlaying??run?.phase==='playing',
      targetFrame:Math.round(seconds*44100),progressFrame:0,startedAt:seekClock(),deadline:null,releaseCleanup:null,task:null};
    previous?.controller.abort();if(previous&&previous.deadline!==null)nativeCancel(previous.deadline);
    seekCleanupPending++;seekCleanup=new Promise(resolve=>{owner.releaseCleanup=resolve;});seeking=owner;
    owner.deadline=nativeSchedule(()=>owner.controller.abort(new Error('PSF seek exceeded its processing-time limit.')),seekTimeoutMilliseconds);
    seekMessage=`Preparing seek to ${(owner.targetFrame/44100).toFixed(2)} s…`;
    owner.task=Promise.resolve().then(()=>performSeek(owner,previousCleanup));say(seekMessage);
    return owner.task;
  }
  async function cancelSeek() {
    const owner=seeking;if(!owner)return false;
    owner.cancelled=true;owner.controller.abort();if(owner.deadline!==null)nativeCancel(owner.deadline);
    await owner.task;return true;
  }
  async function play() {
    if(disposed)throw new Error('PSF preview is disposed');
    if(seeking)return false;
    if(run?.phase==='paused')return resume();
    if(starting||run)return false;
    if(!source)throw new Error('Choose a PSF entry first');
    const owner={generation:++generation,source,controller:new AbortController(),core:null};starting=owner;
    const check=()=>{if(!current(owner)||starting!==owner)throw abortError();};
    say(`Preparing ${source.title}…`);
    try {
      if(seekCleanupPending)await abortable(seekCleanup,owner.controller.signal);check();
      owner.core=await createCore({set:owner.source.set,entry:owner.source.entry,signal:owner.controller.signal});check();
      validateCore(owner.core);
      await beforePlay({signal:owner.controller.signal,isCurrent:()=>current(owner)&&starting===owner});check();
      const audio=await getAudio();check();
      const item=makeRun(owner,audio);
      run=item;starting=null;say(`Playing ${source.title}.`);refill(item);return run===item;
    }catch(cause) {
      const accepted=current(owner)&&starting===owner;
      if(accepted){starting=null;if(!isAbort(cause))say(`PSF playback failed: ${cause?.message??String(cause)}. Edited instrument and selected entry kept.`,true);}
      await disposeCore(owner.core).catch(()=>{});return false;
    }
  }
  function pauseRun(item) {
    if(run!==item||!current(item)||item.phase!=='playing')return false;
    trim(item);item.livePaused=liveEnabled?audibleEntry(item):null;
    cancelRefill(item);stopNodes(item);item.phase='paused';
    say(`Paused ${source.title}.`);return true;
  }
  function pause() {return !seeking&&run?pauseRun(run):false;}
  async function resume() {
    if(seeking)return false;
    const item=run;if(!item||item.phase!=='paused')return false;
    item.phase='resuming';say(`Resuming ${source.title}…`);
    try {
      while(item.monitorTask)await item.monitorTask;
      if(run!==item||!current(item)||item.phase!=='resuming')return false;
      if(typeof item.audio.resume==='function')await item.audio.resume();
      while(item.monitorTask)await item.monitorTask;
      if(run!==item||!current(item)||item.phase!=='resuming')return false;
      item.phase='playing';item.livePaused=null;
      say(`Playing ${source.title}.`);refill(item);openScheduledMonitor(item);return run===item;
    }catch(cause){fail(item,cause);return false;}
  }
  function setSource(set,entry) {
    if(disposed)throw new Error('PSF preview is disposed');
    // Validate the candidate before retiring any accepted source or playback.
    const next=selectedSource(set,entry);
    if(source?.set===set&&source.entry===entry)return read();
    void stop().catch(()=>{});source=next;say(`PSF ready · ${next.title}. Play to hear the song.`);return read();
  }
  function setLiveEnabled(value) {
    if(typeof value!=='boolean')throw new TypeError('PSF Live enabled must be boolean');
    if(disposed||liveEnabled===value)return read();
    liveEnabled=value;
    if(run) {
      // Off releases lookahead history. One already-audible frozen Pause
      // snapshot may survive so On can compare channels without advancing the
      // machine. Off while playing never keeps a stale/future observation.
      clearLive(run,run.phase==='paused'||run.phase==='resuming');
      if(value&&run.livePaused)run.liveHistory.push(run.livePaused);
      else if(value&&run.phase==='paused'&&run.rendered===run.consumed) {
        captureLive(run,run.rendered);run.livePaused=run.liveHistory.at(-1)??null;
      }
    }
    emit();return read();
  }
  function setLiveVoice(value) {
    if(!Number.isInteger(value)||value<0||value>23)throw new RangeError('PSF Live channel must be an integer 0..23');
    if(disposed||liveVoice===value)return read();
    liveVoice=value;if(run&&monitorEnabled)void requestMonitorSwitch(run);emit();return read();
  }
  async function setMonitorEnabled(value) {
    if(typeof value!=='boolean')throw new TypeError('PSF selected-channel listening must be boolean');
    if(disposed)return false;
    monitorEnabled=value;
    const item=run;
    if(item) {
      item.monitorError=value&&!item.monitorAvailable?'Selected-channel listening is unavailable in this PSF engine. Full song playback is kept.':'';
      const done=requestMonitorSwitch(item);emit();return done;
    }
    emit();return true;
  }
  async function dispose() {
    if(disposed)return;
    disposed=true;await stop();source=null;
  }
  return {read,setSource,play,pause,resume,stop,dispose,seek,cancelSeek,setLiveEnabled,setLiveVoice,setMonitorEnabled,capturePaused};
}
