// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {VgmPlayer} from '../js/vgmplayer.js';
import {YM2608Synth} from '../js/ym2608synth.js';
import {prepareFm2608SongSource} from './song_source.js';
import {createFm2608SongTimeline,createFm2608RegisterState} from './song_state.js';
import {createFm2608SongEngine,installFm2608SongMix,FM2608_SONG_CHANNELS} from './song_engine.js';
import {readFm2608OutputMix,resolveFm2608OutputMix} from './output_mix.js';
import {createPerformanceQueue} from '../js/playground_performance_queue.js';
import {createFm2608AdpcmNoteOffGuard} from './adpcm_noteoff_guard.js?v=opna-sine-release-2';

const CHUNK = 256, LOOKAHEAD = .05, START_DELAY = .01;
const nativeSchedule = globalThis.setTimeout.bind(globalThis);
const nativeCancel = globalThis.clearTimeout.bind(globalThis);
const aborted = () => new DOMException('OPNA song operation cancelled','AbortError');
const afterTask = () => new Promise(resolve => nativeSchedule(resolve,0));
const copy = value => structuredClone(value);

function syncClient(chip,snapshot) {
  for (const voice of snapshot.fm.channels) {
    const target = chip.channels[voice.channel], preset = voice.preset;
    Object.assign(target,{algorithm:preset.algorithm,feedback:preset.feedback,ams:preset.ams,pms:preset.pms,
      left:preset.pan.left,right:preset.pan.right,block:voice.block,fnum:voice.fnum,
      specialFrequencies:voice.specialFrequencies.map(({block,fnum}) => ({block,fnum})),
      operators:[1,2,3,4].map(index => ({...preset.operators[index]}))});
  }
  chip.lfo = {...snapshot.lfo}; chip._modeRegister = snapshot.fm.modeRegister;
  chip.clock = snapshot.clockHz * 6 / snapshot.prescale;
  chip.ssg.clock = snapshot.clockHz / (snapshot.prescale === 6 ? 4 : snapshot.prescale === 3 ? 2 : 1);
  chip.adpcm.clock = chip.clock;
  const previousSsg = chip.ssg._getState();
  const ssgRegisters = Array.from(snapshot.registers[0].subarray(0,16));
  chip.ssg._adoptState({registers:ssgRegisters,levels:[0,1,2].map(channel =>
    ssgRegisters[8+channel] || (previousSsg.registers[8+channel] === 0 ? previousSsg.levels[channel] : 0))});
  for (let register = 0; register < 16; register++) {
    chip.adpcm.observeWrite(register,snapshot.registers[1][register]);
  }
  for (let register = 0x18; register <= 0x1d; register++) chip.rhythm.observeWrite(register,snapshot.registers[0][register]);
  return chip;
}

function seedShadow(shadow,snapshot) {
  shadow.reset();
  for (let port=0; port<2; port++) for (let register=0; register<256; register++) {
    if (port === 1 && [0,8].includes(register) || port === 0 && [0x28,0x2e,0x2f].includes(register)) continue;
    shadow.write(port,register,snapshot.registers[port][register]);
  }
  for (const voice of snapshot.fm.channels) {
    const port = voice.channel >= 3 ? 1 : 0, offset = voice.channel % 3;
    shadow.write(port,0xa4+offset,voice.block << 3 | voice.fnum >> 8);
    shadow.write(port,0xa0+offset,voice.fnum & 255);
    shadow.write(0,0x28,voice.keyMask << 4 | [0,1,2,4,5,6][voice.channel]);
  }
  snapshot.channel3.frequencies.slice(0,3).forEach(({block,fnum},index) => {
    const low = [0xa9,0xaa,0xa8][index];
    shadow.write(0,low+4,block << 3 | fnum >> 8); shadow.write(0,low,fnum & 255);
  });
  if (snapshot.prescale !== 6) shadow.write(0,snapshot.prescale === 3 ? 0x2e : 0x2f,0);
  if (snapshot.adpcm.available) shadow.loadMemory(snapshot.adpcm.data,snapshot.adpcm.start);
  shadow.write(1,0,snapshot.adpcm.control);
}

function createClient(engine,onWrite=()=>{}) {
  const transport = {
    write(port,register,value) {
      if (engine.fm2608Disposed) throw aborted();
      engine.fm2608ManualWrite = true;
      try {const result = engine.writeYm2608(port,register,value); onWrite(port,register,value); return result;}
      finally {engine.fm2608ManualWrite = false;}
    },
    loadAdpcmMemory(bytes,address) {
      if (engine.fm2608Disposed) throw aborted();
      engine.fm2608ManualWrite = true;
      try {return engine.loadAdpcmBMemory(bytes,address);}
      finally {engine.fm2608ManualWrite = false;}
    },
    loadRhythmRom:bytes => {if (engine.fm2608Disposed) throw aborted();return engine.loadAdpcmARom(bytes);},
  };
  return new YM2608Synth({transport,clock:engine.fm2608Clock});
}

/** Independent one-pass OPNA song transport. Code ownership is coordinated by
 * beforePlay. The Synth owns the borrowed AudioContext and master output.
 * Pause retains exact unconsumed PCM. Paused keyboard audition renders a second
 * OPNA, leaving the song core, parser and retained PCM untouched for Resume. */
export function createFm2608SongPlayer({getAudio,beforePlay=async()=>{},onState=()=>{},onStatus=()=>{},
  createEngine=createFm2608SongEngine,schedule=nativeSchedule,cancel=nativeCancel,yieldTask=afterTask,
  nowMs=()=>performance.now()} = {}) {
  if (typeof getAudio !== 'function') throw new TypeError('getAudio is required');
  let source = null, name = '', active = null, audition = null, disposed = false;
  let generation = 0, loadGeneration = 0, loadController = null, loading = false, playback = 'stopped';
  let positionFrames = 0, sampleRate = 44100, volume = 1, errorMessage = '', liveEnabled = true;
  let liveState = null, songLiveState = null, seeking = null, preparingAudition = false, pending = Promise.resolve();
  let outputMix = readFm2608OutputMix();
  const enabled = Object.fromEntries(Object.entries(FM2608_SONG_CHANNELS).map(([section,count]) => [section,Array(count).fill(true)]));
  const open = () => {if (disposed) throw new Error('OPNA song player is disposed');};
  const current = ticket => !disposed && ticket === generation;
  const notify = message => {try {onStatus(message);} catch {}};
  function position(run=active) {
    if (!run) return positionFrames;
    if (playback !== 'playing') return run.basePosition;
    let result = run.basePosition;
    for (const segment of run.segments) {
      if (segment.playAt === null || run.context.currentTime < segment.playAt) break;
      const frames = segment.offset + Math.max(0,Math.floor((run.context.currentTime - segment.playAt) * run.sampleRate + 1e-7));
      result = Math.max(result,segment.firstFrame + Math.min(segment.frames,frames));
    }
    return Math.min(run.renderedFrames,result);
  }
  function publish(force=false) {
    if (!active || seeking) return;
    const frame = position();
    const next = playback === 'paused' && audition ? audition.shadow.snapshot(frame) : active.timeline.read(frame);
    if (playback === 'paused' && audition) {
      const {levels} = audition.chip.ssg._getState();
      next.ssg.channels = next.ssg.channels.map((voice,index) => ({...voice,volume:levels[index] & 15,envelope:Boolean(levels[index] & 16)}));
      next.adpcm.control = (audition.chip.adpcm.registers[0] & ~0x70) | audition.adpcmMode.value;
      next.adpcm.external = Boolean(audition.adpcmMode.value & 0x20);
      next.adpcm.repeat = Boolean(audition.adpcmMode.value & 0x10);
      next.adpcm.playing = Boolean(next.adpcm.control & 128) && !(next.adpcm.control & 1);
    }
    if (playback === 'playing' && active.manualAdpcmReleased) {
      next.adpcm.control = (next.adpcm.control & 0x70) | 1; next.adpcm.playing = false;
      next.registers[1][0] = next.adpcm.control;
    }
    songLiveState = active.timeline.readSong(frame);
    if (force || liveEnabled || !liveState) liveState = next;
  }
  function getState() {
    if (['playing','paused'].includes(playback)) publish();
    const frames = position(), busy = loading || playback === 'starting' || Boolean(seeking);
    const resolvedMix = resolveFm2608OutputMix(outputMix,source);
    return {playback,state:playback,loaded:Boolean(source),hasSource:Boolean(source),name,errorMessage,
      playing:playback === 'playing',paused:playback === 'paused',loading,busy,preparingAudition,
      sampleRate,positionFrames:frames,positionSeconds:frames / sampleRate,totalSamples:source?.totalSamples ?? 0,
      durationSeconds:source ? source.totalSamples / 44100 : 0,warnings:source ? [...source.warnings] : [],
      format:source?.format ?? '',metadata:source?.metadata ?? null,sourceHeader:source?.sourceHeader ?? null,
      sourceChip:source?.sourceChip ?? null,sourceClock:source?.sourceClock ?? null,
      compatibility:source?.compatibility ? {...source.compatibility,volumeAdjustmentsApplied:resolvedMix.volumeAdjustmentsApplied,
        extraVolumeEntries:resolvedMix.fileVolumeEntries} : null,
      outputMix:resolvedMix,
      liveEnabled,liveState,songLiveState,manualReady:!busy && (playback === 'playing' && Boolean(active) || playback === 'paused' && Boolean(audition)),
      channelEnabled:copy(enabled),volume,seeking:Boolean(seeking),seekProgress:seeking?.progress ?? 0,
      seekTargetSeconds:seeking?.targetSeconds ?? null,
      canPlay:Boolean(source) && !busy && playback !== 'playing',canPause:playback === 'playing',
      canResume:playback === 'paused' && !busy,canStop:busy || Boolean(active) || frames > 0,
      canSeek:Boolean(source) && !loading && playback !== 'starting',
    };
  }
  function emit() {try {onState(getState());} catch {}}
  function cancelNodes(run) {
    if (!run) return;
    if (run.timer !== null) {cancel(run.timer); run.timer = null;}
    for (const segment of run.segments) {
      const node = segment.node; segment.node = null; segment.playAt = null;
      if (!node) continue;
      node.onended = null;
      try {node.stop();} catch {} try {node.disconnect();} catch {}
    }
    run.nextTime = null;
  }
  function release(run) {
    if (!run || run.released) return;
    run.released = true; cancelNodes(run); run.gain?.disconnect(); run.adpcmRelease?.dispose();
    run.timeline?.dispose(); run.mix?.dispose(); run.engine.fm2608Disposed = true; run.engine.dispose(); run.segments.length = 0;
  }
  function releaseAudition() {release(audition); audition = null; preparingAudition = false;}
  function stop() {
    if (disposed) return;
    generation++; seeking?.controller.abort(); seeking = null;
    loadController?.abort(); loading = false;
    releaseAudition(); release(active); active = null; playback = 'stopped'; positionFrames = 0;
    liveState = songLiveState = null; errorMessage = ''; emit();
  }
  async function load(bytes,nextName='',{signal} = {}) {
    open(); const ticket = ++loadGeneration;
    loadController?.abort(); const controller = new AbortController(); loadController = controller;
    const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
    if (signal?.aborted) controller.abort();
    loading = true; emit();
    try {
      const next = await prepareFm2608SongSource(bytes,{signal:controller.signal,yieldTask});
      if (disposed || ticket !== loadGeneration || controller.signal.aborted) throw aborted();
      // Validation is transactional: a bad import leaves the previous song,
      // position, pending PCM and authored Synth sound available.
      stop(); source = next; name = String(nextName || 'OPNA song'); sampleRate = 44100;
      outputMix = readFm2608OutputMix({ym2203Mode:source.sourceChip === 'ym2203'},outputMix);
      emit(); return getState();
    } finally {
      signal?.removeEventListener('abort',abort);
      if (ticket === loadGeneration) {loadController = null; loading = false; emit();}
    }
  }
  function clear() {open(); stop(); source = null; name = ''; outputMix = readFm2608OutputMix({ym2203Mode:false},outputMix); emit();}
  function fail(error,run=active) {
    if (run && active !== run) return;
    positionFrames = position(); releaseAudition(); release(active); active = null;
    playback = 'error'; errorMessage = error?.message ?? String(error); notify(`Song playback failed: ${errorMessage}`); emit();
  }
  function applyMix(run) {
    for (const [section,channels] of Object.entries(enabled)) channels.forEach((value,channel) => run.mix.setChannelEnabled(section,channel,value));
    run.engine.setOutputGains(resolveFm2608OutputMix(outputMix,run.source).effective);
    run.gain.gain.value = volume;
  }
  function scheduleSegment(run,segment) {
    const offset = Math.max(0,run.basePosition - segment.firstFrame);
    if (offset >= segment.frames) return;
    const at = Math.max(run.nextTime ?? 0,run.context.currentTime + START_DELAY);
    const node = run.context.createBufferSource(); node.buffer = segment.buffer; node.connect(run.gain);
    segment.node = node; segment.offset = offset; segment.playAt = at;
    node.onended = () => {try {node.disconnect();} catch {} if (segment.node === node) segment.node = null;};
    node.start(at,offset / run.sampleRate); run.nextTime = at + (segment.frames - offset) / run.sampleRate;
  }
  function append(run,left,right,frames) {
    for (let index = 0; index < frames; index++) if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error('OPNA renderer produced non-finite PCM');
    const buffer = run.context.createBuffer(2,frames,run.sampleRate);
    buffer.copyToChannel(left.subarray(0,frames),0); buffer.copyToChannel(right.subarray(0,frames),1);
    const segment = {buffer,frames,firstFrame:run.renderedFrames,node:null,offset:0,playAt:null};
    run.renderedFrames += frames; run.segments.push(segment); scheduleSegment(run,segment);
  }
  function pump(run) {
    if (active !== run || playback !== 'playing') return;
    try {
      const consumed = position(); positionFrames = consumed; run.basePosition = consumed;
      run.timeline.read(consumed);
      run.segments = run.segments.filter(segment => segment.firstFrame + segment.frames > consumed);
      const deadline = nowMs() + 8;
      for (let chunks=0; !run.eof && chunks<12 && nowMs()<deadline; chunks++) {
        if ((run.renderedFrames - position()) / run.sampleRate >= LOOKAHEAD) break;
        const left = new Float32Array(CHUNK), right = new Float32Array(CHUNK);
        const frames = run.player.process(left,right,CHUNK,{budgetMs:4});
        if (!Number.isInteger(frames) || frames < 0 || frames > CHUNK) throw new Error('Invalid OPNA render length');
        if (frames) append(run,left,right,frames);
        run.eof = !run.player.isPlaying() && run.player.queuedFrames === 0;
        if (!frames) break;
      }
      if (run.eof && position() >= run.renderedFrames) {
        positionFrames = run.renderedFrames; publish(true); active = null; playback = 'ended'; release(run); emit(); return;
      }
      if (run.lastEmitTime === null || run.context.currentTime - run.lastEmitTime >= .05) {run.lastEmitTime = run.context.currentTime; emit();}
      if (active === run && playback === 'playing') run.timer = schedule(() => {run.timer = null; pump(run);},8);
    } catch (error) {fail(error,run);}
  }
  async function host(ticket,{manualPreparation=false}={}) {
    await beforePlay({manualPreparation}); if (!current(ticket)) throw aborted();
    const audio = await getAudio(); if (!current(ticket)) throw aborted();
    const context = audio?.context, output = audio?.songInputNode ?? audio?.outputNode;
    if (!context || !output || output.context !== context || context.state === 'closed') throw new Error('The song requires the Synth AudioContext and master input');
    if (context.state !== 'running') await context.resume();
    if (!current(ticket)) throw aborted();
    return {context,output};
  }
  function installManualAdpcmRelease(run,physicalWrite,onRequestedOff = () => {}) {
    const engine = run.engine, chip = run.chip, rate = run.sampleRate;
    const originals = {write:engine.writeYm2608,process:engine.processFrames,reset:engine.reset,load:engine.loadAdpcmBMemory};
    let frame = 0, retired = false;
    const apply = command => physicalWrite(command.port,command.register,command.value);
    const queue = createPerformanceQueue({sampleRate:rate,nowFrame:() => frame,apply});
    const guard = createFm2608AdpcmNoteOffGuard({
      postMessage:message => queue.receive(message),writePhysical:writes => writes.forEach(apply),
      now:() => frame / rate,sampleRate:rate,getVolume:() => run.mix.snapshot().registers[1][11],
      getMuted:() => !enabled.adpcm[0],getGate:() => Boolean(chip.adpcm.registers[0] & 128),
      requestedOff() {
        run.manualAdpcmReleased = true;
        chip.adpcm.observeWrite(0,(chip.adpcm.registers[0] & 0x70) | 1);
        onRequestedOff(chip.adpcm.registers[0]);
      },
    });
    function write(port,register,value) {
      let restore = false;
      if (port === 1 && register === 0) {
        if (value & 128) { guard.cancel({restore:true}); run.manualAdpcmReleased = false; }
        else if (value & 1) restore = guard.cancel();
        else guard.cancel({stop:true,restore:true});
      } else if (port === 1 && [2,3,4,5,11,12,13].includes(register)) guard.cancel({stop:true,restore:true});
      const result = originals.write.call(this,port,register,value);
      if (restore) guard.restore();
      return result;
    }
    function process(frames) {
      queue.advance(frame);
      if (queue.nextFrame() >= frame + frames) {
        const result = originals.process.call(this,frames); frame += frames; return result;
      }
      const left = new Float32Array(frames), right = new Float32Array(frames);
      for (let offset = 0; offset < frames;) {
        queue.advance(frame);
        const count = Math.min(frames - offset,queue.nextFrame() - frame);
        const pcm = originals.process.call(this,count);
        left.set(pcm.left,offset); right.set(pcm.right,offset); frame += count; offset += count;
      }
      return {left,right};
    }
    function reset(...args) { guard.cancel(); run.manualAdpcmReleased = false; const result = originals.reset.apply(this,args); frame = 0; return result; }
    function load(...args) { guard.cancel({stop:true,restore:true}); return originals.load.apply(this,args); }
    engine.writeYm2608 = write; engine.processFrames = process; engine.reset = reset; engine.loadAdpcmBMemory = load;
    chip.adpcm.noteOff = () => {
      if (retired || engine.fm2608Disposed) throw aborted();
      return guard.noteOff();
    };
    return {volumeChanged() {
      guard.volumeChanged();
      if (guard.getState().pending) physicalWrite(1,11,guard.filterVolume(enabled.adpcm[0] ? run.mix.snapshot().registers[1][11] : 0));
    },dispose() {
      if (retired) return; retired = true; guard.dispose();
      for (const [key,original,installed] of [['writeYm2608',originals.write,write],['processFrames',originals.process,process],['reset',originals.reset,reset],['loadAdpcmBMemory',originals.load,load]]) {
        if (engine[key] === installed) engine[key] = original;
      }
    }};
  }
  async function createRun(ticket,selected,outputHost) {
    const engine = await createEngine(selected.header);
    if (!current(ticket)) {engine.dispose(); throw aborted();}
    let mix, timeline, gain;
    try {
      engine.fm2608Clock = selected.header.ym2608Clock;
      const physicalWrite = engine.writeYm2608.bind(engine);
      mix = installFm2608SongMix(engine,engine.fm2608Clock);
      timeline = createFm2608SongTimeline(engine,engine.fm2608Clock);
      const chip = createClient(engine);
      const player = new VgmPlayer(engine); player.setPrefetchFactor(1); player.setLoopEnabled(false);
      player.load(selected.bytes,{logger:{warn:message => {throw new Error(message);}}}); player.reset();
      const rate = engine.sampleRate();
      if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error('Invalid OPNA output rate');
      gain = outputHost.context.createGain(); gain.connect(outputHost.output);
      const run = {engine,mix,timeline,chip,player,...outputHost,gain,sampleRate:rate,source:selected,
        basePosition:0,renderedFrames:0,segments:[],nextTime:null,timer:null,eof:false,released:false,lastEmitTime:null};
      run.adpcmRelease = installManualAdpcmRelease(run,physicalWrite);
      applyMix(run); return run;
    } catch (error) {gain?.disconnect(); timeline?.dispose(); mix?.dispose(); engine.dispose(); throw error;}
  }
  async function play() {
    open(); if (loading || seeking || playback === 'starting') return false;
    if (!source) throw new Error('Choose a VGM, VGZ or S98 song first');
    if (playback === 'paused') return resume();
    if (playback === 'playing') return true;
    const ticket = ++generation; releaseAudition(); release(active); active = null;
    playback = 'starting'; positionFrames = 0; liveState = songLiveState = null; errorMessage = ''; emit();
    try {
      const output = await host(ticket), run = await createRun(ticket,source,output);
      if (!current(ticket)) {release(run); return false;}
      active = run; sampleRate = run.sampleRate; playback = 'playing'; run.player.play(); pump(run);
      return playback === 'playing' || playback === 'ended';
    } catch (error) {if (current(ticket)) fail(error); return false;}
  }
  function auditionPump(run) {
    if (audition !== run || playback !== 'paused') return;
    try {
      const consumed = run.context.currentTime * run.sampleRate;
      run.segments = run.segments.filter(segment => segment.playAt !== null && (segment.playAt + segment.frames / run.sampleRate) > run.context.currentTime);
      for (let chunks=0; chunks<12 && (run.nextTime ?? 0)<run.context.currentTime+LOOKAHEAD; chunks++) {
        const pcm = run.engine.processFrames(CHUNK); append(run,pcm.left,pcm.right,CHUNK);
      }
      if (consumed >= 0 && (run.lastEmitTime === null || run.context.currentTime-run.lastEmitTime >= .05)) {run.lastEmitTime=run.context.currentTime; emit();}
      run.timer = schedule(() => {run.timer=null; auditionPump(run);},8);
    } catch (error) {releaseAudition(); notify(`Paused audition unavailable: ${error?.message ?? error}`); emit();}
  }
  async function prepareAudition(ticket,run,snapshot) {
    preparingAudition = true; emit();
    const engine = await createEngine(run.source.header);
    if (!current(ticket) || active !== run || playback !== 'paused') {engine.dispose(); return;}
    let next = null;
    try {
      engine.fm2608Clock = run.source.header.ym2608Clock;
      const physicalWrite = engine.writeYm2608.bind(engine);
      const mix = installFm2608SongMix(engine,engine.fm2608Clock), shadow = createFm2608RegisterState(engine.fm2608Clock);
      const adpcmMode = {value:snapshot.adpcm.control & 0x70};
      const chip = createClient(engine,(port,register,value) => {
        // High-level Key Off sends the pure reset command. Retain the chosen
        // sample playback mode while its actual execution gate is cleared.
        if (port === 1 && register === 0 && value !== 1) adpcmMode.value = value & 0x70;
        shadow.write(port,register,value);
      });
      engine.reset();
      const memory = run.timeline.getMemory(); engine.loadAdpcmBMemory(memory,0,memory.length);
      // Recreate the written controls, never replay CPU memory-data side effects.
      // Frequency high/low pairs are committed explicitly after the bulk copy.
      for (let port=0; port<2; port++) for (let register=0; register<256; register++) {
        if (port === 1 && [0,8].includes(register) || port === 0 && [0x10,0x27,0x28,0x2d,0x2e,0x2f].includes(register)) continue;
        engine.writeYm2608(port,register,snapshot.registers[port][register]);
      }
      syncClient(chip,snapshot);
      for (const voice of snapshot.fm.channels) chip.setBlockFnum(voice.channel,voice.block,voice.fnum);
      snapshot.channel3.frequencies.forEach(({block,fnum},operator) => chip.setChannel3SpecialFrequency(operator,block,fnum));
      chip.write(0,0x27,snapshot.fm.modeRegister & ~0x8f);
      for (let channel=0; channel<6; channel++) chip.keyOff(channel);
      for (let channel=0; channel<3; channel++) chip.ssg.keyOff(channel);
      chip.rhythm.keyOff([0,1,2,3,4,5]); chip.adpcm.keyOff();
      // The displayed frozen state begins with the audible song snapshot.
      // Only subsequent explicit human writes change this separate observer.
      seedShadow(shadow,snapshot);
      const keyOff = chip.adpcm.keyOff.bind(chip.adpcm);
      chip.adpcm.keyOff = () => {
        const result = keyOff();
        chip.adpcm.registers[0] = 1 | adpcmMode.value;
        return result;
      };
      // Stopped Repeat edits use this logical control shadow to preserve the
      // external/record bits while changing just Repeat, without Key On.
      chip.adpcm.registers[0] = 1 | adpcmMode.value;
      const gain = run.context.createGain(); gain.connect(run.output);
      next = {engine,mix,chip,shadow,adpcmMode,source:run.source,context:run.context,output:run.output,gain,sampleRate:run.sampleRate,
        basePosition:0,renderedFrames:0,segments:[],nextTime:null,timer:null,released:false,lastEmitTime:null};
      next.adpcmRelease = installManualAdpcmRelease(next,physicalWrite,value => shadow.write(1,0,value));
      applyMix(next); audition = next; preparingAudition = false; auditionPump(next); emit();
    } catch (error) {if (next) release(next); else engine.dispose(); preparingAudition = false; throw error;}
  }
  async function pause() {
    open(); const run = active; if (!run || playback !== 'playing') return false;
    const ticket = ++generation;
    run.basePosition = position(); positionFrames = run.basePosition; publish(true);
    const frozen = liveState; cancelNodes(run);
    run.segments = run.segments.filter(segment => segment.firstFrame + segment.frames > positionFrames);
    run.player.pause(); playback = 'paused'; emit();
    pending = prepareAudition(ticket,run,frozen).catch(error => {
      if (current(ticket)) {preparingAudition = false; notify(`Paused audition unavailable: ${error?.message ?? error}`); emit();}
    });
    await pending; return playback === 'paused';
  }
  async function resume() {
    open(); const run = active; if (!run || playback !== 'paused' || loading || seeking) return false;
    const ticket = ++generation; playback = 'starting'; emit();
    try {
      const output = await host(ticket);
      if (!current(ticket) || active !== run) return false;
      if (output.context !== run.context || output.output !== run.output) throw new Error('Audio output changed. Stop and Play to restart the song');
      releaseAudition();
      playback = 'playing'; run.player.resume(); run.nextTime = null;
      for (const segment of run.segments) scheduleSegment(run,segment);
      pump(run); emit(); return playback === 'playing' || playback === 'ended';
    } catch (error) {if (current(ticket)) fail(error,run); return false;}
  }
  async function seek(seconds,{manualPreparation=false}={}) {
    open(); if (!source || loading || !Number.isFinite(seconds)) throw new TypeError('Choose a song and a finite seek time');
    const targetSeconds = Math.max(0,Math.min(source.totalSamples/44100,seconds));
    const resumePlaying = playback === 'playing', previous = active, previousPlayback = playback;
    const previousPosition = position(), ticket = ++generation;
    seeking?.controller.abort(); const controller = new AbortController();
    seeking = {controller,targetSeconds,progress:0}; releaseAudition();
    if (previous) {previous.basePosition=previousPosition; cancelNodes(previous); previous.player.pause();}
    playback = 'seeking'; emit();
    let next = null;
    try {
      const output = await host(ticket,{manualPreparation}); next = await createRun(ticket,source,output);
      const target = Math.min(Math.round(targetSeconds * next.sampleRate),Math.floor(source.totalSamples * next.sampleRate / 44100));
      const left = new Float32Array(2048), right = new Float32Array(2048); let frame = 0;
      next.player.play(); const deadline = nowMs() + 30000;
      while (frame < target) {
        if (!current(ticket) || controller.signal.aborted) throw aborted();
        if (nowMs() > deadline) throw new Error('OPNA seek exceeded 30 seconds');
        const frames = next.player.process(left,right,Math.min(2048,target-frame),{budgetMs:4});
        frame += frames; next.timeline.read(frame);
        if (!frames && !next.player.isPlaying()) break;
        seeking.progress = target ? frame / target : 1; emit(); await yieldTask();
      }
      if (!current(ticket) || controller.signal.aborted) throw aborted();
      next.basePosition = next.renderedFrames = frame;
      next.eof = !next.player.isPlaying() && next.player.queuedFrames === 0;
      applyMix(next);
      release(previous); active = next; next = null; positionFrames=frame; sampleRate=active.sampleRate;
      seeking=null; liveState = songLiveState = null;
      if (resumePlaying) {playback='playing'; pump(active);}
      else {playback='paused'; active.player.pause(); publish(true); await prepareAudition(ticket,active,liveState);}
      emit(); return true;
    } catch (error) {
      release(next);
      if (!current(ticket)) return false;
      seeking=null; active=previous; positionFrames=previousPosition; playback=previous ? 'paused' : 'stopped';
      if (previous && previousPlayback === 'playing') {playback='playing'; previous.player.resume(); for (const segment of previous.segments) scheduleSegment(previous,segment); pump(previous);}
      if (error.name !== 'AbortError') {errorMessage=error?.message??String(error); notify(`Seek failed: ${errorMessage}`);}
      emit(); return false;
    }
  }
  function setLiveEnabled(value) {open(); if (typeof value !== 'boolean') throw new TypeError('Live enabled must be boolean'); liveEnabled=value; if(value)publish(true); emit(); return getState();}
  function setChannelEnabled(section,channel,value) {
    open(); if (!Object.hasOwn(enabled,section) || !Number.isInteger(channel) || channel<0 || channel>=enabled[section].length) throw new RangeError('Invalid OPNA mixer channel');
    if (typeof value !== 'boolean') throw new TypeError('Channel enabled must be boolean');
    enabled[section][channel]=value; active?.mix.setChannelEnabled(section,channel,value); audition?.mix.setChannelEnabled(section,channel,value);
    if (section === 'adpcm') { active?.adpcmRelease?.volumeChanged(); audition?.adpcmRelease?.volumeChanged(); }
    emit(); return getState();
  }
  function setVolume(value) {open(); if(!Number.isFinite(value)||value<0||value>3.8)throw new RangeError('Song volume must be 0–3.8');volume=value;if(active)active.gain.gain.value=value;if(audition)audition.gain.gain.value=value;emit();}
  function setOutputMix(value) {
    open();
    const next = readFm2608OutputMix(value,outputMix);
    const effective = resolveFm2608OutputMix(next,source).effective;
    active?.engine.setOutputGains(effective);
    audition?.engine.setOutputGains(effective);
    outputMix = next;
    // Existing queued stereo buffers finish at the previous mix. New PCM uses
    // these gains within the normal short lookahead, including after Resume.
    // Keeping that bounded queue preserves note gates and the exact position.
    emit(); return getState();
  }
  function getChip() {
    if (seeking || loading) return null;
    if (playback === 'paused' && audition) {
      audition.chip.adpcm.registers[0] = (audition.chip.adpcm.registers[0] & ~0x70) | audition.adpcmMode.value;
      return audition.chip;
    }
    if (playback === 'playing' && active) {
      const chip = syncClient(active.chip,active.mix.snapshot());
      if (active.manualAdpcmReleased) chip.adpcm.observeWrite(0,(chip.adpcm.registers[0] & 0x70) | 1);
      return chip;
    }
    return null;
  }
  function write(port,register,value) {const chip=getChip();if(!chip)throw new Error('Play or pause a song before editing its channels');chip.write(port,register,value);publish(true);emit();}
  function dispose() {if(disposed)return;stop();disposed=true;source=null;name='';}
  return {load,play,pause,resume,stop,clear,seek,getState,read:getState,getChip,write,setLiveEnabled,setChannelEnabled,setVolume,setOutputMix,
    whenIdle:()=>pending,dispose};
}
