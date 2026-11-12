// SPDX-License-Identifier: BSD-3-Clause
import {noteToHz} from '../js/soundchip_pitch.js';

export const GAMEBOY_CODE_METHODS = Object.freeze([
  'initialize','reset','writeRegister','getState','setFrequency','setNote','noteOn','keyOn','keyOff',
  'setPan','setMasterVolume','setClock','allNotesOff','dispose',
  'pulse.setVoice','pulse.setDuty','pulse.setEnvelope','pulse.setSweep','pulse.setFrequency','pulse.setNote','pulse.keyOn','pulse.keyOff','pulse.noteOn',
  'wave.stopAndSetWaveform','wave.setWaveform','wave.setLevel','wave.setFrequency','wave.setNote','wave.keyOn','wave.keyOff','wave.noteOn',
  'noise.setVoice','noise.setEnvelope','noise.setParameters','noise.keyOn','noise.keyOff',
]);
export function gameboyCodeCancelled() {
  const error = new Error('Game Boy Code session was stopped or its instrument changed');
  error.name = 'AbortError'; return error;
}
const channel = (value, maximum) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Game Boy channel must be an integer 0..${maximum}`);
};

/** Reject malformed note ownership synchronously before the shared runtime
 * records a physical Gate. Full voice/wave patches are also validated by the
 * existing GameboySynth, before it writes registers in the audio processor. */
export function validateGameboyCodeCall(method, args, clock = 4194304) {
  if (!GAMEBOY_CODE_METHODS.includes(method)) throw new Error('Unknown Game Boy Code method');
  if (!Array.isArray(args)) throw new TypeError('Game Boy Code arguments must be an array');
  if (['initialize','reset','getState','allNotesOff','dispose','wave.keyOn','wave.keyOff','noise.keyOn','noise.keyOff'].includes(method) && args.length) throw new TypeError(`${method} takes no arguments`);
  if (['setFrequency','setNote','noteOn'].includes(method)) channel(args[0],2);
  if (['keyOn','keyOff','setPan'].includes(method)) channel(args[0],3);
  if (method.startsWith('pulse.') && method !== 'pulse.setSweep') channel(args[0],1);
  const note = ['setNote','noteOn','pulse.setNote','pulse.noteOn','wave.setNote','wave.noteOn'].includes(method);
  const frequency = ['setFrequency','pulse.setFrequency','wave.setFrequency'].includes(method);
  if (note || frequency) {
    const wave = method.startsWith('wave.') || !method.includes('.') && args[0] === 2;
    const value = args[method.startsWith('wave.') ? 0 : 1];
    const hz = note ? noteToHz(value) : value;
    const period = Math.round(2048 - clock / ((wave ? 64 : 32) * hz));
    if (!Number.isFinite(hz) || hz <= 0 || !Number.isInteger(period) || period < 0 || period > 2047) throw new RangeError('Note is outside the Game Boy channel frequency range');
  }
  if (method === 'setClock' && (args.length !== 1 || args[0] !== clock)) throw new RangeError(`DMG Synth Code uses a fixed ${clock} Hz clock`);
}

/** Awaitable public GameboySynth shape over the Synth's existing RPC port.
 * Nested objects remain ordinary objects so the shared runtime can wrap their
 * methods with loop/Run ownership guards. This facade owns no audio device. */
export function createGameboyCodeClient({metadata, invoke, isCurrent, dispose} = {}) {
  if (!Number.isSafeInteger(metadata?.session) || metadata.session < 1 || metadata.clock !== 4194304 || metadata.channels !== 4) throw new Error('Invalid Game Boy Code session');
  for (const callback of [invoke,isCurrent,dispose]) if (typeof callback !== 'function') throw new TypeError('Game Boy Code client requires ownership callbacks');
  let closed = false, closing = null;
  const current = () => !closed && isCurrent();
  const check = () => { if (!current()) throw gameboyCodeCancelled(); };
  const client = {id:'gameboy:synth',chip:'gameboy',channels:4,pulse:{},wave:{},noise:{}};
  Object.defineProperty(client,'clock',{enumerable:true,get:() => metadata.clock});
  for (const path of GAMEBOY_CODE_METHODS) {
    if (path === 'dispose') continue;
    const [group, member] = path.split('.'), target = member ? client[group] : client;
    target[member ?? group] = (...args) => {
      check(); validateGameboyCodeCall(path,args,metadata.clock);
      let pending;
      try { pending = invoke(path,args); }
      catch (error) { pending = Promise.reject(error); }
      return Promise.resolve(pending).then(value => {check();return value;});
    };
  }
  client.isCurrent = current;
  client.ownsOutput = current;
  client.dispose = (...args) => {
    if (closing) return closing;
    check(); validateGameboyCodeCall('dispose',args,metadata.clock); closed = true;
    try { closing = Promise.resolve(dispose()); }
    catch (error) { closing = Promise.reject(error); }
    return closing;
  };
  return client;
}
