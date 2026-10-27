// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
import {createCDDAPCM} from './cdda_pcm.js?v=cdda-pcm-1';
import {createCddaPlayer} from './cdda_player.js?v=cdda-pcm-1';

const LIMIT = 10000000;
const ACTIONS = new Set(['play', 'pause', 'resume', 'stop', 'seek', 'mix', 'state', 'ready']);

/** @typedef {{volume?:number,mute?:boolean,pan?:number}} CddaOfflineMix */
/** @typedef {{processFrames:(frames:number)=>{left:Float32Array,right:Float32Array},
 * sampleRate?:number|(()=>number),mix?:CddaOfflineMix}} CddaOfflineSource */
/** @typedef {CddaOfflineMix & {engine:CddaOfflineSource}} CddaOfflineSourceDescriptor */
/** @typedef {{type:'play',sourceFrame?:number}|{type:'pause'|'resume'|'stop'|'state'|'ready'}|
 * {type:'seek',sourceFrame:number}|(CddaOfflineMix & {type:'mix'})} CddaOfflineAction */
/** @typedef {(clock:{frame:number,sampleRate:number})=>void} CddaOfflineCallback */
/** @typedef {{sampleRate?:number,wasmBinary?:ArrayBuffer|Uint8Array,
 * wasmBytes?:ArrayBuffer|Uint8Array,wasmURL?:string|URL,
 * readFile?:(path:string,options?:{signal?:AbortSignal})=>Promise<ArrayBuffer|Uint8Array>,
 * signal?:AbortSignal,sources?:Array<CddaOfflineSource|CddaOfflineSourceDescriptor>}} CddaOfflineOptions */

/** Offline PCM source and sample-clock mixer. No AudioContext is opened.
 * `cdda` is the same track/player API as realtime playback. `sources` borrows
 * synchronous engines exposing processFrames(count), at this output rate;
 * CD-DA and every source advance by exactly the same frame counts.
 * Extra source mix controls belong under source.mix, or use explicit
 * {engine,volume,mute,pan} descriptors. Bare engine.volume is its existing
 * internal gain and is deliberately not applied a second time here.
 *
 * Adapter {at} timestamps are absolute output-clock seconds. schedule(frame,
 * actionOrCallback) uses absolute output frames. Future commands acknowledge
 * their queue position immediately, so they can be awaited before render().
 * Callbacks must be synchronous and can write PSG/ADPCM registers on this clock.
 *
 * render() returns the existing encodeWav()-compatible {left,right,sampleRate}.
 * Source engine objects remain owned by their caller. No normalization,
 * clipping, device-gain defaults, or effects are applied implicitly.
 * @param {CddaOfflineOptions} [options]
 */
export async function createCddaOffline({sampleRate = 44100, wasmBinary, wasmBytes,
  wasmURL = new URL('../generated/cdda_wasm.wasm', import.meta.url),
  readFile, signal, sources = []} = {}) {
  signal?.throwIfAborted();
  if (!Array.isArray(sources) || sources.length > 64) throw new TypeError('sources must contain at most 64 synchronous audio engines');
  const borrowed = sources.map(source => ({engine: source?.engine ?? source, descriptor: source}));
  for (const {engine, descriptor} of borrowed) {
    if (!engine || typeof engine.processFrames !== 'function') throw new TypeError('Each source must expose processFrames(frames)');
    const rate = typeof engine.sampleRate === 'function' ? engine.sampleRate() : engine.sampleRate;
    if (rate !== undefined && rate !== sampleRate) throw new RangeError('Offline sources must use the same sample rate');
    mixValues(descriptor.engine ? descriptor : descriptor.mix ?? {});
  }
  let binary = wasmBinary || wasmBytes;
  if (!binary && typeof process !== 'undefined' && process.versions?.node && new URL(wasmURL, import.meta.url).protocol === 'file:') {
    const {readFile: read} = await import('node:fs/promises');
    binary = await read(new URL(wasmURL, import.meta.url), {signal});
  }
  const core = await createCDDAPCM({sampleRate, wasmBinary: binary, wasmURL});
  signal?.throwIfAborted();
  let frame = 0, order = 0, pan = 0, closed = false, track = null;
  const queue = [];
  const scratchLeft = new Float32Array(128), scratchRight = new Float32Array(128);
  const assertOpen = () => {
    signal?.throwIfAborted();
    if (closed) throw new Error('CD-DA offline renderer is disposed');
  };
  const status = () => {
    const state = core.status();
    return {...state, positionSeconds: state.positionFrames / 44100,
      durationSeconds: state.durationFrames / 44100, outputFrame: frame,
      volume: state.gain, mute: state.muted, pan, track};
  };
  const apply = action => {
    if (typeof action === 'function') {
      const result = action({frame, sampleRate});
      if (result && typeof result.then === 'function') throw new TypeError('Offline scheduled callbacks must be synchronous');
      return;
    }
    if (action.type === 'mix') {
      if (action.volume !== undefined) core.setGain(action.volume);
      if (action.mute !== undefined) core.setMuted(action.mute);
      if (action.pan !== undefined) pan = action.pan;
    } else if (action.type === 'play') {
      const first = action.sourceFrame ?? 0;
      if (first > core.status().durationFrames) throw new RangeError('CD-DA position is outside the track');
      core.play();
      if (first) core.seek(first);
    } else if (action.type === 'seek') core.seek(action.sourceFrame);
    else if (action.type !== 'state' && action.type !== 'ready') core[action.type]();
  };
  /** @param {number} atFrame @param {CddaOfflineAction|CddaOfflineCallback} action */
  const enqueue = (atFrame, action) => {
    assertOpen();
    if (!Number.isSafeInteger(atFrame) || atFrame < frame) throw new RangeError('Cannot schedule before currentFrame');
    const checked = validateAction(action);
    if (atFrame === frame) { apply(checked); return status(); }
    if (queue.length >= 4096) throw new RangeError('CD-DA offline command queue is full');
    queue.push({frame: atFrame, action: checked, order: order++});
    queue.sort((a, b) => a.frame - b.frame || a.order - b.order);
    return {...status(), scheduled: true, scheduledFrame: atFrame};
  };
  const disposeAdapter = () => {
    if (closed) return;
    closed = true; queue.length = 0; track = null;
    core.dispose(); signal?.removeEventListener('abort', disposeAdapter);
  };
  const adapter = {
    /** @param {Uint8Array} pcm @param {string} number @param {{signal?:AbortSignal}} [options] */
    async prepare(pcm, number, {signal: operationSignal} = {}) {
      assertOpen(); operationSignal?.throwIfAborted();
      core.prepare(pcm); // Validates before replacing the borrowed source.
      queue.length = 0; track = number;
      return status();
    },
    /** @param {CddaOfflineAction} action @param {{at?:number}} [timing] */
    async command(action, {at} = {}) {
      assertOpen();
      if (at !== undefined && (!Number.isFinite(at) || at < 0 || !Number.isSafeInteger(Math.round(at * sampleRate)))) {
        throw new RangeError('CD-DA at must be nonnegative audio-clock seconds');
      }
      const atFrame = at === undefined ? frame : Math.round(at * sampleRate);
      // Emergency Stop cancels queued playback; a timestamped future Stop is
      // part of the offline timeline and preserves earlier controls.
      const checked = validateAction(action);
      if (checked.type === 'stop' && atFrame === frame) queue.length = 0;
      return enqueue(atFrame, checked);
    },
    dispose: disposeAdapter,
  };
  const cdda = createCddaPlayer(adapter, {readFile, signal});
  signal?.addEventListener('abort', disposeAdapter, {once: true});
  return {
    cdda, adapter,
    get currentFrame() { return frame; },
    get currentTime() { return frame / sampleRate; },
    sampleRate,
    schedule: enqueue,
    /** @param {CddaOfflineMix} values @param {{at?:number}} [timing] */
    mix: (values, timing) => adapter.command({...values, type: 'mix'}, timing),
    clearSchedule() { assertOpen(); queue.length = 0; },
    /** @param {number} frames */
    render(frames) {
      assertOpen();
      if (!Number.isSafeInteger(frames) || frames < 0 || frames > LIMIT || !Number.isSafeInteger(frame + frames)) {
        throw new RangeError('frames must be an integer from 0 to 10000000');
      }
      const left = new Float32Array(frames), right = new Float32Array(frames);
      let offset = 0;
      while (true) {
        while (queue[0]?.frame === frame) apply(queue.shift().action);
        assertOpen();
        if (offset === frames) break;
        const count = Math.min(128, frames - offset, (queue[0]?.frame ?? Infinity) - frame);
        core.render(scratchLeft, scratchRight, count);
        const lg = 1 - Math.max(0, pan), rg = 1 + Math.min(0, pan);
        for (let i = 0; i < count; i++) {
          left[offset + i] = scratchLeft[i] * lg;
          right[offset + i] = scratchRight[i] * rg;
        }
        for (const {engine, descriptor} of borrowed) {
          const mixed = engine.processFrames(count);
          if (!(mixed?.left instanceof Float32Array) || !(mixed?.right instanceof Float32Array) ||
              mixed.left.length !== count || mixed.right.length !== count) {
            throw new TypeError('Offline source must return matching planar Float32 output');
          }
          const {volume, mute, pan: sourcePan} = mixValues(descriptor.engine ? descriptor : descriptor.mix ?? {});
          const sl = mute ? 0 : volume * (1 - Math.max(0, sourcePan));
          const sr = mute ? 0 : volume * (1 + Math.min(0, sourcePan));
          for (let i = 0; i < count; i++) {
            if (!Number.isFinite(mixed.left[i]) || !Number.isFinite(mixed.right[i])) throw new RangeError('Offline source returned nonfinite audio');
            left[offset + i] += mixed.left[i] * sl;
            right[offset + i] += mixed.right[i] * sr;
          }
        }
        frame += count; offset += count;
      }
      return {left, right, sampleRate};
    },
    dispose() { cdda.dispose(); },
  };
}

function mixValues(value) {
  const volume = value.volume ?? 1, mute = value.mute ?? false, pan = value.pan ?? 0;
  if (!Number.isFinite(volume) || volume < 0 || volume > 16 || typeof mute !== 'boolean' ||
      !Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError('Invalid offline source volume, mute or pan');
  return {volume, mute, pan};
}

function validateAction(action) {
  if (typeof action === 'function') return action;
  if (!action || typeof action !== 'object' || !ACTIONS.has(action.type)) throw new TypeError('Invalid CD-DA offline action');
  const copy = {...action};
  if ((copy.type === 'seek' || copy.sourceFrame !== undefined) &&
      (!Number.isSafeInteger(copy.sourceFrame) || copy.sourceFrame < 0)) throw new RangeError('Invalid CD-DA source frame');
  if (copy.type === 'mix') mixValues(copy);
  return copy;
}
