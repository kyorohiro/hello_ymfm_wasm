// Use the existing Game Boy API/source declarations, scoped to one borrowed APU.
import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js';

export const GAMEBOY_CODE_GLOBALS=Object.freeze([
  'context','fx','CH1','CH2','CH3','CH4','console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween',
  'liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName',
  'scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg',
]);
const TYPES=`
interface GameboyCodeState {
  clock:number;initialized:boolean;registers:number[];voice:number[];
  /** Upper editor's selected source; Code can still address all four channels. */
  editorSource:'pulse'|'wave'|'noise';positionFrames:number;
}
/** Borrow the existing editor APU. Hardware methods acknowledge asynchronously.
 * Pulse CH1/CH2, Wave CH3 and Noise CH4 remain physical channels. */
type GameboyCodeClient = Omit<PlaygroundGameboy,'dispose'|'setClock'> & {
  readonly id:string;readonly chip:'gameboy';readonly channels:4;readonly clock:4194304;
  getState():Promise<GameboyCodeState>;
  allNotesOff():Promise<void>;
  /** The Synth APU stays at its existing DMG clock. */
  setClock(clock:4194304):Promise<number>;
  /** End this lease and restore the editor preset/Wave RAM; never close its AudioContext. */
  dispose():Promise<void>;
};
type GameboyCodeSoundChipMap={gameboy:GameboyCodeClient};
type PlaygroundLivePrepareAPI=GameboyCodeAPI;
declare function useSoundChip<Name extends keyof GameboyCodeSoundChipMap>(name:Name):Promise<GameboyCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:GameboyCodeAPI;
`;

export function selectGameboyCodeDeclarations(source){
  return selectCodeHostDeclarations(source,{globals:GAMEBOY_CODE_GLOBALS,customTypes:TYPES,apiName:'GameboyCodeAPI',
    banner:'DMG Synth Code: one shared Game Boy APU, no independent chip factory.',transformTypes(types){
      const gameboy=types.get('PlaygroundGameboy');
      if(!gameboy)throw Error('Shared Game Boy declarations are missing.');
      types.set(gameboy.name,{...gameboy,text:gameboy.text
        .replace(/^(\s+\w+\([^\n]*\)): void;/gm,'$1: Promise<void>;')
        .replace(/^(\s+\w+\([^\n]*\)): number;/gm,'$1: Promise<number>;')});
    }});
}
