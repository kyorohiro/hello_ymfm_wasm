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

type PlaygroundPlayOptions = {
  channel?: number;
  duration?: number;
  preset?: YM2612Preset;
};

type GainFXOptions = {
  gain?: number;
};

type EqFXOptions = {
  bass?: number;
  mid?: number;
  treble?: number;
};

type FilterFXOptions = {
  type?: string;
  cutoff?: number;
  q?: number;
};

type DelayFXOptions = {
  time?: number;
  feedback?: number;
  mix?: number;
};

type ReverbFXOptions = {
  mix?: number;
  tone?: number;
};

declare const fm: {
  reset(): void;
  setPreset(channel: number, preset: YM2612Preset): void;
  setOperator(channel: number, operator: number, params: YM2612OperatorParams): void;
  setAlgo(channel: number, algorithm: number, feedback?: number): void;
  setPan(channel: number, left: boolean, right: boolean, ams?: number, pms?: number): void;
  setLfo(enabled: boolean, frequency: number): void;
  noteOn(channel: number, block: number, fnum: number): void;
  noteOff(channel: number): void;
  write(port: number, register: number, value: number): void;
  writeAddress(port: number, register: number): void;
  writeData(value: number): void;
  read(offset: number): number;
  readStatus(): number;
  getIrq(): boolean;
  rawWrite(port: number, register: number, value: number): void;
};

declare const fx: {
  gain(options?: GainFXOptions): any;
  eq(options?: EqFXOptions): any;
  filter(options?: FilterFXOptions): any;
  delay(options?: DelayFXOptions): any;
  reverb(options?: ReverbFXOptions): any;
  setChain(effects: any[]): void;
  clear(): void;
};

declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
declare function livePrepare(name: string, fn: (context: { fx: typeof fx; fm: typeof fm; log: (...args: unknown[]) => void }) => Promise<any> | any): Promise<any>;
declare function play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
declare function sleep(seconds: number): Promise<void>;
declare function beat(beats?: number): Promise<void>;
declare function nextBeat(): Promise<void>;
/**
 * Set the shared tempo used by beat() and nextBeat().
 * @param bpm Beats per minute. For example, 120 means 120 quarter-note beats per minute.
 */
declare function setBpm(bpm: number): void;
declare function scale(root: string, name: string, octaves?: number): string[];
declare function choose<T>(values: T[]): T;
declare function rand(): number;
declare function randInt(min: number, max: number): number;
declare function stopLoop(name: string): void;
declare function stopAllLoops(): void;
declare function stopAll(): void;

declare const pg: {
  fm: typeof fm;
  fx: typeof fx;
  presets: typeof MEGADRIVE_FM_PRESETS;
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
