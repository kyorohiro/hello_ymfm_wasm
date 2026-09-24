/**
 * @file ymf288.js
 * 実行環境: Browser / Node.js。依存: WASM（moduleFactory で注入）。DOM・Web Audio は不要。
 */
import { OpnVariant } from './opn_variant.js';
/** Example input clock in Hz; set the clock appropriate to the target machine. */
export const YMF288_CLOCK = 8000000;
/** YMF288 native core. FM/SSG core. Rhythm ROM loading is not exposed by this binding. */
export class Ymf288 extends OpnVariant {
  /**
   * @param {{moduleFactory: Function, moduleOptions?: Object}} options WASM loader settings.
   * @returns {Promise<Ymf288>} Caller-owned chip; dispose when finished.
   */
  static async create({moduleFactory, moduleOptions} = {}) {
    if (typeof moduleFactory !== 'function') throw new TypeError('moduleFactory is required');
    return new Ymf288(await moduleFactory(moduleOptions ?? {}), YMF288_CLOCK);
  }
}
/**
 * @param {Function} moduleFactory Generated ymf288_wasm.js factory.
 * @param {Object} [moduleOptions] Emscripten loader options.
 * @returns {Promise<Ymf288>}
 */
export function createYmf288(moduleFactory, moduleOptions) {
  return Ymf288.create({moduleFactory, moduleOptions});
}
