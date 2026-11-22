import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js?v=shared-code-hosts-1';
const globals=['context','fx','CH1','CH2','CH3','CH4','CH5','CH6','CH7','CH8','console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween','liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName','scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg'];
const types=`
type SnesCodeLane = 0|1|2|3|4|5|6|7;
interface SnesCodePresetBrr {name:string;data:string;rootNote:number;basePitch:number;loopStartSamples:number|null;}
interface SnesCodePresetEnvelope {
  mode:'adsr'|'gain';attack:number;decay:number;sustainLevel:number;sustainRate:number;
  gainMode:'direct'|'linear-decrease'|'exponential-decrease'|'linear-increase'|'bent-increase';gainLevel:number;gainRate:number;
}
interface SnesCodePreset {
  format:'tetorica-sdsp-voice';version:5;name:string;source:'wave'|'brr'|'noise';
  wave:number[];brr:SnesCodePresetBrr;volume:{left:number;right:number};envelope:SnesCodePresetEnvelope;
  echo:Omit<PlaygroundSnesEchoOptions,'sendMask'> & {send:boolean};
  noise:{clock:number};
  pmon:{enabled:boolean;source:'wave'|'brr';ratio:number;wave:number[];brr:SnesCodePresetBrr;envelope:SnesCodePresetEnvelope};
}
interface SnesCodeState {
  preset:SnesCodePreset;
  voices:{id:string;midi:number;channel:number;modulatorChannel?:number}[];
  tails:{id:string;channel:number;modulatorChannel?:number}[];
  capacity:number;pitch:number;generation:number;
  nativeFrames:number;muteMask:number;
  /** Currently owned physical voices started by Code reservations. */
  timedGateMask:number;
  sample:PlaygroundSnesSample|null;modulatorSample:PlaygroundSnesSample|null;
  pmon:{enabled:boolean;active:boolean;ratio:number};
  pmonRegisters:{mask:number};
  noise:{enabled:boolean;clock:number;shared:boolean};
  noiseRegisters:{non:number;flg:number;clock:number};
  echo:PlaygroundSnesEchoState;
  echoRegisters:{flg:number;esa:number;edl:number;efb:number;eon:number;volumeLeft:number;volumeRight:number;fir:number[]};
  memory:{directoryAddress:number;maxSampleBytes:number};
  registers:number[][];
}
/** Borrow the editor's current sound and shared eight-voice allocator.
 * Lanes 0..7 own notes, not fixed DSP voices. PMON has four-note capacity. */
interface SnesCodeClient extends Pick<PlaygroundSnes,'build'|'captureState'|'compile'|'schedule'|'clearSchedule'> {
  readonly id:string;readonly chip:'snes';
  noteOn(lane:SnesCodeLane,note:string|number):Promise<{channel:number;stolenId:string|null}>;
  /** Release the current Code note on the logical lane, if it still owns a voice. */
  noteOff(lane:SnesCodeLane):Promise<boolean>;
  getState():Promise<SnesCodeState>;
  /** Release current Code notes on logical lanes and in reservations. Future events remain scheduled. */
  allNotesOff():Promise<void>;
  dispose():Promise<void>;
}
type SnesCodeSoundChipMap = {snes:SnesCodeClient};
type PlaygroundLivePrepareAPI = SnesCodeAPI;
declare function useSoundChip<Name extends keyof SnesCodeSoundChipMap>(name:Name):Promise<SnesCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:SnesCodeAPI;
`;
export function selectSnesCodeDeclarations(source){return selectCodeHostDeclarations(source,{globals,customTypes:types,apiName:'SnesCodeAPI',banner:'S-DSP Synth Code: performance lanes over the current editor sound.'});}
