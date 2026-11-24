// SPDX-License-Identifier: BSD-3-Clause
import { selectCodeHostDeclarations, SYNTH_CODE_GLOBALS } from '../synth/synth_code_declarations.js';

const types = `
/** OPNB FM operations. YM2610 logical channels 0–3 map to hardware slots 1, 2, 4, 5. */
interface Fm2610CodeFm<Channel extends OPNFmChannel> extends Fm2610TimedApi<Channel> {
  readonly clock: number;
  readonly channelCount: 4 | 6;
  /** Reset the chip registers and retain both ADPCM ROM banks. */
  reset(): void;
  /** Raw register bus. Port 0 also exposes SSG and ADPCM-B, port 1 exposes ADPCM-A. */
  write(port: 0 | 1, register: number, value: number): void;
  setPreset(channel: Channel, preset: PlaygroundOPNPreset): void;
  setOperator(channel: Channel, operator: YM2612Operator, params: YM2612OperatorParams): void;
  setOperators(channel: Channel, entries: Array<[YM2612Operator, YM2612OperatorParams]>): void;
  setAlgo(channel: Channel, algorithm: YM2612Algorithm, feedback?: YM2612Feedback): void;
  setPan(channel: Channel, left: boolean, right: boolean, ams?: YM2612Ams, pms?: YM2612Pms): void;
  setModulation(channel: Channel, ams: YM2612Ams, pms: YM2612Pms): void;
  setLfo(enabled: boolean, frequency: number): void;
  setChannel3SpecialMode(enabled: boolean): void;
  setChannel3SpecialFrequency(operator: YM2612Operator, block: number, fnum: number): void;
  setFrequency(channel: Channel, hz: number): void;
  setFrequency(channel: Channel, block: number, fnum: number): void;
  setNote(channel: Channel, note: string | number): void;
  setBlockFnum(channel: Channel, block: number, fnum: number): void;
  keyOn(channel: Channel, operators?: YM2612Operator[]): void;
  keyOff(channel: Channel): void;
  noteOn(channel: Channel, note: string | number): void;
  noteOn(channel: Channel, block: number, fnum: number): void;
  noteOnRaw(channel: Channel, block: number, fnum: number): void;
  noteOff(channel: Channel): void;
}

type Fm2610TimedMethod =
  'write' | 'setPreset' | 'setOperator' | 'setOperators' | 'setAlgo' | 'setPan' |
  'setModulation' | 'setLfo' | 'setChannel3SpecialMode' | 'setChannel3SpecialFrequency' |
  'setNote' | 'setBlockFnum' | 'keyOn' | 'keyOff' | 'noteOnRaw' | 'noteOff';
type Fm2610OperationRecorder<Channel extends OPNFmChannel> = {
  [Method in Fm2610TimedMethod]:
    (...args: Parameters<Fm2610CodeFm<Channel>[Method]>) => Fm2610OperationRecorder<Channel>;
} & {
  atSample(offset: number): Fm2610OperationRecorder<Channel>;
  atSeconds(offset: number): Fm2610OperationRecorder<Channel>;
  rawWrite(port: 0 | 1, register: number, value: number): Fm2610OperationRecorder<Channel>;
  setFrequency(channel: Channel, hz: number): Fm2610OperationRecorder<Channel>;
  setFrequency(channel: Channel, block: number, fnum: number): Fm2610OperationRecorder<Channel>;
  noteOn(channel: Channel, note: string | number): Fm2610OperationRecorder<Channel>;
  noteOn(channel: Channel, block: number, fnum: number): Fm2610OperationRecorder<Channel>;
};
interface Fm2610OperationProgram {
  readonly version: 1;
  readonly chip: 'ym2610' | 'ym2610b';
  readonly referenceSampleRate: number;
  readonly operations: readonly unknown[];
}
interface Fm2610TimedSnapshot {
  readonly format: 'tetorica-ym2610-state';
  readonly variant: 'ym2610' | 'ym2610b';
  readonly clock: number;
  readonly frame: number;
  readonly sampleRate: number;
  readonly registers: readonly (readonly number[])[];
}
interface Fm2610CompiledWrite {
  port: 0 | 1;
  register: number;
  value: number;
  offsetSeconds: number;
  operationIndex: number;
  writeIndex: number;
}
interface Fm2610ScheduleReceipt {
  name: string;
  startFrame?: number;
  sampleRate: number;
  entries: number;
  repeatSeconds?: number;
  staged?: boolean;
}
interface Fm2610TimedApi<Channel extends OPNFmChannel> {
  /** Build register operations without writing to the live chip. Offsets are relative to the pattern start. */
  build(callback: (recorder: Fm2610OperationRecorder<Channel>) => void | Fm2610OperationRecorder<Channel>,
    options?: {referenceSampleRate?: number}): Fm2610OperationProgram;
  compile(program: Fm2610OperationProgram,
    options?: {initialState?: 'current' | 'reset' | Fm2610TimedSnapshot}): Promise<Fm2610CompiledWrite[]>;
  captureState(): Promise<Fm2610TimedSnapshot>;
  schedule(program: Fm2610OperationProgram,
    options: {name: string; repeatSeconds?: number}): Promise<Fm2610ScheduleReceipt>;
  clearSchedule(name: string): Promise<boolean>;
}

interface Fm2610BCodeFm extends Fm2610CodeFm<OPNFmChannel> {
  rawWrite(port: 0 | 1, register: number, value: number): void;
  writeAddress(port: 0 | 1, register: number): void;
  writeData(value: number): void;
}

type Fm2610SsgChannel = 0 | 1 | 2;
interface Fm2610CodeSsg {
  readonly clock: number;
  write(register: number, value: number): void;
  reset(): void;
  setTonePeriod(channel: Fm2610SsgChannel, period: number): void;
  setFrequency(channel: Fm2610SsgChannel, hz: number): number;
  setNote(channel: Fm2610SsgChannel, note: string | number): number;
  setMixer(channel: Fm2610SsgChannel, options: {tone?: boolean; noise?: boolean}): void;
  setVolume(channel: Fm2610SsgChannel, volume: number, envelope?: boolean): void;
  /** Set the envelope shared by all three SSG channels. Writing shape retriggers it. */
  setEnvelope(options: {period?: number; shape?: number}): void;
  tone(channel: Fm2610SsgChannel, options: {period?: number; frequency?: number; note?: string | number; volume?: number; envelope?: boolean}): number;
  noise(channel: Fm2610SsgChannel, options?: {period?: number; volume?: number; envelope?: boolean}): void;
  keyOn(channel: Fm2610SsgChannel): void;
  keyOff(channel: Fm2610SsgChannel): void;
  noteOn(channel: Fm2610SsgChannel, note: string | number): void;
  noteOff(channel: Fm2610SsgChannel): void;
  off(channel: Fm2610SsgChannel): void;
}

/** Start and exclusive end byte addresses, both aligned to 256 bytes. */
interface Fm2610RomRange { start: number; end: number; }
interface Fm2610CodeAdpcmA {
  /** Upload Yamaha ADPCM-A bytes to this chip's separate 16 MiB ROM bank. */
  loadMemory(bytes: Uint8Array | ArrayBuffer, address?: number): Promise<void>;
  /** ADPCM-A is fixed rate. Each voice range is shorter than 1 MiB. */
  setSample(voice: OPNFmChannel, range: Fm2610RomRange): void;
  /** Shared hardware level 0–63. */
  setVolume(volume: number): void;
  /** Individual hardware level 0–31 and independent stereo gates. */
  setVoice(voice: OPNFmChannel, options?: {volume?: number; left?: boolean; right?: boolean}): void;
  keyOn(voices: OPNFmChannel | readonly OPNFmChannel[]): void;
  keyOff(voices: OPNFmChannel | readonly OPNFmChannel[]): void;
  reset(): void;
}

interface Fm2610CodeAdpcmB {
  readonly clock: number;
  /** Upload encoded Yamaha ADPCM-B bytes to its own 16 MiB bank. */
  loadMemory(bytes: Uint8Array | ArrayBuffer, address?: number): Promise<void>;
  setSample(range: Fm2610RomRange): void;
  /** Raw playback rate register 1–65535. */
  setDeltaN(value: number): void;
  /** Set decoded samples per second and return the actual quantized rate. */
  setPlaybackRate(rate: number): number;
  setVolume(volume: number): void;
  setPan(left: boolean, right: boolean): void;
  /** Repeat the whole selected range until keyOff. */
  keyOn(options?: {repeat?: boolean}): void;
  keyOff(): void;
  reset(): void;
}

interface Fm2610CodeSections {
  readonly ssg: Fm2610CodeSsg;
  readonly adpcmA: Fm2610CodeAdpcmA;
  readonly adpcmB: Fm2610CodeAdpcmB;
}

type Fm2610CodeSoundChipMap = {
  ym2610: Fm2610CodeSections & {readonly id: 'ym2610'; readonly fm: Fm2610CodeFm<0 | 1 | 2 | 3>};
  ym2610b: Fm2610CodeSections & {readonly id: 'ym2610b'; readonly fm: Fm2610BCodeFm};
};
type PlaygroundSelectedFmChannel = OPNFmChannel;
type PlaygroundLivePrepareAPI = Fm2610CodeAPI;
/** Borrow the chip selected in the Synth header. Select its matching variant before running. */
declare function useSoundChip<Name extends keyof Fm2610CodeSoundChipMap>(name: Name): Promise<Fm2610CodeSoundChipMap[Name]>;
declare const fm: Fm2610CodeFm<OPNFmChannel>;
declare function parseNoteName(note: string): number;
declare function toPitch(note: string | number): {block: number; fnum: number};
declare function midiToNoteName(midi: number): string;
declare function trackAsync(task: PromiseLike<unknown>): void;
/** Decode a base64 string into a string of bytes using the browser decoder. */
declare function atob(data: string): string;
declare const pg: Fm2610CodeAPI;
`;

export function selectFm2610CodeDeclarations(source) {
  return selectCodeHostDeclarations(source, {
    globals: SYNTH_CODE_GLOBALS, customTypes: types, apiName: 'Fm2610CodeAPI',
    banner: 'FM2610 Synth Code borrows the selected YM2610 or YM2610B with FM, SSG and separate ADPCM-A/B banks.',
  });
}
