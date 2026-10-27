import {OPLSynth,OPLDirectTransport} from './opl_synth.js?v=audio-numeric-bindings-1';
export {OPL_PRESETS} from './opl_synth.js?v=audio-numeric-bindings-1';
export {YM3812_CLOCK} from './ym3812.js?v=audio-stability-2';
export {YM3812WorkletTransport} from './chip_worklet_transport.js?v=pokey-mode-1';

/** Nine-channel OPL2 instrument API; channels and operators are zero-based. */
export class YM3812Synth extends OPLSynth {
  /** @param {{transport:import('./opl_synth.js?v=audio-numeric-bindings-1').OPLTransport,clock?:number}} options */
  constructor({transport,clock} = {}) {super({transport,clock,chip:'ym3812'});}
}
/** Borrow a synchronous YM3812 without creating an audio device. */
export class YM3812DirectTransport extends OPLDirectTransport {
  /** @param {import('./ym3812.js?v=audio-stability-2').Ym3812} chip @param {{clock?:number}} [options] */
  constructor(chip, {clock} = {}) {super(chip,{chip:'ym3812',clock});}
}
