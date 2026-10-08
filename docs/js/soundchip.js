import {allocateSoundChipId} from './soundchip_mixer.js';
export {SoundChipMixer, soundChipMixDefaults} from './soundchip_mixer.js';
/**
 * @file Browser / Node.js の便利なチップ生成入口。DOM・AudioContext は不要。
 * 選択した WASM だけを読み込む。最小配布には soundchip_factory.js を使うこと。
 * 動的 import の配布方法はバンドラーに依存するため、この入口はサイズ削減を保証しない。
 */
import { createSoundChipFactory } from './soundchip_factory.js';
import {createWorkletSoundChip} from './soundchip_worklet.js';
import {PWM32X} from './pwm32x.js';
export {encodeWav} from './wav.js';

/**
 * Loader settings forwarded to an Emscripten chip factory.
 * @typedef {Object} WasmLoaderOptions
 * @property {Uint8Array|ArrayBuffer} [wasmBinary] Preloaded WASM bytes.
 * @property {(path:string, prefix:string)=>string} [locateFile] Resolve generated assets.
 * @property {(message:string)=>void} [print] Standard output callback.
 * @property {(message:string)=>void} [printErr] Error output callback.
 * @property {boolean} [noInitialRun] Skip the generated main entry point.
 */
/**
 * Common native memory and binding surface used by the chip wrappers.
 * Generated modules may expose additional chip-specific functions.
 * @typedef {Object} WasmChipModule
 * @property {Float32Array} HEAPF32 Native float sample memory.
 * @property {Uint8Array} HEAPU8 Native byte memory.
 * @property {(bytes:number)=>number} _malloc Allocate native memory.
 * @property {(pointer:number)=>void} _free Release native memory.
 * @property {((name:string, result:'number', args:string[]) => (...values:number[])=>number) & ((name:string, result:null, args:string[]) => (...values:number[])=>void)} cwrap Bind a native chip entry point.
 */
/** @typedef {WasmLoaderOptions & Record<string, unknown>} WasmModuleOptions */
/** @typedef {(options?: WasmModuleOptions)=>WasmChipModule|Promise<WasmChipModule>} WasmModuleFactory */

/**
 * @typedef {Object} SoundChipOptions
 * @property {URL|string} [assetBaseUrl] 生成済み *_wasm.js / .wasm のディレクトリURL（末尾 /）。
 * @property {WasmModuleFactory} [moduleFactory] 注入する Emscripten factory。指定時は自動ロードを省略。
 * @property {WasmModuleOptions} [moduleOptions] wasmBinary、locateFile などをそのまま渡す。
 * @property {import('./soundchip_mixer.js').SoundChipMixer} [mixer] Worklet output mixer.
 * @property {string} [id] Stable chip ID (automatically allocated when omitted).
 * @property {AbortSignal} [signal] WASM ファイルの読み込みを中断する。
 * @property {'direct'|'worklet'} [execution='direct'] チップの実行場所。worklet はブラウザーのみ。
 * @property {AudioContext} [audioContext] Worklet の接続先。省略時は factory が生成・解放する。
 * @property {number} [clock] Input clock in Hz.
 * @property {boolean} [fds=false] Enable the FDS expansion on NES.
 * @property {number} [sampleRate] Requested PCM/output sample rate.
 * @property {number} [type] AY chip variant type.
 * @property {number} [flags] Chip-specific flags.
 * @property {boolean|'ym2151'|'ym2164'} [variant] Chip variant selection.
 * @property {'dac'|'duty'} [outputMode] PWM amplitude scaling.
 * @property {AudioNode} [outputNode] Browser output destination.
 * @property {number} [gain=0.25] Worklet endpoint の出力音量。
 */
async function loadModule(name, options = {}) {
  options.signal?.throwIfAborted();
  if (options.moduleFactory) return options;
  // Source tree: web/ -> docs/generated/. Published tree: js/ -> generated/.
  const base = new URL(options.assetBaseUrl ??
    (import.meta.url.includes('/web/') ? '../docs/generated/' : '../generated/'), import.meta.url);
  const { default: moduleFactory } = await import(new URL(`${name}_wasm.js`, base).href);
  const moduleOptions = { ...options.moduleOptions };
  if (moduleOptions.wasmBinary === undefined && !moduleOptions.locateFile) {
    const wasmUrl = new URL(`${name}_wasm.wasm`, base);
    if (wasmUrl.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      moduleOptions.wasmBinary = await readFile(wasmUrl, {signal: options.signal});
    } else {
      // Not all generated loaders accept locateFile. Read the bytes ourselves
      // and pass the supported wasmBinary option in every environment.
      const response = await fetch(wasmUrl, {signal: options.signal});
      if (!response.ok) throw new Error(`Failed to load ${name} WASM: HTTP ${response.status}`);
      moduleOptions.wasmBinary = new Uint8Array(await response.arrayBuffer());
    }
  }
  options.signal?.throwIfAborted();
  return { ...options, moduleFactory, moduleOptions };
}

const loaders = {
  nes: async options => {
    options.signal?.throwIfAborted();
    const {NesApu} = await import('./nesapu.js');
    options.signal?.throwIfAborted();
    return NesApu.create(options);
  },
  gameboy: async (options) => {
    const {GameboyApu} = await import('./gameboyapu.js');
    return GameboyApu.create(await loadModule('gameboy_apu', options));
  },
  segapsg: async (options) => {
    const {SegaPSG} = await import('./segapsg.js');
    return SegaPSG.create(await loadModule('segapsg', options));
  },
  /** @param {SoundChipOptions} [options] */
  ay8910: async (options) => {
    const { Ay8910 } = await import('./ay8910.js');
    return Ay8910.create(await loadModule('ay8910', options));
  },
  /** @param {SoundChipOptions} [options] */
  y8950: async (options) => {
    const { Y8950 } = await import('./y8950.js');
    return Y8950.create(await loadModule('y8950', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym2151: async (options) => {
    const { Ym2151 } = await import('./ym2151.js');
    return Ym2151.create(await loadModule('ym2151', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym2203: async (options) => {
    const { Ym2203 } = await import('./ym2203.js');
    return Ym2203.create(await loadModule('ym2203', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym2413: async (options) => {
    const { Ym2413 } = await import('./ym2413.js');
    return Ym2413.create(await loadModule('ym2413', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym2608: async (options) => {
    const { Ym2608 } = await import('./ym2608.js');
    return Ym2608.create(await loadModule('ym2608', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym2610b: async (options) => {
    const { Ym2610B } = await import('./ym2610b.js');
    return Ym2610B.create(await loadModule('ym2610b', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym2612: async (options) => {
    const { Ym2612 } = await import('./ym2612.js');
    return Ym2612.create(await loadModule('ym2612', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym3438: async (options) => {
    const { Ym3438 } = await import('./ym3438.js');
    return Ym3438.create(await loadModule('ym3438', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym3526: async (options) => {
    const { Ym3526 } = await import('./ym3526.js');
    return Ym3526.create(await loadModule('ym3526', options));
  },
  /** @param {SoundChipOptions} [options] */
  ym3812: async (options) => {
    const { Ym3812 } = await import('./ym3812.js');
    return Ym3812.create(await loadModule('ym3812', options));
  },
  /** @param {SoundChipOptions} [options] */
  ymf262: async (options) => {
    const { Ymf262 } = await import('./ymf262.js');
    return Ymf262.create(await loadModule('ymf262', options));
  },
  /** @param {SoundChipOptions} [options] */
  ymf276: async (options) => {
    const { Ymf276 } = await import('./ymf276.js');
    return Ymf276.create(await loadModule('ymf276', options));
  },
  /** @param {SoundChipOptions} [options] */
  ymf278b: async (options) => {
    const { Ymf278b } = await import('./ymf278b.js');
    return Ymf278b.create(await loadModule('ymf278b', options));
  },
  /** @param {SoundChipOptions} [options] */
  ymf288: async (options) => {
    const { Ymf288 } = await import('./ymf288.js');
    return Ymf288.create(await loadModule('ymf288', options));
  },
};

/**
 * 名前から低レベルチップを生成する。呼び出しごとに独立インスタンスを返す。
 * PCM生成・レジスタAPIはチップ固有。音声出力やROMの自動取得は行わない。
 * 使用後は dispose() が必要。
 * @example
 * const chip = await createSoundChip('ym2151');
 * try { const pcm = chip.generateStereo(128); } finally { chip.dispose(); }
 */
const createLocalSoundChip = createSoundChipFactory(loaders);
/** @typedef {{
 *   gameboy: import('./gameboyapu.js').GameboyApu,
 *   segapsg: import('./segapsg.js').SegaPSG,
 *   pwm: import('./pwm32x.js').PWM32X,
 *   nes: import('./nesapu.js').NesApu,
 *   ay8910: import('./ay8910.js').Ay8910,
 *   y8950: import('./y8950.js').Y8950,
 *   ym2610b: import('./ym2610b.js').Ym2610B,
 *   ym2151: import('./ym2151.js').Ym2151,
 *   ym2203: import('./ym2203.js').Ym2203,
 *   ym2413: import('./ym2413.js').Ym2413,
 *   ym2608: import('./ym2608.js').Ym2608,
 *   ym2612: import('./ym2612.js').Ym2612,
 *   ym3438: import('./ym3438.js').Ym3438,
 *   ym3526: import('./ym3526.js').Ym3526,
 *   ym3812: import('./ym3812.js').Ym3812,
 *   ymf262: import('./ymf262.js').Ymf262,
 *   ymf276: import('./ymf276.js').Ymf276,
 *   ymf278b: import('./ymf278b.js').Ymf278b,
 *   ymf288: import('./ymf288.js').Ymf288,
 * }} SoundChipMap */
/** @typedef {'ym2612'|'ym2608'|'ym2151'|'gameboy'|'segapsg'|'pwm'|'nes'} WorkletChipName */
/**
 * @template {WorkletChipName} Name
 * @overload
 * @param {Name} name
 * @param {SoundChipOptions & {execution: 'worklet'}} options
 * @returns {Promise<import('./soundchip_worklet.js').WorkletSoundChip & {name: Name}>}
 */
/**
 * @template {keyof SoundChipMap} Name
 * @overload
 * @param {Name} name
 * @param {SoundChipOptions & {execution?: 'direct'}} [options]
 * @returns {Promise<SoundChipMap[Name] & {readonly id: string}>}
 */
/**
 * @template {WorkletChipName} Name
 * @overload
 * @param {Name} name
 * @param {SoundChipOptions} options
 * @returns {Promise<(SoundChipMap[Name] & {readonly id: string}) | import('./soundchip_worklet.js').WorkletSoundChip>}
 */
/** @param {keyof SoundChipMap} name @param {SoundChipOptions} [options] */
export function createSoundChip(name, options = {}) {
  if (options.mixer && options.execution !== 'worklet') return Promise.reject(new Error('An output mixer requires execution: worklet; direct chips generate raw PCM'));
  if (options.execution === 'worklet') {
    if (options.moduleFactory) return Promise.reject(new Error('Worklet execution uses the packaged chip factory'));
    const moduleName = name === 'gameboy' ? 'gameboy_apu' : name;
    return createWorkletSoundChip(name, options, async () => {
      if (name === 'pwm' || name === 'nes') return undefined;
      const loaded = await loadModule(moduleName, options);
      const bytes = loaded.moduleOptions.wasmBinary;
      if (!bytes) throw new Error('Worklet execution requires WASM bytes; use wasmBinary or default asset loading');
      return bytes;
    });
  }
  if (options.execution !== undefined && options.execution !== 'direct') return Promise.reject(new Error('Unknown sound-chip execution mode'));
  let id;
  try {id = allocateSoundChipId(name, options.id);} catch (error) {return Promise.reject(error);}
  const pending = name === 'pwm' ? Promise.resolve().then(() => {options.signal?.throwIfAborted(); return new PWM32X(options);}) : createLocalSoundChip(name, options);
  return pending.then(chip => {
    Object.defineProperty(chip, 'id', {value: id, enumerable: true});
    return chip;
  });
}
