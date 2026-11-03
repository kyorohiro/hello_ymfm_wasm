/**
 * @file msxaudioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
import {Ym2151AudioEngine} from './ym2151audioengine.js';
import {Ay8910AudioEngine} from './ay8910audioengine.js';
import {Ym2413AudioEngine} from './ym2413audioengine.js';
import {Y8950AudioEngine} from './y8950audioengine.js?v=mutes-1';
import {K051649AudioEngine} from './k051649audioengine.js';
import {MultiChipAudioEngine} from './multichipaudioengine.js';

/** @typedef {{type:'ym2151',index?:number,options:NonNullable<Parameters<typeof Ym2151AudioEngine.create>[0]>} | {type:'ay8910',index?:number,options:NonNullable<Parameters<typeof Ay8910AudioEngine.create>[0]>} | {type:'ym2413',index?:number,options:NonNullable<Parameters<typeof Ym2413AudioEngine.create>[0]>} | {type:'y8950',index?:number,options:NonNullable<Parameters<typeof Y8950AudioEngine.create>[0]>} | {type:'k051649',index?:number,options:NonNullable<Parameters<typeof K051649AudioEngine.create>[0]>}} MsxChipDescriptor */

/**
 * MsxAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class MsxAudioEngine extends MultiChipAudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {{chips?:MsxChipDescriptor[],outputSampleRate?:number,masterVolume?:number, ym2151ModuleFactory?:import('./soundchip.js').WasmModuleFactory, ym2151ModuleOptions?:import('./soundchip.js').WasmModuleOptions, ym2151Clock?:number, ayModuleFactory?:import('./soundchip.js').WasmModuleFactory, ayModuleOptions?:import('./soundchip.js').WasmModuleOptions, ayClock?:number, ym2413ModuleFactory?:import('./soundchip.js').WasmModuleFactory, ym2413ModuleOptions?:import('./soundchip.js').WasmModuleOptions, ym2413Clock?:number, y8950ModuleFactory?:import('./soundchip.js').WasmModuleFactory, y8950ModuleOptions?:import('./soundchip.js').WasmModuleOptions, y8950Clock?:number, k051649ModuleFactory?:import('./soundchip.js').WasmModuleFactory, k051649ModuleOptions?:import('./soundchip.js').WasmModuleOptions, k051649Clock?:number,ym2151Variant?:'ym2151'|'ym2164',ayType?:number,ayFlags?:number}} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<MsxAudioEngine>} Initialized engine owned by the caller.
   */
  static async create(options = {}) {
    const {outputSampleRate = 44100, masterVolume = 1} = options;
    // Explicit descriptors allow repeated types with independent clocks/options.
    const chips = options.chips ?? [
      ...(options.ym2151ModuleFactory ? [{type:'ym2151', options}] : []),
      ...(options.ayClock ? [{type:'ay8910', options:{moduleFactory:options.ayModuleFactory, moduleOptions:options.ayModuleOptions, clock:options.ayClock, type:options.ayType ?? 0, flags:options.ayFlags ?? 1}}] : []),
      ...(options.ym2413ModuleFactory ? [{type:'ym2413', options}] : []),
      ...(options.y8950ModuleFactory ? [{type:'y8950', options}] : []),
      ...(options.k051649Clock ? [{type:'k051649', options:{moduleFactory:options.k051649ModuleFactory, moduleOptions:options.k051649ModuleOptions, clock:options.k051649Clock}}] : []),
    ];
    const entries = [];
    const factories = {ym2151:Ym2151AudioEngine, ay8910:Ay8910AudioEngine, ym2413:Ym2413AudioEngine, y8950:Y8950AudioEngine, k051649:K051649AudioEngine};
    const methods = {ym2151:'writeYm2151', ay8910:'writeAy8910', ym2413:'writeYm2413', y8950:'writeY8950', k051649:'writeK051649'};
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
  /** @param {number} register
   * @param {number} value
   * @param {number} [index] */
  writeYm2151(register, value, index = 0) { this.getVgmTarget('ym2151', index).writeRegister(register, value); }
  /** @param {boolean} value */
  setOpmMuted(value) { this.setChipMuted('ym2151', 0, value); }
  /** @param {number} channel
   * @param {boolean} value */
  setOpmChannelMuted(channel, value) { this.entries.get('ym2151:0')?.engine.setChannelMuted(channel, value); }
  /** @param {number} register
   * @param {number} [index] */
  writeAy8910(register, value, index = 0) { this.getVgmTarget('ay8910', index).writeRegister(register, value); }
  /** @param {number} register
   * @param {number} [index] */
  writeYm2413(register, value, index = 0) { this.getVgmTarget('ym2413', index).writeRegister(register, value); }
  /** @param {number} register
   * @param {number} [index] */
  writeY8950(register, value, index = 0) { this.getVgmTarget('y8950', index).writeRegister(register, value); }
  /** @param {number} port
   * @param {number} register
   * @param {number} [index] */
  writeK051649(port, register, value, index = 0) { this.getVgmTarget('k051649', index).writeRegister(port, register, value); }
  /** @param {boolean} value */
  setAyMuted(value) { this.entries.get('ay8910:0')?.engine.setAyMuted(value); }
  /** @param {number} channel
   * @param {boolean} value */
  setAyChannelMuted(channel, value) { this.entries.get('ay8910:0')?.engine.setAyChannelMuted(channel, value); }
  /** @param {boolean} value */
  setOpllMuted(value) { this.setChipMuted('ym2413', 0, value); }
  /** @param {boolean} value */
  setY8950Muted(value) { this.setChipMuted('y8950', 0, value); }
  /** @param {boolean} value */
  setSccMuted(value) { this.entries.get('k051649:0')?.engine.setSccMuted(value); }
  /** @param {number} channel
   * @param {boolean} value */
  setSccChannelMuted(channel, value) { this.entries.get('k051649:0')?.engine.setSccChannelMuted(channel, value); }
}
/** @param {Parameters<typeof MsxAudioEngine.create>[0]} [options] */
export const createMsxAudioEngine = options => MsxAudioEngine.create(options);

/**
 * Check supported MSX chip combinations and single-chip variant flags.
 * @param {import('./ym2612vgm.js').Ym2612VgmHeader} header Parsed VGM clock/variant fields.
 * @returns {void}
 * @throws {Error} For unsupported chip combinations or variants.
 */
export function validateMsxPlaybackHeader(header) {
  for (const type of ['ay8910','ym2413','y8950','k051649','ym2151']) {
    // K051649 bit 31 selects K052539 (SCC+); port 4 already writes independent waveforms.
    const unsupportedFlags = ['k051649','ym2151'].includes(type) ? 0x40000000 : 0xc0000000;
    if (header[`${type}Clock`] & unsupportedFlags) throw new Error(`${type} variants and dual-chip playback are not validated yet.`);
  }
  for (const type of ['ym2612','ym2203','ym2608','ym2610','rf5c164','pwm','psg','ym3526','ym3812','ymf262','ymf278b','segaPcm']) {
    if (header[`${type}Clock`]) throw new Error(`MSX with ${type}: Support coming soon.`);
  }
}
