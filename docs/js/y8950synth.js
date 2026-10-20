import {OPLSynth,OPLDirectTransport} from './opl_synth.js?v=msx-modes-2';
export {OPL_PRESETS} from './opl_synth.js?v=msx-modes-2';
export {Y8950_CLOCK} from './y8950.js?v=audio-stability-2';
export {Y8950WorkletTransport} from './chip_worklet_transport.js?v=msx-modes-2';

/** Y8950's nine-channel OPL FM section. ADPCM remains a separate raw API. */
export class Y8950Synth extends OPLSynth {
  /** @param {{transport:import('./opl_synth.js?v=msx-modes-2').OPLTransport,clock?:number}} options */
  constructor({transport,clock} = {}) {super({transport,clock,chip:'y8950'});}
}
/** Borrow a synchronous Y8950 without creating an audio device. */
export class Y8950DirectTransport extends OPLDirectTransport {
  /** @param {import('./y8950.js?v=audio-stability-2').Y8950} chip @param {{clock?:number}} [options] */
  constructor(chip, {clock} = {}) {super(chip,{chip:'y8950',clock});}
}
