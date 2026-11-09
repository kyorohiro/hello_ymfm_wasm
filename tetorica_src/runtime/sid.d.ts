export interface SidCoreOptions {
  /** Integer output rate, 8000..96000 Hz. */
  sampleRate?:number;
  /** Creation-fixed integer chip clock, 900000..1100000 Hz. */
  clockHz?:number;
  wasmUrl?:URL|string;
  /** Supply bytes explicitly in Node or AudioWorklet; default loading uses fetch. */
  wasmBinary?:BufferSource;
}
export interface SidCoreState {
  model:'6581';
  clockHz:number;
  sampleRate:number;
  cycles:number;
  /** Copy of written registers; hardware reads use readRegister instead. */
  registers:number[];
  voices:Array<{envelope:number;phase:number}>;
}
export const SID_PAL_CLOCK:985248;
export const SID_NTSC_CLOCK:1022727;
/** Convert finite nonnegative Hz to a 16-bit register, rejecting out-of-range values. */
export function sidFrequency(hz:number,clockHz?:number):number;
/** CPU-free mono 6581 approximation. Each bus access clocks once; PCM includes
 * those samples and the existing 12 Hz host DC blocker. No audio device/player. */
export class SidCore {
  private constructor();
  static create(options?:SidCoreOptions):Promise<SidCore>;
  readonly exports:WebAssembly.Exports;
  readonly handle:number;
  readonly sampleRate:number;
  readonly clockHz:number;
  readonly model:'6581';
  readonly registers:Uint8Array;
  writeRegister(register:number,value:number):void;
  /** Hardware read: OSC3=27 / ENV3=28, distinct from the write-side shadow. */
  readRegister(register:number):number;
  renderInto(output:Float32Array):Float32Array;
  /** Owned mono PCM, at most ten minutes in one call. */
  render(frames:number):Float32Array;
  reset():void;
  getState():SidCoreState;
  dispose():void;
}
