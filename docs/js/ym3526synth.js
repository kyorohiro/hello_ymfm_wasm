import {OPLSynth,OPLDirectTransport} from './opl_synth.js?v=audio-numeric-bindings-1';
export {OPL_PRESETS} from './opl_synth.js?v=audio-numeric-bindings-1';
export {YM3526_CLOCK} from './ym3526.js?v=audio-stability-2';
export {YM3526WorkletTransport} from './chip_worklet_transport.js?v=pokey-mode-1';

/** Nine-channel original OPL instrument API; sine waveform only. */
export class YM3526Synth extends OPLSynth {
  /** @param {{transport:import('./opl_synth.js?v=audio-numeric-bindings-1').OPLTransport,clock?:number}} options */
  constructor({transport,clock} = {}) {super({transport,clock,chip:'ym3526'});}
}
/** Borrow a synchronous YM3526 without creating an audio device. */
export class YM3526DirectTransport extends OPLDirectTransport {
  /** @param {import('./ym3526.js?v=audio-stability-2').Ym3526} chip @param {{clock?:number}} [options] */
  constructor(chip, {clock} = {}) {super(chip,{chip:'ym3526',clock});}
}
