import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";

const NEO_GEO_FM_CHANNELS = [1, 2, 4, 5];

export class YM2610BDirectTransport extends OPNDirectTransport {
  constructor(chip) { super(chip, { chipName: "YM2610B", portCount: 2 }); }
}

/** Full six-channel YM2610B FM API. */
export class YM2610BSynth extends OPNFMSynth {
  constructor({ transport } = {}) {
    super({ transport, chipName: "YM2610B", channelCount: 6, portCount: 2, supportsPan: true, supportsLfo: true });
  }
}

/** Browser-hosted full YM2610B core. */
export class YM2610BRuntimeSynth extends OPNRuntimeSynth {
  constructor(options = {}) {
    super(options, {
      chip: "ym2610b", chipName: "YM2610B", fmChannels: 6, portCount: 2,
      processorName: "ym2610b-processor", workletUrl: "./ym2610b-worklet.js",
      wasmUrl: "./generated/ym2610b_wasm.wasm", FMSynth: YM2610BSynth,
    });
  }
}

/**
 * Neo Geo exposes four YM2610 FM channels. They are not the first four OPN
 * channels, so this facade maps compact logical channels to hardware ones.
 */
export class NeoGeoFMSynth {
  constructor(fm) { this.fm = fm; this.channelCount = 4; }
  reset() { this.fm.reset(); }
  write(...args) { return this.fm.write(...args); }
  read(...args) { return this.fm.read?.(...args); }
  readStatus(...args) { return this.fm.readStatus?.(...args); }
  getIrq(...args) { return this.fm.getIrq?.(...args); }
  setLfo(...args) { return this.fm.setLfo(...args); }
  setChannel3SpecialMode(...args) { return this.fm.setChannel3SpecialMode(...args); }
  setChannel3SpecialFrequency(...args) { return this.fm.setChannel3SpecialFrequency(...args); }
  setPreset(channel, ...args) { return this.fm.setPreset(this.#channel(channel), ...args); }
  setOperator(channel, ...args) { return this.fm.setOperator(this.#channel(channel), ...args); }
  setAlgo(channel, ...args) { return this.fm.setAlgo(this.#channel(channel), ...args); }
  setPan(channel, ...args) { return this.fm.setPan(this.#channel(channel), ...args); }
  setModulation(channel, ...args) { return this.fm.setModulation(this.#channel(channel), ...args); }
  setFrequency(channel, ...args) { return this.fm.setFrequency(this.#channel(channel), ...args); }
  keyOn(channel, ...args) { return this.fm.keyOn(this.#channel(channel), ...args); }
  keyOff(channel, ...args) { return this.fm.keyOff(this.#channel(channel), ...args); }
  noteOn(channel, ...args) { return this.fm.noteOn(this.#channel(channel), ...args); }
  noteOff(channel, ...args) { return this.fm.noteOff(this.#channel(channel), ...args); }
  #channel(channel) {
    const physical = NEO_GEO_FM_CHANNELS[Number(channel)];
    if (physical === undefined) throw new Error("Neo Geo FM channel must be 0..3");
    return physical;
  }
}

/** Neo Geo YM2610 profile built on the YM2610B core. */
export class NeoGeoSynth extends YM2610BRuntimeSynth {
  constructor(options = {}) {
    super(options);
    this.chip = "ym2610";
    this.capabilities = Object.freeze({ chip: "ym2610", fmChannels: 4, psg: false, dac: false, recorder: false });
    this.rawFm = null;
  }

  async start() {
    await super.start();
    if (!(this.fm instanceof NeoGeoFMSynth)) {
      this.rawFm = this.fm;
      this.fm = new NeoGeoFMSynth(this.rawFm);
    }
    return this;
  }
}
