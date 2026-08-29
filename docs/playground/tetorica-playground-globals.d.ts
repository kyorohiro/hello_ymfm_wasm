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

/**
 * One logical YM2612 channel preset used by `fm.setPreset()`.
 */
type YM2612Preset = {
  algorithm?: number;
  feedback?: number;
  ams?: number;
  pms?: number;
  pan?: {
    left?: boolean;
    right?: boolean;
  };
  left?: boolean;
  right?: boolean;
  lfo?: {
    enabled?: boolean;
    frequency?: number;
  };
  operators?: {
    1?: YM2612OperatorParams;
    2?: YM2612OperatorParams;
    3?: YM2612OperatorParams;
    4?: YM2612OperatorParams;
  };
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
  | "one-op-basic"
  | "one-op-flute"
  | "two-op-bell"
  | "two-op-organ"
  | "four-op-brass"
  | "four-op-pad"
  | "coin"
  | "laser"
  | "hit"
  | "burst"
  | "ui-confirm"
  | "ui-select"
  | "ui-cancel"
  | "ui-error"
  | "ui-cursor"
  | "item-get"
  | "power-up"
  | "damage"
  | "heavy-hit"
  | "warning"
  | "teleport"
  | "scanner"
  | "machine-hum"
  | "engine-low"
  | "metallic-ping"
  | "ritual-bell"
  | "horror-drone"
  | "dark-ambient"
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

/** Options for `fx.gain()`. */
type GainFXOptions = {
  /** Linear gain amount. Default is 1. */
  gain?: number;
};

/** Options for `fx.eq()`. */
type EqFXOptions = {
  bass?: number;
  mid?: number;
  treble?: number;
};

/** Options for `fx.filter()`. */
type FilterFXOptions = {
  type?: string;
  cutoff?: number;
  q?: number;
};

/** Options for `fx.delay()`. */
type DelayFXOptions = {
  time?: number;
  feedback?: number;
  mix?: number;
};

/** Options for `fx.distortion()`. */
type DistortionFXOptions = {
  drive?: number;
  mix?: number;
  output?: number;
};

/** Options for `fx.compressor()`. */
type CompressorFXOptions = {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
  output?: number;
};

/** Options for `fx.gate()`. */
type GateFXOptions = {
  threshold?: number;
  floor?: number;
  mix?: number;
};

/** Options for `fx.wobble()`. */
type WobbleFXOptions = {
  cutoff?: number;
  depth?: number;
  rate?: number;
  resonance?: number;
  mix?: number;
};

/** Options for `fx.flanger()`. */
type FlangerFXOptions = {
  time?: number;
  depth?: number;
  rate?: number;
  feedback?: number;
  mix?: number;
};

/** Options for `fx.reverb()`. */
type ReverbFXOptions = {
  mix?: number;
  tone?: number;
};

/** Options for `fx.slicer()`. */
type SlicerFXOptions = {
  phase?: number;
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

type BaseFXUnit = {
  type: string;
  input: AudioNode;
  output: AudioNode;
  params: Record<string, unknown>;
  connect(target: FXConnectTarget): FXConnectTarget;
  disconnect(): void;
  dispose(): void;
};

type FXBranch = {
  type: "branch";
  effects: AnyFXUnit[];
};

type GainFXUnit = BaseFXUnit & {
  type: "gain";
  gain: AudioParamControl;
};

type EqFXUnit = BaseFXUnit & {
  type: "eq";
  bass: AudioParamControl;
  mid: AudioParamControl;
  treble: AudioParamControl;
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
  mix: SimpleParamControl;
};

type DistortionFXUnit = BaseFXUnit & {
  type: "distortion";
  drive: AudioParamControl;
  mix: SimpleParamControl;
  outputGain: AudioParamControl;
};

type CompressorFXUnit = BaseFXUnit & {
  type: "compressor";
  threshold: AudioParamControl;
  knee: AudioParamControl;
  ratio: AudioParamControl;
  attack: AudioParamControl;
  release: AudioParamControl;
  outputGain: AudioParamControl;
};

type GateFXUnit = BaseFXUnit & {
  type: "gate";
  threshold: SimpleParamControl;
  floor: AudioParamControl;
  mix: SimpleParamControl;
};

type WobbleFXUnit = BaseFXUnit & {
  type: "wobble";
  cutoff: AudioParamControl;
  depth: AudioParamControl;
  rate: SimpleParamControl;
  resonance: AudioParamControl;
  mix: SimpleParamControl;
};

type FlangerFXUnit = BaseFXUnit & {
  type: "flanger";
  time: AudioParamControl;
  depth: AudioParamControl;
  rate: SimpleParamControl;
  feedback: AudioParamControl;
  mix: SimpleParamControl;
};

type ReverbFXUnit = BaseFXUnit & {
  type: "reverb";
  mix: SimpleParamControl;
  tone: AudioParamControl;
};

type SlicerFXUnit = BaseFXUnit & {
  type: "slicer";
  phase: SimpleParamControl;
  mix: AudioParamControl;
};

type ParallelFXUnit = BaseFXUnit & {
  type: "parallel";
  branches: FXBranch[];
};

type AnyFXUnit =
  | GainFXUnit
  | EqFXUnit
  | FilterFXUnit
  | DelayFXUnit
  | DistortionFXUnit
  | CompressorFXUnit
  | GateFXUnit
  | WobbleFXUnit
  | FlangerFXUnit
  | ReverbFXUnit
  | SlicerFXUnit
  | ParallelFXUnit;

declare const fm: {
  /** Reset YM2612 state. */
  reset(): void;
  /** Apply one preset to one YM2612 channel. */
  setPreset(channel: YM2612Channel, preset: YM2612Preset): void;
  /** Partially update one logical operator `0..3`. */
  setOperator(channel: YM2612Channel, operator: YM2612Operator, params: YM2612OperatorParams): void;
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

declare const psg: {
  /** Send one raw Sega PSG (SN76489-compatible) register byte. */
  write(value: number): void;
  /** Reset only the Sega PSG state. */
  reset(): void;
  /** Reset both PSG and YM2612 state. */
  resetAll(): void;
};

/** Write one PSG tone channel period + attenuation pair. Channel is 0..2. */
declare function psgTone(channel: number, period: number, attenuation?: number): void;
/** Write PSG noise mode + attenuation. Mode is the raw 3-bit noise register value 0..7. */
declare function psgNoise(mode: number, attenuation?: number): void;

declare const fx: {
  /** Create a gain effect unit. */
  gain(options?: GainFXOptions): GainFXUnit;
  /** Create a simple 3-band EQ effect unit. */
  eq(options?: EqFXOptions): EqFXUnit;
  /** Create a filter effect unit. */
  filter(options?: FilterFXOptions): FilterFXUnit;
  /** Create a delay effect unit. */
  delay(options?: DelayFXOptions): DelayFXUnit;
  /** Create a simple wave-shaper distortion effect unit. */
  distortion(options?: DistortionFXOptions): DistortionFXUnit;
  /** Create a DynamicsCompressor-based effect unit. */
  compressor(options?: CompressorFXOptions): CompressorFXUnit;
  /** Create a simple noise-gate style effect unit. */
  gate(options?: GateFXOptions): GateFXUnit;
  /** Create an LFO-driven filter wobble effect unit. */
  wobble(options?: WobbleFXOptions): WobbleFXUnit;
  /** Create a short-delay modulation flanger effect unit. */
  flanger(options?: FlangerFXOptions): FlangerFXUnit;
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

/** Create or replace a named repeating live loop. */
declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
/** Prepare shared live state once and reuse it across runs. */
declare function livePrepare(name: string, fn: (context: { fx: typeof fx; fm: typeof fm; psg: typeof psg; log: (...args: unknown[]) => void }) => Promise<any> | any): Promise<any>;
/** Play one note through the current synth setup. */
declare function play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
/** Wait for a number of seconds. */
declare function sleep(seconds: number): Promise<void>;
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
/** Browser timer helper available in playground examples. */
declare function setInterval(handler: () => void, timeout?: number): number;
/** Browser timer helper available in playground examples. */
declare function clearInterval(id: number): void;

declare const pg: {
  /** Low-level YM2612 synth API. */
  fm: typeof fm;
  /** Master FX helper API. */
  fx: typeof fx;
  /** Raw Sega PSG API, mixed into the same output as fm. */
  psg: typeof psg;
  psgTone: typeof psgTone;
  psgNoise: typeof psgNoise;
  /** Built-in preset table. */
  presets: typeof FM_PRESETS;
  /** Play one note through the current synth setup. */
  play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
  sleep: typeof sleep;
  beat: typeof beat;
  nextBeat: typeof nextBeat;
  tween: typeof tween;
  setBpm: typeof setBpm;
  liveLoop: typeof liveLoop;
  livePrepare: typeof livePrepare;
  scale: typeof scale;
  chord: typeof chord;
  noteToBlockFnum: typeof noteToBlockFnum;
  noteLerp: typeof noteLerp;
  choose: typeof choose;
  cycle: typeof cycle;
  rand: typeof rand;
  rrange: typeof rrange;
  randInt: typeof randInt;
  lerp: typeof lerp;
  stopLoop: typeof stopLoop;
  stopAllLoops: typeof stopAllLoops;
  stopAll: typeof stopAll;
  setMasterVolume: typeof setMasterVolume;
  getMasterVolume: typeof getMasterVolume;
  log: (...args: unknown[]) => void;
};
