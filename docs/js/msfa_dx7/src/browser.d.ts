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
