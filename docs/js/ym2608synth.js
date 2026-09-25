/**
 * @file ym2608synth.js
 * 実行環境: Browser / Node.js（クラスにより異なる）
 * 依存: 低レベル Synth / DirectTransport は注入したチップで動作し、Node.js でも使用可能。
 * RuntimeSynth 系の実再生は OPNRuntimeSynth 経由で AudioContext / AudioWorkletNode / fetch を使う。
 */
import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";
import { SSGSynth } from "./ssgsynth.js";
import { YM2608_CLOCK } from "./ym2608.js";

/** Direct transport for YM2608 register operations. */
export class YM2608DirectTransport extends OPNDirectTransport {
  constructor(chip) {
    super(chip, { chipName: "YM2608", portCount: 2 });
  }
}

/** Six-channel FM (including CH3 special) and the three-channel SSG. */
export class YM2608Synth extends OPNFMSynth {
  /** @param {{transport: OPNDirectTransport, clock?: number}} options
   * clock is the master clock in Hz. SSG frequency helpers assume standard prescaling.
   */
  constructor({ transport, clock = YM2608_CLOCK } = {}) {
    super({
      transport,
      chipName: "YM2608",
      channelCount: 6,
      portCount: 2,
      supportsPan: true,
      supportsLfo: true,
    });
    // YM2608's effective SSG clock is master / 4 at the standard prescaler.
    // After raw prescaler changes, update ssg.clock or use explicit periods.
    this.ssg = new SSGSynth({
      transport: { write: (register, value) => this.write(0, register, value) },
      clock: clock / 4,
    });
  }

  /** Reset the chip and enable all six FM channels, preserving default IRQ enables. */
  reset() {
    super.reset();
    this.ssg?.resetState();
    this.write(0, 0x29, 0x9f);
  }

  _write(port, register, value) {
    super._write(port, register, value);
    if (port === 0) this.ssg?.observeWrite(register, value);
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
