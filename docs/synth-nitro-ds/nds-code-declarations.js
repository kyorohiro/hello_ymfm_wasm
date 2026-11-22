// SPDX-License-Identifier: BSD-3-Clause
import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js';

const CHANNELS = Array.from({ length: 16 }, (_, index) => 'CH' + (index + 1));
const GLOBALS = [
	...CHANNELS, 'context', 'console', 'log', 'useSoundChip', 'file', 'pg',
	'setBpm', 'beat', 'nextBeat', 'sleep', 'sleepSamples', 'tween',
	'liveLoop', 'livePrepare', 'liveCleanup', 'stopLoop', 'stopAllLoops', 'trackAsync',
	'parseNoteName', 'midiToNoteName', 'scale', 'chord', 'lerp', 'choose', 'cycle', 'rand', 'rrange', 'randInt',
];

const TYPES = `
type NdsCodeChannel = ${CHANNELS.map((name) => 'typeof ' + name).join(' | ')};
type NdsCodeMode = 'pcm8' | 'pcm16' | 'adpcm' | 'pulse' | 'noise';
type NdsCodeShape = 'sine' | 'triangle' | 'saw' | 'square';
interface NdsCodeVoiceSettings {
  /** Pulse uses CH9–CH14. Noise uses CH15–CH16. */
  mode?: NdsCodeMode;
  /** Software template for a PCM8, PCM16 or ADPCM waveform. */
  shape?: NdsCodeShape;
  /** Hardware channel volume, 0–127. */
  volume?: number;
  /** Hardware stereo position, 0 left through 127 right. */
  pan?: number;
  /** Divider code, normal / ÷2 / ÷4 / ÷16. */
  divider?: 0 | 1 | 2 | 3;
  /** Pulse duty code, 0–7. */
  duty?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  loop?: boolean;
  bytes?: Uint8Array;
  loopStartWords?: number;
  lengthWords?: number;
  /** Sample-cycle length for software MIDI pitch conversion. */
  frames?: number | null;
  /** Source sample rate in Hz for imported PCM/ADPCM. Provide with rootNote. */
  sampleRate?: number;
  /** The note played at the source rate. Use an integer MIDI note or a name such as C4. */
  rootNote?: number | string;
  /** Override the hardware timer code (0–65535). */
  timer?: number;
}
interface NdsCodeChannelState extends NdsCodePitch {
  channel: NdsCodeChannel;
  active: boolean;
  mode: NdsCodeMode;
  playingMode: NdsCodeMode | null;
  volume: number;
  pan: number;
  divider: number;
  duty: number;
  loop: boolean;
  loopStartWords: number;
  lengthWords: number;
  byteLength: number;
  position: number;
  releasing: boolean;
  frames: number;
  shape: NdsCodeShape | null;
  sampleRate: number | null;
  rootNote: number | string | null;
  owner: string | null;
  token: number | null;
}
interface NdsCodePitch {
  timer: number;
  frequencyHz: number;
}
interface NdsCodeNote extends NdsCodePitch {
  channel: NdsCodeChannel;
  token: number;
}
type NdsCodeCaptureUnit = 0 | 1;
type NdsCodeCaptureFormat = 'pcm8' | 'pcm16';
interface NdsCodeCaptureSettings {
  format: NdsCodeCaptureFormat;
  /** 1–65535 four-byte words. */
  lengthWords: number;
  /** Program the shared timer on CH2 for unit 0 or CH4 for unit 1. Omit to use its current value. */
  timer?: number;
}
interface NdsCodeCaptureState {
  unit: NdsCodeCaptureUnit;
  active: boolean;
  format: NdsCodeCaptureFormat | null;
  lengthWords: number;
  recordedFrames: number;
  byteLength: number;
  timer: number;
  currentTimer: number;
  timerChannel: typeof CH2 | typeof CH4;
  /** Rate at the start of the take. */
  sampleRate: number;
  timerChanged: boolean;
}
interface NdsCodeCapture extends NdsCodeCaptureState {
  /** A copy of the complete words written by this unit so far. */
  bytes: Uint8Array;
}
/** A saved .nds.json sound, as read by file(path, { type: "json" }). */
interface NdsCodePreset {
  format: 'tetorica-nds-sound';
  version: 1;
  name: string;
  mode: NdsCodeMode;
  shape?: NdsCodeShape;
  volume: number;
  pan: number;
  divider: NonNullable<NdsCodeVoiceSettings['divider']>;
  duty: NonNullable<NdsCodeVoiceSettings['duty']>;
  loop: boolean;
  /** Optional fixed hardware timer code (0–65535). */
  timer?: number;
  sample?: {
    /** Encoded DS sample bytes in base64. */
    bytes: string;
    sampleRate: number;
    rootNote: number;
    loopStartWords: number;
    lengthWords: number;
  } | null;
}
type NdsTimedVoiceSettings = Pick<NdsCodeVoiceSettings, 'volume' | 'pan' | 'divider' | 'duty' | 'timer'>;
interface NdsOperationRecorder {
  /** Absolute offset from the reservation start. The reference rate defaults to 44100 Hz. */
  atSample(sample: number): NdsOperationRecorder;
  /** Absolute offset in seconds from the reservation start. */
  atSeconds(seconds: number): NdsOperationRecorder;
  /** Change live fields on a configured source. Prepare samples before scheduling. */
  configure(channel: NdsCodeChannel, patch: NdsTimedVoiceSettings): NdsOperationRecorder;
  setNote(channel: NdsCodeChannel, note: string | number): NdsOperationRecorder;
  setFrequency(channel: NdsCodeChannel, hz: number): NdsOperationRecorder;
  noteOn(channel: NdsCodeChannel, note: string | number, patch?: NdsTimedVoiceSettings): NdsOperationRecorder;
  /** Software release. The fade is not itself a register write. */
  noteOff(channel: NdsCodeChannel): NdsOperationRecorder;
  keyOn(channel: NdsCodeChannel): NdsOperationRecorder;
  keyOff(channel: NdsCodeChannel): NdsOperationRecorder;
}
interface NdsOperationProgram {
  readonly kind: 'nds-operations';
  readonly referenceSampleRate: number;
  readonly operations: readonly {
    readonly method: Exclude<keyof NdsOperationRecorder, 'atSample' | 'atSeconds'>;
    readonly args: readonly unknown[];
    readonly time: { readonly unit: 'sample' | 'seconds'; readonly value: number };
  }[];
}
interface NdsTimedChannelState {
  channel: NdsCodeChannel;
  mode: NdsCodeMode;
  volume: number;
  pan: number;
  divider: number;
  duty: number;
  timer: number;
  loop: boolean;
  loopStartWords: number;
  lengthWords: number | null;
  frames: number;
  sampleRate: number | null;
  rootNote: number | string | null;
  control: number;
  timerRegister: number;
  sampleAddress: number;
  sampleLengthRegister: number;
  nextSampleAddress: number | null;
  canKeyOn: boolean;
}
/** Detached applied register and source metadata. It contains no sample bytes. */
interface NdsTimedSnapshot {
  readonly chip: 'nds';
  readonly version: 1;
  readonly instanceId: string;
  readonly frame: number;
  readonly sampleRate: number;
  readonly state: readonly Readonly<NdsTimedChannelState>[];
}
interface NdsCompiledWrite {
  offsetSeconds: number;
  /** Physical DS register address, beginning at 0x04000400 for CH1. */
  register: number;
  value: number;
  width: 32;
  operationIndex: number;
  writeIndex: number;
}
interface NdsScheduleReceipt {
  name: string;
  startFrame?: number;
  sampleRate: number;
  entries: number;
  repeatSeconds?: number;
  staged?: boolean;
}
interface NdsCodeClient {
  /** Change the settings of one zero-based physical channel. */
  configure(channel: NdsCodeChannel, patch: NdsCodeVoiceSettings): Promise<NdsCodeChannelState>;
  /** Apply a saved .nds.json without starting playback. Use keyOn() for a fixed preset timer or noteOn() for a musical note. */
  loadPreset(channel: NdsCodeChannel, preset: string | NdsCodePreset): Promise<NdsCodeChannelState>;
  /** Round musical pitch to the hardware timer. Imported samples use source rate at their root note. */
  setFrequency(channel: NdsCodeChannel, hz: number): Promise<NdsCodePitch>;
  setNote(channel: NdsCodeChannel, note: string | number): Promise<NdsCodePitch>;
  /** Prepare the configured sample in bounded chunks without starting playback. */
  prepareVoice(channel: NdsCodeChannel): Promise<NdsCodeChannelState>;
  /** Start the configured channel at its hardware timer value. */
  keyOn(channel: NdsCodeChannel): Promise<NdsCodeNote>;
  /** End this Code voice immediately. Pass a token to match one attack. */
  keyOff(channel: NdsCodeChannel, token?: number): Promise<boolean>;
  /** Convert MIDI or named pitch to timer settings and play the requested channel. */
  noteOn(channel: NdsCodeChannel, note: string | number, settings?: NdsCodeVoiceSettings): Promise<NdsCodeNote>;
  /** Release this Code voice with software click reduction. */
  noteOff(channel: NdsCodeChannel, token?: number): Promise<boolean>;
  getState(channel: NdsCodeChannel): Promise<NdsCodeChannelState>;
  getState(): Promise<NdsCodeChannelState[]>;
  /** Begin one-shot capture from the Synth mixer. Unit 0 is left and unit 1 is right. */
  startCapture(unit: NdsCodeCaptureUnit, settings: NdsCodeCaptureSettings): Promise<NdsCodeCaptureState>;
  getCaptureState(unit: NdsCodeCaptureUnit): Promise<NdsCodeCaptureState>;
  stopCapture(unit: NdsCodeCaptureUnit): Promise<NdsCodeCaptureState>;
  readCapture(unit: NdsCodeCaptureUnit): Promise<NdsCodeCapture>;
  /** Release all voices owned by Code. */
  allNotesOff(): Promise<number>;
  /** Record timed operations without changing the live chip. */
  build(callback: (recorder: NdsOperationRecorder) => void | NdsOperationRecorder, options?: { referenceSampleRate?: number }): NdsOperationProgram;
  /** Capture applied register and source metadata without stopping the renderer. */
  captureState(): Promise<NdsTimedSnapshot>;
  /** Inspect the predicted writes. The DS Synth lacks a complete local shadow, so 'client' rejects. */
  compile(operations: NdsOperationProgram, options?: { initialState?: 'current' | 'reset' | 'client' | NdsTimedSnapshot }): Promise<NdsCompiledWrite[]>;
  /** Add or replace a named AudioWorklet reservation. */
  schedule(operations: NdsOperationProgram, options: { name: string; repeatSeconds?: number }): Promise<NdsScheduleReceipt>;
  /** Cancel future operations from this reservation. */
  clearSchedule(name: string): Promise<boolean>;
}
type PlaygroundLivePrepareAPI = NdsCodeAPI;
declare function useSoundChip(name: 'nds'): Promise<NdsCodeClient>;
declare function trackAsync(task: PromiseLike<unknown>): void;
declare function parseNoteName(note: string): number;
declare function midiToNoteName(midi: number): string;
declare const pg: NdsCodeAPI;
`;

export function selectNdsCodeDeclarations(source) {
	return selectCodeHostDeclarations(source, {
		globals: GLOBALS,
		customTypes: TYPES,
		apiName: 'NdsCodeAPI',
		banner: 'Nitro DS Synth Code · shared Nintendo DS sound channels',
	});
}
