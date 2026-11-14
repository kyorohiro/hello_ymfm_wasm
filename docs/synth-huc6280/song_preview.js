// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {VgmPlayer} from '../js/vgmplayer.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import factory from '../generated/huc6280_wasm.js';
import {prepareHuc6280SongSource} from './song_source.js';
import {createHuc6280SongTimeline} from './song_state.js';
import {createHuc6280SongCache} from './song_cache.js';
import {captureHuc6280SongCheckpoint,restoreHuc6280SongCheckpoint} from './song_checkpoint.js';

const CHUNK = 256, LOOKAHEAD = .05, START_DELAY = .01, INTERVAL = 8;
const scheduleTask = globalThis.setTimeout.bind(globalThis);
const cancelTask = globalThis.clearTimeout.bind(globalThis);
const aborted = () => new DOMException('HuC6280 song operation cancelled', 'AbortError');
const defaultEngine = header => Huc6280AudioEngine.create({moduleFactory:factory,
  clock:header.huc6280Clock, outputSampleRate:44100, masterVolume:1});

/** One-pass reference transport, independent of the authored instrument. It
 * borrows only the Synth's context/songInputNode, and owns all other nodes and
 * native resources it creates. Pause retains rendered PCM and its exact read
 * offset; Resume neither restarts the core nor discards prefetched events.
 * Construction and load() never open audio. */
export function createHuc6280SongPreview({getAudio, beforePlay = async () => {}, onState = () => {},
  onStatus = () => {}, createEngine = defaultEngine, schedule = scheduleTask, cancel = cancelTask,
  nowMs = () => performance.now(), yieldTask = () => new Promise(resolve => scheduleTask(resolve, 0)),
  seekChunkFrames=2048,seekTimeoutMilliseconds=30000,
  cacheEnabled=true,cacheMaxBytes=8*1024*1024,cacheMaxCount=64,cacheIntervalSeconds=5,
} = {}) {
  if(!Number.isInteger(seekChunkFrames)||seekChunkFrames<1||seekChunkFrames>2048)throw RangeError('HuC6280 seek slices must be 1..2048 frames');
  if(!Number.isFinite(seekTimeoutMilliseconds)||seekTimeoutMilliseconds<1||seekTimeoutMilliseconds>120000)throw RangeError('HuC6280 seek timeout must be 1..120000 milliseconds');
  let source = null, name = '', active = null, generation = 0, loadGeneration = 0;
  let loadController = null, loading = false, disposed = false, playback = 'stopped';
  let errorMessage = '', positionFrames = 0, sampleRate = 44100;
  let liveEnabled = true, liveState = null, liveMessage = '';
  let channelMuteMask=0;
  let seeking=null,seekCleanup=Promise.resolve(),seekPreparing=0,seekMessage='';
  const seekCache=createHuc6280SongCache({enabled:cacheEnabled,maxBytes:cacheMaxBytes,maxCount:cacheMaxCount,intervalSeconds:cacheIntervalSeconds});
  let cacheGeneration=0;
  function prepareCacheRun(run){
    if(run.cacheGeneration!==cacheGeneration||run.cacheMask!==channelMuteMask){
      run.cacheGeneration=cacheGeneration;run.cacheMask=channelMuteMask;
      // Native/player lookahead can still contain the previous output mix.
      run.cacheSafeFrame=run.timeline.generatedFrames;run.cacheLastAttempt=-Infinity;run.cacheBlocked=false;
    }
  }
  function captureCachePoint(run,force=false){
    if(source!==run.source||!seekCache.read().enabled||!run.engine.supportsState?.())return;
    prepareCacheRun(run);if(run.cacheBlocked)return;
    const frame=run.player.renderedPositionFrames(),interval=run.sampleRate*cacheIntervalSeconds;
    if(frame<run.cacheSafeFrame||!force&&(frame<interval||frame-(run.cacheLastAttempt??0)<interval))return;
    run.cacheLastAttempt=frame;
    try{seekCache.insert(source,captureHuc6280SongCheckpoint({source,player:run.player,timeline:run.timeline,engine:run.engine,frame,mask:channelMuteMask,maxBytes:cacheMaxBytes}));}
    catch(error){run.cacheBlocked=true;seekCache.captureFailed(error);}
  }
  const appliedChannelMasks=new WeakMap();
  function applyChannelMask(engine,mask=channelMuteMask,force=false) {
    const previous=appliedChannelMasks.get(engine);
    if(previous===mask&&!force)return;
    if(typeof engine.setChannelMuted!=='function'){
      if(mask)throw Error('HuC6280 reference engine does not support channel On/Off');
      appliedChannelMasks.set(engine,0);return;
    }
    const attempted=[];
    try{
      for(let channel=0;channel<6;channel++)if(force||previous===undefined||((previous^mask)&(1<<channel))){
        attempted.push(channel);engine.setChannelMuted(channel,Boolean(mask&(1<<channel)));
      }
    }catch(error){
      // Do not publish a half-applied user toggle. A native setter normally
      // cannot fail; compatible injected engines can still reject a request.
      if(previous!==undefined)for(const channel of attempted)try{engine.setChannelMuted(channel,Boolean(previous&(1<<channel)));}catch{}
      throw error;
    }
    appliedChannelMasks.set(engine,mask);
  }
  const open = () => {if (disposed) throw new Error('HuC6280 song preview is disposed');};
  const current = ticket => !disposed && ticket === generation;
  const notify = message => {try {onStatus(message);} catch {}};

  function position(run = active) {
    if (!run) return positionFrames;
    if (playback !== 'playing') return run.basePosition;
    let consumed = run.basePosition;
    // Segment clocks rather than a single elapsed clock: a throttled renderer
    // may leave a real scheduling gap, which must not skip unheard samples.
    for (const segment of run.segments) {
      if (segment.playAt === null || run.context.currentTime < segment.playAt) break;
      const frames = segment.offset + Math.max(0, Math.floor((run.context.currentTime - segment.playAt) * run.sampleRate + 1e-7));
      consumed = Math.max(consumed, segment.firstFrame + Math.min(segment.frames, frames));
    }
    return Math.min(run.renderedFrames, consumed);
  }
  function getState() {
    const frames = position(), busy = loading || playback === 'starting'||Boolean(seeking)||seekPreparing>0;
    return {playback, playing:playback === 'playing', paused:playback === 'paused', busy, loading,
      hasSource:source !== null, name, errorMessage, sampleRate, positionFrames:frames,
      positionSeconds:frames / sampleRate, durationSeconds:source ? source.totalSamples / 44100 : 0,
      warnings:source ? [...source.warnings] : [], canPlay:!disposed && !!source && !busy && playback !== 'playing',
      canPause:!disposed && playback === 'playing', canResume:!disposed && !busy && playback === 'paused',
      canStop:!disposed && (busy || active !== null || frames > 0),
      bufferedFrames:active ? Math.max(0, active.renderedFrames - frames) : 0,
      seeking:Boolean(seeking),seekCancelling:Boolean(seeking?.controller.signal.aborted),seekPreparing:seekPreparing>0,seekTargetSeconds:seeking?.targetSeconds??null,
      seekProgressSeconds:seeking?seeking.progressFrame/seeking.rate:0,seekProgressFrames:seeking?.progressFrame??0,
      seekMessage,canSeek:!disposed&&Boolean(source)&&!loading&&playback!=='starting'&&(!seekPreparing||Boolean(seeking)),
      seekCache:seekCache.read(),
      channelEnabled:Array.from({length:6},(_,channel)=>!(channelMuteMask&(1<<channel))),channelMuteMask,
      liveKind:'song',liveEnabled,liveState,liveError:Boolean(liveMessage),liveMessage,
      liveActive:Boolean(liveState&&!liveMessage&&['playing','paused','ended'].includes(playback))};
  }
  function emit() {try {onState(getState());} catch {}}
  function cancelTimer(run) {if (run && run.timer !== null) {cancel(run.timer); run.timer = null;}}
  function cancelNodes(run) {
    for (const segment of run?.segments ?? []) {
      const node = segment.node; segment.node = null; segment.playAt = null;
      if (!node) continue;
      node.onended = null;
      try {node.stop();} catch {} try {node.disconnect();} catch {}
    }
  }
  function release(run) {
    if (!run || run.released) return;
    run.released = true; cancelTimer(run); cancelNodes(run); run.segments = [];
    try {run.gain?.disconnect();} finally {try {run.timeline.dispose();} finally {run.engine.dispose();}}
  }
  function stop() {
    seeking?.controller.abort();seeking=null;seekMessage='';
    generation++; loadGeneration++; loadController?.abort(); loadController = null; loading = false;
    const old = active; active = null; release(old);
    positionFrames = 0; playback = 'stopped'; errorMessage = '';liveState=null;liveMessage=''; emit(); return true;
  }
  async function load(bytes, nextName = '', {signal} = {}) {
    open(); const ticket = ++loadGeneration;
    loadController?.abort(); const controller = loadController = new AbortController();
    const externalAbort = () => controller.abort();
    signal?.addEventListener('abort', externalAbort, {once:true});
    if (signal?.aborted) controller.abort();
    loading = true; emit();
    try {
      if(seeking){seeking.controller.abort();await seekCleanup;if(controller.signal.aborted)throw aborted();}
      const prepared = await prepareHuc6280SongSource(bytes, {signal:controller.signal, yieldTask});
      if (disposed || ticket !== loadGeneration || controller.signal.aborted) throw aborted();
      generation++; const old = active; active = null; release(old);
      source = prepared; name = String(nextName); positionFrames = 0; sampleRate = 44100;
      seekCache.reset(source,channelMuteMask);cacheGeneration++;
      playback = 'stopped'; errorMessage = '';liveState=null;liveMessage='';seekMessage=''; return true;
    } catch (error) {
      if (!disposed && ticket === loadGeneration && error?.name !== 'AbortError') notify(`VGM load failed: ${error.message}. Previous song kept.`);
      throw error;
    } finally {
      signal?.removeEventListener('abort', externalAbort);
      if (ticket === loadGeneration) {loadController = null; loading = false; emit();}
    }
  }
  function clear() {open(); stop(); source = null; name = ''; sampleRate = 44100;seekCache.reset(null,channelMuteMask);cacheGeneration++; emit();}
  function fail(error, run = active) {
    if (run && active !== run) return;
    positionFrames = position(run); active = null; release(run);
    liveState=null;liveMessage='';
    playback = 'error'; errorMessage = error?.message ?? String(error);
    notify(`VGM playback failed: ${errorMessage}`); emit();
  }
  function scheduleSegment(run, segment) {
    const offset = Math.max(0, run.basePosition - segment.firstFrame);
    if (offset >= segment.frames) return;
    const at = Math.max(run.nextTime ?? 0, run.context.currentTime + START_DELAY);
    const node = run.context.createBufferSource();
    node.buffer = segment.buffer; node.connect(run.gain);
    segment.node = node; segment.offset = offset; segment.playAt = at;
    node.onended = () => {try {node.disconnect();} catch {} if (segment.node === node) segment.node = null;};
    node.start(at, offset / run.sampleRate);
    run.nextTime = at + (segment.frames - offset) / run.sampleRate;
  }
  function pump(run, forceEmit = false) {
    if (active !== run || playback !== 'playing') return;
    try {
      const consumed = position(run); positionFrames = consumed; run.basePosition = consumed;
      run.timeline.read(consumed);
      if(run.timeline.error){liveMessage=run.timeline.error;liveState=null;}
      run.segments = run.segments.filter(segment => {
        if (segment.firstFrame + segment.frames > consumed) return true;
        try {segment.node?.disconnect();} catch {} return false;
      });
      const deadline = nowMs() + 8;
      for (let chunks = 0; !run.eof && chunks < 12 && nowMs() < deadline; chunks++) {
        if ((run.renderedFrames - position(run)) / run.sampleRate >= LOOKAHEAD) break;
        const left = new Float32Array(CHUNK), right = new Float32Array(CHUNK);
        prepareCacheRun(run);
        applyChannelMask(run.engine);
        const frames = run.player.process(left, right, CHUNK, {budgetMs:4});
        if (!Number.isInteger(frames) || frames < 0 || frames > CHUNK) throw new Error('Invalid HuC6280 reference render length');
        if (frames) {
          for (let i = 0; i < frames; i++) if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('HuC6280 reference produced non-finite PCM');
          const buffer = run.context.createBuffer(2, frames, run.sampleRate);
          buffer.copyToChannel(left.subarray(0, frames), 0); buffer.copyToChannel(right.subarray(0, frames), 1);
          const segment = {buffer, frames, firstFrame:run.renderedFrames, node:null, offset:0, playAt:null};
          run.renderedFrames += frames; run.segments.push(segment); scheduleSegment(run, segment);
          captureCachePoint(run);
        }
        run.eof = !run.player.isPlaying() && run.player.queuedFrames === 0;
        if (!frames) break;
      }
      if (run.eof && position(run) >= run.renderedFrames) {
        positionFrames = run.renderedFrames;publishLive(run,positionFrames,true); active = null; playback = 'ended'; release(run); emit(); return;
      }
      if (forceEmit || run.lastEmitTime === null || run.context.currentTime - run.lastEmitTime >= .05) {
        run.lastEmitTime = run.context.currentTime;publishLive(run,position(run),forceEmit&&!liveState); emit();
      }
      if (active === run && playback === 'playing') run.timer = schedule(() => {run.timer = null; pump(run);}, INTERVAL);
    } catch (error) {fail(error, run);}
  }
  function publishLive(run,frame,force=false) {
    const snapshot=run.timeline.read(frame);
    liveMessage=run.timeline.error;
    if(liveMessage)liveState=null;
    else if(liveEnabled||force)liveState=snapshot;
  }
  function setLiveEnabled(value) {
    if(typeof value!=='boolean')throw TypeError('HuC6280 song Live enabled must be boolean');
    open();if(liveEnabled===value)return getState();
    liveEnabled=value;if(value&&active)publishLive(active,position(active),true);emit();return getState();
  }
  function setChannelEnabled(channel,enabled) {
    open();
    if(!Number.isInteger(channel)||channel<0||channel>5)throw RangeError('HuC6280 song channel must be an integer 0..5');
    if(typeof enabled!=='boolean')throw TypeError('HuC6280 song channel enabled must be boolean');
    const next=enabled?channelMuteMask&~(1<<channel):channelMuteMask|(1<<channel);
    if(next===channelMuteMask)return getState();
    // Output only: parser/registers, LFO/Noise phase and retained PCM are kept.
    // The changed mix reaches the output after already rendered PCM drains.
    if(active&&!active.released)applyChannelMask(active.engine,next);
    channelMuteMask=next;seekCache.setMask(next);cacheGeneration++;emit();return getState();
  }
  function setCacheEnabled(value){open();seekCache.setEnabled(value);cacheGeneration++;emit();return getState();}
  function clearSeekCache(){open();seekCache.clear();cacheGeneration++;emit();return getState();}
  function requestAudio() {
    const requested = getAudio();
    // Synchronous existing-context access keeps resume in the Play gesture.
    const context = requested && typeof requested.then !== 'function' ? requested.context : null;
    const resumed = context?.resume();
    return Promise.all([Promise.resolve(requested), Promise.resolve(resumed)]).then(async ([host]) => {
      if (!context) await host?.context?.resume();
      return host;
    });
  }
  async function prepareHost(ticket,guard=()=>current(ticket)) {
    let audio, preparation;
    try {audio = requestAudio();} catch (error) {audio = Promise.reject(error);}
    try {preparation = beforePlay({isCurrent:guard});} catch (error) {preparation = Promise.reject(error);}
    // Await both operations even on failure, so a late ownership hook cannot
    // continue after play() has already reported completion to its caller.
    const results = await Promise.allSettled([audio, preparation]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    return results[0].value;
  }
  function validateHost(host) {
    const context = host?.context, output = host?.songInputNode;
    if (!context || !output || output.context !== context || context.state === 'closed') throw new Error('Reference songInputNode must belong to the Synth AudioContext');
    return {context, output};
  }
  async function play() {
    open(); if (loading) {notify('Wait for VGM validation, then press Play.'); return false;}
    if(seeking||seekPreparing){notify('Wait for the current seek cleanup, or Stop it first.');return false;}
    if (!source) throw new Error('Choose a valid HuC6280 VGM/VGZ song first');
    if (playback === 'paused') return resume();
    if (playback === 'playing') return true;
    const ticket = ++generation, selected = source;
    release(active); active = null; positionFrames = 0; playback = 'starting'; errorMessage = '';liveState=null;liveMessage='';seekMessage=''; emit();
    let engine = null, gain = null,timeline=null;
    try {
      const host = await prepareHost(ticket); if (!current(ticket)) return false;
      const {context, output} = validateHost(host);
      engine = await createEngine(selected.header);
      if (!current(ticket)) {engine.dispose(); engine = null; return false;}
      validateHost(host);
      const rate = engine.sampleRate();
      if (!Number.isInteger(rate) || rate < 8000 || rate > 96000) throw new Error('Invalid HuC6280 reference sample rate');
      timeline=createHuc6280SongTimeline(engine,selected.header.huc6280Clock);
      const player = new VgmPlayer(engine);
      player.setPrefetchFactor(1); player.setLoopEnabled(false);
      player.load(selected.bytes, {logger:{warn:message => {throw new Error(message);}}}); player.reset();
      applyChannelMask(engine,channelMuteMask,true);
      seekCache.setAvailable(Boolean(engine.supportsState?.()));
      gain = context.createGain(); gain.gain.value = 1; gain.connect(output);
      const run = {engine, timeline,player, context, output, gain, sampleRate:rate, source:selected,cacheGeneration,cacheMask:channelMuteMask,cacheSafeFrame:0,cacheLastAttempt:0,
        basePosition:0, renderedFrames:0,
        segments:[], nextTime:null, timer:null, eof:false, released:false, lastEmitTime:null};
      active = run; engine = gain =timeline= null; sampleRate = rate;
      playback = 'playing'; player.play(); pump(run, true);
      return playback === 'playing' || playback === 'ended';
    } catch (error) {
      try {gain?.disconnect();} finally {try{timeline?.dispose();}finally{engine?.dispose();}}
      if (!current(ticket)) return false; fail(error); return false;
    }
  }
  function pause() {
    open(); const run = active; if (!run || playback !== 'playing') return false;
    run.basePosition = position(run); positionFrames = run.basePosition;
    publishLive(run,positionFrames,true);
    cancelTimer(run); cancelNodes(run);
    run.segments = run.segments.filter(segment => segment.firstFrame + segment.frames > positionFrames);
    run.player.pause(); run.nextTime = null; playback = 'paused'; emit(); return true;
  }
  async function resume() {
    open(); const run = active; if (!run || playback !== 'paused' || loading||seeking||seekPreparing) return false;
    const ticket = ++generation; playback = 'starting';seekMessage=''; emit();
    try {
      const host = await prepareHost(ticket); if (!current(ticket) || active !== run) return false;
      const {context, output} = validateHost(host);
      if (context !== run.context || output !== run.output) throw new Error('Audio output changed; Stop and Play to restart the song');
      run.nextTime = null; playback = 'playing'; run.player.resume();
      for (const segment of run.segments) scheduleSegment(run, segment);
      pump(run, true); return playback === 'playing' || playback === 'ended';
    } catch (error) {if (current(ticket) && active === run) fail(error, run); return false;}
  }
  function freezeRun(run){
    const frame=position(run);
    if(run){run.basePosition=frame;cancelTimer(run);cancelNodes(run);run.segments=run.segments.filter(segment=>segment.firstFrame+segment.frames>frame);run.player.pause();run.nextTime=null;}
    positionFrames=frame;return frame;
  }
  function restoreSeek(job){
    const previous=job.previous;
    active=previous.run;positionFrames=previous.position;sampleRate=previous.sampleRate;liveState=previous.snapshot;liveMessage=previous.liveMessage;errorMessage=previous.error;playback=previous.phase;
    if(active&&playback==='playing'){
      active.nextTime=null;active.player.resume();for(const segment of active.segments)scheduleSegment(active,segment);pump(active,true);
    }else emit();
  }
  function emitSeekProgress(job,force=false){
    const now=nowMs();
    if(force||job.lastProgressEmit===null||now-job.lastProgressEmit>=50){job.lastProgressEmit=now;emit();}
  }
  async function runSeek(job,preceding){
    let candidate=null,engine=null,timeline=null;
    const valid=()=>current(job.ticket)&&seeking===job&&!job.controller.signal.aborted&&source===job.source;
    const check=()=>{if(!valid())throw aborted();if(nowMs()-job.started>seekTimeoutMilliseconds)throw Error('HuC6280 seek timed out; the previous song position was kept.');};
    try{
      // A superseding seek may reuse the retained old run, but cannot start a
      // second candidate until uncancellable initialization/cleanup settles.
      await preceding;job.started=nowMs();check();
      let host;
      seekPreparing++;emit();
      try{
        host=await prepareHost(job.ticket,valid);check();validateHost(host);
        engine=await createEngine(job.source.header);check();validateHost(host);
      }finally{seekPreparing--;emit();}
      const {context,output}=validateHost(host),rate=engine.sampleRate();
      if(!Number.isInteger(rate)||rate<8000||rate>96000)throw Error('Invalid HuC6280 seek sample rate');
      job.rate=rate;const totalFrames=Math.floor(job.source.totalSamples*rate/44100+1e-7);
      job.targetFrame=Math.min(totalFrames,Math.max(0,Math.round(job.targetSeconds*rate)));
      timeline=createHuc6280SongTimeline(engine,job.source.header.huc6280Clock);
      const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);
      player.load(job.source.bytes,{logger:{warn:message=>{throw Error(message);}}});player.reset();applyChannelMask(engine,channelMuteMask,true);player.play();
      seekCache.setAvailable(Boolean(engine.supportsState?.()));
      const checkpoint=seekCache.find(job.source,rate,job.targetFrame);
      if(checkpoint){
        try{job.progressFrame=restoreHuc6280SongCheckpoint(checkpoint,{source:job.source,player,timeline,engine,mask:channelMuteMask});player.resume();}
        catch(error){seekCache.reject(checkpoint,error);player.reset();applyChannelMask(engine,channelMuteMask,true);player.play();job.progressFrame=0;}
      }
      job.restoredFrame=job.progressFrame;seekCache.noteProgress(0);
      candidate={engine,timeline,player,context,output,gain:null,sampleRate:rate,source:job.source,cacheGeneration,cacheMask:channelMuteMask,cacheSafeFrame:0,cacheLastAttempt:job.progressFrame,
        basePosition:job.targetFrame,renderedFrames:job.targetFrame,
        segments:[],nextTime:null,timer:null,eof:false,released:false,lastEmitTime:null};
      engine=timeline=null;
      const left=new Float32Array(seekChunkFrames),right=new Float32Array(seekChunkFrames);
      let chunks=0,batchStarted=nowMs();
      const validatePcm=(frames,requested)=>{
        if(!Number.isInteger(frames)||frames<0||frames>requested)throw Error('Invalid HuC6280 seek render length');
        for(let i=0;i<frames;i++)if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw Error('HuC6280 seek produced non-finite PCM');
      };
      while(job.progressFrame<job.targetFrame){
        check();prepareCacheRun(candidate);applyChannelMask(candidate.engine);
        const requested=Math.min(seekChunkFrames,job.targetFrame-job.progressFrame),frames=player.process(left,right,requested,{budgetMs:4});validatePcm(frames,requested);
        job.progressFrame+=frames;candidate.timeline.read(job.progressFrame);
        seekCache.noteProgress(job.progressFrame-job.restoredFrame);captureCachePoint(candidate);
        if(!frames&&!player.isPlaying()&&!player.queuedFrames)throw Error('HuC6280 seek ended before its target frame');
        if(++chunks>=8||nowMs()-batchStarted>=8||job.progressFrame===job.targetFrame){emitSeekProgress(job,job.progressFrame===job.targetFrame);await yieldTask();check();chunks=0;batchStarted=nowMs();}
      }
      check();captureCachePoint(candidate,true);
      // Pull the target boundary's writes before observing, retaining its
      // first future PCM instead of skipping or replaying native samples.
      for(;;){
        check();prepareCacheRun(candidate);applyChannelMask(candidate.engine);const frames=player.process(left,right,Math.min(CHUNK,seekChunkFrames),{budgetMs:4});validatePcm(frames,Math.min(CHUNK,seekChunkFrames));
        if(frames){
          const buffer=context.createBuffer(2,frames,rate);buffer.copyToChannel(left.subarray(0,frames),0);buffer.copyToChannel(right.subarray(0,frames),1);
          candidate.segments.push({buffer,frames,firstFrame:job.targetFrame,node:null,offset:0,playAt:null});candidate.renderedFrames+=frames;
        }
        candidate.eof=!player.isPlaying()&&player.queuedFrames===0;
        if(frames||candidate.eof)break;
        emitSeekProgress(job);await yieldTask();
      }
      check();const snapshot=candidate.timeline.read(job.targetFrame);
      candidate.gain=context.createGain();candidate.gain.gain.value=1;candidate.gain.connect(output);
      const old=active;active=candidate;candidate=null;release(old);
      sampleRate=rate;positionFrames=job.targetFrame;liveState=snapshot;liveMessage=active.timeline.error;errorMessage='';seekMessage='';seeking=null;
      playback=job.previous.phase==='playing'?'playing':'paused';
      if(playback==='playing'){active.player.resume();for(const segment of active.segments)scheduleSegment(active,segment);pump(active,true);}
      else{active.player.pause();emit();}
      return true;
    }catch(error){
      if(current(job.ticket)&&seeking===job&&source===job.source){
        seeking=null;seekMessage=error?.name==='AbortError'?'Seek cancelled.':`Seek failed: ${error?.message??String(error)}`;
        restoreSeek(job);if(error?.name!=='AbortError')notify(seekMessage);
      }
      return false;
    }finally{
      if(candidate)release(candidate);else{try{timeline?.dispose();}finally{engine?.dispose();}}
    }
  }
  async function seek(seconds){
    open();if(!Number.isFinite(seconds))throw TypeError('HuC6280 seek seconds must be finite');
    if(!source||loading||playback==='starting'||seekPreparing&&!seeking)return false;
    const oldJob=seeking;
    const previous=oldJob?.previous??{run:active,phase:playback,position:position(active),sampleRate,snapshot:liveState,liveMessage,error:errorMessage};
    oldJob?.controller.abort();if(!oldJob)previous.position=freezeRun(active);
    seekCache.beginSeek();
    const targetSeconds=Math.max(0,Math.min(source.totalSamples/44100,seconds));
    const job={ticket:++generation,source,previous,targetSeconds,targetFrame:Math.round(targetSeconds*sampleRate),progressFrame:0,rate:sampleRate,
      controller:new AbortController(),started:nowMs(),lastProgressEmit:null,promise:null};
    seeking=job;playback='seeking';seekMessage='Seeking…';
    job.promise=runSeek(job,seekCleanup);seekCleanup=job.promise.then(()=>undefined,()=>undefined);emit();return job.promise;
  }
  async function cancelSeek(){
    const job=seeking;if(!job){await seekCleanup;return false;}
    job.controller.abort();emit();await job.promise;return true;
  }
  function dispose() {if (disposed) return; stop(); disposed = true; source = null; name = '';seekCache.reset(null,channelMuteMask); emit();}
  return {load, play, pause, resume, stop,clear,seek,cancelSeek,setCacheEnabled,clearSeekCache,whenIdle:()=>seekCleanup,getState,read:getState,setLiveEnabled,setChannelEnabled, dispose};
}
