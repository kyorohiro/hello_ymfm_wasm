// SPDX-License-Identifier: BSD-3-Clause
import { createFm2610VgmEngine, createFm2610VgmPlayer } from './vgm.js';

const workletUrl = new URL('../js/vgm-output-worklet.js', import.meta.url).href;
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
  let state = {playback: 'stopped', position: 0};

  function publish(playback, position) {
    state = {playback, position};
    onState(state);
  }

  function release() {
    if (!run) return;
    const current = run;
    run = null;
    current.controller.abort();
    if (current.node) {
      current.node.port.onmessage = null;
      current.node.port.close();
      current.node.disconnect();
    }
    current.engine?.dispose();
  }

  function stop() {
    release();
    if (state.playback !== 'stopped') publish('stopped', 0);
  }

  function fail(error) {
    stop();
    onError(error);
  }

  // Only consumed PCM advances the display. Pause retains both the queue in
  // the worklet and the renderer's exact register, ROM and sample state.
  function fill(current) {
    if (state.playback !== 'playing' || current.endSent) return;
    while (current.sent - current.consumed < bufferFrames) {
      const left = new Float32Array(framesPerChunk);
      const right = new Float32Array(framesPerChunk);
      const count = current.player.process(left, right, framesPerChunk, {budgetMs: 5});
      if (count) {
        const leftBuffer = (count === framesPerChunk ? left : left.slice(0, count)).buffer;
        const rightBuffer = (count === framesPerChunk ? right : right.slice(0, count)).buffer;
        current.node.port.postMessage({type: 'enqueue', left: leftBuffer, right: rightBuffer}, [leftBuffer, rightBuffer]);
        current.sent += count;
      }
      if (!current.player.isPlaying() && !current.player.queuedFrames) {
        current.endSent = true;
        current.node.port.postMessage({type: 'end'});
        break;
      }
      if (count < framesPerChunk) break;
    }
  }

  async function seekFrames(current, target) {
    if (!target) return 0;
    const left = new Float32Array(bufferFrames), right = new Float32Array(bufferFrames);
    let position = 0;
    while (position < target) {
      current.controller.signal.throwIfAborted();
      position += current.player.process(left, right, Math.min(bufferFrames, target - position), {budgetMs: 8});
      if (!current.player.isPlaying() && !current.player.queuedFrames) break;
      if (position < target) await yieldTask();
    }
    return position;
  }

  async function play(source, {position = 0, paused = false} = {}) {
    stop();
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
      current.player = createFm2610VgmPlayer(current.engine, source);
      current.player.play();
      const duration = source.totalSamples / 44100;
      const target = Math.max(0, Math.min(position, duration));
      current.offset = await seekFrames(current, Math.round(target * sampleRate));
      signal.throwIfAborted();
      if (target === duration) {
        release();
        publish('ended', duration);
        return;
      }
      await loadOutputWorklet(context);
      signal.throwIfAborted();
      const node = new AudioWorkletNode(context, 'vgm-output-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: {startupFrames: framesPerChunk, recoveryFrames: 128},
      });
      current.node = node;
      node.port.onmessage = ({data}) => {
        if (run !== current) return;
        try {
          current.consumed = data.consumedFrames;
          if (data.ended) {
            release();
            publish('ended', duration);
          } else {
            publish(state.playback, Math.min(duration, (current.offset + current.consumed) / sampleRate));
            fill(current);
          }
        } catch (error) { fail(error); }
      };
      if (paused) node.port.postMessage({type: 'pause'});
      connectSongOutput(node);
      publish(paused ? 'paused' : 'playing', current.offset / sampleRate);
      fill(current);
    } catch (error) {
      if (!signal.aborted) fail(error);
    }
  }

  function pause() {
    if (state.playback !== 'playing') return;
    run.node.port.postMessage({type: 'pause'});
    publish('paused', state.position);
  }

  function resume() {
    if (state.playback !== 'paused') return;
    run.node.port.postMessage({type: 'resume'});
    publish('playing', state.position);
    try { fill(run); } catch (error) { fail(error); }
  }

  return {play, pause, resume, stop, getState: () => state};
}
