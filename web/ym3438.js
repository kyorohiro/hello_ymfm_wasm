/**
 * @file ym3438.js
 * 実行環境: Browser / Node.js。依存: WASM（moduleFactory で注入）。DOM・Web Audio は不要。
 */
import { OpnVariant } from './opn_variant.js';
/** Example input clock in Hz; set the clock appropriate to the target machine. */
export const YM3438_CLOCK = 7670454;
/** YM3438 native core. Uses the variant-specific DAC/output implementation. */
export class Ym3438 extends OpnVariant {
  /**
   * @param {moduleFactory: Function, moduleOptions?: Object} options WASM loader settings.
   * @returns {Promise<Ym3438>} Caller-owned chip; dispose when finished.
   */
  static async create({moduleFactory, moduleOptions} = {}) {
    if (typeof moduleFactory !== 'function') throw new TypeError('moduleFactory is required');
    return new Ym3438(await moduleFactory(moduleOptions ?? {}), YM3438_CLOCK);
  }
}
/**
 * @param {Function} moduleFactory Generated ym3438_wasm.js factory.
 * @param {Object} [moduleOptions] Emscripten loader options.
 * @returns {Promise<Ym3438>}
 */
export function createYm3438(moduleFactory, moduleOptions) {
  return Ym3438.create({moduleFactory, moduleOptions});
}
