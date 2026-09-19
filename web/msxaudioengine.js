import {Ay8910AudioEngine} from './ay8910audioengine.js';
import {Ym2413AudioEngine} from './ym2413audioengine.js';
import {Y8950AudioEngine} from './y8950audioengine.js?v=mutes-1';
import {K051649AudioEngine} from './k051649audioengine.js';
import {MultiChipAudioEngine} from './multichipaudioengine.js';

export class MsxAudioEngine extends MultiChipAudioEngine {
  static async create(options = {}) {
    const {outputSampleRate = 44100, masterVolume = 1} = options;
    // Explicit descriptors allow repeated types with independent clocks/options.
    const chips = options.chips ?? [
      ...(options.ayClock ? [{type:'ay8910', options:{moduleFactory:options.ayModuleFactory, moduleOptions:options.ayModuleOptions, clock:options.ayClock, type:options.ayType ?? 0, flags:options.ayFlags ?? 1}}] : []),
      ...(options.ym2413ModuleFactory ? [{type:'ym2413', options}] : []),
      ...(options.y8950ModuleFactory ? [{type:'y8950', options}] : []),
      ...(options.k051649Clock ? [{type:'k051649', options:{moduleFactory:options.k051649ModuleFactory, moduleOptions:options.k051649ModuleOptions, clock:options.k051649Clock}}] : []),
    ];
    const entries = [];
    const factories = {ay8910:Ay8910AudioEngine, ym2413:Ym2413AudioEngine, y8950:Y8950AudioEngine, k051649:K051649AudioEngine};
    const methods = {ay8910:'writeAy8910', ym2413:'writeYm2413', y8950:'writeY8950', k051649:'writeK051649'};
    try {
      for (const {type, index = 0, options: chipOptions} of chips) {
        if (!factories[type]) throw new Error(`Unsupported MSX chip: ${type}`);
        const engine = await factories[type].create({...chipOptions, outputSampleRate, masterVolume:1, psgClock:0});
        entries.push({type, index, engine, target:{
          writeRegister:(...args) => engine[methods[type]](...args),
          ...(type === 'y8950' ? {loadSampleMemory:(...args) => engine.loadSampleMemory(...args)} : {}),
        }});
      }
      return new MsxAudioEngine(entries, outputSampleRate, masterVolume);
    } catch (error) { for (const {engine} of entries) engine.dispose(); throw error; }
  }
  writeAy8910(register, value, index = 0) { this.getVgmTarget('ay8910', index).writeRegister(register, value); }
  writeYm2413(register, value, index = 0) { this.getVgmTarget('ym2413', index).writeRegister(register, value); }
  writeY8950(register, value, index = 0) { this.getVgmTarget('y8950', index).writeRegister(register, value); }
  writeK051649(port, register, value, index = 0) { this.getVgmTarget('k051649', index).writeRegister(port, register, value); }
  setAyMuted(value) { this.entries.get('ay8910:0')?.engine.setAyMuted(value); }
  setAyChannelMuted(channel, value) { this.entries.get('ay8910:0')?.engine.setAyChannelMuted(channel, value); }
  setOpllMuted(value) { this.setChipMuted('ym2413', 0, value); }
  setY8950Muted(value) { this.setChipMuted('y8950', 0, value); }
  setSccMuted(value) { this.entries.get('k051649:0')?.engine.setSccMuted(value); }
  setSccChannelMuted(channel, value) { this.entries.get('k051649:0')?.engine.setSccChannelMuted(channel, value); }
}
export const createMsxAudioEngine = options => MsxAudioEngine.create(options);

export function validateMsxPlaybackHeader(header) {
  for (const type of ['ay8910','ym2413','y8950','k051649']) {
    if (header[`${type}Clock`] & 0xc0000000) throw new Error(`${type} variants and dual-chip playback are not validated yet.`);
  }
  for (const type of ['ym2612','ym2203','ym2608','ym2610','rf5c164','pwm','psg','ym2151','ym3526','ym3812','ymf262','ymf278b','segaPcm']) {
    if (header[`${type}Clock`]) throw new Error(`MSX with ${type}: Support coming soon.`);
  }
}
