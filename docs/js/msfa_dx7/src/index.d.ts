export * from './sysex.js';
export type {DX7Operator,DX7EnvelopeValues,DX7EnvelopeParams,DX7KeyboardScalingParams,DX7OperatorParams,DX7Operators,DX7OperatorEntries,DX7LfoParams,DX7Preset,DX7EnvelopeState,DX7OperatorState,DX7PresetState} from './preset.js';
import type {DX7Operator,DX7OperatorParams,DX7OperatorEntries,DX7Preset,DX7PresetState} from './preset.js';
export declare const INTERNAL_SAMPLE_RATE: 44100;
export declare const DEFAULT_WASM_URL: string;
export interface DX7Options {
  /** PCM output rate; the MSFA engine always runs at 44,100 Hz. */
  sampleRate?: 44100 | 48000;
  wasmBytes?: ArrayBuffer | ArrayBufferView;
  wasmUrl?: string | URL;
}
export interface VoiceInfo { readonly index: number; readonly name: string; }
export interface DX7 {
  readonly sampleRate: 44100 | 48000;
  readonly internalSampleRate: 44100;
  readonly voices: VoiceInfo[];
  readonly selectedVoice: number;
  loadSysex(input: ArrayBuffer | ArrayBufferView): Promise<VoiceInfo[]>;
  selectVoice(index: number): void;
  /** Replace only the selected bank slot, filling omitted fields from INIT.
   * Creates slot 0 if no bank is loaded. Other bank slots remain unchanged. */
  setPreset(preset: DX7Preset): void;
  /** Edit OP1..OP6. outputLevel/mode/coarse/fine/detune affect sounding notes
   * of this patch, including release tails, without retriggering; other fields
   * affect future notes. setPreset/loadSysex establish new patch identities. */
  setOperator(operator: DX7Operator, patch: DX7OperatorParams): void;
  /** Validate the entire unique tuple batch before committing; [] is a no-op. */
  setOperators(entries: DX7OperatorEntries): void;
  /** Raw feedback 0..7; this patch's sounding/future notes. May cause a step. */
  setFeedback(feedback: number): void;
  /** Complete independent state; throws if no voice has been selected. */
  getPreset(): DX7PresetState;
  /** MIDI note 0..127, velocity 0..127. Zero velocity is Note Off. */
  noteOn(note: number, velocity?: number): void;
  /** Releases every held voice of this pitch, following upstream MSFA. */
  noteOff(note: number): void;
  /** Releases held voices; release envelopes continue. */
  allNotesOff(): void;
  /** Immediate silence, including release tails and queued PCM. */
  panic(): void;
  /** Owned mono PCM [-1,1]. Retained arrays survive later renders/dispose. */
  render(frames: number): Float32Array;
  /** Writes and advances buffer.length output frames; allocates no new output. */
  renderInto(buffer: Float32Array): void;
  /** Idempotent. All subsequent performance/render calls throw. */
  dispose(): void;
}
export declare function createDX7(options?: DX7Options): Promise<DX7>;
