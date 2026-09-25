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
  /** Transfer caller-provided rhythm ROM to the core. */
  loadRhythmRom(bytes) { return this.chip.loadAdpcmARom(bytes); }
}

/** YM2608's six fixed rhythm voices. Names follow the ROM's hardware order. */
export const YM2608_RHYTHM_VOICES = Object.freeze({
  bassDrum: 0, snare: 1, cymbal: 2, hiHat: 3, tom: 4, rimShot: 5,
});

const rhythmInteger = (name, value, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid rhythm ${name}`);
  return value;
};
const rhythmVoice = voice => {
  const index = typeof voice === "string" && Object.prototype.hasOwnProperty.call(YM2608_RHYTHM_VOICES, voice)
    ? YM2608_RHYTHM_VOICES[voice] : voice;
  return rhythmInteger("voice", index, 5);
};

/** Register control for the fixed rhythm ROM; does not decode WAV or allocate PCM voices. */
export class YM2608RhythmSynth {
  /** @param {{write: function(number, number): void, loadRom: function(Uint8Array): void}} transport */
  constructor(transport) {
    this.transport = transport;
    this.resetState();
  }
  /** Clear the register shadow after a whole-chip reset, without bus writes. */
  resetState() { this.levels = new Uint8Array(6); }
  /** Track raw port-0 writes made through the parent Synth. */
  observeWrite(register, value) {
    if (register >= 0x18 && register <= 0x1d) this.levels[register - 0x18] = value;
  }
  /** Load the complete 8 KiB rhythm ROM supplied by the caller. No ROM is bundled here.
   * @param {Uint8Array} bytes Encoded ADPCM-A ROM, not WAV or ADPCM-B.
   */
  loadRom(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 8192) throw new RangeError("Rhythm ROM must be an 8192-byte Uint8Array");
    return this.transport.loadRom(bytes);
  }
  /** Set global hardware level 0..63; larger values are louder. */
  setVolume(volume) { this.transport.write(0x11, rhythmInteger("volume", volume, 63)); }
  /** Set one voice's hardware level 0..31 and/or stereo gates; omitted settings are preserved.
   * @param {number|string} voice 0..5 or a key of YM2608_RHYTHM_VOICES.
   * @param {{volume?: number, left?: boolean, right?: boolean}} options
   */
  setVoice(voice, {volume, left, right} = {}) {
    const ch = rhythmVoice(voice);
    let value = this.levels[ch];
    if (volume !== undefined) value = (value & 0xe0) | rhythmInteger("voice volume", volume, 31);
    for (const [flag, mask] of [[left, 0x80], [right, 0x40]]) {
      if (flag === undefined) continue;
      if (typeof flag !== "boolean") throw new TypeError("Rhythm pan gates must be boolean");
      value = flag ? value | mask : value & ~mask;
    }
    this.transport.write(0x18 + ch, value);
    this.levels[ch] = value;
  }
  /** Trigger one voice or an array simultaneously. Repeated calls retrigger from its fixed ROM start. */
  keyOn(voices) { this._key(voices, false); }
  /** Stop one voice or an array immediately; this is not an FM envelope release. */
  keyOff(voices) { this._key(voices, true); }
  _key(voices, off) {
    const list = Array.isArray(voices) ? voices : [voices];
    if (!list.length) return;
    const mask = list.reduce((mask, voice) => mask | (1 << rhythmVoice(voice)), 0);
    this.transport.write(0x10, (off ? 0x80 : 0) | mask);
  }
  /** Stop all rhythm voices and clear their controls; preserve ROM, FM, SSG and ADPCM-B. */
  reset() {
    this.keyOff([0, 1, 2, 3, 4, 5]);
    this.setVolume(0);
    for (let ch = 0; ch < 6; ch++) this.setVoice(ch, {volume: 0, left: false, right: false});
  }
}

/** Six-channel FM (including CH3 special), three-channel SSG and fixed-ROM rhythm control. */
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
    this.rhythm = new YM2608RhythmSynth({
      write: (register, value) => this.write(0, register, value),
      loadRom: bytes => {
        if (typeof this.transport.loadRhythmRom !== "function") throw new Error("Transport does not support rhythm ROM loading");
        return this.transport.loadRhythmRom(bytes);
      },
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
    this.rhythm?.resetState();
    this.write(0, 0x29, 0x9f);
  }

  _write(port, register, value) {
    super._write(port, register, value);
    if (port === 0) {
      this.ssg?.observeWrite(register, value);
      this.rhythm?.observeWrite(register, value);
    }
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
