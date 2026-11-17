/** Experimental standalone SCSP API (tetorica-fm2612/scsp.js). */
export const SCSP_SAMPLE_RATE: 44100;
export const SCSP_RAM_BYTES: number;
export const SCSP_MAX_FRAMES: number;
export interface ScspOptions {
  moduleFactory: (options: any) => any | Promise<any>;
  moduleOptions?: Record<string, unknown>;
}
export class Scsp {
  static create(options: ScspOptions): Promise<Scsp>;
  constructor(module: any, handle: number, api: any);
  readonly sampleRate: 44100;
  readonly nativeFrames: number;
  reset(options?: {clearRam?: boolean}): void;
  write(offset: number, value: number, mask?: number): void;
  read(offset: number): number;
  loadRam(bytes: Uint8Array, address?: number): void;
  readRam(address?: number, length?: number): Uint8Array;
  prepare(frames: number): void;
  renderInto(left: Float32Array, right: Float32Array, frames?: number, offset?: number): void;
  generateStereo(frames: number): {left: Float32Array; right: Float32Array};
  dispose(): void;
}
