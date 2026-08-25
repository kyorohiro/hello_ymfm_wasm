/**
 * One logical YM2612 operator parameter block used by `fm.setOperator()`.
 *
 * Public operator numbers are logical `1..4`.
 * They are not the YM2612 physical slot order.
 */
type YM2612OperatorParams = {
  dt?: number;
  multi?: number;
  tl?: number;
  rs?: number;
  ar?: number;
  am?: boolean;
  d1r?: number;
  sr?: number;
  d2r?: number;
  sl?: number;
  rr?: number;
  ssg?: number;
};

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
 * `MEGADRIVE_FM_PRESETS["..."]`
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
declare const MEGADRIVE_FM_PRESETS: Record<MegaDriveFmPresetName, YM2612Preset>;

/**
 * Common play helper options used by `play()` and `pg.play()`.
 */
type PlaygroundPlayOptions = {
  /** YM2612 channel 0..5. */
  channel?: number;
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

/** Options for `fx.reverb()`. */
type ReverbFXOptions = {
  mix?: number;
  tone?: number;
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

type ReverbFXUnit = BaseFXUnit & {
  type: "reverb";
  mix: SimpleParamControl;
  tone: AudioParamControl;
};

type AnyFXUnit =
  | GainFXUnit
  | EqFXUnit
  | FilterFXUnit
  | DelayFXUnit
  | ReverbFXUnit;

declare const fm: {
  /** Reset YM2612 state. */
  reset(): void;
  /** Apply one preset to one YM2612 channel. */
  setPreset(channel: number, preset: YM2612Preset): void;
  /** Partially update one logical operator `1..4`. */
  setOperator(channel: number, operator: number, params: YM2612OperatorParams): void;
  /** Set channel algorithm and feedback. */
  setAlgo(channel: number, algorithm: number, feedback?: number): void;
  /** Set left/right output plus AMS/PMS on one channel. */
  setPan(channel: number, left: boolean, right: boolean, ams?: number, pms?: number): void;
  /** Set chip-level LFO enable and frequency. */
  setLfo(enabled: boolean, frequency: number): void;
  /** Enable or disable YM2612 channel 3 special / 3-slot mode. */
  setChannel3SpecialMode(enabled: boolean): void;
  /** Set one logical channel 3 operator frequency while special mode is active. */
  setChannel3SpecialFrequency(operator: number, block: number, fnum: number): void;
  /** Enable or disable the YM2612 DAC playback path on channel 6. */
  setDacEnabled(enabled: boolean): void;
  /** Write one 8-bit DAC sample byte to YM2612 register 0x2A. */
  writeDac(value: number): void;
  /** Trigger note on with raw YM2612 BLOCK/F-NUM values. */
  noteOn(channel: number, block: number, fnum: number): void;
  /** Trigger note off on one channel. */
  noteOff(channel: number): void;
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

declare const fx: {
  /** Create a gain effect unit. */
  gain(options?: GainFXOptions): GainFXUnit;
  /** Create a simple 3-band EQ effect unit. */
  eq(options?: EqFXOptions): EqFXUnit;
  /** Create a filter effect unit. */
  filter(options?: FilterFXOptions): FilterFXUnit;
  /** Create a delay effect unit. */
  delay(options?: DelayFXOptions): DelayFXUnit;
  /** Create a reverb effect unit. */
  reverb(options?: ReverbFXOptions): ReverbFXUnit;
  /** Replace the current master FX chain. */
  setChain(effects: AnyFXUnit[]): void;
  /** Clear the current master FX chain. */
  clear(): void;
};

/** Create or replace a named repeating live loop. */
declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
/** Prepare shared live state once and reuse it across runs. */
declare function livePrepare(name: string, fn: (context: { fx: typeof fx; fm: typeof fm; log: (...args: unknown[]) => void }) => Promise<any> | any): Promise<any>;
/** Play one note through the current synth setup. */
declare function play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
/** Wait for a number of seconds. */
declare function sleep(seconds: number): Promise<void>;
/** Wait for a number of beat units. */
declare function beat(beats?: number): Promise<void>;
/** Wait for the next integer beat boundary. */
declare function nextBeat(): Promise<void>;
/**
 * Set the shared tempo used by beat() and nextBeat().
 * @param bpm Beats per minute. For example, 120 means 120 quarter-note beats per minute.
 */
declare function setBpm(bpm: number): void;
/** Build an array of note names from one named scale. */
declare function scale(root: string, name: string, octaves?: number): string[];
/** Pick one random item from an array. */
declare function choose<T>(values: T[]): T;
/** Return a random float from 0 to 1. */
declare function rand(): number;
/** Return a random integer in the inclusive range. */
declare function randInt(min: number, max: number): number;
/** Stop one named live loop. */
declare function stopLoop(name: string): void;
/** Stop all live loops. */
declare function stopAllLoops(): void;
/** Stop all sounding notes and playback state. */
declare function stopAll(): void;
/** Browser timer helper available in playground examples. */
declare function setInterval(handler: () => void, timeout?: number): number;
/** Browser timer helper available in playground examples. */
declare function clearInterval(id: number): void;

declare const pg: {
  /** Low-level YM2612 synth API. */
  fm: typeof fm;
  /** Master FX helper API. */
  fx: typeof fx;
  /** Built-in preset table. */
  presets: typeof MEGADRIVE_FM_PRESETS;
  /** Play one note through the current synth setup. */
  play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
  sleep: typeof sleep;
  beat: typeof beat;
  nextBeat: typeof nextBeat;
  setBpm: typeof setBpm;
  liveLoop: typeof liveLoop;
  livePrepare: typeof livePrepare;
  scale: typeof scale;
  choose: typeof choose;
  rand: typeof rand;
  randInt: typeof randInt;
  stopLoop: typeof stopLoop;
  stopAllLoops: typeof stopAllLoops;
  stopAll: typeof stopAll;
  log: (...args: unknown[]) => void;
};
