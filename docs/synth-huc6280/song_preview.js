// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {VgmPlayer} from '../js/vgmplayer.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import factory from '../generated/huc6280_wasm.js';
import {prepareHuc6280SongSource} from './song_source.js';

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
} = {}) {
  let source = null, name = '', active = null, generation = 0, loadGeneration = 0;
  let loadController = null, loading = false, disposed = false, playback = 'stopped';
  let errorMessage = '', positionFrames = 0, sampleRate = 44100;
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
    const frames = position(), busy = loading || playback === 'starting';
    return {playback, playing:playback === 'playing', paused:playback === 'paused', busy, loading,
      hasSource:source !== null, name, errorMessage, sampleRate, positionFrames:frames,
      positionSeconds:frames / sampleRate, durationSeconds:source ? source.totalSamples / 44100 : 0,
      warnings:source ? [...source.warnings] : [], canPlay:!disposed && !!source && !busy && playback !== 'playing',
      canPause:!disposed && playback === 'playing', canResume:!disposed && !busy && playback === 'paused',
      canStop:!disposed && (busy || active !== null || frames > 0),
      bufferedFrames:active ? Math.max(0, active.renderedFrames - frames) : 0};
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
    try {run.gain.disconnect();} finally {run.engine.dispose();}
  }
  function stop() {
    generation++; loadGeneration++; loadController?.abort(); loadController = null; loading = false;
    const old = active; active = null; release(old);
    positionFrames = 0; playback = 'stopped'; errorMessage = ''; emit(); return true;
  }
  async function load(bytes, nextName = '', {signal} = {}) {
    open(); const ticket = ++loadGeneration;
    loadController?.abort(); const controller = loadController = new AbortController();
    const externalAbort = () => controller.abort();
    signal?.addEventListener('abort', externalAbort, {once:true});
    if (signal?.aborted) controller.abort();
    loading = true; emit();
    try {
      const prepared = await prepareHuc6280SongSource(bytes, {signal:controller.signal, yieldTask});
      if (disposed || ticket !== loadGeneration || controller.signal.aborted) throw aborted();
      generation++; const old = active; active = null; release(old);
      source = prepared; name = String(nextName); positionFrames = 0; sampleRate = 44100;
      playback = 'stopped'; errorMessage = ''; return true;
    } catch (error) {
      if (!disposed && ticket === loadGeneration && error?.name !== 'AbortError') notify(`VGM load failed: ${error.message}. Previous song kept.`);
      throw error;
    } finally {
      signal?.removeEventListener('abort', externalAbort);
      if (ticket === loadGeneration) {loadController = null; loading = false; emit();}
    }
  }
  function clear() {open(); stop(); source = null; name = ''; sampleRate = 44100; emit();}
  function fail(error, run = active) {
    if (run && active !== run) return;
    positionFrames = position(run); active = null; release(run);
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
      run.segments = run.segments.filter(segment => {
        if (segment.firstFrame + segment.frames > consumed) return true;
        try {segment.node?.disconnect();} catch {} return false;
      });
      const deadline = nowMs() + 8;
      for (let chunks = 0; !run.eof && chunks < 12 && nowMs() < deadline; chunks++) {
        if ((run.renderedFrames - position(run)) / run.sampleRate >= LOOKAHEAD) break;
        const left = new Float32Array(CHUNK), right = new Float32Array(CHUNK);
        const frames = run.player.process(left, right, CHUNK, {budgetMs:4});
        if (!Number.isInteger(frames) || frames < 0 || frames > CHUNK) throw new Error('Invalid HuC6280 reference render length');
        if (frames) {
          for (let i = 0; i < frames; i++) if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('HuC6280 reference produced non-finite PCM');
          const buffer = run.context.createBuffer(2, frames, run.sampleRate);
          buffer.copyToChannel(left.subarray(0, frames), 0); buffer.copyToChannel(right.subarray(0, frames), 1);
          const segment = {buffer, frames, firstFrame:run.renderedFrames, node:null, offset:0, playAt:null};
          run.renderedFrames += frames; run.segments.push(segment); scheduleSegment(run, segment);
        }
        run.eof = !run.player.isPlaying() && run.player.queuedFrames === 0;
        if (!frames) break;
      }
      if (run.eof && position(run) >= run.renderedFrames) {
        positionFrames = run.renderedFrames; active = null; playback = 'ended'; release(run); emit(); return;
      }
      if (forceEmit || run.lastEmitTime === null || run.context.currentTime - run.lastEmitTime >= .05) {
        run.lastEmitTime = run.context.currentTime; emit();
      }
      if (active === run && playback === 'playing') run.timer = schedule(() => {run.timer = null; pump(run);}, INTERVAL);
    } catch (error) {fail(error, run);}
  }
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
  async function prepareHost(ticket) {
    let audio, preparation;
    try {audio = requestAudio();} catch (error) {audio = Promise.reject(error);}
    try {preparation = beforePlay({isCurrent:() => current(ticket)});} catch (error) {preparation = Promise.reject(error);}
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
    if (!source) throw new Error('Choose a valid HuC6280 VGM/VGZ song first');
    if (playback === 'paused') return resume();
    if (playback === 'playing') return true;
    const ticket = ++generation, selected = source;
    release(active); active = null; positionFrames = 0; playback = 'starting'; errorMessage = ''; emit();
    let engine = null, gain = null;
    try {
      const host = await prepareHost(ticket); if (!current(ticket)) return false;
      const {context, output} = validateHost(host);
      engine = await createEngine(selected.header);
      if (!current(ticket)) {engine.dispose(); engine = null; return false;}
      validateHost(host);
      const rate = engine.sampleRate();
      if (!Number.isInteger(rate) || rate < 8000 || rate > 96000) throw new Error('Invalid HuC6280 reference sample rate');
      const player = new VgmPlayer(engine);
      player.setPrefetchFactor(1); player.setLoopEnabled(false);
      player.load(selected.bytes, {logger:{warn:message => {throw new Error(message);}}}); player.reset();
      gain = context.createGain(); gain.gain.value = 1; gain.connect(output);
      const run = {engine, player, context, output, gain, sampleRate:rate, basePosition:0, renderedFrames:0,
        segments:[], nextTime:null, timer:null, eof:false, released:false, lastEmitTime:null};
      active = run; engine = gain = null; sampleRate = rate;
      playback = 'playing'; player.play(); pump(run, true);
      return playback === 'playing' || playback === 'ended';
    } catch (error) {
      try {gain?.disconnect();} finally {engine?.dispose();}
      if (!current(ticket)) return false; fail(error); return false;
    }
  }
  function pause() {
    open(); const run = active; if (!run || playback !== 'playing') return false;
    run.basePosition = position(run); positionFrames = run.basePosition;
    cancelTimer(run); cancelNodes(run);
    run.segments = run.segments.filter(segment => segment.firstFrame + segment.frames > positionFrames);
    run.player.pause(); run.nextTime = null; playback = 'paused'; emit(); return true;
  }
  async function resume() {
    open(); const run = active; if (!run || playback !== 'paused' || loading) return false;
    const ticket = ++generation; playback = 'starting'; emit();
    try {
      const host = await prepareHost(ticket); if (!current(ticket) || active !== run) return false;
      const {context, output} = validateHost(host);
      if (context !== run.context || output !== run.output) throw new Error('Audio output changed; Stop and Play to restart the song');
      run.nextTime = null; playback = 'playing'; run.player.resume();
      for (const segment of run.segments) scheduleSegment(run, segment);
      pump(run, true); return playback === 'playing' || playback === 'ended';
    } catch (error) {if (current(ticket) && active === run) fail(error, run); return false;}
  }
  function dispose() {if (disposed) return; stop(); disposed = true; source = null; name = ''; emit();}
  return {load, play, pause, resume, stop, clear, getState, read:getState, dispose};
}
