// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import {preparePs1Waveform} from '../js/ps1_waveform.js?v=ps1-waveform-1';
import {SPU_SYNTH_MIX_HEADROOM} from './spu_synth_levels.js';
import {readMorph, morphPcm} from './spu_synth_morph.js';
import {readPmon, pmonPcm} from './spu_synth_pmon.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';

export const SPU_SYNTH_CALIBRATED_GAIN = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(entry => entry.name === 'ps1').volume;
export const SPU_SYNTH_OUTPUT_GAIN = SPU_SYNTH_CALIBRATED_GAIN * SPU_SYNTH_MIX_HEADROOM;
const initialWaveform = () => preparePs1Waveform(Array.from({length:112}, (_, i) => .65 * Math.sin(2 * Math.PI * i / 112)));

/** A standalone Web Audio instrument. Startup creates a suspended context;
 * call resume() from a user gesture before playing. Failed initialization
 * releases the context, so the caller can retry by creating another engine.
 * `command` uses the same identity-safe voice editor operations as Playground.
 * PCM encoding and all DOM work remain on this main thread.
 * @param {{onError?:(error:Error)=>void,onState?:(state:object)=>void,volume?:number}} [options]
 */
export async function createSpuAudio({onError = () => {}, onState = () => {}, volume = 1} = {}) {
  validateVolume(volume);
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio');
  const context = new Context({latencyHint:'interactive'});
  let node = null, gain = null, disposed = false, fatalError = null, nextId = 0, rejectReady, readyTimer;
  const pending = new Map();
  let state = null;
  const failPending = error => {for (const {reject} of pending.values()) reject(error); pending.clear();};
  const report = error => {try {onError(error);} catch {}};
  const publish = value => {state = value; try {onState(value);} catch (error) {report(error);}};
  const assertOpen = () => {if (fatalError) throw fatalError; if (disposed || context.state === 'closed') throw new Error('SPU synth is closed');};
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(readyTimer);
    context.removeEventListener('statechange', stateChanged);
    failPending(new Error('SPU synth was disposed'));
    if (node) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      try {node.port.postMessage({method:'dispose'});} catch {}
      node.disconnect();
      node.port.close();
    }
    gain?.disconnect();
    if (context.state !== 'closed') await context.close();
  };
  const fail = error => {
    if (disposed || fatalError) return;
    fatalError = error;
    rejectReady?.(error);
    failPending(error);
    report(error);
    void dispose().catch(() => {});
  };
  function stateChanged() {if (context.state === 'closed' && !disposed) fail(new Error('SPU synth AudioContext was closed'));}
  context.addEventListener('statechange', stateChanged);

  try {
    // Browsers with unrestricted autoplay can start a new context immediately.
    // Suspend before connecting, keeping page load silent in either policy.
    if (context.state === 'running') await context.suspend();
    if (!context.audioWorklet) throw new Error('SPU synth needs AudioWorklet; open this page over HTTPS or localhost');
    const [wasmBinary] = await Promise.all([
      fetch(new URL('../generated/ps1_spu_wasm.wasm?v=ps1-deferred-release-1', import.meta.url)).then(response => {
        if (!response.ok) throw new Error(`SPU WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(new URL('./spu_synth_worklet.js?v=spu-synth-headroom-1', import.meta.url)),
    ]);
    node = new AudioWorkletNode(context, 'tetorica-spu-synth', {
      numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2],
      processorOptions:{wasmBinary, initialWaveform:initialWaveform()},
    });
    node.onprocessorerror = () => fail(new Error('SPU synth audio processor failed'));
    const ready = new Promise((resolve, reject) => {
      rejectReady = reject;
      readyTimer = setTimeout(() => fail(new Error('SPU synth audio initialization timed out')), 15000);
      node.port.onmessage = ({data}) => {
        if (data?.fatal) {fail(new Error(data.error ?? 'SPU synth audio processor failed')); return;}
        if (data?.ready) {clearTimeout(readyTimer); resolve(data); return;}
        const request = pending.get(data?.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.error) {
          const error = new Error(data.error); error.name = data.name ?? 'Error'; request.reject(error);
        } else {
          if (data.state) publish(data.state);
          request.resolve(data.value);
        }
      };
    });
    const metadata = await ready;
    assertOpen();
    gain = context.createGain();
    gain.gain.value = volume * SPU_SYNTH_OUTPUT_GAIN;
    node.connect(gain);
    gain.connect(context.destination);
    publish(metadata.state);
    const request = (method, args = []) => {
      assertOpen();
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject});
        try {node.port.postMessage({id, method, args});} catch (error) {pending.delete(id); reject(error);}
      });
    };
    return {
      context, node, gain, calibratedGain:SPU_SYNTH_CALIBRATED_GAIN,
      get state() {return state;},
      async inspect() {const value = await request('inspect'); publish(value); return value;},
      async command(method, args = []) {
        if (!Array.isArray(args)) throw new TypeError('SPU command arguments must be an array');
        // The encoder must not run in the real-time audio processor.
        if (method === 'setWaveform') args = [args[0], preparePs1Waveform(args[1]), args[2]];
        else if (method === 'setInstrumentWaveform') args = [preparePs1Waveform(args[0]), args[1]];
        else if (method === 'setInstrumentMorph') {
          const settings=readMorph(args[0]);
          args=[settings,settings.enabled ? preparePs1Waveform(morphPcm(settings)) : undefined];
        }
        else if (method === 'setInstrumentPmon') {
          const settings=readPmon(args[0]);
          const needsWaveform=settings.enabled && (!state?.pmonSampleReserved || !state?.pmon?.enabled || settings.depth!==state.pmon.depth || settings.waveform!==state.pmon.waveform);
          args=[settings, needsWaveform ? preparePs1Waveform(pmonPcm(settings.depth,settings.waveform)) : undefined];
        }
        return request(method, args);
      },
      async resume() {assertOpen(); await context.resume(); assertOpen();},
      stop() {return request('stop');},
      setVolume(value) {
        assertOpen(); validateVolume(value); volume = value;
        const parameter = gain.gain, now = context.currentTime;
        // Cancel a previous ramp at its actual current value to keep gestures
        // smooth even when a user moves the slider before a ramp finishes.
        if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
        else {const current = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(current, now);}
        parameter.linearRampToValueAtTime(value * SPU_SYNTH_OUTPUT_GAIN, now + .01);
      },
      dispose,
    };
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  } finally {clearTimeout(readyTimer);}
}

function validateVolume(value) {if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('SPU volume must be from 0 to 1');}
