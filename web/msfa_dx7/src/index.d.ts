export * from './sysex.js';
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
