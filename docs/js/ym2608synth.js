import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";

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

/** Browser-hosted YM2608 FM synth with shared Tetorica audio services. */
export class YM2608RuntimeSynth extends OPNRuntimeSynth {
  constructor(options = {}) {
    super(options, {
      chip: "ym2608",
      chipName: "YM2608",
      fmChannels: 6,
      portCount: 2,
      processorName: "ym2608-processor",
      workletUrl: "./ym2608-worklet.js",
      wasmUrl: "./generated/ym2608_wasm.wasm",
      FMSynth: YM2608Synth,
    });
  }
}
