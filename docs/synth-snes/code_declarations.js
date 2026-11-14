import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js?v=shared-code-hosts-1';
const globals=['context','fx','CH1','CH2','CH3','CH4','CH5','CH6','console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween','liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName','scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg'];
const types=`
type SnesCodeLane = 0|1|2|3|4|5|6|7;
interface SnesCodeState {
  preset: {format:'tetorica-sdsp-voice';version:number;name:string;source:'wave'|'brr'|'noise'};
  voices:{id:string;midi:number;channel:number;modulatorChannel?:number}[];
  capacity:number;pitch:number;generation:number;
  pmon:{enabled:boolean;active:boolean;ratio:number};
  noise:{enabled:boolean;clock:number;shared:boolean};
}
/** Borrow the editor's current sound and shared eight-voice allocator.
 * Lanes 0..7 own notes, not fixed DSP voices. PMON has four-note capacity. */
interface SnesCodeClient {
  readonly id:string;readonly chip:'snes';
  noteOn(lane:SnesCodeLane,note:string|number):Promise<{channel:number;stolenId:string|null}>;
  noteOff(lane:SnesCodeLane):Promise<void>;
  getState():Promise<SnesCodeState>;
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
