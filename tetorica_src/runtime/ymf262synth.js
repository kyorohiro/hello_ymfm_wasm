import {OPLSynth,OPLDirectTransport} from './opl_synth.js';
export {OPL_PRESETS} from './opl_synth.js';
export {YMF262_CLOCK} from './ymf262.js';
export {YMF262WorkletTransport} from './chip_worklet_transport.js';

/** Eighteen-channel OPL3 with six selectable four-operator pairs and stereo. */
export class YMF262Synth extends OPLSynth {
  /** @param {{transport:import('./opl_synth.js').OPLTransport,clock?:number}} options */
  constructor({transport,clock} = {}) {super({transport,clock,chip:'ymf262'});}
}
/** Borrow a synchronous YMF262 without creating an audio device. */
export class YMF262DirectTransport extends OPLDirectTransport {
  /** @param {import('./ymf262.js').Ymf262} chip @param {{clock?:number}} [options] */
  constructor(chip, {clock} = {}) {super(chip,{chip:'ymf262',clock});}
}
