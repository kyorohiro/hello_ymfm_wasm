import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";

/** High-level FM-only API for the 3-channel YM2203. */
export class YM2203DirectTransport extends OPNDirectTransport {
  constructor(chip) {
    super(chip, { chipName: "YM2203", portCount: 1 });
  }
}

export class YM2203Synth extends OPNFMSynth {
  constructor({ transport } = {}) {
    super({
      transport,
      chipName: "YM2203",
      channelCount: 3,
      portCount: 1,
    });
  }
}
