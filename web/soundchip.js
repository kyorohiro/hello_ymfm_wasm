/**
 * @file Browser / Node.js の便利なチップ生成入口。DOM・AudioContext は不要。
 * 選択した WASM だけを読み込む。最小配布には soundchip_factory.js を使うこと。
 * 動的 import の配布方法はバンドラーに依存するため、この入口はサイズ削減を保証しない。
 */
import { createSoundChipFactory } from './soundchip_factory.js';

/**
 * @typedef {Object} SoundChipOptions
 * @property {URL|string} [assetBaseUrl] 生成済み *_wasm.js / .wasm のディレクトリURL（末尾 /）。
 * @property {Function} [moduleFactory] 注入する Emscripten factory。指定時は自動ロードを省略。
 * @property {Object} [moduleOptions] wasmBinary、locateFile などをそのまま渡す。
 */
async function loadModule(name, options = {}) {
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
      moduleOptions.wasmBinary = await readFile(wasmUrl);
    } else {
      moduleOptions.locateFile = path => new URL(path, base).href;
    }
  }
  return { moduleFactory, moduleOptions };
}

const loaders = {
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
export const createSoundChip = createSoundChipFactory(loaders);
