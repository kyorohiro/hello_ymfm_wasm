/**
 * @file ym2203synth.js
 * 実行環境: Browser / Node.js（クラスにより異なる）
 * 依存: 低レベル Synth / DirectTransport は注入したチップで動作し、Node.js でも使用可能。
 * RuntimeSynth 系の実再生は OPNRuntimeSynth 経由で AudioContext / AudioWorkletNode / fetch を使う。
 */
import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";

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
