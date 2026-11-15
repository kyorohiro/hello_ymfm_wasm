// SPDX-License-Identifier: BSD-3-Clause
import {noteToHz} from '../js/soundchip_pitch.js';

export const NES_CODE_METHODS=Object.freeze([
  'getState','reset','resetRegisters','writeRegister','loadMemory','setFrequency','setNote','noteOn','noteOff','keyOn','keyOff','allNotesOff','dispose',
  'pulse.setVoice','pulse.setFrequency','pulse.setNote','pulse.noteOn','pulse.noteOff','pulse.keyOn','pulse.keyOff',
  'triangle.setFrequency','triangle.setNote','triangle.noteOn','triangle.noteOff','triangle.keyOn','triangle.keyOff',
  'noise.setVoice','noise.noteOn','noise.noteOff','dmc.loadSample','dmc.play','dmc.stop',
  'fds.setWave','fds.setVolume','fds.setFrequency','fds.setNote','fds.noteOn','fds.noteOff','fds.keyOn','fds.keyOff','fds.setModulation',
]);
export function nesCodeCancelled() {
  const error = new Error('NES Code session was stopped');
  error.name = 'AbortError';
  return error;
}
export function nesCodeChannel(method,args){
  if(method.startsWith('triangle.'))return 2;
  if(method.startsWith('noise.'))return 3;
  if(method.startsWith('dmc.'))return 4;
  if(method.startsWith('fds.'))return 5;
  return args[0];
}
export function validateNesCodeCall(method, args, clock = 1789772.7272727273) {
  if (!NES_CODE_METHODS.includes(method)) throw new Error('Unknown NES Code method');
  if (!Array.isArray(args)) throw new TypeError('NES Code arguments must be an array');
  const exact = {
    getState:0, reset:0, resetRegisters:0, allNotesOff:0, dispose:0,
    'triangle.keyOn':0, 'triangle.keyOff':0, 'triangle.noteOff':0,
    'noise.noteOn':0, 'noise.noteOff':0, 'dmc.stop':0,
    'fds.keyOn':0, 'fds.keyOff':0, 'fds.noteOff':0,
  };
  if (Object.hasOwn(exact, method) && args.length !== exact[method]) {
    throw new TypeError(`${method} takes ${exact[method]} arguments`);
  }
  const channel = nesCodeChannel(method, args);
  const generic = ['setFrequency','setNote','noteOn','noteOff','keyOn','keyOff'].includes(method);
  if (generic && (!Number.isInteger(channel) || channel < 0 || channel > 5)) {
    throw new RangeError('NES channel must be an integer 0..5');
  }
  if (method.startsWith('pulse.') && (!Number.isInteger(channel) || channel < 0 || channel > 1)) {
    throw new RangeError('Pulse channel must be 0 or 1');
  }
  if (method === 'dmc.loadSample') {
    const bytes = args[0] instanceof ArrayBuffer ? new Uint8Array(args[0]) : args[0];
    const options = args[1] ?? {};
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 4081) {
      throw new RangeError('DMC sample must contain 1..4081 DPCM bytes');
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('DMC sample options must be an object');
    }
    const address = options.address ?? 0xc000;
    const length = Math.ceil((bytes.length - 1) / 16) * 16 + 1;
    if (!Number.isInteger(address) || address < 0xc000 || address % 64 || address + length > 65536) {
      throw new RangeError('DMC address must be 64-byte aligned in $C000..$FFFF and fit the sample');
    }
  }
  const tonal = ['setFrequency','setNote','pulse.setFrequency','pulse.setNote',
    'triangle.setFrequency','triangle.setNote','fds.setFrequency','fds.setNote'].includes(method);
  const on = method === 'noteOn' || method.endsWith('.noteOn');
  if (tonal || on && ![3,4].includes(channel)) {
    if (![0,1,2,5].includes(channel)) throw new RangeError('Tone channel must be 0, 1, 2 or 5');
    const value = args[method.startsWith('triangle.') || method.startsWith('fds.') ? 0 : 1];
    const hz = method.endsWith('Frequency') ? value : noteToHz(value);
    const period = channel === 5 ? Math.round(hz * 4194304 / clock)
      : Math.round(clock / ((channel === 2 ? 32 : 16) * hz) - 1);
    // This deployed APU mutes Pulse and Triangle periods below eight. Keep
    // Code note helpers consistent with the keyboard's usable pitch range.
    if (!Number.isFinite(hz) || hz <= 0 || period < (channel === 5 ? 1 : 8) || period > (channel === 5 ? 4095 : 2047)) {
      throw new RangeError('Note is outside the NES channel frequency range');
    }
  }
}

/** An awaitable NesApuSynth-shaped facade; it owns no APU or audio device. */
export function createNesCodeClient({metadata, invoke, isCurrent, dispose} = {}) {
  if (!Number.isSafeInteger(metadata?.session) || metadata.session < 1 || metadata.channels !== 6
      || !Number.isFinite(metadata.clock) || metadata.clock <= 0) throw new Error('Invalid NES Code session');
  for (const callback of [invoke,isCurrent,dispose]) {
    if (typeof callback !== 'function') throw new TypeError('NES Code requires ownership callbacks');
  }
  let closed = false, closing = null;
  const current = () => !closed && isCurrent();
  const check = () => {if (!current()) throw nesCodeCancelled();};
  const client = {id:'nes:synth', chip:'nes', channels:6, clock:metadata.clock, fdsEnabled:true,
    pulse:{}, triangle:{}, noise:{}, dmc:{}, fds:{}, isCurrent:current};
  for (const path of NES_CODE_METHODS) {
    if (path === 'dispose') continue;
    const [group, member] = path.split('.');
    const target = member ? client[group] : client;
    target[member ?? group] = (...args) => {
      check();
      validateNesCodeCall(path, args, metadata.clock);
      return Promise.resolve(invoke(path, args)).then(value => {check(); return value;});
    };
  }
  client.dispose = (...args) => {
    if (closing) return closing;
    check();
    validateNesCodeCall('dispose', args);
    closed = true;
    return closing = Promise.resolve(dispose());
  };
  return client;
}
