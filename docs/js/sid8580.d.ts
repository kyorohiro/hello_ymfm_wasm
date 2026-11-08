export interface Sid8580Options {
  sampleRate?:number;
  /** The standalone 8580 Preview currently supports PAL only. */
  clockHz?:985248;
  model?:'8580';
  wasmUrl?:URL|string;
  wasmBinary?:BufferSource;
  signal?:AbortSignal;
}
/** CPU-free PAL 8580 Preview. Register accesses tick once before bus access;
 * rendering advances Rust batches, with no chip-cycle JavaScript callbacks. */
export class Sid8580Core {
  private constructor();
  static create(options?:Sid8580Options):Promise<Sid8580Core>;
  readonly model:'8580';
  readonly modelStatus:'preview';
  readonly clockHz:985248;
  readonly sampleRate:number;
  readonly registers:Uint8Array;
  readonly exports:WebAssembly.Exports;
  readonly handle:number;
  writeRegister(register:number,value:number):void;
  readRegister(register:number):number;
  renderInto(output:Float32Array):Float32Array;
  render(frames:number):Float32Array;
  reset():void;
  getState():{model:'8580';modelStatus:'preview';clockHz:985248;sampleRate:number;cycles:number;frames:number;registers:number[];
    voices:Array<{envelope:null;phase:null}>;profiles:{resonance:boolean;cutoff:boolean};hostDcHz:12;cpuFree:true;batchClocking:true};
  dispose():void;
}
