import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js?v=shared-code-hosts-1';

export const SID_CODE_GLOBALS=Object.freeze([
  'context','fx','CH1','CH2','CH3','console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween',
  'liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName',
  'scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg',
]);
const SID_TYPES=`
type SidCodeSoundChipMap = {sid:PlaygroundSid};
type PlaygroundLivePrepareAPI = SidCodeAPI;
declare function useSoundChip<Name extends keyof SidCodeSoundChipMap>(name:Name):Promise<SidCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:SidCodeAPI;
`;

/** The SID Synth borrows the Worklet's existing SID instead of constructing
 * a second register shadow. Its normal SID methods acknowledge asynchronously;
 * note names, hardware codes and the physical 0..2 channel indices stay shared. */
export function selectSidCodeDeclarations(source) {
  return selectCodeHostDeclarations(source,{globals:SID_CODE_GLOBALS,customTypes:SID_TYPES,apiName:'SidCodeAPI',
    banner:'SID Synth Code: one shared SID, no independent chip factory.',transformTypes(types) {
      const sid=types.get('PlaygroundSid');
      if(!sid)throw Error('Shared SID declarations are missing.');
      types.set(sid.name,{...sid,text:sid.text
        .replace('Reset the SID and authored state. initialize() establishes the silent defaults.',
          "Stop Code voices and restore the upper editor's current voice/filter settings.")
        .replace('Silent saw voices, ADSR 2/6/12/5; filter off and hardware volume 8.',
          "Restore the upper editor's current settings without replacing its instrument.")
        .replace('  dispose():void;',"  /** Restore the current editor patch and stop its voices; never close the shared SID or AudioContext. */\n  dispose():void;")
        .replace(/^(  \w+\([^\n]*\)):void;/gm,'$1:Promise<void>;')
        .replace(/^(  (?:setFrequency|setNote)\([^\n]+\)):number;/gm,'$1:Promise<number>;')});
    }});
}
