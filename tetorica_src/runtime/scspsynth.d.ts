import type {Scsp} from './scsp.js';
export const SCSP_SLOT_COUNT: 32;
export const SCSP_LFO_FREQUENCIES_HZ: readonly number[];
export const SCSP_LFO_PITCH_CENTS: readonly number[];
export const SCSP_LFO_AMPLITUDE_DB: readonly number[];
export const SCSP_LFO_WAVEFORMS: readonly string[];
export interface ScspLfo {
  /** Manual frequency code 0..31. */
  frequencyCode: number;
  /** 0 saw, 1 square, 2 triangle, 3 noise. */
  pitchWave: number;
  pitchDepth: number;
  amplitudeWave: number;
  amplitudeDepth: number;
  /** Hold both oscillator phases at zero until cleared. */
  reset: boolean;
}
/** Hardware 64-word sound stack. Offsets are relative to the current stack
 * pointer, not slot numbers; the bundled core has zero slot-write delay. */
export interface ScspModulation {
  /** MDL 0..15; 0 disconnects both inputs. */
  depth: number;
  xOffset: number;
  yOffset: number;
  /** STWINH: retain old sound-stack data instead of writing this slot. */
  writeInhibit: boolean;
}
export type ScspNote = string | number;
export type ScspPCMOptions = ({rootNote: ScspNote; baseFrequencyHz?: never} |
  {baseFrequencyHz: number; rootNote?: never}) & {
    sourceSampleRate?: number;
    /** Reserve repeated waveform guards for MDL 0..15. Requires loopStartSamples:0. */
    modulationDepth?: number;
    /** Forward loop [start, PCM length); omit for a one shot. */
    loopStartSamples?: number;
  };
export interface ScspSample {
  readonly bankId: string;
  readonly id: number;
  readonly address: number;
  readonly allocationAddress?: number;
  readonly modulationDepth?: number;
  /** Total allocation bytes including periodic/interpolation guards; starts at
   * allocationAddress ?? address. May also need alignment. */
  readonly byteLength: number;
  readonly length: number;
  readonly bits: 8 | 16;
  /** Editor-owned handles can expire when an idle editor page is reused. */
  readonly editorOwned?: true;
  readonly rootFrequencyHz: number;
  readonly sourceSampleRate: number;
  readonly loopStartSamples: number | null;
}
/** Raw SCSP rates 0..31 (higher faster), KRS 0..15 (15 disables scaling).
 * Preset EG updates take effect at the next keyOn, not during a held note. */
export interface ScspEnvelope {
  attackRate: number;
  decay1Rate: number;
  decay2Rate: number;
  decayLevel: number;
  releaseRate: number;
  keyRateScaling: number;
}
export interface ScspMix {
  /** 0..255 attenuation; 0 loudest. */
  totalLevel: number;
  /** Direct send 0..7; 0 mute. */
  directLevel: number;
  /** Hardware DIPAN 0..31; 0 center, 15 right only, 31 left only. */
  pan: number;
}
export interface ScspPreset extends ScspMix {
  sample: ScspSample | null;
  frequencyHz: number;
  envelope: ScspEnvelope;
  lfo: ScspLfo;
  modulation: ScspModulation;
}
export type ScspPresetPatch = Partial<Omit<ScspPreset,'envelope'|'lfo'|'modulation'>> & {envelope?: Partial<ScspEnvelope>; lfo?: Partial<ScspLfo>; modulation?: Partial<ScspModulation>};
export interface ScspState {
  sampleRate: 44100;
  bankId: string;
  nextSampleId: number;
  ramUsedBytes: number;
  ramFreeBytes: number;
  /** Native source references include releasing voices; gate alone is insufficient. */
  playingFrequencies?: (number | null)[];
  playingLfos?: (ScspLfo | null)[];
  playingModulations?: (ScspModulation | null)[];
  playingSampleIds?: (number | null)[];
  samples: ScspSample[];
  /** Authored presets; gate is the requested key state, not an activity meter. */
  slots: (ScspPreset & {gate: boolean})[];
}
export function scspPitch(ratio: number): {word: number; ratio: number};
/** Owns the core exclusively and disposes it. 32 physical slots, no allocator. */
export class ScspSynth {
  constructor(core: Scsp);
  readonly sampleRate: 44100;
  readonly nativeFrames: number;
  loadPCM(pcm: Int8Array | Int16Array, options: ScspPCMOptions): ScspSample;
  setPreset(slot: number, patch: ScspPresetPatch): void;
  /** Live partial LFO update. setPreset({lfo}) is next-keyOn only. */
  setLfo(slot: number, patch: Partial<ScspLfo>): void;
  /** Live without retrigger; depth edits commit the full depth/X/Y routing word. */
  setModulation(slot: number, patch: Partial<ScspModulation>): void;
  setEnvelope(slot: number, patch: Partial<ScspEnvelope>): void;
  setFrequency(slot: number, frequencyHz: number): number;
  setNote(slot: number, note: ScspNote): number;
  setMix(slot: number, patch: Partial<ScspMix>): void;
  keyOn(slot: number): void;
  keyOff(slot: number): void;
  noteOn(slot: number, note: ScspNote): void;
  noteOff(slot: number): void;
  allNotesOff(): void;
  /** Immediate silence; retains bank/presets, resets native frame clock. */
  stopVoices(): void;
  /** Clears presets; retains samples unless clearRam is true. */
  reset(options?: {clearRam?: boolean}): void;
  getState(): ScspState;
  prepare(frames: number): void;
  renderInto(left: Float32Array, right: Float32Array, frames?: number, offset?: number): void;
  generateStereo(frames: number): {left: Float32Array; right: Float32Array};
  dispose(): void;
}
export function createScspInitSample(): {pcm: Int16Array; options: ScspPCMOptions};
