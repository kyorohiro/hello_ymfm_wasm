import type {ChannelPCM} from './wav.js';
/** Decode only; creates no live audio device and writes no chip RAM. */
export function readScspAudio(source: unknown, options?: {
  decodeAudio?: (bytes: ArrayBuffer) => Promise<AudioBuffer | ChannelPCM>;
  signal?: AbortSignal;
}): Promise<ChannelPCM>;
export interface ScspPCMSelection {
  startSeconds?: number;
  endSeconds: number;
  sourceSampleRate?: number;
  /** Manual recorded pitch, not pitch detection. */
  rootNote?: number | string;
  bits?: 8 | 16;
}
export interface ScspPCMDraft {
  pcm: Int8Array | Int16Array;
  sample: {bits: 8 | 16; rootFrequencyHz: number; sourceSampleRate: number; loopStartSamples: null};
  sourceStartFrame: number;
  sourceEndFrame: number;
}
/** Mono selection of 2..65535 output samples; oversized output is rejected. */
export function prepareScspPCM(audio: ChannelPCM, options: ScspPCMSelection): ScspPCMDraft;
