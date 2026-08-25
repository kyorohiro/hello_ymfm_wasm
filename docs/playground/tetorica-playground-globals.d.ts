declare const MEGADRIVE_FM_PRESETS: Record<string, unknown>;

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

type PlaygroundPlayOptions = {
  channel?: number;
  duration?: number;
  preset?: object;
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
  setPreset(channel: number, preset: object): void;
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
