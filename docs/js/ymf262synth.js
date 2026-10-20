import {OPLSynth,OPLDirectTransport} from './opl_synth.js?v=msx-modes-2';
export {OPL_PRESETS} from './opl_synth.js?v=msx-modes-2';
export {YMF262_CLOCK} from './ymf262.js?v=audio-stability-2';
export {YMF262WorkletTransport} from './chip_worklet_transport.js?v=msx-modes-2';

/** Eighteen-channel OPL3 with six selectable four-operator pairs and stereo. */
export class YMF262Synth extends OPLSynth {
  /** @param {{transport:import('./opl_synth.js?v=msx-modes-2').OPLTransport,clock?:number}} options */
  constructor({transport,clock} = {}) {super({transport,clock,chip:'ymf262'});}
}
/** Borrow a synchronous YMF262 without creating an audio device. */
export class YMF262DirectTransport extends OPLDirectTransport {
  /** @param {import('./ymf262.js?v=audio-stability-2').Ymf262} chip @param {{clock?:number}} [options] */
  constructor(chip, {clock} = {}) {super(chip,{chip:'ymf262',clock});}
}
