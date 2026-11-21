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
  sample?: {
    /** Encoded DS sample bytes in base64. */
    bytes: string;
    sampleRate: number;
    rootNote: number;
    loopStartWords: number;
    lengthWords: number;
  } | null;
}
interface NdsCodeClient {
  /** Change the settings of one zero-based physical channel. */
  configure(channel: NdsCodeChannel, patch: NdsCodeVoiceSettings): Promise<NdsCodeChannelState>;
  /** Apply a saved .nds.json as JSON text or an object. Call noteOn() to play it. */
  loadPreset(channel: NdsCodeChannel, preset: string | NdsCodePreset): Promise<NdsCodeChannelState>;
  /** Round musical pitch to the hardware timer. Imported samples use source rate at their root note. */
  setFrequency(channel: NdsCodeChannel, hz: number): Promise<NdsCodePitch>;
  setNote(channel: NdsCodeChannel, note: string | number): Promise<NdsCodePitch>;
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
  /** Release all voices owned by Code. */
  allNotesOff(): Promise<number>;
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
