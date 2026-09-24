/**
 * @file FM helpers for the additional OPN cores.
 * 実行環境: Browser / Node.js。依存: 注入されたレジスタ transport。Web Audio は不要。
 * FM only: no rhythm/SSG presets or browser RuntimeSynth are added here.
 */
import { OPNFMSynth } from './opn_fm_synth.js';

/** YM3438 FM programming uses the shared six-channel OPN register interface. */
export class YM3438Synth extends OPNFMSynth {
  /** @param {{transport: Object}} options Register transport, e.g. OPNDirectTransport. */
  constructor({transport} = {}) {
    super({transport, chipName: 'YM3438', channelCount: 6, portCount: 2, supportsPan: true, supportsLfo: true});
  }
}
/** YMF276 has its own native output path, with the same FM programming interface. */
export class YMF276Synth extends OPNFMSynth {
  /** @param {{transport: Object}} options Register transport. */
  constructor({transport} = {}) {
    super({transport, chipName: 'YMF276', channelCount: 6, portCount: 2, supportsPan: true, supportsLfo: true});
  }
}
