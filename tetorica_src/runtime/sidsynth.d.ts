import type {SidCore} from './sid.js';
export {SID_PAL_CLOCK,SID_NTSC_CLOCK} from './sid.js';

export type SidChannel = 0 | 1 | 2;
export type SidWaveform = 'triangle' | 'saw' | 'pulse' | 'noise';
export type SidFilterMode = 'off' | 'lowpass' | 'bandpass' | 'highpass' | 'notch';
export interface SidVoiceOptions {
  waveform?:SidWaveform;
  /** Twelve-bit pulse comparator, 0..4095. */
  pulseWidth?:number;
  /** Hardware ADSR codes, each 0..15. */
  attack?:number; decay?:number; sustain?:number; release?:number;
  /** The preceding oscillator in the cyclic voice 3→1→2→3 chain. */
  sync?:boolean; ring?:boolean; test?:boolean;
}
export interface SidFilterOptions {
  mode?:SidFilterMode;
  /** Hardware cutoff code 0..2047; the 6581 response is an approximation. */
  cutoff?:number;
  resonance?:number;
  /** Voice input mask, 0..7. Mode off with routing 7 silences all voices. */
  routing?:number;
  /** Hardware master volume, 0..15. */
  volume?:number;
  /** Remove voice 3 from dry output; the oscillator and filtered path still run. */
  voice3off?:boolean;
}
export interface SidVoiceState {
  frequency:number; frequencyRegister:number;
  waveform:SidWaveform|'off'|'combined';
  waveformBits:number; waveforms:SidWaveform[];
  pulseWidth:number;
  attack:number; decay:number; sustain:number; release:number;
  sync:boolean; ring:boolean; test:boolean; gate:boolean;
  /** Present when a live core supplied the observation. */
  envelope?:number; phase?:number;
}
export interface SidState {
  clock:number; model:'6581'; initialized:boolean;
  /** Last applied write-side settings, not hardware readback. */
  registers:number[];
  channels:SidVoiceState[];
  filter:Required<Omit<SidFilterOptions,'mode'>> & {mode:SidFilterMode|'combined';modeBits:number};
  cycles?:number;
}
export interface SidTransport {
  clock?:number;
  writeRegister(register:number,value:number,channel?:SidChannel):void;
  reset():void;
  readRegister?(register:number):number;
  dispose?():void;
}
export interface SidSynthOptions {
  /** Borrowed core: the caller owns and disposes it. */
  core?:SidCore;
  /** Supply either core or transport. */
  transport?:SidTransport;
  /** Creation-fixed integer clock in Hz, 900000..1100000. */
  clock?:number;
}
export interface SidWriteEvent {
  method:'writeRegister'|'reset';
  args:number[];
  channel?:SidChannel;
}
export function validateSidClock(clock:number):number;
export class SidDirectTransport implements SidTransport {
  constructor(core:SidCore);
  readonly core:SidCore;
  readonly clock:number;
  writeRegister(register:number,value:number):void;
  readRegister(register:number):number;
  reset():void;
}
/** CPU-free 6581 approximation; this prototype has no C64 CPU or .sid player. */
export class SidSynth {
  constructor(options:SidSynthOptions);
  readonly chip:'sid';
  readonly model:'6581';
  readonly channels:3;
  readonly clock:number;
  _beforeWrite?: (register:number,value:number,channel?:SidChannel)=>boolean|void;
  _observe?: (event:SidWriteEvent)=>void;
  reset():void;
  /** Silent saw voices, PW 2048, ADSR 2/6/12/5; volume 8 and dry routing 0. */
  initialize():void;
  writeRegister(register:number,value:number):void;
  /** Synchronous hardware read; the Playground client overrides this with a Promise. */
  readRegister(register:number):number;
  adoptRegisterState():void;
  getRegisterSnapshot():Uint8Array;
  setVoice(channel:SidChannel,options:SidVoiceOptions):void;
  setFilter(options:SidFilterOptions):void;
  setFrequency(channel:SidChannel,hz:number):number;
  setNote(channel:SidChannel,note:string|number):number;
  keyOn(channel:SidChannel):void;
  keyOff(channel:SidChannel):void;
  noteOn(channel:SidChannel,note:string|number):void;
  noteOff(channel:SidChannel):void;
  allNotesOff():void;
  /** Accept the creation clock only; create another chip to change it. */
  setClock(clock:number):Promise<boolean>;
  _getState():SidState;
  /** Adopt a validated shadow without replaying any hardware writes. */
  _adoptState(state:{initialized:boolean;registers:ArrayLike<number>;clock?:number;model?:'6581'}):void;
  dispose():void;
}
