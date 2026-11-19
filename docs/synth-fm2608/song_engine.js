// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2608AudioEngine} from '../js/ym2608audioengine.js?v=ym2608-source-gains-1';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {createFm2608RegisterState} from './song_state.js';

export const FM2608_SONG_CALIBRATED_GAIN = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(value => value.name === 'ym2608').volume;
export const FM2608_SONG_CHANNELS = Object.freeze({fm:6,ssg:3,rhythm:6,adpcm:1});
let rhythmBytes = null, wasmBytes = null;

/** The same measured OPNA gain and original rhythm ROM as RuntimeSynth.
 * Source mutes keep the native clocks running and retain every authored value. */
export async function createFm2608SongEngine(header) {
  const {default:ym2608ModuleFactory} = await import('../generated/ym2608_wasm.js?v=fm2608-source-mixer-1');
  if (!wasmBytes) {
    const response = await fetch(new URL('../generated/ym2608_wasm.wasm?v=fm2608-source-mixer-1',import.meta.url));
    if (!response.ok) throw new Error(`OPNA audio processor could not be loaded (${response.status})`);
    wasmBytes = new Uint8Array(await response.arrayBuffer());
  }
  const engine = await Ym2608AudioEngine.create({ym2608ModuleFactory,ym2608Clock:header.ym2608Clock,
    ym2608ModuleOptions:{wasmBinary:wasmBytes},
    outputSampleRate:44100,masterVolume:FM2608_SONG_CALIBRATED_GAIN});
  try {
    if (!rhythmBytes) {
      const response = await fetch(new URL('../js/tetorica_ym2608_adpcm_rom.bin',import.meta.url));
      if (!response.ok) throw new Error(`OPNA demonstration rhythm ROM could not be loaded (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== 8192) throw new Error('OPNA demonstration rhythm ROM must contain 8192 bytes');
      rhythmBytes = bytes;
    }
    engine.loadAdpcmARom(rhythmBytes);
    return engine;
  } catch (error) {engine.dispose(); throw error;}
}

/** Wrap only this reference engine. The read-only shadow sees pre-mute data. */
export function installFm2608SongMix(engine,clockHz) {
  const shadow = createFm2608RegisterState(clockHz);
  const muted = Object.fromEntries(Object.entries(FM2608_SONG_CHANNELS).map(([section,count]) => [section,Array(count).fill(false)]));
  const originals = {write:engine.writeYm2608,reset:engine.reset,load:engine.loadAdpcmBMemory,clear:engine.clearAdpcmBMemory};
  const registers = [new Uint8Array(256),new Uint8Array(256)];
  const fmChannel = (port,register) => register >= 0x40 && register <= 0x4e && (register & 3) < 3 ? port * 3 + (register & 3) : -1;
  function mask(port,register,value) {
    const channel = fmChannel(port,register);
    if (channel >= 0 && muted.fm[channel]) return 127;
    if (!port && register >= 8 && register <= 10 && muted.ssg[register-8]) return 0;
    if (!port && register >= 0x18 && register <= 0x1d && muted.rhythm[register-0x18]) return value & 63;
    if (port === 1 && register === 11 && muted.adpcm[0]) return 0;
    return value;
  }
  const send = (port,register,value) => originals.write.call(engine,port,register,mask(port,register,value));
  function write(port,register,value) {
    shadow.write(port,register,value); registers[port][register] = value;
    return send(port,register,value);
  }
  function reset(...args) {
    const result = originals.reset.apply(this,args); registers.forEach(values => values.fill(0)); shadow.reset(); return result;
  }
  function load(bytes,offset=0,memorySize=0x200000) {
    const result = originals.load.call(this,bytes,offset,memorySize); shadow.loadMemory(bytes,offset,memorySize); return result;
  }
  function clear() {const result = originals.clear?.call(this); shadow.clearMemory(); return result;}
  engine.writeYm2608 = write; engine.reset = reset; engine.loadAdpcmBMemory = load; engine.clearAdpcmBMemory = clear;
  function setChannelEnabled(section,channel,enabled) {
    if (!Object.hasOwn(FM2608_SONG_CHANNELS,section) || !Number.isInteger(channel) || channel < 0 || channel >= FM2608_SONG_CHANNELS[section]) throw new RangeError('Invalid OPNA mixer channel');
    if (typeof enabled !== 'boolean') throw new TypeError('Channel enabled must be boolean');
    muted[section][channel] = !enabled;
    if (section === 'fm') {
      for (const slot of [0,8,4,12]) {
        const port = channel >= 3 ? 1 : 0, register = 0x40 + channel % 3 + slot;
        send(port,register,registers[port][register]);
      }
    } else {
      const port = section === 'adpcm' ? 1 : 0;
      const register = section === 'ssg' ? 8+channel : section === 'rhythm' ? 0x18+channel : 11;
      send(port,register,registers[port][register]);
    }
  }
  return {setChannelEnabled,getState:() => Object.fromEntries(Object.entries(muted).map(([key,values]) => [key,values.map(value => !value)])),
    snapshot:() => shadow.snapshot(),dispose() {
      for (const [key,original,installed] of [['writeYm2608',originals.write,write],['reset',originals.reset,reset],
        ['loadAdpcmBMemory',originals.load,load],['clearAdpcmBMemory',originals.clear,clear]]) if (engine[key] === installed) engine[key] = original;
    }};
}
