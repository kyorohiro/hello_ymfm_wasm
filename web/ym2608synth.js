import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";

/** High-level FM-only API for the 6-channel YM2608. */
export class YM2608DirectTransport extends OPNDirectTransport {
  constructor(chip) {
    super(chip, { chipName: "YM2608", portCount: 2 });
  }
}

export class YM2608Synth extends OPNFMSynth {
  constructor({ transport } = {}) {
    super({
      transport,
      chipName: "YM2608",
      channelCount: 6,
      portCount: 2,
      supportsPan: true,
      supportsLfo: true,
    });
  }
}
