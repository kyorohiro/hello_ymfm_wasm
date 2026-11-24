// SPDX-License-Identifier: BSD-3-Clause
import { normalizeYm2610BSourceGains } from '../js/ym2610b.js?v=ym2610-source-mix-1';
import { createFm2610SongTimeline, createFm2610VgmEngine, createFm2610VgmPlayer } from './vgm.js';

const workletUrl = new URL('../js/vgm-output-worklet.js?v=fm2610-position-1', import.meta.url).href;
const worklets = new WeakMap();
const framesPerChunk = 2048;
const bufferFrames = 8192;
const checkpointInterval = 2;
const checkpointBytes = 64 * 1024 * 1024;
const checkpointCount = 32;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

function loadOutputWorklet(context) {
  if (!worklets.has(context)) {
    worklets.set(context, context.audioWorklet.addModule(workletUrl).catch(error => {
      worklets.delete(context);
      throw error;
    }));
  }
  return worklets.get(context);
}

export function createFm2610SongTransport({sound, beforePlay, onState, onError}) {
  let run = null;
  let renderer = null;
  let retainedAdpcm = null;
  let sourceGains = [1, 1, 1, 1];
  let lastRestoreFrame = 0;
  let state = {playback: 'stopped', position: 0, snapshot: null, retained: false};

  function publish(playback, position, snapshot = null) {
    state = {playback, position, snapshot, retained: Boolean(snapshot && retainedAdpcm)};
    onState(state);
  }

  function release({retain = false} = {}) {
    if (!run) return null;
    const current = run;
    run = null;
    current.controller.abort();
    if (current.node) {
      current.node.port.onmessage = null;
      current.node.port.close();
      current.node.disconnect();
    }
    return retain ? current.timeline?.retainAdpcm() ?? null : null;
  }

  function disposeRenderer() {
    if (!renderer) return;
    renderer.player.clearCheckpoints();
    renderer.timeline.dispose();
    renderer.engine.dispose();
    renderer = null;
  }

  async function prepareRenderer(source, sampleRate, signal) {
    if (renderer && renderer.source === source && renderer.sampleRate === sampleRate) return renderer;
    disposeRenderer();
    const engine = await createFm2610VgmEngine(source, {outputSampleRate: sampleRate, signal});
    try {
      signal.throwIfAborted();
      engine.setSourceGains(sourceGains);
      if (engine.supportsState()) {
        const origin = engine.chip.saveState();
        const reset = engine.reset;
        // ymfm's soft reset can preserve the FM envelope sequencer phase.
        // Cold seeks start from the same fresh chip state as the first play.
        engine.reset = function () {
          const gains = this.getSourceGains();
          reset.call(this);
          this.chip.loadState(origin);
          this.setSourceGains(gains);
        };
      }
      const player = createFm2610VgmPlayer(engine, source);
      player.setPrefetchFactor(1);
      player.checkpointMaxBytes = checkpointBytes;
      player.checkpointMaxCount = checkpointCount;
      const timeline = createFm2610SongTimeline(engine, source);
      player.captureSeekState = timeline.saveState;
      player.restoreSeekState = timeline.loadState;
      renderer = {source, sampleRate, engine, player, timeline};
      return renderer;
    } catch (error) {
      engine.dispose();
      throw error;
    }
  }

  function finish(playback, position, snapshot) {
    if (run) retainedAdpcm = release({retain: Boolean(snapshot)});
    publish(playback, position, snapshot);
  }

  function stop() {
    if (state.playback === 'stopped') return;
    // Stop is immediate. Keep only the frame confirmed by the output worklet.
    const position = run?.position ?? state.position;
    const snapshot = run?.consumed && position !== state.position ? snapshotAtOutput(run) : state.snapshot;
    finish('stopped', snapshot ? position : 0, snapshot);
  }

  function clear() {
    release();
    disposeRenderer();
    lastRestoreFrame = 0;
    retainedAdpcm = null;
    if (state.playback !== 'stopped' || state.snapshot) publish('stopped', 0);
  }

  function fail(error) {
    clear();
    onError(error);
  }

  // Only consumed PCM advances the display. Pause retains both the queue in
  // the worklet and the renderer's exact register, ROM and sample state.
  function enqueue(current, left, right, count) {
    const leftBuffer = (count === left.length ? left : left.slice(0, count)).buffer;
    const rightBuffer = (count === right.length ? right : right.slice(0, count)).buffer;
    current.node.port.postMessage({type: 'enqueue', left: leftBuffer, right: rightBuffer}, [leftBuffer, rightBuffer]);
    current.sent += count;
  }

  function fill(current) {
    if (run !== current || state.playback !== 'playing' || current.endSent) return;
    if (current.primed) {
      const {left, right} = current.primed;
      current.primed = null;
      enqueue(current, left, right, 1);
    }
    while (current.sent - current.consumed < bufferFrames) {
      const frames = Math.min(framesPerChunk, bufferFrames - (current.sent - current.consumed));
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      const count = current.player.process(left, right, frames, {budgetMs: 5});
      if (count) enqueue(current, left, right, count);
      if (!current.player.isPlaying() && !current.player.queuedFrames) {
        current.endSent = true;
        current.node.port.postMessage({type: 'end'});
        break;
      }
      if (count < frames) break;
    }
  }

  async function seekFrames(current, position, target) {
    if (position >= target) return position;
    const left = new Float32Array(bufferFrames), right = new Float32Array(bufferFrames);
    while (position < target) {
      current.controller.signal.throwIfAborted();
      position += current.player.process(left, right, Math.min(bufferFrames, target - position), {budgetMs: 8});
      current.timeline.advance(position - 1);
      if (!current.player.isPlaying() && !current.player.queuedFrames) break;
      if (position < target) await yieldTask();
    }
    return position;
  }

  // An explicit paused seek displays the first frame at its destination.
  // Save that frame for Resume so neither audio nor register events get skipped.
  async function primePausedSeek(current) {
    const left = new Float32Array(1), right = new Float32Array(1);
    while (current.player.isPlaying() || current.player.queuedFrames) {
      current.controller.signal.throwIfAborted();
      if (current.player.process(left, right, 1, {budgetMs: 8})) {
        current.primed = {left, right};
        current.seekSnapshot = current.timeline.read(current.offset);
        return;
      }
      await yieldTask();
    }
  }

  function snapshotAtOutput(current) {
    if (current.consumed) return current.timeline.read(current.offset + current.consumed - 1);
    return current.seekSnapshot ?? null;
  }

  async function play(source, {position = 0, paused = false} = {}) {
    if (!Number.isFinite(position)) throw new RangeError('Choose a finite VGM position.');
    release();
    retainedAdpcm = null;
    if (renderer?.source !== source) disposeRenderer();
    lastRestoreFrame = 0;
    const controller = new AbortController(), {signal} = controller;
    const current = {controller, sent: 0, consumed: 0, offset: 0, endSent: false};
    run = current;
    publish('loading', position);
    try {
      const [{context, connectSongOutput}] = await Promise.all([sound(), beforePlay()]);
      signal.throwIfAborted();
      const sampleRate = context.sampleRate;
      const prepared = await prepareRenderer(source, sampleRate, signal);
      signal.throwIfAborted();
      const {player, timeline} = prepared;
      current.player = player;
      current.timeline = timeline;
      const duration = source.totalSamples / 44100;
      const target = Math.max(0, Math.min(position, duration));
      const targetFrame = Math.round(target * sampleRate);
      lastRestoreFrame = targetFrame ? player.restoreCheckpoint(targetFrame) : 0;
      if (lastRestoreFrame) timeline.advance(lastRestoreFrame - 1);
      else {
        player.reset();
        player.play();
      }
      player.checkpointIntervalSeconds = checkpointInterval;
      current.offset = await seekFrames(current, lastRestoreFrame, targetFrame);
      signal.throwIfAborted();
      if (target === duration) {
        const snapshot = current.offset ? current.timeline.read(current.offset - 1) : null;
        finish('ended', duration, snapshot);
        return;
      }
      if (paused) await primePausedSeek(current);
      await loadOutputWorklet(context);
      signal.throwIfAborted();
      const node = new AudioWorkletNode(context, 'vgm-output-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: {startupFrames: framesPerChunk, recoveryFrames: 128, positionReportFrames: 1024},
      });
      current.node = node;
      node.port.onmessage = ({data}) => {
        if (run !== current) return;
        try {
          current.consumed = data.consumedFrames;
          const position = Math.min(duration, (current.offset + current.consumed) / sampleRate);
          current.position = position;
          if (data.type === 'paused') {
            const snapshot = snapshotAtOutput(current) ?? (current.sent ? current.timeline.read(current.offset) : null);
            publish('paused', position, snapshot);
          } else if (data.ended) {
            finish('ended', duration, snapshotAtOutput(current));
          } else if (state.playback === 'playing') {
            publish('playing', position, snapshotAtOutput(current));
            fill(current);
          }
        } catch (error) { fail(error); }
      };
      if (paused) node.port.postMessage({type: 'pause'});
      connectSongOutput(node);
      if (!paused) {
        publish('playing', current.offset / sampleRate);
        fill(current);
      }
    } catch (error) {
      if (!signal.aborted) fail(error);
    }
  }

  function pause() {
    if (state.playback !== 'playing') return;
    run.node.port.postMessage({type: 'pause'});
    publish('pausing', state.position, state.snapshot);
  }

  function resume() {
    if (state.playback !== 'paused') return;
    run.node.port.postMessage({type: 'resume'});
    publish('playing', state.position, state.snapshot);
    try { fill(run); } catch (error) { fail(error); }
  }

  function setSourceGains(gains) {
    const next = normalizeYm2610BSourceGains(gains);
    if (sourceGains.every((gain, index) => gain === next[index])) return;
    // Drain the existing bounded queue at its recorded mix to keep the PCM
    // position, FM envelopes and ADPCM decoder phase intact.
    if (renderer) {
      renderer.player.clearCheckpoints();
      // This pass may still contain audio rendered at the previous mix.
      renderer.player.checkpointIntervalSeconds = 0;
      renderer.engine.setSourceGains(next);
    }
    sourceGains = next;
  }

  function isFmEditable() {
    return state.playback === 'playing' && run && !run.endSent;
  }

  function writeFm(writes) {
    if (!isFmEditable()) return false;
    if (!run.timeline.writeFm(writes)) return false;
    // Clean earlier checkpoints still represent the original file. Never
    // save a state containing a manual edit or its decoder history.
    run.player.checkpointIntervalSeconds = 0;
    return true;
  }

  function getFmEditSnapshot() {
    return isFmEditable() ? run.timeline.readFmAtRenderFront() : null;
  }

  function getSeekCacheStats() {
    return {...(renderer?.player.checkpointStats() ?? {count: 0, bytes: 0}), lastRestoreFrame,
      maxBytes: checkpointBytes, maxCount: checkpointCount};
  }

  function currentAdpcmA(snapshot, customWindow) {
    if (!snapshot || snapshot !== state.snapshot ||
        (customWindow !== undefined && state.playback !== 'paused' && !state.retained)) return null;
    return snapshot.adpcm.adpcmA;
  }

  function getAdpcmAWindow(snapshot, channel, customWindow) {
    const adpcmA = currentAdpcmA(snapshot, customWindow);
    const reader = run?.timeline ?? retainedAdpcm;
    return adpcmA ? reader?.getAdpcmAWindow(channel, adpcmA, customWindow) ?? null : null;
  }

  function readAdpcmABytes(snapshot, channel, customWindow) {
    const adpcmA = currentAdpcmA(snapshot, customWindow);
    const reader = run?.timeline ?? retainedAdpcm;
    return adpcmA ? reader?.readAdpcmABytes(channel, adpcmA, customWindow) ?? null : null;
  }

  function readAdpcmBBytes(snapshot = state.snapshot) {
    if (!snapshot || snapshot !== state.snapshot) return null;
    return (run?.timeline ?? retainedAdpcm)?.readAdpcmBBytes(snapshot.adpcm.adpcmB) ?? null;
  }

  function retainAdpcmARom(snapshot) {
    if (!snapshot || state.playback !== 'paused' && !state.retained || snapshot !== state.snapshot) return null;
    return (run?.timeline ?? retainedAdpcm)?.retainAdpcmARom(snapshot.adpcm.adpcmA) ?? null;
  }

  return {play, pause, resume, stop, clear, setSourceGains, writeFm, getFmEditSnapshot, getSeekCacheStats,
    getAdpcmAWindow, readAdpcmABytes, readAdpcmBBytes,
    retainAdpcmARom,
    getState: () => state, getSnapshot: () => state.snapshot};
}
