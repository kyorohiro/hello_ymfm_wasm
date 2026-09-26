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

type YM2612Channel = 0 | 1 | 2 | 3 | 4 | 5;
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
declare const FM_PRESETS: Record<MegaDriveFmPresetName, YM2612Preset>;

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
 */
type PlaygroundPlayOptions = {
  /** YM2612 channel 0..5. */
  channel?: YM2612Channel;
  /** Note duration in seconds. */
  duration?: number;
  /** Optional preset applied before playing the note. */
  preset?: YM2612Preset;
};

type PlaygroundSamplePlayOptions = {
  gain?: number;
  /** Native PCM playback requires a positive rate; linear interpolation. */
  playbackRate?: number;
  offset?: number;
  duration?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  fadeIn?: number;
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

type FMApi = {
  /** Reset YM2612 state. */
  reset(): void;
  /** Apply one preset to one YM2612 channel. */
  setPreset(channel: YM2612Channel, preset: YM2612Preset): void;
  /** Partially update one logical operator `0..3`. */
  setOperator(channel: YM2612Channel, operator: YM2612Operator, params: YM2612OperatorParams): void;
  /** Apply entries in array order; fields within each entry use setOperator's order. YM2612 only. */
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
  /** Write BLOCK / F-NUM without KEY ON. */
  setFrequency(channel: YM2612Channel, block: number, fnum: number): void;
  /** Trigger KEY ON on one channel. */
  keyOn(channel: YM2612Channel, operators?: YM2612Operator[]): void;
  /** Trigger KEY OFF on one channel. */
  keyOff(channel: YM2612Channel, operators?: YM2612Operator[]): void;
  /** Write one 8-bit DAC sample byte to YM2612 register 0x2A. */
  writeDac(value: number): void;
  /** Trigger note on with raw YM2612 BLOCK/F-NUM values. */
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

declare const fm: FMApi;

type PSGApi = {
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

declare const psg: PSGApi;
declare const PSG1: 0;
declare const PSG2: 1;
declare const PSG3: 2;

/** Write one PSG tone channel period + attenuation pair. Channel is 0..2. */
declare function psgTone(channel: number, period: number, attenuation?: number): void;
/** Write PSG noise mode + attenuation. Mode is the raw 3-bit noise register value 0..7. */
declare function psgNoise(mode: number, attenuation?: number): void;

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

/** Create or replace a named repeating live loop. */
declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
/** Register a named key-down handler for the current Playground run. */
declare function onKeyboardPressKey(name: string, fn: (event: KeyboardEvent) => void): void;
/** Register a named key-up handler for the current Playground run. */
declare function onKeyboardReleaseKey(name: string, fn: (event: KeyboardEvent) => void): void;
/** Register cleanup that runs once after all named live loops disappear. */
declare function liveCleanup(names: string[], fn: () => Promise<void> | void): void;
/** Prepare shared live state once and reuse it across runs. */
declare function livePrepare(name: string, fn: (context: { fx: FXApi; fm: FMApi; psg: PSGApi; sample: PlaygroundSampleAPI; stream: PlaygroundStreamAPI; noise: PlaygroundNoiseAPI; log: (...args: unknown[]) => void }) => Promise<any> | any): Promise<any>;
/** Play one note through the current synth setup. */
declare function play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
/** Compact YM2612 write helper. Defaults to port 0 when omitted. */
declare function write(register: number, value: number): void;
/** Compact YM2612 write helper with explicit port. */
declare function write(port: number, register: number, value: number): void;
/** Wait for a number of seconds. */
declare function sleep(seconds: number): Promise<void>;
/** Wait for VGM-style sample units. Default sampleRate is 44100. */
declare function sleepSamples(samples: number, sampleRate?: number): Promise<void>;
/** Return the current liveLoop cycle start in VGM sample units. */
declare function beginSampleSchedule(): number;
/** Queue [offsetSamples, port, register, value] writes for the current VGM cycle. */
declare function scheduleWritesSamples(startSamples: number, entries: Array<[number, number, number, number]>): void;
declare const dac: {
  /** Load packed DAC records: little-endian uint32 sample offset + uint8 value. */
  load(name: string, data: ArrayBuffer | Uint8Array): Promise<void>;
  loadBase64(name: string, encoded: string): Promise<void>;
  playStream(name: string, options?: { atSamples?: number }): void;
  schedule(startSamples: number, entries: Array<[number, number]>): void;
  scheduleBase64(startSamples: number, encoded: string): void;
};
/** Wait for a number of beat units. */
declare function beat(beats?: number): Promise<void>;
/** Wait for the next integer beat boundary. */
declare function nextBeat(): Promise<void>;
/** Update something gradually over time with `t = 0..1`. */
declare function tween(seconds: number, fn: (t: number) => void | Promise<void>): Promise<void>;
/**
 * Set the shared tempo used by beat() and nextBeat().
 * @param bpm Beats per minute. For example, 120 means 120 quarter-note beats per minute.
 */
declare function setBpm(bpm: number): void;
/** Build an array of note names from one named scale. */
declare function scale(root: string, name: string, octaves?: number): string[];
/** Build a simple chord from a root note. */
declare function chord(root: string, name: "major" | "minor" | "major7" | "minor7" | "dominant7"): string[];
/** Convert one note name into raw YM2612 BLOCK / F-NUM values. */
declare function noteToBlockFnum(note: string): { block: number; fnum: number };
/** Convert Hz to YM2612 BLOCK/FNUM. Clock defaults to 7670454 Hz. */
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
/** Set the final browser-side master output volume. 1.0 = 100%. */
declare function setMasterVolume(volume: number): number;
/** Read the current browser-side master output volume. */
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

type PlaygroundAPI = {
  createSoundChip: typeof createSoundChip;
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

  midi: PlaygroundMidi;
  /** Low-level YM2612 synth API. */
  fm: FMApi;
  /** Master FX helper API. */
  fx: FXApi;
  /** Raw Sega PSG API, mixed into the same output as fm. */
  psg: PSGApi;
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
  psgTone: (channel: number, period: number, attenuation?: number) => void;
  psgNoise: (mode: number, attenuation?: number) => void;
  PSG1: 0;
  PSG2: 1;
  PSG3: 2;
  /** Built-in preset table. */
  presets: typeof FM_PRESETS;
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
  sleepSamples: (samples: number, sampleRate?: number) => Promise<void>;
  beginSampleSchedule: () => number;
  scheduleWritesSamples: (startSamples: number, entries: Array<[number, number, number, number]>) => void;
  beat: (beats?: number) => Promise<void>;
  nextBeat: () => Promise<void>;
  tween: (seconds: number, fn: (t: number) => void | Promise<void>) => Promise<void>;
  setBpm: (bpm: number) => void;
  liveFx: typeof liveFx;
  liveLoop: (name: string, fn: () => Promise<void> | void) => void;
  onKeyboardPressKey: (name: string, fn: (event: KeyboardEvent) => void) => void;
  onKeyboardReleaseKey: (name: string, fn: (event: KeyboardEvent) => void) => void;
  livePrepare: (name: string, fn: (context: { fx: FXApi; fm: FMApi; psg: PSGApi; sample: PlaygroundSampleAPI; stream: PlaygroundStreamAPI; noise: PlaygroundNoiseAPI; log: (...args: unknown[]) => void }) => Promise<any> | any) => Promise<any>;
  scale: (root: string, name: string, octaves?: number) => string[];
  chord: (root: string, name: "major" | "minor" | "major7" | "minor7" | "dominant7") => string[];
  noteToBlockFnum: (note: string) => { block: number; fnum: number };
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
};

declare var pg: PlaygroundAPI;

interface PlaygroundTiming { lookaheadSeconds: number; schedulerIntervalMs: number; }
/** Configure Schedule lookahead and refill interval before starting loops. Await in Worker mode. */
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
  /** Duration is in beats at setBpm(), unlike the existing global FM play(). */
  play(note: string | number, options?: {velocity?: number; duration?: number}): Promise<void>;
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
  /** WAV/FLAC URL or encoded file bytes. loopStart is a sample offset; omitted means silence after end. */
  loadSample(source: string | Uint8Array | ArrayBuffer | Blob, options?: {address?: number; loopStart?: number}): Promise<{start: number; loopStart: number; step: number}>;
  setChannel(ch: number, options: {start?: number; loopStart?: number; step?: number; volume?: number; pan?: {left: number; right: number}}): Promise<void>;
  setPitch(ch: number, step: number): Promise<void>;
  keyOn(ch: number): Promise<void>;
  keyOff(ch: number): Promise<void>;
  writeRegister(register: number, value: number): Promise<void>;
  /** Reset registers, retain RAM. */
  reset(): Promise<void>;
  dispose(): void;
}
declare function createSoundChip(name: 'rf5c164'): Promise<PlaygroundRf5c164>;
