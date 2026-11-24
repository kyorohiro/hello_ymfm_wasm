// SPDX-License-Identifier: BSD-3-Clause
import { normalizeYm2610BSourceGains } from '../js/ym2610b.js?v=ym2610-source-mix-1';
import { createFm2610SongTimeline, createFm2610VgmEngine, createFm2610VgmPlayer } from './vgm.js';

const workletUrl = new URL('../js/vgm-output-worklet.js?v=fm2610-position-1', import.meta.url).href;
const worklets = new WeakMap();
const framesPerChunk = 2048;
const bufferFrames = 8192;
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
  let retainedAdpcm = null;
  let sourceGains = [1, 1, 1, 1];
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
    const reader = retain ? current.timeline?.retainAdpcm() ?? null : null;
    if (!reader) current.timeline?.dispose();
    current.engine?.dispose();
    return reader;
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

  async function seekFrames(current, target) {
    if (!target) return 0;
    const left = new Float32Array(bufferFrames), right = new Float32Array(bufferFrames);
    let position = 0;
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
    clear();
    const controller = new AbortController(), {signal} = controller;
    const current = {controller, sent: 0, consumed: 0, offset: 0, endSent: false};
    run = current;
    publish('loading', position);
    try {
      const [{context, connectSongOutput}] = await Promise.all([sound(), beforePlay()]);
      signal.throwIfAborted();
      const sampleRate = context.sampleRate;
      current.engine = await createFm2610VgmEngine(source, {outputSampleRate: sampleRate, signal});
      if (signal.aborted) {
        current.engine.dispose();
        signal.throwIfAborted();
      }
      current.engine.setSourceGains(sourceGains);
      current.player = createFm2610VgmPlayer(current.engine, source);
      current.player.setPrefetchFactor(1);
      current.timeline = createFm2610SongTimeline(current.engine, source);
      current.player.play();
      const duration = source.totalSamples / 44100;
      const target = Math.max(0, Math.min(position, duration));
      current.offset = await seekFrames(current, Math.round(target * sampleRate));
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
    run?.engine?.setSourceGains(next);
    sourceGains = next;
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

  return {play, pause, resume, stop, clear, setSourceGains, getAdpcmAWindow, readAdpcmABytes, readAdpcmBBytes,
    getState: () => state, getSnapshot: () => state.snapshot};
}
