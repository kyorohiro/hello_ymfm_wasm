import type { DX7Preset, DX7OperatorParams, DX7OperatorEntries, DX7PresetState } from './preset.js';

export interface DX7NodeVoice {
  readonly index: number;
  readonly name: string;
}

export interface DX7NodeOptions {
  /** Override the packaged AudioWorklet module URL. */
  workletUrl?: string | URL;
  /** Override the packaged WASM asset URL. Loaded outside the audio thread. */
  wasmUrl?: string | URL;
  wasmBytes?: ArrayBuffer | Uint8Array;
  /** Called for initialization or fatal audio processing failures. */
  onError?: (error: Error) => void;
}

export interface DX7Node {
  /** Ready mono node; connect it to a destination after creation. */
  readonly node: AudioWorkletNode;
  /** AudioContext output sample rate. Internal synthesis remains 44,100 Hz. */
  readonly sampleRate: number;
  readonly internalSampleRate: 44100;
  readonly voices: readonly DX7NodeVoice[];
  readonly selectedVoice: number;
  /** Resolves after the Worklet applies the complete bank and selects voice 0. */
  loadSysex(data: ArrayBuffer | Uint8Array): Promise<readonly DX7NodeVoice[]>;
  /** Replace the selected patch from INIT defaults; resolve after application.
   * Changes affect subsequent Note On events; chip-global LFO state is shared. */
  setPreset(preset: DX7Preset): Promise<void>;
  /** Patch OP1..OP6; level/frequency changes also affect this patch's sounding
   * notes and release tails without retriggering. Resolve after application. */
  setOperator(operator: 1 | 2 | 3 | 4 | 5 | 6, patch: DX7OperatorParams): Promise<void>;
  /** Apply an ordered tuple batch atomically; an empty batch changes nothing. */
  setOperators(entries: DX7OperatorEntries): Promise<void>;
  /** Raw feedback 0..7 on this patch's sounding/future notes. May cause a step. */
  setFeedback(feedback: number): Promise<void>;
  /** Full copied state of the selected patch. Rejects when no patch is loaded. */
  getPreset(): Promise<DX7PresetState>;
  /** Events use one ordered MessagePort and apply before the next render block. */
  selectVoice(index: number): void;
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
  /** Release all held notes, allowing their envelopes to finish. */
  allNotesOff(): void;
  /** Immediately silence all voices. */
  panic(): void;
  /** Disconnect and destroy this instrument. Safe to call more than once. */
  dispose(): void;
}

/**
 * Resolve only when WASM initialization has completed. No early-event queue is
 * exposed. The caller resumes AudioContext in a user gesture when required.
 */
export function createDX7Node(context: AudioContext, options?: DX7NodeOptions): Promise<DX7Node>;
