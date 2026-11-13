import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {VgmPlayer} from '../js/vgmplayer.js';
import {GenesisAudioEngine} from '../js/genesisaudioengine.js';
import {Ym2612, YM2612_CLOCK} from '../js/ym2612.js';
import {SegaPSG, SEGAPSG_CLOCK} from '../js/segapsg.js';
import {Rf5c164} from '../js/rf5c164.js';
import {PWM32X} from '../js/pwm32x.js';
import ym2612ModuleFactory from '../generated/ym2612_wasm.js';
import segaPsgModuleFactory from '../generated/segapsg_wasm.js';
import {createYm2612SongTimeline} from './synth_song_state.js?v=song-seek-1';
import {createPsgSongTimeline} from './synth_song_psg_state.js?v=psg-live-1';
import {createPcmSongTimeline} from './synth_song_pcm_state.js?v=pcm-live-1';
import {createSynthSongMix} from './synth_song_mix.js?v=channel-mixer-1';
import {installSynthSongOutputMix} from './synth_song_output_mix.js?v=channel-mixer-1';
import {seekPlayback} from '../vgm_analyzer/seek_playback.js';
import {createSynthSongInteraction} from './synth_song_interaction.js?v=vgm-manual-1';
import {createSynthPsgSongInteraction} from './synth_song_psg_interaction.js?v=psg-manual-1';
import {createSynthPcmSongInteraction} from './synth_song_pcm_interaction.js?v=pcm-manual-1';

// Keep the existing native-rate buffer size/resampling path. Only the queued
// duration changes: manual writes no longer wait behind 200 ms of rendered PCM.
const LOOKAHEAD_SECONDS = 0.045;
const START_DELAY_SECONDS = 0.01;
const REFILL_MILLISECONDS = 10;
const CHUNK_FRAMES = 2048;
const CACHE_INTERVAL_SECONDS = 5;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const CACHE_MAX_COUNT = 120;

/** Reject unsupported songs before creating the reference-song engine. */
export function inspectGenesisPreview(bytes) {
  const parser = new Ym2612VGM(bytes, {logger:null});
  const {header} = parser;
  const supportedClocks = ['ym2612Clock','psgClock','rf5c164Clock','pwmClock'];
  const otherChips = Object.entries(header)
    .filter(([key, value]) => key.endsWith('Clock') && value && !supportedClocks.includes(key))
    .map(([key]) => key.slice(0, -5));
  if (otherChips.length) throw new Error(`Reference playback supports YM2612 + PSG + DAC + Mega CD PCM + 32X PWM. Unsupported chip: ${otherChips.join(', ')}.`);
  if (supportedClocks.some(key => header[key] & 0xc0000000)) {
    throw new Error('Reference playback does not support dual or variant YM2612 / PSG / RF5C164 / PWM chips.');
  }
  const requireClock = (key, chip) => {
    if (!header[key]) throw new Error(`Reference playback requires a ${chip} clock in the VGM header.`);
  };
  const allowed = new Set([0x50,0x52,0x53,0x61,0x62,0x63,0x64,0x66,0x67,0x68,0x90,0x91,0x92,0x93,0x94,0x95,0xb1,0xb2,0xc2,0xe0]);
  const usage = parser.analyzeCommandUsage();
  for (const command of usage.keys()) {
    const value = Number(command);
    if (!allowed.has(value) && !(value >= 0x70 && value <= 0x8f)) {
      throw new Error(`Reference playback does not support VGM command ${command}.`);
    }
  }
  if (['0xb1','0xc2','0x68'].some(command => usage.has(command))) requireClock('rf5c164Clock', 'RF5C164');
  if (usage.has('0xb2')) requireClock('pwmClock', '32X PWM');
  for (const block of parser.dataBlockSummary()) {
    if ([0x02,0x42,0xc1].includes(block.type)) {
      requireClock('rf5c164Clock', 'RF5C164');
      if (parser.view.getUint32(block.offset + 3, true) & 0x80000000) {
        throw new Error('Reference playback does not support a second RF5C164 sample bank.');
      }
    }
  }
  for (const command of parser.analyzeSpecialCommands()) {
    const ram = /cmd=0x68 type=0x([0-9a-f]+)/i.exec(command);
    if (ram && parseInt(ram[1],16) !== 0x02) throw new Error(`Reference playback does not support PCM RAM target 0x${ram[1]}.`);
    const target = /chipType=0x([0-9a-f]+)/i.exec(command);
    if (target && ![0x00, 0x02, 0x11].includes(parseInt(target[1], 16))) {
      throw new Error(`Reference playback does not support DAC stream chip type 0x${target[1]}.`);
    }
    if (target && parseInt(target[1],16) === 0x11) requireClock('pwmClock', '32X PWM');
  }
  // Event decoding catches second-instance bits in RF register commands and
  // validates bank-copy ranges before any chip is created or any audio plays.
  if (header.rf5c164Clock || header.pwmClock) {
    while (!parser.ended) {
      const event = parser.step();
      if (event.type.startsWith('rf5c164-') && event.chipIndex) throw new Error('Reference playback does not support a second RF5C164 chip.');
      if (event.type === 'pwm-write' && event.register > 4) throw new Error('Reference playback does not support that 32X PWM register.');
    }
  }
  return header;
}

async function createPreviewEngine(header) {
  const ym2612 = await Ym2612.create({moduleFactory:ym2612ModuleFactory});
  let psg, pcm, pwm;
  try {
    const rate = ym2612.sampleRate(header.ym2612Clock || YM2612_CLOCK);
    psg = await SegaPSG.create({moduleFactory:segaPsgModuleFactory,
      sampleRate:rate, clock:header.psgClock || SEGAPSG_CLOCK});
    if (header.rf5c164Clock) {
      const {default:moduleFactory} = await import('../generated/rf5c164_wasm.js');
      pcm = await Rf5c164.create({moduleFactory, sampleRate:rate, clock:header.rf5c164Clock});
    }
    if (header.pwmClock) {
      // Match VGM Analyzer's FIFO/timer WASM model and duty-domain output.
      pwm = await PWM32X.create({clock:header.pwmClock, sampleRate:rate, outputMode:'duty', gain:1});
    }
    // The output GainNode applies the Synth's Master, including later changes.
    return new GenesisAudioEngine(ym2612, psg, rate, 1, pcm,
      pwm ? {model:'mame', clock:header.pwmClock, outputMode:'duty', chip:pwm} : {});
  } catch (error) {
    // A failed second chip must not leave the first chip's native state alive.
    psg?.dispose();
    pcm?.dispose();
    pwm?.dispose();
    ym2612.dispose();
    throw error;
  }
}

/**
 * An independent reference-song player. Loading prepares bytes and metadata;
 * Play prepares a separate Genesis engine and borrows the Synth's audio bus.
 * The host owns that AudioContext: this controller never closes it.
 *
 * Small native-rate AudioBuffers are scheduled ahead of the audio clock. Web
 * Audio resamples those buffers to the device rate. Pausing retains unconsumed
 * PCM, including the exact offset into the current buffer; the parser is never
 * advanced again to reconstruct Pause. Master gain is outside those buffers.
 */
export function createSynthSongPreview({getAudio, onState=()=>{}, onStatus=()=>{}, createEngine=createPreviewEngine, beforeResume=()=>{},seekCacheEnabled=true,mix=createSynthSongMix()}={}) {
  if (typeof getAudio !== 'function') throw new TypeError('getAudio is required');
  if (typeof seekCacheEnabled !== 'boolean') throw new TypeError('Seek cache enabled must be a boolean');
  let source = null, name = '', active = null, generation = 0, disposed = false;
  let volume = 1, playback = 'stopped', errorMessage = null;
  let positionFrames = 0, sampleRate = 0, totalSamples = 0;
  let lastLiveState = null, lastPsgLiveState = null, lastPcmLiveState = null, metadata = null, metadataReady = null;
  let seekProgress = 0, seekTargetSeconds = null, seekResumePlaying = false, lastSeekCacheFrame = 0;
  let abortSeek = null, work = Promise.resolve();
  const releaseMix = mix.onDidChange((_state,change)=>{
    if (disposed) return;
    if (['volume','mute','reset'].includes(change.type)) {
      applyMix();invalidateCache();restartChangedSeek();
    }
    emit();
  });

  function currentPosition(run=active) {
    if (!run) return positionFrames;
    if (!['playing','paused','seeking'].includes(playback)) return positionFrames;
    if (playback !== 'playing') return run.basePosition;
    const elapsed = Math.max(0, run.context.currentTime - run.clockStart);
    return Math.min(run.renderedFrames, run.basePosition + Math.floor(elapsed * run.sampleRate));
  }
  function getState() {
    const consumedFrames = currentPosition();
    let liveState = playback === 'seeking' ? null :
      active?.timeline && ['playing','paused'].includes(playback) ? active.timeline.read(consumedFrames) : lastLiveState;
    if (liveState && active?.interaction) liveState=active.interaction.readSnapshot(liveState,consumedFrames);
    let psgLiveState = playback === 'seeking' ? null :
      active?.psgTimeline && ['playing','paused'].includes(playback) ? active.psgTimeline.read(consumedFrames) : lastPsgLiveState;
    if (psgLiveState && active?.psgInteraction) psgLiveState=active.psgInteraction.readSnapshot(psgLiveState,consumedFrames);
    let pcmLiveState = playback === 'seeking' ? null :
      active?.pcmTimeline && ['playing','paused'].includes(playback) ? active.pcmTimeline.read(consumedFrames) : lastPcmLiveState;
    if (pcmLiveState && active?.pcmInteraction) pcmLiveState=active.pcmInteraction.readSnapshot(pcmLiveState,consumedFrames);
    const stats = active?.player.checkpointStats() ?? {count:0,bytes:0};
    const durationKnown = totalSamples > 0;
    return {playback, hasSource:Boolean(source), name, errorMessage,
      sampleRate, positionFrames:consumedFrames, consumedFrames,
      positionSeconds:sampleRate ? consumedFrames / sampleRate : 0,
      totalSamples, durationSeconds:totalSamples / 44100, liveState,psgLiveState,pcmLiveState,
      durationKnown,seekable:durationKnown,seeking:playback==='seeking',seekProgress,seekTargetSeconds,
      manualReady:playback==='playing'&&Boolean(active?.interaction),
      psgManualReady:playback==='playing'&&Boolean(active?.psgInteraction),
      pcmManualReady:playback==='playing'&&Boolean(active?.pcmInteraction),
      manualLatencySeconds:active?.interaction&&playback==='playing'
        ? Math.max(0,(active.interaction.generatedFrames-consumedFrames)/sampleRate)+
          Math.max(0,active.clockStart-active.context.currentTime):0,
      psgManualLatencySeconds:active?.psgInteraction&&playback==='playing'
        ? Math.max(0,(active.psgInteraction.generatedFrames-consumedFrames)/sampleRate)+
          Math.max(0,active.clockStart-active.context.currentTime):0,
      pcmManualLatencySeconds:active?.pcmInteraction&&playback==='playing'
        ? Math.max(0,(active.pcmInteraction.generatedFrames-consumedFrames)/sampleRate)+
          Math.max(0,active.clockStart-active.context.currentTime):0,
      lastSeekCacheFrame,cache:{enabled:seekCacheEnabled,supported:Boolean(active?.player.supportsState()),
        manualDirty:Boolean(active?.manualDirty),
        ...stats,maxBytes:CACHE_MAX_BYTES,maxCount:CACHE_MAX_COUNT,lastRestoreFrame:lastSeekCacheFrame},
      mix:mix.getState()};
  }
  function emit() { onState(getState()); }
  function checkOpen() { if (disposed) throw new Error('Reference player is disposed'); }
  function isCurrent(ticket) { return !disposed && ticket === generation; }
  function cancelNodes(run) {
    for (const segment of run.segments) {
      if (!segment.node) continue;
      segment.node.onended = null;
      try { segment.node.stop(); } catch {}
      segment.node.disconnect();
      segment.node = null;
    }
  }
  function release(run) {
    if (!run || run.released) return;
    run.released = true;
    run.player.clearCheckpoints();
    clearInterval(run.timer);
    cancelNodes(run);
    run.segments.length = 0;
    run.gain.disconnect();
    // Observers wrap process/reset; unwind the last installed first.
    run.pcmInteraction?.dispose();
    run.psgInteraction?.dispose();
    run.interaction?.dispose();
    run.pcmTimeline?.dispose();
    run.psgTimeline?.dispose();
    run.timeline?.dispose();
    run.outputMix?.dispose();
    run.engine.dispose();
  }
  function suspend(run) {
    if (!run) return;
    run.pcmInteraction?.releaseKeyboard();
    run.psgInteraction?.releaseKeyboard();
    run.interaction?.releaseKeyboard();
    run.basePosition = currentPosition(run);
    positionFrames = run.basePosition;
    clearInterval(run.timer);run.timer=null;
    cancelNodes(run);
    run.player.pause();
  }
  function cancelOperation() {abortSeek?.abort();abortSeek=null;return ++generation;}
  function stop() {
    cancelOperation();
    suspend(active);
    if(active)active.segments=[];
    positionFrames = 0;
    lastLiveState = null;
    lastPsgLiveState = null;
    lastPcmLiveState = null;
    playback = 'stopped';
    errorMessage = null;
    seekProgress=0;seekTargetSeconds=null;
    emit();
  }
  function discard() {stop();release(active);active=null;lastSeekCacheFrame=0;}
  function load(bytes, nextName='') {
    checkOpen();
    const next = bytes instanceof Uint8Array ? new Uint8Array(bytes) :
      bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : null;
    if (!next) throw new TypeError('Choose a binary VGM or VGZ file.');
    discard();
    source = next;
    name = String(nextName);
    sampleRate = totalSamples = 0;
    metadata=null;
    mix.clear();
    emit();
    // Header preparation enables the position bar before Play without creating
    // an AudioContext or chip. Stale metadata cannot replace a newer source.
    const selected=source;
    metadataReady=Promise.resolve().then(async()=>{
      try {
        const decoded=new Uint8Array(await maybeDecodeVgmFile(selected));
        const header=new Ym2612VGM(decoded,{logger:null}).header;
        if(disposed||source!==selected)return false;
        metadata={bytes:decoded,header,validated:false};
        totalSamples=header.totalSamples;emit();return true;
      } catch(error) {
        if(!disposed&&source===selected)metadata={error};
        return false;
      }
    });
    return metadataReady;
  }
  function clear() {
    checkOpen();
    discard();
    source = null;
    name = '';
    sampleRate = totalSamples = 0;
    metadata=metadataReady=null;
    mix.clear();
    emit();
  }
  function setVolume(value) {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0 || next > 3.8) throw new RangeError('Master volume must be 0..3.8.');
    volume = next;
    if (active) active.gain.gain.value = next;
  }
  function applyMix() {
    if (!active) return;
    active.outputMix.setMutedChannels(mix.getMutedChannels());
    for (const [id,value] of Object.entries(mix.getGroupVolumes())) active.outputMix.setGroupVolume(id,value);
  }
  function updateCachePolicy(run) {
    run.player.checkpointIntervalSeconds=seekCacheEnabled&&!run.manualDirty&&
      run.player.renderedPositionFrames()>=run.cacheResumeFrame?CACHE_INTERVAL_SECONDS:0;
  }
  function invalidateCache() {
    lastSeekCacheFrame=0;
    if(!active)return;
    active.player.clearCheckpoints();
    // The already queued prefix remains audible. Do not snapshot it under the
    // new mix settings until those old-gain parser frames have drained.
    active.cacheResumeFrame=active.player.renderedPositionFrames()+active.player.queuedFrames;
    updateCachePolicy(active);
  }
  function applyManualFor(interaction,method,...args) {
    checkOpen();
    if(playback!=='playing'||!interaction)return false;
    const before=interaction.read().revision;
    const result=interaction[method](...args);
    const changed=result!==false&&(result?.revision??interaction.read().revision)!==before;
    if(changed) {
      // A checkpoint made after intervention would contain the player's edits.
      // Source seek always reconstructs the original VGM, so suspend caching
      // until the next source reset/replay instead of snapshotting that state.
      active.manualDirty=true;invalidateCache();
    }
    // Selecting OPs while the channel is idle changes the next manual gate,
    // without writing a hardware KeyOn or dirtying source checkpoints.
    if(changed||result?.edits?.length)emit();
    return result;
  }
  function applyManual(method,...args) {return applyManualFor(active?.interaction,method,...args);}
  function editFm(edit) {return applyManual('applyEdit',edit);}
  function applyFmPreset(channel,preset) {return applyManual('applyPreset',channel,preset);}
  function noteOnFm(id,midi,options) {return applyManual('noteOn',id,midi,options);}
  function noteOffFm(id) {return applyManual('noteOff',id);}
  function releaseFmKeyboard() {
    const result=active?.interaction?.releaseKeyboard()??false;
    if(active&&result!==false){active.manualDirty=true;invalidateCache();emit();}
    return result;
  }
  function setFmPitch(semitones) {return applyManual('setPitch',semitones);}
  function describeFm(channel) {return active?.interaction?.describe(channel)??{playable:false,reason:'Start a YM2612 song to play this channel.'};}
  function readFmSnapshot(snapshot,consumedFrames=currentPosition()) {
    return active?.interaction&&snapshot
      ?active.interaction.readSnapshot(snapshot,consumedFrames,{frozen:true}):snapshot??null;
  }
  function editPsg(edit) {return applyManualFor(active?.psgInteraction,'applyEdit',edit);}
  function applyPsgPreset(channel,preset) {return applyManualFor(active?.psgInteraction,'applyPreset',channel,preset);}
  function noteOnPsg(id,note,options) {return applyManualFor(active?.psgInteraction,'noteOn',id,note,options);}
  function noteOffPsg(id) {return applyManualFor(active?.psgInteraction,'noteOff',id);}
  function releasePsgKeyboard() {
    const result=active?.psgInteraction?.releaseKeyboard()??false;
    if(active&&result!==false){active.manualDirty=true;invalidateCache();emit();}
    return result;
  }
  function setPsgPitch(semitones) {return applyManualFor(active?.psgInteraction,'setPitch',semitones);}
  function describePsg(channel) {return active?.psgInteraction?.describe(channel)??{playable:false,reason:'Start a PSG song to play this channel.'};}
  function readPsgSnapshot(snapshot,consumedFrames=currentPosition()) {
    return active?.psgInteraction&&snapshot
      ?active.psgInteraction.readSnapshot(snapshot,consumedFrames,{frozen:true}):snapshot??null;
  }
  function editPcm(edit) {return applyManualFor(active?.pcmInteraction,'applyEdit',edit);}
  function applyPcmSettings(channel,settings) {return applyManualFor(active?.pcmInteraction,'applySettings',channel,settings);}
  function noteOnPcm(id,note,options) {return applyManualFor(active?.pcmInteraction,'noteOn',id,note,options);}
  function noteOffPcm(id) {return applyManualFor(active?.pcmInteraction,'noteOff',id);}
  function releasePcmKeyboard() {
    const result=active?.pcmInteraction?.releaseKeyboard()??false;
    if(active&&result!==false){active.manualDirty=true;invalidateCache();emit();}
    return result;
  }
  function setPcmPitch(semitones) {return applyManualFor(active?.pcmInteraction,'setPitch',semitones);}
  function describePcm(channel) {return active?.pcmInteraction?.describe(channel)??{playable:false,reason:'Start a PCM song to play this channel.'};}
  function readPcmSnapshot(snapshot,consumedFrames=currentPosition()) {
    return active?.pcmInteraction&&snapshot
      ?active.pcmInteraction.readSnapshot(snapshot,consumedFrames,{frozen:true}):snapshot??null;
  }
  function restartChangedSeek() {
    if(playback==='seeking')void seekAt(seekTargetSeconds,seekResumePlaying).catch(()=>{});
  }
  function setChannelMuted(id, value) {
    checkOpen();
    mix.setChannelMuted(id,value);
  }
  function setGroupVolume(id, value) {
    checkOpen();
    mix.setGroupVolume(id,value);
  }
  function resetMix() {
    checkOpen();
    mix.reset();
  }
  function setSeekCacheEnabled(value) {
    checkOpen();
    if(typeof value!=='boolean')throw new TypeError('Seek cache enabled must be a boolean');
    if(value===seekCacheEnabled)return;
    seekCacheEnabled=value;lastSeekCacheFrame=0;
    if(active){active.player.clearCheckpoints();updateCachePolicy(active);}
    emit();
  }
  function fail(error, run) {
    if (run && active !== run) return;
    positionFrames = playback==='seeking'&&run?run.player.renderedPositionFrames():currentPosition(run);
    // An error may occur mid-replay, when the former audible position no
    // longer belongs to this native state. Cleanup must still release it.
    try {lastLiveState = run?.timeline?.read(positionFrames) ?? null;}
    catch {lastLiveState=null;}
    try {lastPsgLiveState = run?.psgTimeline?.read(positionFrames) ?? null;}
    catch {lastPsgLiveState=null;}
    try {lastPcmLiveState = run?.pcmTimeline?.read(positionFrames) ?? null;}
    catch {lastPcmLiveState=null;}
    if (run) { active = null; release(run); }
    playback = 'error';
    seekTargetSeconds=null;
    errorMessage = error?.message ?? String(error);
    onStatus(`VGM playback failed: ${errorMessage}`);
    emit();
  }
  function schedule(run, segment) {
    const offset = Math.max(0, run.basePosition - segment.firstFrame);
    if (offset >= segment.frames) return;
    const node = run.context.createBufferSource();
    node.buffer = segment.buffer;
    node.connect(run.gain);
    segment.node = node;
    node.onended = () => { node.disconnect(); if (segment.node === node) segment.node = null; };
    const when = run.clockStart + Math.max(0, segment.firstFrame - run.basePosition) / run.sampleRate;
    node.start(when, offset / run.sampleRate);
  }
  function pump(run) {
    if (active !== run || playback !== 'playing') return;
    try {
      const consumed = currentPosition(run);
      positionFrames = consumed;
      run.segments = run.segments.filter(segment => {
        if (segment.firstFrame + segment.frames > consumed) return true;
        segment.node?.disconnect();
        return false;
      });
      const endTime = run.clockStart + (run.renderedFrames - run.basePosition) / run.sampleRate;
      if (!run.eof && run.context.currentTime > endTime + .02) {
        // A background/throttled tab may miss its refill. Continue from the
        // first unheard sample rather than silently skipping song commands.
        run.basePosition = run.renderedFrames;
        run.clockStart = run.context.currentTime + START_DELAY_SECONDS;
      }
      const deadline = performance.now() + 8;
      let generated = 0;
      while (!run.eof && generated++ < 8 && performance.now() < deadline) {
        const queuedSeconds = (run.renderedFrames - currentPosition(run)) / run.sampleRate;
        if (queuedSeconds >= LOOKAHEAD_SECONDS) break;
        const left = new Float32Array(CHUNK_FRAMES), right = new Float32Array(CHUNK_FRAMES);
        updateCachePolicy(run);
        const frames = run.player.process(left, right, CHUNK_FRAMES, {budgetMs:4});
        if (frames) {
          const buffer = run.context.createBuffer(2, frames, run.sampleRate);
          buffer.copyToChannel(left.subarray(0, frames), 0);
          buffer.copyToChannel(right.subarray(0, frames), 1);
          const segment = {buffer, frames, firstFrame:run.renderedFrames, node:null};
          run.renderedFrames += frames;
          run.segments.push(segment);
          schedule(run, segment);
        }
        run.eof = !run.player.isPlaying() && run.player.queuedFrames === 0;
        if (!frames) break;
      }
      if (run.eof && currentPosition(run) >= run.renderedFrames) {
        positionFrames = run.renderedFrames;
        lastLiveState = run.timeline?.read(positionFrames) ?? null;
        lastPsgLiveState = run.psgTimeline?.read(positionFrames) ?? null;
        lastPcmLiveState = run.pcmTimeline?.read(positionFrames) ?? null;
        clearInterval(run.timer);run.timer=null;
        totalSamples=Math.round(positionFrames*44100/run.sampleRate);
        playback = 'ended';
        emit();
        return;
      }
      emit();
    } catch (error) { fail(error, run); }
  }
  function requestAudio() {
    // Start inside the trusted action, even if header decoding or a previous
    // cancelled seek must finish before this operation can touch the engine.
    try {
      const audio=getAudio();
      const context=active?.context??(typeof audio?.then!=='function'?audio?.context:null);
      const resumed=context?Promise.resolve(context.resume()):Promise.resolve();
      const ready=Promise.all([Promise.resolve(audio),resumed]).then(([value])=>value);
      ready.catch(()=>{});return ready;
    }
    catch(error) {const failed=Promise.reject(error);failed.catch(()=>{});return failed;}
  }
  function enqueue(ticket,perform) {
    const task=work.catch(()=>{}).then(()=>isCurrent(ticket)?perform():false);
    work=task.catch(()=>{});
    return task;
  }
  async function prepare(ticket,audioReady,hostReady=Promise.resolve()) {
    let engine=null,timeline=null,psgTimeline=null,pcmTimeline=null,outputMix=null,interaction=null,psgInteraction=null,pcmInteraction=null;
    try {
      await metadataReady;
      if(!isCurrent(ticket))return null;
      if(metadata?.error)throw metadata.error;
      const {bytes}=metadata;
      const header=metadata.validated?metadata.header:inspectGenesisPreview(bytes);
      metadata.header=header;metadata.validated=true;
      mix.configure(header);
      emit();
      const audio = await audioReady;
      await hostReady;
      if (!isCurrent(ticket)) return null;
      const {context, output} = audio;
      if (!context || !output || output.context !== context) throw new Error('Reference output must belong to the Synth AudioContext.');
      await context.resume();
      if (!isCurrent(ticket)) return null;
      if(active&&!active.released&&active.context===context&&active.output===output)return active;
      release(active);active=null;
      engine = await createEngine(header);
      if (!isCurrent(ticket)) { engine.dispose(); return null; }
      // ymfm reset preserves its global EG sequencer phase. A deterministic
      // cold replay must restore this fresh-instance baseline as well as the
      // ordinary register reset. This fixed power-on state is independent of
      // optional seek checkpoints, and the outer mix adapter reapplies mutes.
      if(engine.ym2612?.supportsState?.()) {
        const origin=engine.ym2612.saveState(),reset=engine.reset;
        engine.reset=function(...args){const result=reset.apply(this,args);this.ym2612.loadState(origin);return result;};
      }
      // Filter only native output routing. Install before the Live observer so
      // it still records the VGM's original register values, including pan.
      outputMix = installSynthSongOutputMix(engine);
      outputMix.setMutedChannels(mix.getMutedChannels());
      for (const [id,value] of Object.entries(mix.getGroupVolumes())) outputMix.setGroupVolume(id,value);
      // Track source writes against native generated frames before the player
      // resets / prefetches. The UI later reads only the audible prefix.
      timeline = header.ym2612Clock ? createYm2612SongTimeline(engine, header.ym2612Clock) : null;
      psgTimeline = header.psgClock ? createPsgSongTimeline(engine, header.psgClock) : null;
      pcmTimeline = header.rf5c164Clock ? createPcmSongTimeline(engine, header.rf5c164Clock) : null;
      interaction=header.ym2612Clock?createSynthSongInteraction(engine,{clockHz:header.ym2612Clock}):null;
      psgInteraction=header.psgClock?createSynthPsgSongInteraction(engine,{clockHz:header.psgClock}):null;
      pcmInteraction=header.rf5c164Clock?createSynthPcmSongInteraction(engine,{clockHz:header.rf5c164Clock}):null;
      const player = new VgmPlayer(engine);
      // The host already keeps a bounded native-rate queue. A second speculative queue would
      // delay listening changes further; retain only one requested chunk.
      player.setPrefetchFactor(1);
      player.setLoopEnabled(false);
      player.checkpointMaxBytes=CACHE_MAX_BYTES;player.checkpointMaxCount=CACHE_MAX_COUNT;
      player.seekSettingsKey=()=>JSON.stringify([mix.getMutedChannels(),mix.getGroupVolumes()]);
      player.captureSeekState=()=>({timeline:timeline?.saveState(),psgTimeline:psgTimeline?.saveState(),pcmTimeline:pcmTimeline?.saveState(),outputMix:outputMix.saveState(),interaction:interaction?.saveState(),psgInteraction:psgInteraction?.saveState(),pcmInteraction:pcmInteraction?.saveState()});
      player.restoreSeekState=state=>{
        if(state.timeline)timeline?.loadState(state.timeline);
        if(state.psgTimeline)psgTimeline?.loadState(state.psgTimeline);
        if(state.pcmTimeline)pcmTimeline?.loadState(state.pcmTimeline);
        outputMix.loadState(state.outputMix);
        if(state.interaction)interaction?.loadState(state.interaction);
        if(state.psgInteraction)psgInteraction?.loadState(state.psgInteraction);
        if(state.pcmInteraction)pcmInteraction?.loadState(state.pcmInteraction);
      };
      const restoreCheckpoint=player.restoreCheckpoint.bind(player);
      player.restoreCheckpoint=target=>{
        lastSeekCacheFrame=restoreCheckpoint(target);return lastSeekCacheFrame;
      };
      player.load(bytes, {logger:{warn:message=>onStatus(String(message))}});
      sampleRate = engine.sampleRate();
      totalSamples = header.totalSamples;
      const gain = context.createGain();
      gain.gain.value = volume;
      gain.connect(output);
      const run = {engine, timeline, psgTimeline, pcmTimeline, outputMix, interaction, psgInteraction, pcmInteraction, manualDirty:false,player, context, output, gain, sampleRate,basePosition:0,renderedFrames:0,cacheResumeFrame:0,
        clockStart:context.currentTime + START_DELAY_SECONDS, segments:[], eof:false, timer:null, released:false};
      active = run;
      engine = null; // Ownership has moved to run/release.
      // The snapshot hooks retain these adapters for the life of this run.
      return run;
    } catch (error) {
      pcmInteraction?.dispose();
      psgInteraction?.dispose();
      interaction?.dispose();
      pcmTimeline?.dispose();
      psgTimeline?.dispose();
      timeline?.dispose();
      outputMix?.dispose();
      engine?.dispose();
      throw error;
    }
  }
  function startRun(run) {
    run.clockStart=run.context.currentTime+START_DELAY_SECONDS;
    playback='playing';run.player.play();
    for(const segment of run.segments)schedule(run,segment);
    pump(run);
    if(active===run&&playback==='playing')run.timer=setInterval(()=>pump(run),REFILL_MILLISECONDS);
  }
  async function play() {
    checkOpen();
    if(!source)throw new Error('Choose a VGM file first.');
    const audioReady=requestAudio(),ticket=cancelOperation();
    suspend(active);if(active)active.segments=[];
    playback='loading';errorMessage=null;seekTargetSeconds=null;emit();
    try {
      const run=await prepare(ticket,audioReady);
      if(!run||!isCurrent(ticket))return false;
      return await enqueue(ticket,()=>{
        run.player.reset();run.basePosition=run.renderedFrames=positionFrames=0;run.eof=false;run.cacheResumeFrame=0;run.manualDirty=false;
        updateCachePolicy(run);lastLiveState=lastPsgLiveState=lastPcmLiveState=null;lastSeekCacheFrame=0;
        startRun(run);return true;
      });
    } catch(error) {if(!isCurrent(ticket))return false;fail(error,active);throw error;}
  }
  async function seekAt(seconds,resumeAfter) {
    checkOpen();
    if(!source)throw new Error('Choose a VGM file first.');
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw new RangeError('Seek seconds must be a finite nonnegative number');
    const requested=totalSamples>0?Math.min(seconds,totalSamples/44100):seconds;
    const audioReady=requestAudio(),ticket=cancelOperation(),controller=new AbortController();abortSeek=controller;
    suspend(active);if(active)active.segments=[];
    seekResumePlaying=resumeAfter;seekTargetSeconds=requested;seekProgress=0;playback='seeking';errorMessage=null;emit();
    let hostReady;
    try {hostReady=Promise.resolve(beforeResume());hostReady.catch(()=>{});}
    catch(error) {hostReady=Promise.reject(error);hostReady.catch(()=>{});}
    try {
      const run=await prepare(ticket,audioReady,hostReady);
      if(!run||!isCurrent(ticket))return false;
      return await enqueue(ticket,async()=>{
        const player=run.player,process=player.process;
        // Fast-forward consumes every chunk, keeping only a bounded pending
        // Live window. Normal playback retains its audible-prefix observer.
        player.process=function(left,right,frames,options){
          // Even silent seek must bound the engine's native render head. An
          // unbudgeted long wait would leave up to 1.5 s in VgmPlayer's own
          // queue, making the first manual note after Resume arrive late.
          const copied=process.call(this,left,right,frames,{...options,budgetMs:4});
          run.timeline?.read(this.renderedPositionFrames());
          run.psgTimeline?.read(this.renderedPositionFrames());
          run.pcmTimeline?.read(this.renderedPositionFrames());
          return copied;
        };
        run.manualDirty=false;run.cacheResumeFrame=0;updateCachePolicy(run);lastSeekCacheFrame=0;
        try {
          await seekPlayback(player,requested*44100,{signal:controller.signal,
            onProgress:value=>{if(isCurrent(ticket)){seekProgress=value;emit();}}});
        } finally {player.process=process;}
        if(!isCurrent(ticket)||controller.signal.aborted)return false;
        const frame=player.renderedPositionFrames();
        run.basePosition=run.renderedFrames=positionFrames=frame;
        // Prime only the next bounded chunk, without scheduling any sound.
        // This applies zero-time writes at the target (including time zero)
        // and preserves their first sample for Resume, just like normal Pause.
        const left=new Float32Array(CHUNK_FRAMES),right=new Float32Array(CHUNK_FRAMES);
        let frames=0;player.play();
        try {
          do {
            if(controller.signal.aborted||!isCurrent(ticket))return false;
            frames=player.process(left,right,CHUNK_FRAMES,{budgetMs:4});
            if(!frames&&player.isPlaying())await new Promise(resolve=>setTimeout(resolve,0));
          } while(!frames&&player.isPlaying());
        } finally {player.pause();}
        if(controller.signal.aborted||!isCurrent(ticket))return false;
        if(frames) {
          const buffer=run.context.createBuffer(2,frames,run.sampleRate);
          buffer.copyToChannel(left.subarray(0,frames),0);buffer.copyToChannel(right.subarray(0,frames),1);
          run.segments.push({buffer,frames,firstFrame:frame,node:null});run.renderedFrames+=frames;
        }
        run.eof=Boolean(player.parser.ended)&&player.queuedFrames===0;
        if(run.eof)totalSamples=Math.round((frame+frames)*44100/run.sampleRate);
        lastLiveState=run.timeline?.read(frame)??null;
        lastPsgLiveState=run.psgTimeline?.read(frame)??null;
        lastPcmLiveState=run.pcmTimeline?.read(frame)??null;
        seekProgress=1;seekTargetSeconds=null;abortSeek=null;
        if(resumeAfter&&!run.eof)startRun(run);
        else {playback=resumeAfter&&run.eof?'ended':'paused';emit();}
        return true;
      });
    } catch(error) {
      if(!isCurrent(ticket)||controller.signal.aborted||error?.name==='AbortError')return false;
      fail(error,active);throw error;
    }
  }
  function seek(seconds) {
    return seekAt(seconds,playback==='playing'||playback==='seeking'&&seekResumePlaying);
  }
  function pause() {
    if (!active || playback !== 'playing') return;
    const run = active;
    run.pcmInteraction?.releaseKeyboard();
    run.psgInteraction?.releaseKeyboard();
    run.interaction?.releaseKeyboard();
    run.basePosition = currentPosition(run);
    positionFrames = run.basePosition;
    playback = 'paused';
    cancelNodes(run);
    emit();
  }
  async function resume() {
    checkOpen();
    const run = active, ticket = generation;
    if (!run || playback !== 'paused') return false;
    // Resume the shared context inside the trusted click before asynchronous
    // recorder shutdown yields. The song stays paused until the host is ready.
    const contextReady=Promise.resolve(run.context.resume());
    contextReady.catch(()=>{});
    await beforeResume();
    await contextReady;
    if (!isCurrent(ticket) || active !== run || playback !== 'paused') return false;
    run.clockStart = run.context.currentTime + START_DELAY_SECONDS;
    playback = 'playing';
    run.player.play();
    for (const segment of run.segments) schedule(run, segment);
    pump(run);
    if(active===run&&playback==='playing'&&!run.timer)run.timer=setInterval(()=>pump(run),REFILL_MILLISECONDS);
    return true;
  }
  function dispose() {
    if (disposed) return;
    discard();
    source = null;
    metadata=metadataReady=null;
    disposed = true;
    releaseMix();
  }
  return {load, clear, play, pause, resume, stop, setVolume,
    setChannelMuted, setGroupVolume, resetMix,seek,setSeekCacheEnabled,dispose,getState,
    editFm,applyFmPreset,noteOnFm,noteOffFm,releaseFmKeyboard,setFmPitch,readFmSnapshot,describeFm,
    editPsg,applyPsgPreset,noteOnPsg,noteOffPsg,releasePsgKeyboard,setPsgPitch,readPsgSnapshot,describePsg,
    editPcm,applyPcmSettings,noteOnPcm,noteOffPcm,releasePcmKeyboard,setPcmPitch,readPcmSnapshot,describePcm};
}
