type PlaygroundChipMix = {volume: number; pan: number; muted: boolean; solo: boolean};
interface PlaygroundMixer {
  set(id: string, settings: {volume?: number; pan?: number; muted?: boolean; solo?: boolean}): PlaygroundChipMix | Promise<PlaygroundChipMix>;
  get(id: string): PlaygroundChipMix | Promise<PlaygroundChipMix>;
  list(): Array<PlaygroundChipMix & {id: string; name: string; connected: boolean; effectiveMuted: boolean}> | Promise<Array<PlaygroundChipMix & {id: string; name: string; connected: boolean; effectiveMuted: boolean}>>;
  reset(id?: string): void | Promise<void>;
}
declare const mixer: PlaygroundMixer;
interface PlaygroundCreateSoundChipOptions {id?: string;}
/**
 * One logical YM2612 operator parameter block used by `fm.setOperator()`.
 *
 * Public operator numbers are logical `0..3`.
 * They are not the YM2612 physical slot order.
 */
type YM2612OperatorParams = {
  /** Detune, 0..7. */
  dt?: number;
  /** Frequency multiple, 0..15. */
  multi?: number;
  /** Total level, 0..127. Lower values are louder. */
  tl?: number;
  /** Rate scaling, 0..3. */
  rs?: number;
  /** Attack rate, 0..31. */
  ar?: number;
  am?: boolean;
  /** First decay rate, 0..31. */
  d1r?: number;
  /** Sustain rate, 0..31. */
  sr?: number;
  /** Alias of sustain rate used in some demos, 0..31. */
  d2r?: number;
  /** Sustain level, 0..15. */
  sl?: number;
  /** Release rate, 0..15. */
  rr?: number;
  /** SSG-EG value, 0..15. */
  ssg?: number;
};

/** Logical channels shared by the six-channel OPN FM APIs. */
type OPNFmChannel = 0 | 1 | 2 | 3 | 4 | 5;
type YM2612Channel = OPNFmChannel;
type YM2612Operator = 0 | 1 | 2 | 3;
type YM2612Algorithm = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type YM2612Feedback = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type YM2612Ams = 0 | 1 | 2 | 3;
type YM2612Pms = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type YM2612LfoFrequency = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * One logical YM2612 channel preset used by `fm.setPreset()`.
 */
type YM2612Preset = {
  algorithm?: YM2612Algorithm;
  feedback?: YM2612Feedback;
  ams?: YM2612Ams;
  pms?: YM2612Pms;
  pan?: {
    left?: boolean;
    right?: boolean;
  };
  lfo?: {
    enabled?: boolean;
    frequency?: YM2612LfoFrequency;
  };
  operators?: [
    YM2612OperatorParams?,
    YM2612OperatorParams?,
    YM2612OperatorParams?,
    YM2612OperatorParams?
  ];
};

/**
 * Built-in preset names shipped with the playground.
 *
 * This makes
 * `FM_PRESETS["..."]`
 * and
 * `pg.presets["..."]`
 * much easier for Monaco to complete.
 */
type MegaDriveFmPresetName =
  | "sine"
  | "one-op-basic"
  | "two-op-bell"
  | "fm-bell"
  | "two-op-organ"
  | "four-op-brass"
  | "four-op-pad"
  | "coin"
  | "laser"
  | "hit"
  | "ritual-bell"
  | "fm-bass"
  | "fm-pluck"
  | "fm-lead"
  | "fm-electric-piano"
  | "fm-strings";

/**
 * Built-in YM2612 preset table used by playground examples and helpers.
 */
type PlaygroundFMPresets = Record<MegaDriveFmPresetName, YM2612Preset>;
declare const FM_PRESETS: PlaygroundFMPresets;

/** Friendly YM2612 channel constants for readable examples. */
declare const CH1: 0;
declare const CH2: 1;
declare const CH3: 2;
declare const CH4: 3;
declare const CH5: 4;
declare const CH6: 5;
/** MIDI channels; these do not extend the physical FM channel count. */
declare const CH7: 6;
declare const CH8: 7;
declare const CH9: 8;
declare const CH10: 9;
declare const CH11: 10;
declare const CH12: 11;
declare const CH13: 12;
declare const CH14: 13;
declare const CH15: 14;
declare const CH16: 15;

/** Friendly logical operator constants for readable examples. */
declare const OP1: 0;
declare const OP2: 1;
declare const OP3: 2;
declare const OP4: 3;

/**
 * Common play helper options used by `play()` and `pg.play()`.
 * Beats follow shared BPM changes while the note is held; seconds do not.
 * Omitted length defaults to 0.2 seconds. Legacy duration is seconds.
 */
/** Explicit note lengths are mutually exclusive. Legacy duration retains its API's unit. */
type PlaygroundNoteLength =
  | {seconds: number; beats?: never; duration?: never}
  | {beats: number; seconds?: never; duration?: never}
  | {
      /** @deprecated Use seconds or beats. Legacy unit is seconds for play, beats for MIDI output.play. */
      duration?: number; seconds?: never; beats?: never
    };

type PlaygroundPlayOptions = PlaygroundNoteLength & {
  /** Logical FM channel in the selected mode: 3 on YM2203, 4 on YM2610, otherwise 6. */
  channel?: PlaygroundSelectedFmChannel;
  /** Built-in or host-provided preset name applied before playing the note. */
  preset?: MegaDriveFmPresetName | (string & {});
};

type PlaygroundSamplePlayOptions = {
  gain?: number;
  /** Nonzero speed: negative reverses playback. Linear interpolation. */
  playbackRate?: number;
  /** Source seconds skipped from the start; from the end for reverse playback. */
  offset?: number;
  /** Source seconds to play. Wall time depends on absolute playbackRate. */
  duration?: number;
  loop?: boolean;
  /** Loop bounds in source seconds from the original file start, even in reverse. */
  loopStart?: number;
  loopEnd?: number;
  /** Output seconds, independent of playbackRate. */
  fadeIn?: number;
  /** Output seconds; fades the natural end (if bounded) and explicit stop. */
  fadeOut?: number;
  pan?: number;
};

type PlaygroundSampleVoice = {
  name: string;
  stop(): void;
};

/** Worker returns PCM metadata; main execution retains decoded AudioBuffer access. */
type PlaygroundSampleInfo = { name: string; length: number; sampleRate: number; numberOfChannels: number; duration: number };
type PlaygroundSampleAPI = {
  load(source: string): Promise<AudioBuffer | PlaygroundSampleInfo>;
  load(name: string, source: string | ArrayBuffer | AudioBuffer): Promise<AudioBuffer | PlaygroundSampleInfo>;
  /** Load a Virtual FS audio file using its path as the sample name. */
  loadFile(path: string): Promise<AudioBuffer | PlaygroundSampleInfo>;
  play(name: string, options?: PlaygroundSamplePlayOptions): Promise<PlaygroundSampleVoice>;
  stop(name?: string): void;
  stopAll(): void;
  unload(name: string): boolean;
  isLoaded(name: string): boolean;
  get(name: string): AudioBuffer | PlaygroundSampleInfo | null;
  list(): string[];
};

type PlaygroundStreamPlayOptions = {
  gain?: number;
  playbackRate?: number;
  offset?: number;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  pan?: number;
};

type PlaygroundStreamEntry = {
  name: string;
  play(options?: PlaygroundStreamPlayOptions): Promise<void>;
  pause(): void;
  stop(): void;
};

type PlaygroundStreamAPI = {
  load(url: string): Promise<PlaygroundStreamEntry>;
  load(name: string, url: string): Promise<PlaygroundStreamEntry>;
  play(name: string, options?: PlaygroundStreamPlayOptions): Promise<PlaygroundStreamEntry>;
  pause(name?: string): void;
  stop(name?: string): void;
  unload(name: string): boolean;
  isLoaded(name: string): boolean;
  get(name: string): PlaygroundStreamEntry | null;
  list(): string[];
};

type PlaygroundNoiseType =
  | "white"
  | "pink"
  | "brown"
  | "gray"
  | "clip";

/** Native WASM noise; up to 32 voices. Dispose unused voices to free slots. */
type PlaygroundNoiseOptions = {
  /** Optional unsigned seed for repeatable noise generation. */
  seed?: number;
  type?: PlaygroundNoiseType;
  gain?: number;
  pan?: number;
  attack?: number;
  release?: number;
  autoStart?: boolean;
};

type NoiseControlOptions = {
  gain?: number;
  pan?: number;
  cutoff?: number;
  q?: number;
  slide?: number;
};

type PlaygroundNoiseVoice = {
  readonly type: PlaygroundNoiseType;
  attack: SimpleParamControl;
  release: SimpleParamControl;
  gain: AudioParamControl;
  pan: AudioParamControl;
  filter: {
    set(
      type: BiquadFilterType,
      frequency: number,
      q?: number
    ): void;
    cutoff: AudioParamControl;
    q: AudioParamControl;
  };
  start(): void;
  stop(): void;
  dispose(): void;
};

type PlaygroundNoiseAPI = {
  create(
    options?: PlaygroundNoiseOptions
  ): PlaygroundNoiseVoice;
  stopAll(): void;
};

type PlaygroundContext = Record<string, unknown>;

/** Options for `fx.gain()`. */
type GainFXOptions = {
  /** Default 1; range 0..2. */
  gain?: number;
};

/** Options for `fx.eq()`. */
type EqFXOptions = {
  /** Default 0; range -12..12. */
  bass?: number;
  /** Default 0; range -12..12. */
  mid?: number;
  /** Default 0; range -12..12. */
  treble?: number;
};




/** Options for `fx.bitcrusher()`. */
type BitcrusherFXOptions = {
  /** Default 8; range 2..16. */
  bitDepth?: number;
  /** Default 6; range 1..480. */
  holdFrames?: number;
  /** Default 0.5; range 0..1. */
  mix?: number;
};

/** Options for `fx.filter()`. */
type FilterFXOptions = {
  /** Default 1200; range 20..20000. */
  cutoff?: number;
  /** Default 0.707; range 0.2..12. */
  q?: number;
  type?: "lowpass" | "highpass" | "bandpass";
};

/** Options for `fx.delay()`. */
type DelayFXOptions = {
  /** Default 0.25; range 0.001..2. */
  time?: number;
  /** Default 0.35; range 0..0.9. */
  feedback?: number;
  /** Default 0.3; range 0..1. */
  mix?: number;
};

/** Options for `fx.distortion()`. */
type DistortionFXOptions = {
  /** Default 4; range 1..20. */
  drive?: number;
  /** Default 0.5; range 0..1. */
  mix?: number;
};

/** Options for `fx.compressor()`. */
type CompressorFXOptions = {
  /** Default -24; range -60..0. */
  threshold?: number;
  /** Default 4; range 1..20. */
  ratio?: number;
  /** Default 0.01; range 0.0001..0.2. */
  attack?: number;
  /** Default 0.25; range 0.01..2. */
  release?: number;
  /** Default 0; range -12..24. */
  makeup?: number;
};

/** Options for `fx.gate()`. */
type GateFXOptions = {
  /** Default 0.04; range 0.0001..1. */
  threshold?: number;
  /** Default 6; range 0..24. */
  hysteresis?: number;
  /** Default 0.005; range 0.0001..0.2. */
  attack?: number;
  /** Default 0.05; range 0..1. */
  hold?: number;
  /** Default 0.1; range 0.01..2. */
  release?: number;
};

/** Options for `fx.wobble()`. */
type WobbleFXOptions = {
  /** Default 800; range 20..10000. */
  cutoff?: number;
  /** Default 1100; range 0..12000. */
  depth?: number;
  /** Default 0.5; range 0.03125..16. */
  rate?: number;
  /** Default 0.707; range 0.2..8. */
  resonance?: number;
  /** Default 1; range 0..1. */
  mix?: number;
};

/** Options for `fx.flanger()`. */
type FlangerFXOptions = {
  /** Default 0.003; range 0.001..0.015. */
  time?: number;
  /** Default 0.002; range 0..0.01. */
  depth?: number;
  /** Default 1; range 0.03125..16. */
  rate?: number;
  /** Default 0.3; range 0..0.9. */
  feedback?: number;
  /** Default 0.5; range 0..1. */
  mix?: number;
};

/** Options for `fx.chorus()`. */
type ChorusFXOptions = {
  /** Default 0.02; range 0.01..0.04. */
  time?: number;
  /** Default 0.005; range 0..0.01. */
  depth?: number;
  /** Default 1; range 0.03125..16. */
  rate?: number;
  /** Default 0.5; range 0..1. */
  mix?: number;
};


/** Options for `fx.reverb()`. */
type ReverbFXOptions = {
  /** Default 0.2; range 0..1. */
  mix?: number;
  /** Default 0.7; range 0..0.98. */
  room?: number;
  /** Default 0.4; range 0..1. */
  damping?: number;
  /** Default 7200; range 200..20000. */
  tone?: number;
};

/** Options for `fx.slicer()`. */
type SlicerFXOptions = {
  /** Default 0.25; range 0.03125..16. */
  phase?: number;
  /** Default 0.5; range 0.05..0.95. */
  duty?: number;
  /** Default 0; range 0..1. */
  floor?: number;
  /** Default 1; range 0..1. */
  mix?: number;
};

/** Control wrapper for AudioParam-like values. */
type AudioParamControl = {
  get(): number;
  set(value: number): number;
  rampTo(value: number, seconds?: number): number;
};

/** Simple control wrapper used by some FX values. */
type SimpleParamControl = {
  get(): number;
  set(value: number): number;
};

type FXConnectTarget = AudioNode | { input: AudioNode };

/** Native C/WASM effect descriptor (not an AudioNode). Use fx.setChain to route. */
/** Native C/WASM effect descriptor (not an AudioNode). Use fx.setChain to route. */
type BaseFXUnit = {
  type: string;
  params: Record<string, unknown>;
  dispose(): void;
};

type FXBranch = {
  type: "chain";
  children: AnyFXUnit[];
};

type GainFXUnit = BaseFXUnit & {
  type: "gain";
  /** Linear multiplier: 0..10; 1 is unchanged. */
  gain: AudioParamControl;
};

type EqFXUnit = BaseFXUnit & {
  type: "eq";
  bass: AudioParamControl;
  mid: AudioParamControl;
  treble: AudioParamControl;
};




type BitcrusherFXUnit = BaseFXUnit & {
  type: "bitcrusher";
  bitDepth: AudioParamControl;
  holdFrames: AudioParamControl;
  mix: AudioParamControl;
};

type FilterFXUnit = BaseFXUnit & {
  type: "filter";
  cutoff: AudioParamControl;
  q: AudioParamControl;
};

type DelayFXUnit = BaseFXUnit & {
  type: "delay";
  time: AudioParamControl;
  feedback: AudioParamControl;
  mix: AudioParamControl;
};

type DistortionFXUnit = BaseFXUnit & {
  type: "distortion";
  drive: AudioParamControl;
  mix: AudioParamControl;
};

type CompressorFXUnit = BaseFXUnit & {
  type: "compressor";
  threshold: AudioParamControl;
  ratio: AudioParamControl;
  attack: AudioParamControl;
  release: AudioParamControl;
  makeup: AudioParamControl;
};

type GateFXUnit = BaseFXUnit & {
  type: "gate";
  threshold: AudioParamControl;
  hysteresis: AudioParamControl;
  attack: AudioParamControl;
  hold: AudioParamControl;
  release: AudioParamControl;
};

type WobbleFXUnit = BaseFXUnit & {
  type: "wobble";
  cutoff: AudioParamControl;
  depth: AudioParamControl;
  rate: AudioParamControl;
  resonance: AudioParamControl;
  mix: AudioParamControl;
};

type FlangerFXUnit = BaseFXUnit & {
  type: "flanger";
  time: AudioParamControl;
  depth: AudioParamControl;
  rate: AudioParamControl;
  feedback: AudioParamControl;
  mix: AudioParamControl;
};

type ChorusFXUnit = BaseFXUnit & {
  type: "chorus";
  time: AudioParamControl;
  depth: AudioParamControl;
  rate: AudioParamControl;
  mix: AudioParamControl;
};


type ReverbFXUnit = BaseFXUnit & {
  type: "reverb";
  mix: AudioParamControl;
  room: AudioParamControl;
  damping: AudioParamControl;
  tone: AudioParamControl;
};

type SlicerFXUnit = BaseFXUnit & {
  type: "slicer";
  phase: AudioParamControl;
  duty: AudioParamControl;
  floor: AudioParamControl;
  mix: AudioParamControl;
};

type ParallelFXUnit = BaseFXUnit & {
  type: "parallel";
  children: Array<FXBranch | AnyFXUnit>;
};

type AnyFXUnit =
  | GainFXUnit
  | EqFXUnit
  | BitcrusherFXUnit
  | FilterFXUnit
  | DelayFXUnit
  | DistortionFXUnit
  | CompressorFXUnit
  | GateFXUnit
  | WobbleFXUnit
  | FlangerFXUnit
  | ChorusFXUnit
  | ReverbFXUnit
  | SlicerFXUnit
  | ParallelFXUnit;

/** Unsigned 8-bit mono PCM; 128 is silence. Promises acknowledge commands, not playback completion. */
type YM2612PcmDac = {
  setSample(name: string, data: Uint8Array | ArrayBuffer | number[], options: {sampleRate: number}): Promise<void>;
  playFromSample(name: string, options?: {offset?: number; size?: number; pan?: 'both' | 'left' | 'right'; when?: number}): Promise<void>;
  play(data: Uint8Array | ArrayBuffer | number[], options: {sampleRate: number; offset?: number; size?: number; pan?: 'both' | 'left' | 'right'; when?: number}): Promise<void>;
  stop(): Promise<void>;
  removeSample(name: string): Promise<void>;
};
type FMApi = PlaygroundChipClock & {
  /** YM2612 mode: registered mono PCM playback through CH6. when is absolute audio-clock seconds; omit for immediate playback. */
  readonly dac: YM2612PcmDac;
  /** Reset YM2612 state. */
  reset(): void;
  /** Apply one preset to one YM2612 channel. */
  setPreset(channel: YM2612Channel, preset: YM2612Preset): void;
  /** Partially update one logical operator `0..3`. */
  setOperator(channel: YM2612Channel, operator: YM2612Operator, params: YM2612OperatorParams): void;
  /** Apply entries in array order; fields within each entry use setOperator's order. All OPN FM chips. */
  setOperators(channel: YM2612Channel, entries: Array<[YM2612Operator, YM2612OperatorParams]>): void;
  /** Set channel algorithm and feedback. */
  setAlgo(channel: YM2612Channel, algorithm: YM2612Algorithm, feedback?: YM2612Feedback): void;
  /** Set left/right output plus AMS/PMS on one channel. */
  setPan(channel: YM2612Channel, left: boolean, right: boolean, ams?: YM2612Ams, pms?: YM2612Pms): void;
  /** Set chip-level LFO enable and frequency. */
  setLfo(enabled: boolean, frequency: number): void;
  /** Enable or disable YM2612 channel 3 special / 3-slot mode. */
  setChannel3SpecialMode(enabled: boolean): void;
  /** Set one logical channel 3 operator `0..3` frequency while special mode is active. */
  setChannel3SpecialFrequency(operator: YM2612Operator, block: number, fnum: number): void;
  /** Enable or disable the YM2612 DAC playback path on channel 6. */
  setDacEnabled(enabled: boolean): void;
  /** Set frequency in Hz, without KEY ON. */
  setFrequency(channel: YM2612Channel, hz: number): void;
  /** Set a note name or integer MIDI 0..127, without KEY ON. */
  setNote(channel: YM2612Channel, note: string | number): void;
  /** Explicit raw hardware pitch, without KEY ON. */
  setBlockFnum(channel: YM2612Channel, block: number, fnum: number): void;
  /** Compatibility form: three arguments specify raw BLOCK / F-NUM. */
  setFrequency(channel: YM2612Channel, block: number, fnum: number): void;
  /** Trigger KEY ON on one channel. */
  keyOn(channel: YM2612Channel, operators?: YM2612Operator[]): void;
  /** Trigger KEY OFF on one channel. */
  keyOff(channel: YM2612Channel, operators?: YM2612Operator[]): void;
  /** Write one 8-bit DAC sample byte to YM2612 register 0x2A. */
  writeDac(value: number): void;
  /** Set a note name or integer MIDI 0..127 and trigger KEY ON. */
  noteOn(channel: YM2612Channel, note: string | number): void;
  /** Explicit raw pitch plus KEY ON. */
  noteOnRaw(channel: YM2612Channel, block: number, fnum: number): void;
  /** Compatibility form: three arguments specify raw BLOCK / F-NUM. */
  noteOn(channel: YM2612Channel, block: number, fnum: number): void;
  /** Trigger note off on one channel. */
  noteOff(channel: YM2612Channel): void;
  /** Compact YM2612 register write: port, register, value. */
  write(port: number, register: number, value: number): void;
  /** Queue raw YM2612 writes at AudioContext times. */
  scheduleWrites(entries: Array<{ time: number; port: number; register: number; value: number }>): void;
  /** Write one YM2612 register number to the address port. */
  writeAddress(port: number, register: number): void;
  /** Write one value to the YM2612 data port. */
  writeData(value: number): void;
  /** Read one low-level YM2612 value. */
  read(offset: number): number;
  /** Read YM2612 status register. */
  readStatus(): number;
  /** Return current YM2612 IRQ line state. */
  getIrq(): boolean;
  /** Raw write alias for low-level experiments. */
  rawWrite(port: number, register: number, value: number): void;
};

/** The selected mode's primary FM chip; independent chips retain their own API. */
type PlaygroundNativeSelectedChip = 'gameboy' | 'nes' | 'snes' | 'x68000' | 'huc6280' | 'game-gear' | 'master-system' | 'dx7' | 'msx' | 'msx-audio' | PlaygroundOplChip;
type PlaygroundGenesisSelectedChip = 'ym2612' | 'mega-cd';
type PlaygroundSelectedFmChannel = TetoricaSelectedChip extends PlaygroundNativeSelectedChip ? never
  : TetoricaSelectedChip extends 'ym2203' ? 0 | 1 | 2
  : TetoricaSelectedChip extends 'ym2610' ? 0 | 1 | 2 | 3
  : OPNFmChannel;
interface YM2612FMApi extends FMApi {}
interface YM2203FMApi extends PlaygroundOPNFm<0 | 1 | 2, false> {}
interface YM2608FMApi extends PlaygroundOPNFm<OPNFmChannel> {}
interface YM2610FMApi extends PlaygroundOPNFm<0 | 1 | 2 | 3> {}
interface YM2610BFMApi extends PlaygroundOPNFm<OPNFmChannel> {}
type PlaygroundSelectedFm = {
  ym2612: YM2612FMApi;
  'mega-cd': YM2612FMApi;
  ym2203: YM2203FMApi;
  ym2608: YM2608FMApi;
  ym2610: YM2610FMApi;
  ym2610b: YM2610BFMApi;
  gameboy: never;
  nes: never;
  snes: never;
  x68000: never;
  huc6280: never;
  'game-gear': never;
  'master-system': never;
  dx7: never;
  ym3526: never;
  ym3812: never;
  y8950: never;
  ymf262: never;
  msx: never;
  'msx-audio': never;
}[TetoricaSelectedChip];
declare const fm: PlaygroundSelectedFm;
/** The primary Game Boy APU, initialized and shared by this mode. */
declare const gameboy: PlaygroundPrimaryGameboy;
/** Primary NES APU with FDS enabled. */
declare const nes: PlaygroundPrimaryNes;
/** Primary CPU-free SNES S-DSP. */
declare const snes: PlaygroundPrimarySnes;
/** Primary X68000 YM2151 OPM. */
declare const opm: PlaygroundPrimaryOpm;
/** Primary PC Engine six-channel wavetable PSG. */
declare const pce: PlaygroundPrimaryHuc6280;
/** Primary MSFA DX7: six operators, 32 algorithms and 16 allocated voices. */
declare const dx7: PlaygroundPrimaryDx7;
/** Primary OPL family FM instrument, with physical zero-based channels. */
declare const opl: PlaygroundPrimaryOpl<PlaygroundSelectedOplChip>;
declare const OPL_PRESETS: PlaygroundOplPresets<PlaygroundSelectedOplChip>;
/** Master System's YM2413. Instrument 0 uses the one chip-wide shared user patch. */
declare const opll: PlaygroundPrimaryYm2413;
declare const OPLL_INSTRUMENTS: readonly string[];
declare const OPLL_USER_PRESETS: Readonly<Record<'sine'|'bell',PlaygroundYm2413UserPatch>>;
/** MSX's three-channel AY PSG, with shared noise and hardware envelope. */
declare const ay: PlaygroundPrimaryAy8910;

type PSGApi = {
  /** Configure Hz without triggering or changing attenuation. */
  setFrequency(channel: 0 | 1 | 2, hz: number): number;
  /** Configure a note name or integer MIDI 0..127 without triggering. */
  setNote(channel: 0 | 1 | 2, note: string | number): number;
  /** Restore configured attenuation, retaining pitch. */
  keyOn(channel: 0 | 1 | 2): void;
  /** Silence while remembering configured attenuation and pitch. */
  keyOff(channel: 0 | 1 | 2): void;
  noteOn(channel: 0 | 1 | 2, note: string | number): void;
  /** Exact 10-bit period (0..1023), without changing attenuation. Writes latch then data. */
  setPeriod(channel: 0 | 1 | 2, period: number): number;
  /** 0 = loudest, 15 = silent. Channel 3 is noise; no noise reset. */
  setAttenuation(channel: 0 | 1 | 2 | 3, attenuation: number): void;
  /** Noise control only; resets the noise shift register without changing attenuation. */
  setNoise(options?: {type?: "white" | "periodic"; rate?: "low" | "medium" | "high" | "tone3"}): number;
  /** Send one raw Sega PSG (SN76489-compatible) register byte. */
  write(value: number): void;
  /** Reset only the Sega PSG state. */
  reset(): void;
  /** Reset both PSG and YM2612 state. */
  resetAll(): void;
  /** Set and enable one tone channel. Provide period, frequency, or note. */
  tone(channel: 0 | 1 | 2, options: {
    period?: number;
    frequency?: number;
    note?: string;
    volume?: number;
    attenuation?: number;
  }): number;
  /** Silence one tone channel while keeping its last frequency. */
  off(channel: 0 | 1 | 2): void;
  /** Set and enable the PSG noise channel. */
  noise(options?: {
    type?: "white" | "periodic";
    rate?: "low" | "medium" | "high" | "tone3";
    volume?: number;
    attenuation?: number;
  }): number;
  /** Change PSG noise volume without resetting its shift register. */
  noiseVolume(volume: number): void;
  /** Silence the PSG noise channel. */
  noiseOff(): void;
};

type PlaygroundSelectedPsg = TetoricaSelectedChip extends 'game-gear' ? PlaygroundPrimaryGameGearPsg
  : TetoricaSelectedChip extends 'master-system' ? PlaygroundPrimaryMasterSystemPsg : PSGApi;
declare const psg: PlaygroundSelectedPsg;
declare const PSG1: 0;
declare const PSG2: 1;
declare const PSG3: 2;

/** Write one PSG tone channel period + attenuation pair. Channel is 0..2. */
declare function psgTone(channel: number, period: number, attenuation?: number): void;
/** Write PSG noise mode + attenuation. Mode is the raw 3-bit noise register value 0..7. */
declare function psgNoise(mode: number, attenuation?: number): void;

/** PC-98 OPN/OPNA and Neo Geo modes: SSG tone/noise on the same primary chip as fm. */
declare const ssg: PlaygroundSelectedSSG;
/** PC-98 OPNA mode: built-in rhythm voices on the primary YM2608. */
declare const rhythm: PlaygroundYm2608['rhythm'];
/** Primary ADPCM-B; Neo Geo modes also expose this as adpcmB. Await memory uploads. */
declare const adpcm: PlaygroundSelectedADPCM;
/** Neo Geo YM2610/YM2610B modes: six ADPCM-A voices on the primary chip. */
declare const adpcmA: PlaygroundCreatedYm2610['adpcmA'];
/** Neo Geo YM2610/YM2610B modes: primary ADPCM-B, identical to adpcm. */
declare const adpcmB: PlaygroundCreatedYm2610['adpcmB'];

declare const sample: PlaygroundSampleAPI;
declare const stream: PlaygroundStreamAPI;
declare const noise: PlaygroundNoiseAPI;
declare function control(
  voice: PlaygroundNoiseVoice,
  options: NoiseControlOptions
): void;

/** process executes in AudioWorklet; captured outer variables are unavailable. */
type LiveFXOptions<C extends object = Record<string, unknown>> = {
  context?: C;
  resetState?: boolean;
  process(input: Float32Array[], output: Float32Array[], state: Record<string, any>, context: C): void;
};
/** Named effects omitted from the next successful Run are removed. Same names retain DSP state unless resetState is set. */
declare function liveFx<C extends object>(name: string, options: LiveFXOptions<C>): void;
type FXApi = {
  liveFx: typeof liveFx;
  /** Queues a partial context update without resetting DSP state. */
  updateContext(name: string, patch: object): void;
  removeLiveFx(name: string): void;
  /** Create a gain effect unit. */
  gain(options?: GainFXOptions): GainFXUnit;
  /** Create a simple 3-band EQ effect unit. */
  eq(options?: EqFXOptions): EqFXUnit;
  /** Create a bitcrusher / sample-hold effect unit. */
  bitcrusher(options?: BitcrusherFXOptions): BitcrusherFXUnit;
  /** Create a filter effect unit. */
  filter(options?: FilterFXOptions): FilterFXUnit;
  /** Create a delay effect unit. */
  delay(options?: DelayFXOptions): DelayFXUnit;
  /** Create a simple wave-shaper distortion effect unit. */
  distortion(options?: DistortionFXOptions): DistortionFXUnit;
  /** Create a native envelope compressor effect unit. */
  compressor(options?: CompressorFXOptions): CompressorFXUnit;
  /** Create a simple noise-gate style effect unit. */
  gate(options?: GateFXOptions): GateFXUnit;
  /** Create an LFO-driven filter wobble effect unit. */
  wobble(options?: WobbleFXOptions): WobbleFXUnit;
  /** Create a short-delay modulation flanger effect unit. */
  flanger(options?: FlangerFXOptions): FlangerFXUnit;
  /** Create a stereo modulated-delay chorus effect unit. */
  chorus(options?: ChorusFXOptions): ChorusFXUnit;
  /** Create a reverb effect unit. */
  reverb(options?: ReverbFXOptions): ReverbFXUnit;
  /** Describe one serial branch to be used inside fx.parallel(...). */
  branch(...effects: AnyFXUnit[]): FXBranch;
  /** Split one input into multiple branches and mix them back together. */
  parallel(...branches: Array<FXBranch | AnyFXUnit>): ParallelFXUnit;
  /** Create a BPM-based slicer / gate effect unit. */
  slicer(options?: SlicerFXOptions): SlicerFXUnit;
  /** Replace the current master FX chain. */
  setChain(effects: AnyFXUnit[]): void;
  /** Clear the current master FX chain. */
  clear(): void;
};

declare const fx: FXApi;
declare const context: PlaygroundContext;

/**
 * Create a named repeating loop. Re-running an existing name replaces its
 * callback at the next iteration; the current iteration finishes first.
 * Names absent from the next successful Run are cancelled at their next wait.
 */
declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
/** Editable-target metadata is also available when keyboard events cross into Worker. */
interface PlaygroundKeyboardEvent extends KeyboardEvent {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly editable: boolean;
}
/** Register a named key-down handler for the current Playground run. */
declare function onKeyboardPressKey(name: string, fn: (event: PlaygroundKeyboardEvent) => void): void;
/** Register a named key-up handler for the current Playground run. */
declare function onKeyboardReleaseKey(name: string, fn: (event: PlaygroundKeyboardEvent) => void): void;
/** Register cleanup that runs once after all named live loops and keyboard handlers disappear. */
declare function liveCleanup(names: string[], fn: () => Promise<void> | void): void;
type PlaygroundLivePrepareAPI = {
  fx: FXApi;
  sample: PlaygroundSampleAPI;
  stream: PlaygroundStreamAPI;
  noise: PlaygroundNoiseAPI;
  log: (...args: unknown[]) => void;
} & (TetoricaSelectedChip extends PlaygroundNativeSelectedChip ? PlaygroundSelectedNativeAPI : {fm: PlaygroundSelectedFm})
  & (TetoricaSelectedChip extends PlaygroundGenesisSelectedChip ? {psg: PSGApi} : {}) & PlaygroundSelectedOpnSectionsAPI;
/** Prepare shared live state once and reuse it across runs. */
declare function livePrepare(name: string, fn: (context: PlaygroundLivePrepareAPI) => Promise<any> | any): Promise<any>;
/** Play one note through the current synth setup. */
declare function play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
/** Compact write to the selected FM chip. Defaults to port 0 when omitted. */
declare function write(register: number, value: number): void;
/** Compact write to the selected FM chip with explicit port. */
declare function write(port: number, register: number, value: number): void;
/** Wait for a number of seconds. */
declare function sleep(seconds: number): Promise<void>;
interface PlaygroundSecondsTimeline {
  /**
   * Wait for elapsed seconds from createTimeline(), independent of BPM.
   * Positions must be finite, nonnegative and nondecreasing. Late waits yield
   * without adding the lateness to later positions. Stop cancels the wait.
   */
  waitUntil(seconds: number): Promise<void>;
}
/**
 * Anchor a new elapsed-seconds timeline now. Create it after loading resources.
 * Main uses the audio clock; Worker uses its monotonic clock. This resumes
 * JavaScript and is not a sample-accurate audio reservation.
 */
declare function createTimeline(): PlaygroundSecondsTimeline;
/** Wait for VGM-style sample units. Default sampleRate is 44100. */
declare function sleepSamples(samples: number, sampleRate?: number): Promise<void>;
/**
 * Return this liveLoop's cumulative cursor on the shared 44100-Hz sample timeline.
 * New loops join at the current timeline position, so their first value may be nonzero.
 * Pass this value as startSamples to scheduleWritesSamples; it is not a song-relative seek position.
 */
declare function beginSampleSchedule(): number;
/** Queue [offsetSamples, port, register, value] writes for the current VGM cycle. */
/** FM tuples: [offset, port, register, value]; PSG tuples: [offset, "psg", byte]. Offsets use 44100 Hz samples. */
declare function scheduleWritesSamples(startSamples: number, entries: Array<[number, number, number, number] | [number, "psg", number]>): void;
declare const dac: {
  /** Load packed DAC records: little-endian uint32 sample offset + uint8 value. */
  load(name: string, data: ArrayBuffer | Uint8Array): Promise<void>;
  loadBase64(name: string, encoded: string): Promise<void>;
  playStream(name: string, options?: { atSamples?: number }): void;
  schedule(startSamples: number, entries: Array<[number, number]>): void;
  scheduleBase64(startSamples: number, encoded: string): void;
};
/** Wait for elapsed beats on the shared clock; outstanding waits follow setBpm changes. */
declare function beat(beats?: number): Promise<void>;
/** Wait for the next integer position on the shared beat clock, preserving phase across BPM changes. */
declare function nextBeat(): Promise<void>;
/**
 * Call onUpdate repeatedly over the requested duration, then finish at progress = 1.
 * @param duration Exactly one of {seconds} or {beats}. Seconds ignore BPM;
 * beats follow shared setBpm changes, including during the animation.
 * @param onUpdate Receives progress from 0 (start) to 1 (end), not elapsed seconds.
 * At progress = 0.5, half the selected seconds/beats have elapsed.
 * An async callback is awaited before the next update. Positive durations call 0
 * and end at 1 exactly once. Zero duration calls only 1. Cancellation rejects
 * without forcing a final callback. Durations must be finite and nonnegative.
 * @returns Resolves after the animation completes; `await tween(...)` waits for it.
 * @example
 * const durationSeconds = 4;
 * await tween({seconds: durationSeconds}, progress => {
 *   const elapsedSeconds = progress * durationSeconds; // 0 to 4 seconds
 *   const fnum = 679 + 13 * Math.sin(2 * Math.PI * 4.57 * elapsedSeconds);
 *   fm.setFrequency(CH1, 2, Math.round(fnum));
 * });
 */
type PlaygroundTweenDuration = {seconds: number; beats?: never} | {beats: number; seconds?: never};
declare function tween(duration: PlaygroundTweenDuration, onUpdate: (progress: number) => void | Promise<void>): Promise<void>;
/** Numeric duration is seconds, independent of BPM. onUpdate receives progress from 0 to 1. */
declare function tween(durationSeconds: number, onUpdate: (progress: number) => void | Promise<void>): Promise<void>;
/**
 * Set the shared tempo used by beat() and nextBeat().
 * @param bpm Beats per minute. For example, 120 means 120 quarter-note beats per minute.
 * Shared by every liveLoop in the active runtime. Changes take effect immediately
 * without changing the current beat position. Beat waits, beat-length notes,
 * beat tweens and beat-synchronised FX follow changes; seconds/samples do not.
 */
declare function setBpm(bpm: number): void;
/** Build an array of note names from one named scale. */
declare function scale(root: string, name: string, octaves?: number): string[];
/** Build a simple chord from a root note. */
declare function chord(root: string, name: "major" | "minor" | "major7" | "minor7" | "dominant7"): string[];
/** Note name or MIDI pitch at A4=440 Hz, using the selected chip and current master clock. */
declare function noteToBlockFnum(note: string | number): { block: number; fnum: number };
/** Convert Hz using the selected FM chip and its current master clock; clock overrides the master Hz. */
declare function hzToBlockFnum(hz: number, clock?: number): { block: number; fnum: number };
/** Interpolate between two numbers. */
declare function lerp(a: number, b: number, t: number): number;
/** Interpolate between two note names and return YM2612 BLOCK / F-NUM. */
declare function noteLerp(from: string, to: string, t: number): { block: number; fnum: number };
/** Pick one random item from an array. */
declare function choose<T>(values: T[]): T;
/** Return the next item in a repeating sequence. */
declare function cycle<T>(values: T[]): T;
/** Return the next item in a repeating named sequence. */
declare function cycle<T>(key: string, values: T[]): T;
/** Return a random float from 0 to 1. */
declare function rand(): number;
/** Return a random float in the half-open range [min, max). */
declare function rrange(min: number, max: number): number;
/** Return a random integer in the inclusive range. */
declare function randInt(min: number, max: number): number;
/** Stop one named live loop. */
declare function stopLoop(name: string): void;
/** Stop all live loops. */
declare function stopAllLoops(): void;
/** Stop all sounding notes and playback state. */
declare function stopAll(): void;
/** Set the script's master gain. 1.0 = unity; multiplied by the UI Vol, which is retained across Run. */
declare function setMasterVolume(volume: number): number;
/** Read the script's master gain, independently of the UI Vol. */
declare function getMasterVolume(): number;

/** Sets the AudioWorklet scheduling margin used by DAC streams. */
declare function setDacLookahead(seconds: number): number;

/** Returns the current DAC scheduling margin in seconds. */
declare function getDacLookahead(): number;
/** Write one line into the playground console area. */
declare function log(...args: unknown[]): void;
/** Read a text or binary file stored in the current Virtual FS project. */
declare function file(path: string): Promise<string>;
/** Read a binary file stored in the current Virtual FS project. */
declare function file(
  path: string,
  options: { type: "arrayBuffer" }
): Promise<ArrayBuffer>;
/** Read and parse a JSON file stored in the current Virtual FS project. */
declare function file<T = unknown>(
  path: string,
  options: { type: "json" }
): Promise<T>;
/** Read a text file stored in the current Virtual FS project. */
declare function file(
  path: string,
  options: { type: "text" }
): Promise<string>;
/** Convert 42-byte TFI data into a preset accepted by `fm.setPreset()`. */
declare function tfiToPreset(data: ArrayBuffer | Uint8Array): YM2612Preset;
/** Convert 43-byte VGI data into a preset accepted by `fm.setPreset()`. */
declare function vgiToPreset(data: ArrayBuffer | Uint8Array): YM2612Preset;
/** Console methods captured by the Playground Console tab. */
interface Console {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
declare var console: Console;
/** Browser timer helper available in playground examples. */
declare function setInterval(handler: () => void, timeout?: number): number;
/** Browser timer helper available in playground examples. */
declare function clearInterval(id: number): void;

type PlaygroundChannelConstants = {
  CH1: 0;
  CH2: 1;
  CH3: 2;
  CH4: 3;
  CH5: 4;
  CH6: 5;
  CH7: 6;
  CH8: 7;
  CH9: 8;
  CH10: 9;
  CH11: 10;
  CH12: 11;
  CH13: 12;
  CH14: 13;
  CH15: 14;
  CH16: 15;
};
type PlaygroundSelectedChannelConstants = Pick<PlaygroundChannelConstants,
  TetoricaSelectedChip extends PlaygroundNativeSelectedChip ? never
  : TetoricaSelectedChip extends 'ym2203' ? 'CH1' | 'CH2' | 'CH3'
  : TetoricaSelectedChip extends 'ym2610' ? 'CH1' | 'CH2' | 'CH3' | 'CH4'
  : TetoricaSelectedChip extends PlaygroundGenesisSelectedChip ? keyof PlaygroundChannelConstants
  : 'CH1' | 'CH2' | 'CH3' | 'CH4' | 'CH5' | 'CH6'>;
type PlaygroundSelectedPsgAPI = TetoricaSelectedChip extends PlaygroundGenesisSelectedChip ? {
  /** Raw Sega PSG API, mixed into the same output as fm. */
  psg: PSGApi;
  psgTone: (channel: number, period: number, attenuation?: number) => void;
  psgNoise: (mode: number, attenuation?: number) => void;
  PSG1: 0;
  PSG2: 1;
  PSG3: 2;
} : TetoricaSelectedChip extends 'game-gear' | 'master-system' ? {
  psg: PlaygroundSelectedPsg;
  PSG1: 0;
  PSG2: 1;
  PSG3: 2;
} : {};
type PlaygroundSelectedSSG = TetoricaSelectedChip extends 'ym2203' | 'ym2608' | 'ym2610' | 'ym2610b'
  ? PlaygroundYm2608['ssg'] : never;
type PlaygroundSelectedADPCM = TetoricaSelectedChip extends 'ym2608'
  ? PlaygroundYm2608['adpcm']
  : TetoricaSelectedChip extends 'ym2610' | 'ym2610b' ? PlaygroundCreatedYm2610['adpcmB']
  : TetoricaSelectedChip extends 'x68000' ? PlaygroundPrimaryOki6258 : never;
/** Built-in OPN sections share the primary fm chip and clock. */
type PlaygroundSelectedOpnSectionsAPI = TetoricaSelectedChip extends 'ym2203'
  ? Pick<PlaygroundCreatedYm2203, 'ssg'>
  : TetoricaSelectedChip extends 'ym2608'
    ? Pick<PlaygroundYm2608, 'ssg' | 'rhythm' | 'adpcm'>
    : TetoricaSelectedChip extends 'ym2610' | 'ym2610b'
      ? Pick<PlaygroundCreatedYm2610, 'ssg' | 'adpcmA' | 'adpcmB' | 'adpcm'> : {};

type PlaygroundAPIBase = {
  mixer: PlaygroundMixer;
  /** Track a liveLoop task; rejection interrupts its waits and ends that loop. */
  trackAsync(task: PromiseLike<unknown>): void;
  createSoundChip: typeof createSoundChip;
  useSoundChip: typeof useSoundChip;
  inputAudio: typeof inputAudio;
  keyboard: PlaygroundMusicalKeyboard;
  createSampleInstrument: typeof createSampleInstrument;
  midi: PlaygroundMidi;
  /** Primary FM API for the selected mode. */
  fm: PlaygroundSelectedFm;
  /** Master FX helper API. */
  fx: FXApi;
  /** Shared mutable object that survives re-runs in the same playground session. */
  context: PlaygroundContext;
  /** Preloaded sample playback API. */
  sample: PlaygroundSampleAPI;
  /** Streamed BGM-style playback API. */
  stream: PlaygroundStreamAPI;
  /** Looping noise-source helper for ambient beds. */
  noise: PlaygroundNoiseAPI;
  control: (
    voice: PlaygroundNoiseVoice,
    options: NoiseControlOptions
  ) => void;
  /** Built-in preset table. */
  presets: PlaygroundFMPresets;
  /** Convert 42-byte TFI data into a preset accepted by `fm.setPreset()`. */
  tfiToPreset: (data: ArrayBuffer | Uint8Array) => YM2612Preset;
  vgiToPreset: (data: ArrayBuffer | Uint8Array) => YM2612Preset;
  /** Play one note through the current synth setup. */
  play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
  write: {
    (register: number, value: number): void;
    (port: number, register: number, value: number): void;
  };
  sleep: (seconds: number) => Promise<void>;
  createTimeline: typeof createTimeline;
  sleepSamples: (samples: number, sampleRate?: number) => Promise<void>;
  /** Shared 44100-Hz timeline cursor; a newly started loop may begin at a nonzero value. */
  beginSampleSchedule: () => number;
  scheduleWritesSamples: (startSamples: number, entries: Array<[number, number, number, number] | [number, "psg", number]>) => void;
  beat: (beats?: number) => Promise<void>;
  nextBeat: () => Promise<void>;
  /** Animate over {seconds} or {beats}; progress is 0..1. Beat durations follow shared BPM changes. */
  tween: typeof tween;
  setBpm: (bpm: number) => void;
  liveFx: typeof liveFx;
  /** Same-name updates take effect at the next iteration, preserving the current iteration. */
  liveLoop: (name: string, fn: () => Promise<void> | void) => void;
  onKeyboardPressKey: (name: string, fn: (event: PlaygroundKeyboardEvent) => void) => void;
  onKeyboardReleaseKey: (name: string, fn: (event: PlaygroundKeyboardEvent) => void) => void;
  livePrepare: typeof livePrepare;
  scale: (root: string, name: string, octaves?: number) => string[];
  chord: (root: string, name: "major" | "minor" | "major7" | "minor7" | "dominant7") => string[];
  noteToBlockFnum: (note: string | number) => { block: number; fnum: number };
  hzToBlockFnum: (hz: number, clock?: number) => { block: number; fnum: number };
  noteLerp: (from: string, to: string, t: number) => { block: number; fnum: number };
  choose: <T>(values: T[]) => T;
  cycle: {
    <T>(values: T[]): T;
    <T>(key: string, values: T[]): T;
  };
  rand: () => number;
  rrange: (min: number, max: number) => number;
  randInt: (min: number, max: number) => number;
  lerp: (a: number, b: number, t: number) => number;
  stopLoop: (name: string) => void;
  stopAllLoops: () => void;
  stopAll: () => void;
  setMasterVolume: (volume: number) => number;
  getMasterVolume: () => number;
  setTiming: typeof setTiming;
  getTiming: typeof getTiming;
  setDacLookahead: (seconds: number) => number;
  getDacLookahead: () => number;
  log: (...args: unknown[]) => void;
} & PlaygroundSelectedChannelConstants & PlaygroundSelectedPsgAPI & PlaygroundSelectedOpnSectionsAPI;

type PlaygroundFmConvenienceName = 'fm' | 'midi' | 'presets' | 'tfiToPreset' | 'vgiToPreset'
  | 'play' | 'write' | 'scheduleWritesSamples' | 'noteToBlockFnum' | 'hzToBlockFnum' | 'noteLerp'
  | 'setDacLookahead' | 'getDacLookahead';
type PlaygroundSelectedNativeAPI = TetoricaSelectedChip extends 'gameboy' ? {gameboy: PlaygroundPrimaryGameboy}
  : TetoricaSelectedChip extends 'msx' ? {ay:PlaygroundPrimaryAy8910;opll:PlaygroundPrimaryYm2413;OPLL_INSTRUMENTS:readonly string[];OPLL_USER_PRESETS:Readonly<Record<'sine'|'bell',PlaygroundYm2413UserPatch>>}
  : TetoricaSelectedChip extends 'msx-audio' ? {ay:PlaygroundPrimaryAy8910;opll:PlaygroundPrimaryYm2413;opl:PlaygroundPrimaryOpl<'y8950'>;OPL_PRESETS:PlaygroundOplPresets<'y8950'>;OPLL_INSTRUMENTS:readonly string[];OPLL_USER_PRESETS:Readonly<Record<'sine'|'bell',PlaygroundYm2413UserPatch>>}
  : TetoricaSelectedChip extends 'nes' ? {nes: PlaygroundPrimaryNes}
  : TetoricaSelectedChip extends 'snes' ? {snes: PlaygroundPrimarySnes}
  : TetoricaSelectedChip extends 'x68000' ? {opm: PlaygroundPrimaryOpm; adpcm: PlaygroundPrimaryOki6258}
  : TetoricaSelectedChip extends 'huc6280' ? {pce: PlaygroundPrimaryHuc6280}
  : TetoricaSelectedChip extends 'dx7' ? {dx7: PlaygroundPrimaryDx7}
  : TetoricaSelectedChip extends PlaygroundOplChip ? {opl: PlaygroundPrimaryOpl<TetoricaSelectedChip>; OPL_PRESETS:PlaygroundOplPresets<TetoricaSelectedChip>}
  : TetoricaSelectedChip extends 'master-system' ? {psg: PlaygroundSelectedPsg;opll:PlaygroundPrimaryYm2413;OPLL_INSTRUMENTS:readonly string[];OPLL_USER_PRESETS:Readonly<Record<'sine'|'bell',PlaygroundYm2413UserPatch>>}
  : TetoricaSelectedChip extends 'game-gear' ? {psg: PlaygroundSelectedPsg} : {};
type PlaygroundAPI = TetoricaSelectedChip extends PlaygroundNativeSelectedChip
  ? Omit<PlaygroundAPIBase, PlaygroundFmConvenienceName> & PlaygroundSelectedNativeAPI
  : PlaygroundAPIBase;

declare var pg: PlaygroundAPI;

/** Decoded audio chosen from a local file or recorded from the microphone. */
type PlaygroundSampleTarget = 'rf5c164' | 'adpcm-b' | 'gameboy-wave';
interface PlaygroundSampleAudio {
  sampleRate: number;
  channels: Float32Array[];
  rootMidi?: number;
  tuneCents?: number;
  loopEnabled?: boolean;
  loopStartFrame?: number;
  loopEndFrame?: number;
  target?: PlaygroundSampleTarget;
  /** Game Boy wave RAM: one user-selected cycle rendered to 32 four-bit samples. */
  waveform?: Uint8Array | number[];
  assetPath?: string;
}
interface PlaygroundAudioInput extends PlaygroundSampleAudio {
  name: string;
  source: 'file' | 'microphone';
}
/** Open the sample editor. asset defaults to /samples/sampler.sample.json;
 * edit:false reuses a saved asset without opening the editor. Cancel returns
 * null; Stop aborts. Original audio and neutral edit settings remain separate. */
declare function inputAudio(options?: {title?: string; asset?: string; edit?: boolean}): Promise<PlaygroundAudioInput | null>;

interface PlaygroundMusicalNoteEvent {
  /** Unique press identity; use it for release ownership, since pitches may repeat. */
  id: string;
  /** Integer MIDI note 0..127. */
  midi: number;
  /** MIDI velocity 0..127. */
  velocity: number;
}
interface PlaygroundKeyboardHandlers {
  noteOn(event: PlaygroundMusicalNoteEvent): void | Promise<void>;
  noteOff(event: PlaygroundMusicalNoteEvent): void | Promise<void>;
  allNotesOff(): void | Promise<void>;
}
interface PlaygroundMusicalKeyboard {
  /** Bind the shared Guitar/Bass/Ukulele Keyboard to one instrument for this Run.
   * Register during source evaluation. Stop or omitting it on the next Run
   * retires the binding. Operator view retains its usual FM audition. */
  bind(name: string, handlers: PlaygroundKeyboardHandlers): void;
}
declare const keyboard: PlaygroundMusicalKeyboard;
interface PlaygroundSampleInstrument extends PlaygroundKeyboardHandlers {
  readonly name: string;
  noteOn(event: PlaygroundMusicalNoteEvent): Promise<void>;
  noteOff(event: PlaygroundMusicalNoteEvent): Promise<void>;
  allNotesOff(): Promise<void>;
}
/** Create an adapter for already edited PCM. The chosen chip keeps its hardware
 * memory/voice limits; the adapter does not silently crop or resample audio.
 * Pass the result to keyboard.bind() during source evaluation. */
declare function createSampleInstrument(audio: PlaygroundSampleAudio, options?: {
  target?: 'auto' | PlaygroundSampleTarget;
  /** Physical per-voice level, 0..255; default depends on the target. */
  volume?: number;
}): Promise<PlaygroundSampleInstrument>;

interface PlaygroundTiming {
  /** Explicit DAC/VGM sample schedule refill lead; seconds. Default 0.25. */
  lookaheadSeconds: number;
  /** Explicit audio schedule refill interval; milliseconds. */
  schedulerIntervalMs: number;
  /** Worker script audio transport lead, 0..2 seconds; default 0.15.
   * Applies to the next performance after Stop; hot Run keeps the active lead.
   * Main execution, UI Keyboard and explicit audio/sample schedules are unaffected. */
  workerLookaheadSeconds: number;
}
/** Configure timing. Worker transport lead changes apply after Stop → Run. Await in Worker mode. */
declare function setTiming(options: Partial<PlaygroundTiming>): PlaygroundTiming | Promise<PlaygroundTiming>;
declare function getTiming(): PlaygroundTiming | Promise<PlaygroundTiming>;


/** MIDI output/channel handle. All physical voices are allocated by the sound engine. */
interface PlaygroundMidiOutput {
  /** 0..127 data. Supports 7/10/11/64/120/121/123; returns false for other controllers.
   * FM pan is left/center/right; PSG pan has no audible effect. */
  cc(controller: number, value: number): Promise<boolean>;
  /** -1..1, center 0. Affects held and subsequent notes on this output / MIDI CH. */
  pitchBend(value: number): Promise<void>;
  /** Symmetric range in semitones, 0..96; default 2. Retunes held notes. */
  setPitchBendRange(semitones: number): Promise<void>;
  /** Beats follow tempo changes while held; seconds ignore BPM. Legacy duration/default remain beats (default 1). */
  play(note: string | number, options?: PlaygroundNoteLength & {velocity?: number}): Promise<void>;
  noteOn(note: string | number, options?: {velocity?: number}): Promise<number>;
  noteOff(note: string | number): Promise<void> | void;
  /** YM2612 only; affects subsequent notes, not held voices. */
  setVoice(preset: YM2612Preset): Promise<void>;
  setVoice(bytes: Uint8Array | ArrayBuffer, options: {format: "tfi" | "vgi"}): Promise<void>;
  /** FILES path relative to the Run file. */
  loadVoice(path: string): Promise<void>;
}
type PlaygroundMidiChannel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
interface PlaygroundMidiRoute {
  part: string;
  /** Pitch bend range in semitones; default 2. RPN is not yet applied. */
  bendRange?: number;
  destination: "tetorica-ym2612" | "tetorica-sega-psg";
  channel: PlaygroundMidiChannel;
  preset?: string;
}
/** Editable score event. at/duration are quarter-note beats; play schedules both note edges. */
interface PlaygroundMidiScoreEvent {
  at: number;
  output: PlaygroundMidiOutput;
  play?: string | number;
  duration?: number;
  velocity?: number;
  noteOn?: string | number;
  noteOff?: string | number;
  cc?: [number, number];
  pitchBend?: number;
  /** Optional tie-breaking order retained from imported MIDI. */
  order?: number;
  offOrder?: number;
}
interface PlaygroundMidiSongConfig {
  channels: Record<number, {
    events: (...outputs: PlaygroundMidiOutput[]) => Iterator<PlaygroundMidiScoreEvent>;
    outputs: PlaygroundMidiOutput[];
  }>;
  tempos?: {beat: number; bpm: number}[];
  endBeat?: number;
}
interface PlaygroundMidiSongPlayer {
  readonly running: boolean;
  runChannels(channels: number[], outputs?: Record<number, PlaygroundMidiOutput | PlaygroundMidiOutput[]>): Promise<void>;
}
interface PlaygroundMidi {
  /** YM2612: true (default) shares six voices; false pins CH1..CH6 and silences CH7..CH16.
   * Changing mode silences existing YM2612 notes. CH3 special mode is separate. */
  enableSoundChip(chip: "ym2612" | "tetorica-ym2612", options?: {roundRobin?: boolean}): Promise<void>;
  /** Replay beat-based generators together; tempo changes, note-offs and cleanup are shared. */
  createSongPlayer(config: PlaygroundMidiSongConfig): PlaygroundMidiSongPlayer;
  /** Fix an origin now; waits use seconds from that origin, absorbing previous delays.
   * Times must be finite, nonnegative and nondecreasing. Late waits yield then catch up.
   * JavaScript dispatch may still be late; this is not sample-accurate audio scheduling. */
  createTimeline(): {waitUntil(seconds: number): Promise<void>};
  /** MIDI channel 0..15 (CH1..CH16), default 0. Same destination/channel shares controllers.
   * Physical voices are automatically allocated regardless of channel selection. */
  output(destination: "tetorica-ym2612" | "tetorica-sega-psg", options?: {channel?: PlaygroundMidiChannel}): PlaygroundMidiOutput;
  /** SMF 0/1, PPQN timing. Manual voices; supported CC applied. Other CC/program changes retained but not applied. */
  playFile(data: ArrayBuffer | Uint8Array, routes: PlaygroundMidiRoute[]): Promise<void>;
}
declare const midi: PlaygroundMidi;

/** RF5C164 physical channels: CH1..CH8 (0..7), no automatic allocation. */
interface PlaygroundRf5c164 {
  loadMemory(bytes: Uint8Array | ArrayBuffer, address?: number): Promise<void>;
  /** WAV/FLAC URL or encoded file bytes. loopStart is a sample offset; omitted means silence after end.
   * endGuardBytes reserves consecutive end markers for large pitch steps; 0 keeps the legacy trailer. */
  loadSample(source: {channels: Float32Array[]; sampleRate: number} | string | Uint8Array | ArrayBuffer | Blob, options?: {address?: number; loopStart?: number; endGuardBytes?: number}): Promise<{start: number; loopStart: number; step: number}>;
  setChannel(ch: number, options: {start?: number; loopStart?: number; step?: number; volume?: number; pan?: {left: number; right: number}}): Promise<void>;
  setPitch(ch: number, step: number): Promise<void>;
  keyOn(ch: number): Promise<void>;
  keyOff(ch: number): Promise<void>;
  writeRegister(register: number, value: number): Promise<void>;
  /** Reset registers, retain RAM. */
  reset(): Promise<void>;
  dispose(): void;
}
declare function createSoundChip(name: 'rf5c164', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundRf5c164 & PlaygroundChipClock & {readonly id: string}>;
/** Game Boy note names (C4=MIDI 60) or integer MIDI 0..127. */
type GameboyNote = string | number;
interface GameboyEnvelope { direction?: 'up' | 'down'; period?: number; }
interface GameboyPulseVoice { duty?: 0.125 | 0.25 | 0.5 | 0.75; volume?: number; envelope?: GameboyEnvelope; }
interface PlaygroundGameboy {
  /** Tone channels 0/1=pulse, 2=wave. Requires initialize() or adoptRegisterState(). */
  setFrequency(ch: 0 | 1 | 2, hz: number): number;
  setNote(ch: 0 | 1 | 2, note: GameboyNote): number;
  noteOn(ch: 0 | 1 | 2, note: GameboyNote): void;
  /** Channel 3 is noise. */
  keyOn(ch: 0 | 1 | 2 | 3): void;
  keyOff(ch: 0 | 1 | 2 | 3): void;
  /** Enable high-level operations using tracked raw writes. Requires NR52 power ON; no reset or register writes. Not a core readback. */
  adoptRegisterState(): void;
  /** Reset and prepare silent defaults. Required before high-level operations. */
  initialize(): void;
  pulse: {
    /** Writes settings immediately without triggering. Physical pulse channels 0 and 1. */
    setVoice(ch: 0 | 1, options: GameboyPulseVoice): void;
    /** NR11/NR21 duty bits; immediate, no trigger. */
    setDuty(ch: 0 | 1, duty: 0.125 | 0.25 | 0.5 | 0.75): void;
    /** Writes NR12/NR22, not a live volume setter. Hardware side effects apply; keyOn restarts envelope. */
    setEnvelope(ch: 0 | 1, options: GameboyEnvelope & {volume?: number}): void;
    /** Writes NR10 immediately; hardware sweep state is not restarted. */
    setSweep(options: {direction?: 'up' | 'down'; period?: number; shift?: number}): void;
    setFrequency(ch: 0 | 1, hz: number): number;
    setNote(ch: 0 | 1, note: GameboyNote): number;
    noteOn(ch: 0 | 1, note: GameboyNote): void;
    keyOn(ch: 0 | 1): void;
    keyOff(ch: 0 | 1): void;
  };
  wave: {
    /** Stops DAC, copies 32 four-bit samples, does not restart. */
    stopAndSetWaveform(samples: number[] | Uint8Array): void;
    /** Alias of stopAndSetWaveform; also stops DAC and never restarts. */
    setWaveform(samples: number[] | Uint8Array): void;
    /** Zero mutes NR32; DAC remains enabled. */
    setLevel(level: 0 | 0.25 | 0.5 | 1): void;
    setFrequency(hz: number): number;
    setNote(note: GameboyNote): number;
    noteOn(note: GameboyNote): void;
    keyOn(): void;
    keyOff(): void;
  };
  noise: {
    /** Immediate NR43 update, no trigger. divisor 0..7, shift 0..15. */
    setParameters(options: {divisor?: number; shift?: number; width?: 7 | 15}): void;
    /** Writes NR42; keyOn explicitly restarts the envelope. */
    setEnvelope(options: GameboyEnvelope & {volume?: number}): void;
    /** Immediate partial register settings, no trigger. */
    setVoice(options: {volume?: number; envelope?: GameboyEnvelope; divisor?: number; shift?: number; width?: 7 | 15}): void;
    keyOn(): void;
    keyOff(): void;
  };
  setPan(ch: 0 | 1 | 2 | 3, left: boolean, right: boolean): void;
  /** Integers 0..7; zero is not mute. */
  setMasterVolume(left: number, right: number): void;
  /** Raw offsets relative to 0xFF10. Does not require initialize(). */
  writeRegister(offset: number, value: number): void;
  reset(): void;
  dispose(): void;
}
/** The selected APU has the same instrument API; its lifetime belongs to the mode. */
type PlaygroundPrimaryGameboy = Omit<PlaygroundGameboy, 'dispose'> & PlaygroundChipClock & {readonly id: string};
declare function createSoundChip(name: 'gameboy', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundGameboy & PlaygroundChipClock & {readonly id: string}>;
/** Independent YM2608; memory uploads are asynchronous, register setters are ordered writes. */
type PlaygroundYm2608 = {setClock(clock: number): Promise<void>; resetRegisters(): void; prepareTimeline(events: Array<[number, number, number, number]>, blocks: Uint8Array[], durationSamples: number): Promise<void>; playTimeline(): Promise<void>} & Pick<FMApi, 'reset' | 'setPreset' | 'setOperator' | 'setOperators' | 'setAlgo' | 'setPan' | 'setLfo' | 'setChannel3SpecialMode' | 'setChannel3SpecialFrequency' | 'setFrequency' | 'setNote' | 'setBlockFnum' | 'noteOnRaw' | 'keyOn' | 'keyOff' | 'noteOn' | 'noteOff' | 'writeAddress' | 'writeData'> & {
  write(port: number, register: number, value: number): void;
  dispose(): void;
  ssg: {
    /** Pitch setters preserve volume and mixer. Configure setVolume before keyOn. */
    setFrequency(ch: number, hz: number): number;
    setNote(ch: number, note: string | number): number;
    keyOn(ch: number): void;
    keyOff(ch: number): void;
    noteOn(ch: number, note: string | number): void;
    tone(ch: number, options: {frequency?: number; period?: number; volume?: number; envelope?: boolean}): number;
    noise(ch: number, options: {period: number; volume?: number; envelope?: boolean}): void;
    setTonePeriod(ch: number, period: number): void;
    setMixer(ch: number, options: {tone: boolean; noise: boolean}): void;
    off(ch: number): void;
    setVolume(ch: number, volume: number, envelope?: boolean): void;
    setEnvelope(options: {period: number; shape: number}): void;
    reset(): void;
  };
  rhythm: {
    loadRom(bytes: Uint8Array | ArrayBuffer): Promise<void>;
    setVolume(volume: number): void;
    setVoice(ch: number | string, options: {volume?: number; left?: boolean; right?: boolean}): void;
    keyOn(ch: number | string | Array<number | string>): void;
    keyOff(ch: number | string | Array<number | string>): void;
    reset(): void;
  };
  adpcm: {
    /** PCM/WAV -> mono ADPCM-B -> memory. Selects range/rate but does not key on. */
    loadSample(source: {channels: ArrayLike<number>[]; sampleRate: number} | AudioBuffer | string | URL | Uint8Array | ArrayBuffer | Blob,
      options?: {address?: number; sampleRate?: number; signal?: AbortSignal; decodeAudio?: (bytes: ArrayBuffer) => Promise<AudioBuffer | {channels: ArrayLike<number>[]; sampleRate: number}>}):
      Promise<{start: number; end: number; frames: number; paddedFrames: number; sampleRate: number; deltaN: number; duration: number}>;
    loadMemory(bytes: Uint8Array | ArrayBuffer, address?: number): Promise<void>;
    setSample(range: {start: number; end: number}): void;
    setVolume(volume: number): void;
    setPan(left: boolean, right: boolean): void;
    setPlaybackRate(rate: number): number;
    setDeltaN(value: number): void;
    keyOn(options?: {repeat?: boolean}): void;
    keyOff(): void;
    reset(): void;
  };
};
declare function createSoundChip(name: 'ym2608', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundYm2608 & PlaygroundChipClock & {readonly id: string}>;


/** Runtime-managed chip lookup. Reuses pending/ready instances until Stop.
 * YM2612/YM2203/YM2610 reuse global fm when selected, otherwise create an independent chip.
 * Multiple instances via id are not supported. Existing createSoundChip creates fresh chips.
 */
/** OPN setPreset configures operators/modulation; chip LFO uses setLfo separately. */
type PlaygroundOPNPreset<Stereo extends boolean = true> = Stereo extends true
  ? Omit<YM2612Preset, 'lfo'>
  : Omit<YM2612Preset, 'pan' | 'ams' | 'pms' | 'lfo'>;
/** OPN FM facade with logical channel bounds and the chip's supported controls. */
type PlaygroundOPNFm<Channel extends OPNFmChannel, Stereo extends boolean = true> = {
  [K in Exclude<keyof FMApi, 'setDacEnabled' | 'writeDac' | 'dac' | (Stereo extends false ? 'setPan' | 'setLfo' : never)>]:
    K extends 'setPreset' ? (channel: Channel, preset: PlaygroundOPNPreset<Stereo>) => void
    : K extends 'setFrequency' ? {
      (channel: Channel, hz: number): void;
      (channel: Channel, block: number, fnum: number): void;
    } : K extends 'noteOn' ? {
      (channel: Channel, note: string | number): void;
      (channel: Channel, block: number, fnum: number): void;
    } : K extends 'setOperator' | 'setOperators' | 'setAlgo' | 'setPan' | 'setNote' | 'setBlockFnum' | 'noteOnRaw' | 'keyOn' | 'keyOff' | 'noteOff'
      ? FMApi[K] extends (channel: YM2612Channel, ...args: infer Args) => infer Result
        ? (channel: Channel, ...args: Args) => Result : never
      : FMApi[K];
};
/** Master clock in Hz. Keeps registers, memory and key-on state; output rate and BPM stay fixed.
 * Await before issuing subsequent high-level note/frequency commands. Integer 100000..100000000 Hz.
 * Affects existing sound pitch and hardware envelopes/LFOs. reset() retains this clock.
 */
interface PlaygroundChipClock {
  readonly clock: number;
  setClock(hz: number): Promise<void>;
}
// BEGIN GENERATED DX7 PRESET TYPES
/** Public operator labels. OP1 is the last operator block in DX7 wire data. */
type DX7Operator = 1 | 2 | 3 | 4 | 5 | 6;
/** Four DX7 values, each an integer from 0 through 99. These are not seconds. */
type DX7EnvelopeValues = readonly [number, number, number, number];
interface DX7EnvelopeParams {
  rates?: DX7EnvelopeValues;
  levels?: DX7EnvelopeValues;
}
interface DX7KeyboardScalingParams {
  /** DX7 breakpoint value 0..99, not a MIDI note number. */
  breakpoint?: number;
  leftDepth?: number;
  rightDepth?: number;
  /** DX7 curve encodings 0..3. */
  leftCurve?: number;
  rightCurve?: number;
}
interface DX7OperatorParams {
  envelope?: DX7EnvelopeParams;
  keyboardScaling?: DX7KeyboardScalingParams;
  /** 0..7. */
  rateScaling?: number;
  /** 0..3; retained, but upstream MSFA does not implement operator AM. */
  ampModSensitivity?: number;
  /** 0..7. */
  velocitySensitivity?: number;
  /** 0..99; larger is louder, unlike YM2612 TL. */
  outputLevel?: number;
  mode?: 'ratio' | 'fixed';
  /** DX7 coarse value 0..31. */
  coarse?: number;
  /** DX7 fine value 0..99. */
  fine?: number;
  /** Raw DX7 value 0..14; neutral is 7. */
  detune?: number;
}
type DX7Operators = Partial<Record<DX7Operator, DX7OperatorParams>>;
/** Atomic operator-edit batch. Each OP1..OP6 label appears at most once. */
type DX7OperatorEntries = readonly (readonly [DX7Operator, DX7OperatorParams])[];
interface DX7LfoParams {
  /** Speed, delay and modulation depths are DX7 values 0..99. */
  speed?: number;
  delay?: number;
  pitchModDepth?: number;
  ampModDepth?: number;
  sync?: boolean;
  /** DX7 waveform encoding 0..5. */
  waveform?: number;
  /** 0..7. */
  pitchModSensitivity?: number;
}
/** Partial input. setPreset fills omitted fields from the original INIT SINE. */
interface DX7Preset {
  /** At most ten printable ASCII characters. */
  name?: string;
  /** Zero-based DX7 algorithm 0..31 (displayed as 1..32 on the instrument). */
  algorithm?: number;
  feedback?: number;
  /** Retained; upstream MSFA does not implement oscillator key sync. */
  oscillatorSync?: boolean;
  pitchEnvelope?: DX7EnvelopeParams;
  lfo?: DX7LfoParams;
  /** Raw 0..48, neutral 24; retained but upstream MSFA does not apply it. */
  transpose?: number;
  /** Public OP1..OP6 labels, independent of the reversed SysEx wire order. */
  operators?: DX7Operators;
}
interface DX7EnvelopeState {
  rates: [number, number, number, number];
  levels: [number, number, number, number];
}
interface DX7OperatorState extends Required<DX7OperatorParams> {
  envelope: DX7EnvelopeState;
  keyboardScaling: Required<DX7KeyboardScalingParams>;
}
/** Complete independent output from getPreset(). */
interface DX7PresetState extends Required<DX7Preset> {
  pitchEnvelope: DX7EnvelopeState;
  lfo: Required<DX7LfoParams>;
  operators: Record<DX7Operator, DX7OperatorState>;
}
// END GENERATED DX7 PRESET TYPES
interface PlaygroundDx7VoiceInfo {
  readonly index: number;
  readonly name: string;
}
interface PlaygroundDx7State {
  voices: PlaygroundDx7VoiceInfo[];
  selectedVoice: number;
  /** AudioContext output rate, in Hz: 44100 or 48000. */
  sampleRate: number;
  /** MSFA engine rate, fixed at 44100 Hz. */
  internalSampleRate: number;
}
/** Independent MSFA DX7 synthesizer. MIDI note numbers, 16 voices, mono output.
 * Starts with the self-authored INIT SINE voice. No setClock/register API.
 * Audio is routed through Playground volume, mixer and FX. STOP disposes independent
 * instances; DX7 mode retains its primary instance and bank while silencing voices.
 */
interface PlaygroundDx7 {
  readonly voices: PlaygroundDx7VoiceInfo[];
  readonly selectedVoice: number;
  readonly sampleRate: number;
  readonly internalSampleRate: number;
  /** Complete DX7 1-voice / 32-voice bank SysEx; selects voice 0.
   * Await application before playing. Invalid data preserves the previous bank.
   * Read binary files with file(path, {type:'arrayBuffer'}).
   */
  loadSysex(bytes: ArrayBuffer | ArrayBufferView): Promise<PlaygroundDx7VoiceInfo[]>;
  /** Replace the selected voice from INIT defaults; keep the other bank slots.
   * Resolves after application. OP/algorithm/EG edits affect subsequent Note On;
   * shared LFO settings can affect held notes. No channel argument.
   */
  setPreset(preset: DX7Preset): Promise<void>;
  /** Partially update OP1..6 using DX7 values. outputLevel 0..99: larger is louder.
   * outputLevel/mode/coarse/fine/detune also affect this patch's sounding notes
   * and release tails without retriggering. Other fields affect future notes.
   * setPreset/loadSysex create new patch identities; selectVoice retains them. */
  setOperator(operator: DX7Operator, params: DX7OperatorParams): Promise<void>;
  /** Apply a tuple batch atomically; duplicate operators reject, [] is a no-op. */
  setOperators(entries: ReadonlyArray<readonly [DX7Operator, DX7OperatorParams]>): Promise<void>;
  /** Raw feedback 0..7 on this patch's sounding/future notes; may cause a step. */
  setFeedback(feedback: number): Promise<void>;
  /** Read a complete independent object after preceding commands apply. */
  getPreset(): Promise<DX7PresetState>;
  /** Zero-based voice index. Existing notes retain their operator/envelope settings. */
  selectVoice(index: number): void;
  /** Integer MIDI note and velocity 0..127. Velocity 0 releases that note. */
  noteOn(note: number, velocity?: number): void;
  /** Release all held voices of this MIDI note; their release envelopes continue. */
  noteOff(note: number): void;
  /** Release every voice; release envelopes continue. */
  allNotesOff(): void;
  /** Immediately silence and clear buffered audio, retaining the selected voice. */
  panic(): void;
  /** Read metadata after preceding commands have been applied in the AudioWorklet. */
  getState(): Promise<PlaygroundDx7State>;
  dispose(): void;
}
type PlaygroundPrimaryDx7 = Omit<PlaygroundDx7, 'dispose'> & {readonly id: string};
type PlaygroundSnesChannel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Raw BRR has no tuning metadata. Declare the note/frequency at basePitch.
 * Native DSP rate is fixed at 32,000 Hz. Loop positions are native sample indices.
 */
type PlaygroundSnesBrrOptions = ({rootNote:string | number; baseFrequencyHz?:never} | {baseFrequencyHz:number; rootNote?:never}) & {
  /** Hardware PITCH at the declared root, default 4096 (one source sample/frame). */
  basePitch?:number;
  /** Required for looping BRR, on a 16-sample BRR block boundary. */
  loopStartSamples?:number;
};
interface PlaygroundSnesSample {
  id:number; startAddress:number; loopAddress:number; byteLength:number; frames:number;
  rootNote:string | number | null; rootFrequencyHz:number; basePitch:number;
  loop:boolean; loopStartSamples:number | null;
}
interface PlaygroundSnesChannelState {
  sample:number | null;
  /** Hardware register values 0..255; ADSR1 bit7 enables ADSR, otherwise GAIN. */
  adsr1:number; adsr2:number; gain:number;
  /** Signed hardware volume -128..127, including phase inversion. */
  volumeLeft:number; volumeRight:number;
  /** Hardware PITCH 0..16383; not a frequency in Hz. */
  pitch:number;
}
type PlaygroundSnesPreset = Partial<Omit<PlaygroundSnesChannelState, 'sample'>> & {sample?:number | PlaygroundSnesSample};
interface PlaygroundSnesState {
  /** Fixed internal DSP sample rate, 32,000 Hz. */
  sampleRate:number;
  samples:PlaygroundSnesSample[]; channels:PlaygroundSnesChannelState[]; nextAddress:number;
}
/** Recorded original DSP execution, including RAM/BRR changes. Independent of
 * BPM. Four words per event: effective DSP clock, kind (0 DSP / 1 RAM), address,
 * byte value. Preserve nondecreasing clocks and same-clock event order.
 * These are 1,024,000-Hz execution clocks, not output frames or VGM samples.
 */
interface PlaygroundSnesTimeline {
  version:1;
  clockRate:1024000;
  /** Complete 32,000-Hz frames; maximum 600 seconds. */
  durationClocks:number;
  initialState:{ram:Uint8Array; dsp:Uint8Array; outputDelayFrames:4};
  /** At most 1,000,000 packed events. RAM addresses 0..65535; DSP 0..127. */
  events:Uint32Array | number[];
}
interface PlaygroundSnesTimelineState {
  loaded:boolean; playing:boolean; ended:boolean;
  /** Native 32,000-Hz frames from the prepared timeline's origin. */
  positionFrames:number;
  totalFrames:number;
}
/** Independent CPU-free S-DSP, eight fixed physical voices, no automatic allocator.
 * BRR uploads, tuning and voice configuration are explicit. Routes through mixer/FX.
 * Worker performance commands follow Worker lookahead; STOP disposes this instance.
 * Echo writes are off by default. Raw DSP edits must respect sample/directory RAM.
 */
interface PlaygroundSnes {
  /** AudioContext output sample rate in Hz, independent of nativeSampleRate. */
  readonly sampleRate:number;
  readonly nativeSampleRate:32000;
  loadBRR(bytes:ArrayBuffer | ArrayBufferView, options:PlaygroundSnesBrrOptions):Promise<PlaygroundSnesSample>;
  /** Upload original RAM/DSP state and timed writes, without playback. This
   * replaces the authored instrument state; use reset() before BRR/note editing.
   */
  prepareTimeline(timeline:PlaygroundSnesTimeline):Promise<PlaygroundSnesTimelineState>;
  /** Restart the prepared interval; resolves when audio finishes. Worker
   * lookahead delays the start once. Stop, disposal or owner removal rejects
   * with AbortError. No JS sleep is needed to keep playback alive.
   */
  playTimeline():Promise<PlaygroundSnesTimelineState>;
  /** Silence a timeline and reject any pending playTimeline() wait. */
  stopTimeline():Promise<PlaygroundSnesTimelineState>;
  getTimelineState():Promise<PlaygroundSnesTimelineState>;
  setPreset(channel:PlaygroundSnesChannel, preset:PlaygroundSnesPreset):void;
  setChannel(channel:PlaygroundSnesChannel, params:PlaygroundSnesPreset):void;
  getPreset(channel:PlaygroundSnesChannel):Promise<PlaygroundSnesChannelState>;
  /** Musical fundamental Hz using the assigned BRR sample's declared tuning. */
  setFrequency(channel:PlaygroundSnesChannel, hz:number):void;
  setNote(channel:PlaygroundSnesChannel, note:string | number):void;
  /** Raw hardware PITCH 0..16383; 4096 means unity source playback rate. */
  setPitch(channel:PlaygroundSnesChannel, pitch:number):void;
  keyOn(channel:PlaygroundSnesChannel):void;
  keyOff(channel:PlaygroundSnesChannel):void;
  noteOn(channel:PlaygroundSnesChannel, note?:string | number):void;
  noteOff(channel:PlaygroundSnesChannel):void;
  allNotesOff():void;
  /** Reset registers and release voices, retaining uploaded sample IDs/data.
   * After prepareTimeline(), clears raw timeline mode and returns to BRR editing.
   */
  reset():void;
  writeDsp(register:number, value:number):void;
  readDsp(register:number):Promise<number>;
  /** Applied state; future reserved Worker commands may not yet be reflected. */
  getState():Promise<PlaygroundSnesState>;
  /** Atomic 64KiB RAM and 128-byte DSP register copy; analysis, not a full checkpoint. */
  snapshot():Promise<{ram:Uint8Array; dsp:Uint8Array; nativeFrames:number}>;
  dispose():void;
}
interface PlaygroundSpcState {
  ready:boolean; loaded:boolean; playing:boolean; paused:boolean; muteMask:number;
  /** Elapsed media seconds from the loaded SPC snapshot, independent of BPM. */
  positionSeconds:number;
  playbackNativeFrames:number; renderedNativeFrames:number;
  nativeSampleRate:32000; sampleRate?:number; closed?:boolean;
}
/** Captured S-DSP registers; raw PITCH and envelope bytes, not MIDI or seconds. */
interface PlaygroundSpcEventPreset {
  sourceNumber:number;
  /** Raw PITCH 0..16383; 4096 is unity BRR playback rate. */
  pitch:number;
  adsr1:number; adsr2:number; gain:number;
  /** Signed register values -128..127, including phase inversion. */
  volumeLeft:number; volumeRight:number;
}
type PlaygroundSpcEventType = 'noteOn' | 'noteOff' | 'pitch' | 'volume' | 'instrument' | 'dsp';
/** Source clocks from the SPC origin, at 1,024,000 Hz (32 clocks/native frame).
 * Callback delivery occurs later, in Main or the script Worker, not in audio.
 */
type PlaygroundSpcEvent =
  | (PlaygroundSpcEventPreset & {type:'noteOn'; clock:number; channel:PlaygroundSnesChannel;
      preset:PlaygroundSpcEventPreset; reason:'kon' | 'initial';
      /** The persistent KOFF bit was asserted when KON requested this note. */
      keyOffHeld:boolean;
      /** Initial state is inferred from KON/ENVX/OUTX, not original key history. */
      inferred?:true})
  | {type:'noteOff'; clock:number; channel:PlaygroundSnesChannel; sourceNumber:number; reason:'koff' | 'initial'; inferred?:true}
  | {type:'pitch'; clock:number; channel:PlaygroundSnesChannel; pitch:number}
  | {type:'volume'; clock:number; channel:PlaygroundSnesChannel; volumeLeft:number; volumeRight:number}
  | {type:'instrument'; clock:number; channel:PlaygroundSnesChannel; sourceNumber:number; adsr1:number; adsr2:number; gain:number; preset:PlaygroundSpcEventPreset}
  | {type:'dsp'; clock:number; channel?:never; register:number; value:number}
  | {type:'overflow'; clock:number; channel?:never; droppedWrites:number; message:string};
interface PlaygroundSpcEventOptions {
  /** Physical voices 0..7. Global DSP writes remain available via type 'dsp'. */
  voices?:PlaygroundSnesChannel[];
  types?:PlaygroundSpcEventType[];
  /** Delivery batching interval 16..1000 ms, default 16; not a timing quantizer. */
  intervalMs?:number;
}
/** SPC700 program + S-DSP file player. This is not the CPU-free SNES instrument API.
 * Runs the saved program after play(); optional onEvent observes musical requests.
 * The SPC clock is independent of BPM and Worker lookahead. STOP disposes the player.
 */
interface PlaygroundSpc {
  readonly sampleRate:number;
  readonly nativeSampleRate:32000;
  loadSPC(bytes:Uint8Array | ArrayBuffer):Promise<PlaygroundSpcState>;
  play():Promise<PlaygroundSpcState>;
  pause():Promise<PlaygroundSpcState>;
  /** Reload the original saved state and rewind to zero. */
  stop():Promise<PlaygroundSpcState>;
  /** Replay from the original snapshot to elapsed seconds (0..3600); no seek cache. */
  seek(seconds:number):Promise<PlaygroundSpcState>;
  getState():Promise<PlaygroundSpcState>;
  /** Bit0..7 mute the eight voices; their internal musical state still advances. */
  setMuteMask(mask:number):Promise<PlaygroundSpcState>;
  /** Opt-in musical observations: key requests, distinct PITCH/volume/instrument
   * changes and raw global DSP writes. No smoothing or note-name inference.
   * Same-clock PITCH low/high writes are combined; repeated KON still retriggers.
   * Returns an unsubscribe function. Load/seek reset the inferred initial state;
   * Stop/dispose remove queued delivery. An overflow diagnostic bypasses filters
   * and reports that chronology was lost; the decoder then resynchronizes.
   */
  onEvent(callback:(event:PlaygroundSpcEvent)=>void | Promise<void>, options?:PlaygroundSpcEventOptions):()=>void;
  /** Current RAM/DSP capture, not a complete resumable checkpoint. */
  snapshot():Promise<{ram:Uint8Array; dsp:Uint8Array; nativeFrames:number; playbackNativeFrames:number; positionSeconds:number; nativeSampleRate:32000; muteMask:number}>;
  dispose():void;
}
type PlaygroundSoundChipMap = {
  ym2612: TetoricaSelectedChip extends PlaygroundGenesisSelectedChip ? YM2612FMApi : PlaygroundCreatedFm;
  ym2203: TetoricaSelectedChip extends 'ym2203' ? YM2203FMApi : PlaygroundCreatedYm2203;
  ym2610: TetoricaSelectedChip extends 'ym2610' ? YM2610FMApi : PlaygroundCreatedYm2610;
  rf5c164: TetoricaSelectedChip extends 'mega-cd' ? Omit<PlaygroundRf5c164, 'dispose'> : PlaygroundRf5c164;
  ym2608: PlaygroundYm2608;
  gameboy: TetoricaSelectedChip extends 'gameboy' ? PlaygroundPrimaryGameboy : PlaygroundGameboy;
  segapsg: TetoricaSelectedChip extends 'game-gear' ? PlaygroundPrimaryGameGearPsg
    : TetoricaSelectedChip extends 'master-system' ? PlaygroundPrimaryMasterSystemPsg : PlaygroundSegaPsg;
  ym2151: TetoricaSelectedChip extends 'x68000' ? PlaygroundPrimaryOpm : PlaygroundYm2151;
  nes: TetoricaSelectedChip extends 'nes' ? PlaygroundPrimaryNes : PlaygroundNes;
  pwm: PlaygroundPWM32X;
  dx7: TetoricaSelectedChip extends 'dx7' ? PlaygroundPrimaryDx7 : PlaygroundDx7;
  snes: TetoricaSelectedChip extends 'snes' ? PlaygroundPrimarySnes : PlaygroundSnes;
  spc: PlaygroundSpc;
  huc6280: TetoricaSelectedChip extends 'huc6280' ? PlaygroundPrimaryHuc6280 : PlaygroundHuc6280;
  okim6258: TetoricaSelectedChip extends 'x68000' ? PlaygroundPrimaryOki6258 : PlaygroundOki6258;
  ym3526: TetoricaSelectedChip extends 'ym3526' ? PlaygroundPrimaryOpl<'ym3526'> : PlaygroundOpl<'ym3526'>;
  ym3812: TetoricaSelectedChip extends 'ym3812' ? PlaygroundPrimaryOpl<'ym3812'> : PlaygroundOpl<'ym3812'>;
  y8950: TetoricaSelectedChip extends 'y8950'|'msx-audio' ? PlaygroundPrimaryOpl<'y8950'> : PlaygroundOpl<'y8950'>;
  ymf262: TetoricaSelectedChip extends 'ymf262' ? PlaygroundPrimaryOpl<'ymf262'> : PlaygroundOpl<'ymf262'>;
  ym2413: TetoricaSelectedChip extends 'master-system'|'msx'|'msx-audio' ? PlaygroundPrimaryYm2413 : PlaygroundYm2413;
  ay8910: TetoricaSelectedChip extends 'msx'|'msx-audio' ? PlaygroundPrimaryAy8910 : PlaygroundAy8910;
};
type PlaygroundUseSoundChipOptions = { [key: string]: never };
type PlaygroundSoundChipClient<Name extends keyof PlaygroundSoundChipMap> = Name extends 'dx7' | 'snes' | 'spc'
  ? PlaygroundSoundChipMap[Name] & {readonly id: string}
  : PlaygroundSoundChipMap[Name] & PlaygroundChipClock & {readonly id: string};
/** Borrow the mode's primary instrument when names match; otherwise reuse an
 * independent instance until STOP. For separate instances use createSoundChip. */
declare function useSoundChip<Name extends keyof PlaygroundSoundChipMap>(name: Name, options?: PlaygroundUseSoundChipOptions): Promise<PlaygroundSoundChipClient<Name>>;

/** Create an independent DX7 with its own 16 voices and SysEx bank. */
declare function createSoundChip(name: 'dx7', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundDx7 & {readonly id: string}>;
/** Independent CPU-free S-DSP with separate RAM and eight physical voices. */
declare function createSoundChip(name:'snes', options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundSnes & {readonly id:string}>;
/** Independent SPC file player; use 'snes' for BRR instrument programming. */
declare function createSoundChip(name:'spc', options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundSpc & {readonly id:string}>;

/** Independent chips. Global play/write still target the default Playground chip. */
type PlaygroundCreatedFm = Omit<FMApi, 'dac' | 'scheduleWrites' | 'read' | 'readStatus' | 'getIrq'> & {dispose(): void};
type PlaygroundCreatedOPN<C extends OPNFmChannel, Stereo extends boolean = true> = Omit<PlaygroundOPNFm<C, Stereo>, 'scheduleWrites' | 'read' | 'readStatus' | 'getIrq' | 'rawWrite' | 'writeAddress' | 'writeData'> & {dispose(): void};
/** Native supports independent ymfm FM6/DAC-register chips; YM2612 and Sega PSG share a 16-instance limit. */
declare function createSoundChip(name: 'ym2612', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundCreatedFm & PlaygroundChipClock & {readonly id: string}>;
type PlaygroundCreatedYm2203 = PlaygroundCreatedOPN<0 | 1 | 2, false> & {ssg: PlaygroundYm2608['ssg']; setClock(clock: number): Promise<void>; scheduleRegisters(entries: Array<[number, number, number]>, durationSamples: number): Promise<void>};
declare function createSoundChip(name: 'ym2203', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundCreatedYm2203 & PlaygroundChipClock & {readonly id: string}>;
type PlaygroundCreatedYm2610 = PlaygroundCreatedOPN<0 | 1 | 2 | 3> & {
  ssg: PlaygroundYm2608['ssg'];
  adpcm: Omit<PlaygroundYm2608['adpcm'], 'loadSample'>;
  adpcmB: Omit<PlaygroundYm2608['adpcm'], 'loadSample'>;
  adpcmA: {
    loadMemory(bytes: Uint8Array | ArrayBuffer, address?: number): Promise<void>;
    setSample(ch: number, range: {start: number; end: number}): void;
    setVolume(volume: number): void;
    setVoice(ch: number, options: {volume?: number; left?: boolean; right?: boolean}): void;
    keyOn(ch: number | number[]): void;
    keyOff(ch: number | number[]): void;
    reset(): void;
  };
};
declare function createSoundChip(name: 'ym2610', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundCreatedYm2610 & PlaygroundChipClock & {readonly id: string}>;

/** Independent Sega PSG; resetAll only resets this chip. */
type PlaygroundSegaPsg = Omit<PSGApi, 'resetAll'> & {
  /** Game Gear output mask: bits 0..3 right, bits 4..7 left. 0xff enables every channel on both sides. */
  setStereo(mask: number): void;
  /** Silence the three tone channels and noise without resetting their settings. */
  allNotesOff(): void;
  /** Reset only this independent Sega PSG. */
  resetAll(): void;
  dispose(): void;
};
/** The Game Gear's borrowed primary PSG; its lifetime belongs to the selected mode. */
type PlaygroundPrimaryGameGearPsg = Omit<PlaygroundSegaPsg, 'dispose'> & PlaygroundChipClock & {readonly id: string};
/** The Master System PSG has a mono output and no Game Gear stereo register. */
type PlaygroundPrimaryMasterSystemPsg = Omit<PlaygroundPrimaryGameGearPsg, 'setStereo'>;
/** Native YM2612 and Sega PSG share a limit of 16 additional instances; each has its own mixer id. */
declare function createSoundChip(name: 'segapsg', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundSegaPsg & PlaygroundChipClock & {readonly id: string}>;

/** AY has three channels mixing tone and shared noise, plus one shared envelope. */
type PlaygroundAy8910Channel = 0|1|2;
interface PlaygroundAy8910Voice {
  tone?:boolean;
  noise?:boolean;
  /** Fixed hardware level, 0 silent .. 15 loudest. */
  volume?:number;
  envelope?:boolean;
  period?:number;
  frequency?:number;
  note?:string|number;
}
interface PlaygroundAy8910 {
  readonly chip:'ay8910';
  readonly channels:3;
  initialize():void;
  reset():void;
  writeRegister(register:number,value:number):void;
  getRegisterSnapshot():Uint8Array;
  setVoice(channel:PlaygroundAy8910Channel,voice:PlaygroundAy8910Voice):void;
  tone(channel:PlaygroundAy8910Channel,options?:{period?:number;frequency?:number;note?:string|number;volume?:number;envelope?:boolean}):number;
  setTone(channel:PlaygroundAy8910Channel,options?:{period?:number;frequency?:number;note?:string|number;volume?:number;envelope?:boolean}):number;
  /** Noise period is shared by every channel that enables noise. */
  noise(channel:PlaygroundAy8910Channel,options?:{period?:number;volume?:number;envelope?:boolean}):void;
  setMixer(channel:PlaygroundAy8910Channel,options:{tone?:boolean;noise?:boolean}):void;
  setVolume(channel:PlaygroundAy8910Channel,volume:number,envelope?:boolean):void;
  /** Writing shape retriggers the one shared hardware envelope. */
  setEnvelope(options:{period?:number;shape?:number}):void;
  setNoisePeriod(period:number):void;
  setTonePeriod(channel:PlaygroundAy8910Channel,period:number):void;
  setFrequency(channel:PlaygroundAy8910Channel,frequency:number):number;
  setNote(channel:PlaygroundAy8910Channel,note:string|number):number;
  keyOn(channel:PlaygroundAy8910Channel):void;
  keyOff(channel:PlaygroundAy8910Channel):void;
  noteOn(channel:PlaygroundAy8910Channel,note:string|number):void;
  noteOff(channel:PlaygroundAy8910Channel):void;
  off(channel:PlaygroundAy8910Channel):void;
  allNotesOff():void;
  dispose():void;
}
type PlaygroundPrimaryAy8910 = Omit<PlaygroundAy8910,'dispose'> & PlaygroundChipClock & {readonly id:string};
declare function createSoundChip(name:'ay8910',options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundAy8910 & PlaygroundChipClock & {readonly id:string}>;

/** OPLL has 15 built-in instruments and one user patch shared by all channels. */
type PlaygroundYm2413Channel = 0|1|2|3|4|5|6|7|8;
type PlaygroundYm2413Instrument = 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15;
type PlaygroundYm2413Drum = 'bassDrum'|'snare'|'tom'|'cymbal'|'hiHat';
interface PlaygroundYm2413OperatorParams {
  am?:boolean|0|1; vibrato?:boolean|0|1; egt?:boolean|0|1; sustain?:boolean|0|1;
  ksr?:boolean|0|1; multi?:number; mul?:number; ksl?:number;
  ar?:number; dr?:number; sl?:number; rr?:number; waveform?:0|1;
}
type PlaygroundYm2413ModulatorParams = PlaygroundYm2413OperatorParams & {tl?:number};
interface PlaygroundYm2413UserPatch {
  label?:string;
  feedback?:number;
  operators?:[PlaygroundYm2413ModulatorParams?,PlaygroundYm2413OperatorParams?];
}
interface PlaygroundYm2413Voice {
  instrument?:PlaygroundYm2413Instrument;
  /** Hardware attenuation: 0 is loudest, 15 quietest. */
  attenuation?:number;
  sustain?:boolean;
}
interface PlaygroundYm2413 {
  readonly chip:'ym2413';
  readonly channels:9;
  initialize():void;
  reset():void;
  writeRegister(register:number,value:number):void;
  getRegisterSnapshot():Uint8Array;
  setVoice(channel:PlaygroundYm2413Channel,voice:PlaygroundYm2413Voice):void;
  setInstrument(channel:PlaygroundYm2413Channel,instrument:PlaygroundYm2413Instrument,attenuation?:number):void;
  setAttenuation(channel:PlaygroundYm2413Channel,attenuation:number):void;
  setSustain(channel:PlaygroundYm2413Channel,enabled:boolean):void;
  setPreset(channel:PlaygroundYm2413Channel,preset:PlaygroundYm2413Instrument|(PlaygroundYm2413Voice & {userPatch?:PlaygroundYm2413UserPatch|Uint8Array|number[]})):void;
  /** Updates the single user patch for every channel currently using instrument 0. */
  setUserPatch(patch:PlaygroundYm2413UserPatch|Uint8Array|number[]):void;
  setUserOperator(operator:0,params:PlaygroundYm2413ModulatorParams):void;
  /** Carrier loudness is the channel's attenuation; it has no shared TL field. */
  setUserOperator(operator:1,params:PlaygroundYm2413OperatorParams):void;
  setNote(channel:PlaygroundYm2413Channel,note:string|number):{fnum:number;block:number};
  setFrequency(channel:PlaygroundYm2413Channel,frequency:number):{fnum:number;block:number};
  setPitch(channel:PlaygroundYm2413Channel,fnum:number,block?:number):void;
  keyOn(channel:PlaygroundYm2413Channel):void;
  keyOff(channel:PlaygroundYm2413Channel):void;
  noteOn(channel:PlaygroundYm2413Channel,note:string|number):void;
  noteOff(channel:PlaygroundYm2413Channel):void;
  allNotesOff():void;
  setRhythm(options:{enabled?:boolean;bassDrum?:boolean;snare?:boolean;tom?:boolean;cymbal?:boolean;hiHat?:boolean}):void;
  /** Drum levels share the melody instrument/attenuation registers of CH6..8. */
  setRhythmLevels(levels:Partial<Record<PlaygroundYm2413Drum,number>>):void;
  setRhythmLevel(drum:PlaygroundYm2413Drum,attenuation:number):void;
  dispose():void;
}
type PlaygroundPrimaryYm2413 = Omit<PlaygroundYm2413,'dispose'> & PlaygroundChipClock & {readonly id:string};
declare function createSoundChip(name:'ym2413',options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundYm2413 & PlaygroundChipClock & {readonly id:string}>;

/** OPL family. Y8950 exposes FM here; its ADPCM bus remains a raw-register API. */
type PlaygroundOplChip = 'ym3526'|'ym3812'|'y8950'|'ymf262';
type PlaygroundSelectedOplChip = TetoricaSelectedChip extends 'msx-audio' ? 'y8950' : TetoricaSelectedChip extends PlaygroundOplChip ? TetoricaSelectedChip : 'ym3812';
type PlaygroundOplChannel<K extends PlaygroundOplChip> = K extends 'ymf262'
  ? 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17 : 0|1|2|3|4|5|6|7|8;
type PlaygroundOplWaveform<K extends PlaygroundOplChip> = K extends 'ymf262' ? 0|1|2|3|4|5|6|7
  : K extends 'ym3812' ? 0|1|2|3 : 0;
type PlaygroundOplOperator<K extends PlaygroundOplChip> = K extends 'ymf262' ? 0|1|2|3 : 0|1;
type PlaygroundOplAlgorithm<K extends PlaygroundOplChip> = K extends 'ymf262' ? 0|1|2|3 : 0|1;
interface PlaygroundOplOperatorParams<K extends PlaygroundOplChip = 'ymf262'> {
  am?: boolean|0|1;
  vibrato?: boolean|0|1;
  egt?: boolean|0|1;
  sustain?: boolean|0|1;
  ksr?: boolean|0|1;
  multi?: number;
  mul?: number;
  ksl?: number;
  tl?: number;
  ar?: number;
  dr?: number;
  sl?: number;
  rr?: number;
  waveform?: PlaygroundOplWaveform<K>;
}
interface PlaygroundOplPreset<K extends PlaygroundOplChip = 'ymf262'> {
  label?: string;
  name?: string;
  algorithm?: PlaygroundOplAlgorithm<K>;
  feedback?: number;
  pan?: K extends 'ymf262' ? {left?:boolean;right?:boolean} : {left?:true;right?:true};
  fourOp?: K extends 'ymf262' ? boolean : false;
  operators?: PlaygroundOplOperatorParams<K>[];
}
type PlaygroundOplPresets<K extends PlaygroundOplChip> = Readonly<Record<'sine'|'bell'|'organ',PlaygroundOplPreset<K>>>
  & (K extends 'ymf262' ? Readonly<{'four-op-bell':PlaygroundOplPreset<K>}> : {});
type PlaygroundOplPitch = {fnum:number;block:number};
interface PlaygroundOplBase<K extends PlaygroundOplChip> {
  readonly chip: K;
  readonly channels: K extends 'ymf262' ? 18 : 9;
  initialize(): void;
  reset(): void;
  /** OPL3 also accepts flattened bank addresses 0..511 or a bank argument. */
  writeRegister(register:number,value:number,port?:K extends 'ymf262' ? 0|1 : 0):void;
  getRegisterSnapshot():Uint8Array;
  setOperator(channel:PlaygroundOplChannel<K>,operator:PlaygroundOplOperator<K>,params:PlaygroundOplOperatorParams<K>):void;
  setPreset(channel:PlaygroundOplChannel<K>,preset:PlaygroundOplPreset<K>):void;
  setAlgo(channel:PlaygroundOplChannel<K>,algorithm:PlaygroundOplAlgorithm<K>,feedback?:number):void;
  setPan(channel:PlaygroundOplChannel<K>,left:K extends 'ymf262' ? boolean : true,right:K extends 'ymf262' ? boolean : true):void;
  setFrequency(channel:PlaygroundOplChannel<K>,frequency:number):PlaygroundOplPitch;
  /** Note name or integer MIDI 0..127 within the current clock's hardware range. */
  setNote(channel:PlaygroundOplChannel<K>,note:string|number):PlaygroundOplPitch;
  setPitch(channel:PlaygroundOplChannel<K>,fnum:number,block?:number):void;
  keyOn(channel:PlaygroundOplChannel<K>):void;
  keyOff(channel:PlaygroundOplChannel<K>):void;
  noteOn(channel:PlaygroundOplChannel<K>,note:string|number):void;
  noteOff(channel:PlaygroundOplChannel<K>):void;
  allNotesOff():void;
  setLFO(options:{amDepth?:boolean;pmDepth?:boolean}):void;
  setRhythm(options:{enabled?:boolean;bassDrum?:boolean;snare?:boolean;tom?:boolean;cymbal?:boolean;hiHat?:boolean}):void;
  dispose():void;
}
/** In 4-op mode the paired secondary is owned by its primary (0..2 or 9..11). */
type PlaygroundOpl<K extends PlaygroundOplChip = 'ym3812'> = PlaygroundOplBase<K>
  & (K extends 'ymf262' ? {setFourOp(channel:0|1|2|9|10|11,enabled:boolean):void} : {});
type PlaygroundPrimaryOpl<K extends PlaygroundOplChip> = Omit<PlaygroundOpl<K>,'dispose'> & PlaygroundChipClock & {readonly id:string};
declare function createSoundChip<K extends PlaygroundOplChip>(name:K,options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundOpl<K> & PlaygroundChipClock & {readonly id:string}>;

/** OPM channels 0..7; operators in register order M1, C1, M2, C2 (0..3). */
interface PlaygroundYm2151 {
  writeRegister(register: number, value: number): void;
  reset(): void;
  setOperator(ch: 0|1|2|3|4|5|6|7, operator: 0|1|2|3, options: {dt1?: number; mul?: number; tl?: number; ks?: number; ar?: number; am?: 0|1; d1r?: number; dt2?: number; d2r?: number; d1l?: number; rr?: number}): void;
  setAlgo(ch: 0|1|2|3|4|5|6|7, algorithm: number, feedback?: number): void;
  setPan(ch: 0|1|2|3|4|5|6|7, left: boolean, right: boolean): void;
  /** Note name or integer MIDI 0..127; representable KC/KF range depends on the current clock. */
  setNote(ch: 0|1|2|3|4|5|6|7, note: string|number): number;
  setFrequency(ch: 0|1|2|3|4|5|6|7, hz: number): {keyCode: number; keyFraction: number};
  noteOn(ch: 0|1|2|3|4|5|6|7, note: string|number): void;
  setPitch(ch: 0|1|2|3|4|5|6|7, keyCode: number, keyFraction?: number): void;
  keyOn(ch: 0|1|2|3|4|5|6|7, mask?: number): void;
  keyOff(ch: 0|1|2|3|4|5|6|7): void;
  allNotesOff(): void;
  /** Noise replaces CH8's last operator; frequency 0..31. */
  setNoise(enabled: boolean, frequency?: number): void;
  dispose(): void;
}
declare function createSoundChip(name: 'ym2151', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundYm2151 & PlaygroundChipClock & {readonly id: string}>;

/** MAME-derived 32X PWM. Offsets use the output sample rate, not 44,100 Hz VGM units. */
type PlaygroundPWM32X = {
  write(register: 0 | 1 | 2 | 3 | 4, value: number): Promise<void>;
  writeRegister(register: 0 | 1 | 2 | 3 | 4, value: number): Promise<void>;
  read(register: number): Promise<number>;
  reset(): Promise<void>;
  scheduleWrites(entries: Array<{frame: number; register: 0 | 1 | 2 | 3 | 4; value: number}>): Promise<number>;
  clearSchedule(): Promise<void>;
  getState(): Promise<{model: 'mame'; outputMode: 'dac' | 'duty'; clock: number; sampleRate: number; currentFrame: number; queuedWrites: number}>;
  dispose(): void;
};
declare function createSoundChip(name: 'pwm', options?: PlaygroundCreateSoundChipOptions): Promise<PlaygroundPWM32X & PlaygroundChipClock & {readonly id: string}>;

/** NES APU; primary NES mode enables FDS. Independent instances opt in with {fds:true}. */
interface PlaygroundNes {
  resetRegisters():void;
  loadMemory(bytes:Uint8Array|ArrayBuffer,address?:number):void|Promise<unknown>;
  readonly clock: number;
  readonly fdsEnabled: boolean;
  pulse: {
    setVoice(channel: 0|1, voice: {duty?:0.125|0.25|0.5|0.75; volume?:number; envelope?:{period:number; loop?:boolean}; sweep?:{enabled?:boolean; period?:number; negate?:boolean; shift?:number}}): void;
    setNote(channel: 0|1, note: string|number): void;
    /** Set frequency in Hz without starting playback. Returns the hardware timer period. */
    setFrequency(channel: 0|1, hz: number): number;
    /** Start/retrigger the configured pitch, without replacing its frequency. */
    keyOn(channel: 0|1): void;
    /** Stop playback while keeping the configured pitch. */
    keyOff(channel: 0|1): void;
    noteOn(channel: 0|1, note: string|number): void;
    noteOff(channel: 0|1): void;
  };
  triangle: {setFrequency(hz:number):number; keyOn():void; keyOff():void; setNote(note:string|number):void; noteOn(note:string|number):void; noteOff():void};
  noise: {setVoice(options?:{volume?:number; period?:number; shortMode?:boolean}):void; noteOn():void; noteOff():void};
  dmc: {
    loadSample(bytes:Uint8Array|ArrayBuffer, options?:{address?:number}):Promise<{address:number; length:number}>;
    play(options?:{rate?:number; loop?:boolean; level?:number}):void;
    stop():void;
  };
  fds: {
    setWave(wave:ArrayLike<number>):void;
    setVolume(gain:number, masterScale?:number):void;
    setFrequency(hz:number):number;
    keyOn():void;
    keyOff():void;
    setNote(note:string|number):void;
    noteOn(note:string|number):void;
    noteOff():void;
    setModulation(options:{table:ArrayLike<number>; rate?:number; depth?:number; bias?:number; enabled?:boolean}):void;
  };
  writeRegister(address:number, value:number):void;
  setFrequency(channel:0|1|2|5, hz:number):number;
  setNote(channel:0|1|2|5, note:string|number):number;
  /** Start/retrigger the frequency already configured with setFrequency or setNote. */
  keyOn(channel:0|1|2|5):void;
  keyOff(channel:0|1|2|3|4|5):void;
  noteOn(channel:0|1|2|5, note:string|number):void;
  noteOff(channel:0|1|2|3|4|5):void;
  reset():void;
  dispose():void;
}
declare function createSoundChip(name:'nes', options?:PlaygroundCreateSoundChipOptions & {fds?:boolean;clock?:number}):Promise<PlaygroundNes & PlaygroundChipClock & {readonly id:string}>;

type PlaygroundPrimaryNes = Omit<PlaygroundNes, 'dispose' | 'fdsEnabled'> & PlaygroundChipClock & {readonly id:string; readonly fdsEnabled:true};
type PlaygroundPrimarySnes = Omit<PlaygroundSnes, 'dispose'> & {readonly id:string};
type PlaygroundPrimaryOpm = Omit<PlaygroundYm2151, 'dispose'> & PlaygroundChipClock & {readonly id:string};

type PlaygroundHuc6280Channel = 0|1|2|3|4|5;
/** HuC6280: six 32-sample, five-bit wavetable voices; noise on channels 4 and 5. */
interface PlaygroundHuc6280 {
  initialize():void;
  reset():void;
  writeRegister(register:number, value:number):void;
  setWaveform(channel:PlaygroundHuc6280Channel, samples:number[]|Uint8Array):void;
  setVolume(channel:PlaygroundHuc6280Channel, volume:number):void;
  setPan(channel:PlaygroundHuc6280Channel, left:number, right?:number):void;
  setMasterVolume(left:number, right?:number):void;
  setFrequency(channel:PlaygroundHuc6280Channel, hz:number):number;
  setNote(channel:PlaygroundHuc6280Channel, note:string|number):number;
  keyOn(channel:PlaygroundHuc6280Channel):void;
  keyOff(channel:PlaygroundHuc6280Channel):void;
  noteOn(channel:PlaygroundHuc6280Channel, note:string|number):void;
  allNotesOff():void;
  setNoise(channel:4|5, options:{enabled:boolean;frequency?:number}):void;
  setDda(channel:PlaygroundHuc6280Channel, enabled:boolean):void;
  writeDda(channel:PlaygroundHuc6280Channel, sample:number):void;
  setLfo(options:{frequency:number;depth:0|1|2|3;reset?:boolean}):void;
  dispose():void;
}
type PlaygroundPrimaryHuc6280 = Omit<PlaygroundHuc6280, 'dispose'> & PlaygroundChipClock & {readonly id:string};
declare function createSoundChip(name:'huc6280', options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundHuc6280 & PlaygroundChipClock & {readonly id:string}>;

interface PlaygroundOki6258Sample {
  bytes:number;
  frames:number;
  sampleRate:number;
  durationSeconds:number;
}
/** OKIM6258 four-bit ADPCM stream. Encoded bytes play low nibble first. */
interface PlaygroundOki6258 {
  readonly playbackRate:number;
  readonly sample:PlaygroundOki6258Sample|null;
  loadMemory(bytes:Uint8Array|ArrayBuffer, options?:{sampleRate?:number}):Promise<void>;
  loadSample(source:{channels:ArrayLike<number>[];sampleRate:number}|AudioBuffer|string|URL|Uint8Array|ArrayBuffer|Blob,
    options?:{sampleRate?:number;signal?:AbortSignal;decodeAudio?:(bytes:ArrayBuffer)=>Promise<AudioBuffer|{channels:ArrayLike<number>[];sampleRate:number}>}):Promise<PlaygroundOki6258Sample & {paddedFrames:number}>;
  /** Select nearest VCLK rate using the current master clock / 1024, / 768 or / 512. */
  setPlaybackRate(hz:number):number;
  setDivider(divider:1024|768|512):number;
  setPan(left?:boolean, right?:boolean):void;
  play(options?:{repeat?:boolean}):void;
  stop():void;
  keyOff():void;
  allNotesOff():void;
  /** Stop and reset divider/pan, retaining uploaded sample bytes and master clock. */
  reset():void;
  writeRegister(register:number, value:number):void;
  dispose():void;
}
type PlaygroundPrimaryOki6258 = Omit<PlaygroundOki6258, 'dispose'> & PlaygroundChipClock & {readonly id:string};
declare function createSoundChip(name:'okim6258', options?:PlaygroundCreateSoundChipOptions):Promise<PlaygroundOki6258 & PlaygroundChipClock & {readonly id:string}>;
