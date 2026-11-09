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
import {createYm2612SongTimeline} from './synth_song_state.js?v=vgm-audition-1';
import {createSynthSongMix} from './synth_song_mix.js?v=vgm-mix-1';
import {installSynthSongOutputMix} from './synth_song_output_mix.js?v=vgm-mix-1';

const LOOKAHEAD_SECONDS = 0.2;
const START_DELAY_SECONDS = 0.01;
const REFILL_MILLISECONDS = 25;
const CHUNK_FRAMES = 2048;

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
 * An independent reference-song player. Loading merely copies selected bytes;
 * Play prepares a separate Genesis engine and borrows the Synth's audio bus.
 * The host owns that AudioContext: this controller never closes it.
 *
 * Small native-rate AudioBuffers are scheduled ahead of the audio clock. Web
 * Audio resamples those buffers to the device rate. Pausing retains unconsumed
 * PCM, including the exact offset into the current buffer; the parser is never
 * advanced again to reconstruct Pause. Master gain is outside those buffers.
 */
export function createSynthSongPreview({getAudio, onState=()=>{}, onStatus=()=>{}, createEngine=createPreviewEngine, beforeResume=()=>{}}={}) {
  if (typeof getAudio !== 'function') throw new TypeError('getAudio is required');
  let source = null, name = '', active = null, generation = 0, disposed = false;
  let volume = 1, playback = 'stopped', errorMessage = null;
  let positionFrames = 0, sampleRate = 0, totalSamples = 0;
  let lastLiveState = null;
  const mix = createSynthSongMix();

  function currentPosition(run=active) {
    if (!run) return positionFrames;
    if (playback !== 'playing') return run.basePosition;
    const elapsed = Math.max(0, run.context.currentTime - run.clockStart);
    return Math.min(run.renderedFrames, run.basePosition + Math.floor(elapsed * run.sampleRate));
  }
  function getState() {
    const consumedFrames = currentPosition();
    const liveState = active?.timeline ? active.timeline.read(consumedFrames) : lastLiveState;
    return {playback, hasSource:Boolean(source), name, errorMessage,
      sampleRate, positionFrames:consumedFrames, consumedFrames,
      positionSeconds:sampleRate ? consumedFrames / sampleRate : 0,
      totalSamples, durationSeconds:totalSamples / 44100, liveState,
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
    clearInterval(run.timer);
    cancelNodes(run);
    run.segments.length = 0;
    run.gain.disconnect();
    run.timeline?.dispose();
    run.outputMix?.dispose();
    run.engine.dispose();
  }
  function stop() {
    generation++;
    const run = active;
    active = null;
    release(run);
    positionFrames = 0;
    lastLiveState = null;
    playback = 'stopped';
    errorMessage = null;
    emit();
  }
  function load(bytes, nextName='') {
    checkOpen();
    const next = bytes instanceof Uint8Array ? new Uint8Array(bytes) :
      bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : null;
    if (!next) throw new TypeError('Choose a binary VGM or VGZ file.');
    stop();
    source = next;
    name = String(nextName);
    sampleRate = totalSamples = 0;
    mix.clear();
    emit();
  }
  function clear() {
    checkOpen();
    stop();
    source = null;
    name = '';
    sampleRate = totalSamples = 0;
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
    if (active) active.outputMix.setMutedChannels(mix.getMutedChannels());
  }
  function setChannelMuted(id, value) {
    checkOpen();
    if (!mix.setChannelMuted(id,value)) return;
    applyMix();
    emit();
  }
  function setChannelSolo(id, value) {
    checkOpen();
    if (!mix.setChannelSolo(id,value)) return;
    applyMix();
    emit();
  }
  function resetMix() {
    checkOpen();
    if (!mix.reset()) return;
    applyMix();
    emit();
  }
  function fail(error, run) {
    if (run && active !== run) return;
    positionFrames = currentPosition(run);
    lastLiveState = run?.timeline?.read(positionFrames) ?? null;
    if (run) { active = null; release(run); }
    playback = 'error';
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
        active = null;
        release(run);
        playback = 'ended';
        emit();
        return;
      }
      emit();
    } catch (error) { fail(error, run); }
  }
  async function play() {
    checkOpen();
    if (!source) throw new Error('Choose a VGM file first.');
    stop();
    const ticket = generation, selected = source;
    let engine = null, timeline = null, outputMix = null, run = null;
    playback = 'loading';
    emit();
    try {
      // Preserve Safari's trusted click: the host must create/resume its shared
      // AudioContext now, before VGZ decoding or WASM setup yields control.
      const audioReady = Promise.resolve(getAudio());
      audioReady.catch(() => {});
      const bytes = new Uint8Array(await maybeDecodeVgmFile(selected));
      if (!isCurrent(ticket)) return false;
      const header = inspectGenesisPreview(bytes);
      mix.configure(header);
      emit();
      const audio = await audioReady;
      if (!isCurrent(ticket)) return false;
      const {context, output} = audio;
      if (!context || !output || output.context !== context) throw new Error('Reference output must belong to the Synth AudioContext.');
      await context.resume();
      if (!isCurrent(ticket)) return false;
      engine = await createEngine(header);
      if (!isCurrent(ticket)) { engine.dispose(); return false; }
      // Filter only native output routing. Install before the Live observer so
      // it still records the VGM's original register values, including pan.
      outputMix = installSynthSongOutputMix(engine);
      outputMix.setMutedChannels(mix.getMutedChannels());
      // Track source writes against native generated frames before the player
      // resets / prefetches. The UI later reads only the audible prefix.
      timeline = header.ym2612Clock ? createYm2612SongTimeline(engine, header.ym2612Clock) : null;
      const player = new VgmPlayer(engine);
      // The host already buffers ~200 ms. A second speculative queue would
      // delay listening changes further; retain only one requested chunk.
      player.setPrefetchFactor(1);
      player.setLoopEnabled(false);
      player.load(bytes, {logger:{warn:message=>onStatus(String(message))}});
      player.play();
      sampleRate = engine.sampleRate();
      totalSamples = header.totalSamples;
      const gain = context.createGain();
      gain.gain.value = volume;
      gain.connect(output);
      run = {engine, timeline, outputMix, player, context, gain, sampleRate, basePosition:0, renderedFrames:0,
        clockStart:context.currentTime + START_DELAY_SECONDS, segments:[], eof:false, timer:null, released:false};
      active = run;
      engine = null; // Ownership has moved to run/release.
      timeline = null;
      outputMix = null;
      playback = 'playing';
      pump(run);
      if (active === run) run.timer = setInterval(() => pump(run), REFILL_MILLISECONDS);
      return true;
    } catch (error) {
      timeline?.dispose();
      outputMix?.dispose();
      engine?.dispose();
      if (!isCurrent(ticket)) return false;
      fail(error, run);
      throw error;
    }
  }
  function pause() {
    if (!active || playback !== 'playing') return;
    const run = active;
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
    for (const segment of run.segments) schedule(run, segment);
    pump(run);
    return true;
  }
  function dispose() {
    if (disposed) return;
    stop();
    source = null;
    disposed = true;
  }
  return {load, clear, play, pause, resume, stop, setVolume,
    setChannelMuted, setChannelSolo, resetMix, dispose, getState};
}
