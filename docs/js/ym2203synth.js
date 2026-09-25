/**
 * @file ym2203synth.js
 * 実行環境: Browser / Node.js（クラスにより異なる）
 * 依存: 低レベル Synth / DirectTransport は注入したチップで動作し、Node.js でも使用可能。
 * RuntimeSynth 系の実再生は OPNRuntimeSynth 経由で AudioContext / AudioWorkletNode / fetch を使う。
 */
import { SSGSynth } from "./ssgsynth.js";
import { YM2203_CLOCK } from "./ym2203.js";
import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";

/** Direct transport for YM2203 FM and SSG registers. */
export class YM2203DirectTransport extends OPNDirectTransport {
  constructor(chip) {
    super(chip, { chipName: "YM2203", portCount: 1 });
  }
}

/** YM2203 FM (including CH3 special) and its three-channel SSG. */
export class YM2203Synth extends OPNFMSynth {
  /** @param {{transport: OPNDirectTransport, clock?: number}} options
   * clock is the master clock in Hz; frequency helpers assume the standard prescaler.
   */
  constructor({ transport, clock = YM2203_CLOCK } = {}) {
    super({
      transport,
      chipName: "YM2203",
      channelCount: 3,
      portCount: 1,
    });
    // Standard prescaler: effective SSG clock = master / 2.
    // Raw prescaler changes require updating ssg.clock before Hz-based tone calls.
    this.ssg = new SSGSynth({
      transport: { write: (register, value) => this.write(0, register, value) },
      clock: clock / 2,
    });
  }

  reset() {
    super.reset();
    this.ssg?.resetState();
  }

  _write(port, register, value) {
    super._write(port, register, value);
    if (port === 0) this.ssg?.observeWrite(register, value);
  }
}

/** Browser-hosted YM2203 FM synth with shared Tetorica audio services. */
export class YM2203RuntimeSynth extends OPNRuntimeSynth {
  constructor(options = {}) {
    super(options, {
      chip: "ym2203",
      chipName: "YM2203",
      fmChannels: 3,
      portCount: 1,
      processorName: "ym2203-processor",
      workletUrl: "./ym2203-worklet.js",
      wasmUrl: "./generated/ym2203_wasm.wasm",
      FMSynth: YM2203Synth,
    });
  }
}
