// SPDX-License-Identifier: BSD-3-Clause
import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js';
export const HUC6280_CODE_GLOBALS=Object.freeze([
  'context','fx','CH1','CH2','CH3','CH4','CH5','CH6','console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween',
  'liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName',
  'scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg',
]);
const TYPES=`
interface Huc6280CodeState {
  clock:number;initialized:boolean;selectedChannel:number;globals:number[];
  registers:number[][];waveforms:number[][];indices:number[];positionFrames:number;
  editorSource:'wave'|'noise'|'dda';editorLfoEnabled:boolean;editorLfoMode:'follow'|'recorded';
  dda:{samples:number;sampleRate:number;rootNote:number;loop:boolean;speed:number};
  ddaVoices:Array<{channel:PlaygroundHuc6280Channel;position:number;ended:boolean;sampleRate:number;rootNote:number;loop:boolean;speed:number}|null>;
  envelopes:Array<{enabled:boolean;attack:number;decay:number;sustain:number;release:number}|null>;
  observation:{registers:'sent';waveforms:'configured';softwareEnvelope:true};
}
/** The editor's one physical HuC6280. Await commands. CH5/CH6 support Noise;
 * shared hardware LFO uses CH2 to modulate CH1. Scheduling/FX are software. */
type Huc6280CodeClient=Omit<PlaygroundHuc6280,'dispose'|'noteOn'> & {
  readonly id:string;readonly chip:'huc6280';readonly channels:6;readonly clock:number;
  /** Detached sent-register state, not live hardware oscillator readback. */
  getState():Promise<Huc6280CodeState>;
  /** Start the current waveform or loaded DDA sample with the authored Software Envelope. */
  noteOn(channel:PlaygroundHuc6280Channel,note:string|number):Promise<void>;
  /** Software envelope release of this Code-owned note. keyOff is a raw gate. */
  noteOff(channel:PlaygroundHuc6280Channel):Promise<boolean>;
  /** Restore the authored instrument without closing its AudioContext. */
  dispose():Promise<void>;
};
type Huc6280CodeSoundChipMap={huc6280:Huc6280CodeClient};
type PlaygroundLivePrepareAPI=Huc6280CodeAPI;
declare function useSoundChip<Name extends keyof Huc6280CodeSoundChipMap>(name:Name):Promise<Huc6280CodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:Huc6280CodeAPI;
`;
export function selectHuc6280CodeDeclarations(source) {
  return selectCodeHostDeclarations(source,{globals:HUC6280_CODE_GLOBALS,customTypes:TYPES,apiName:'Huc6280CodeAPI',
    banner:'HuC6280 Synth Code: one shared physical PSG; no independent chip factory.',transformTypes(types){
      const type=types.get('PlaygroundHuc6280');if(!type)throw Error('Shared HuC6280 declarations are missing.');
      types.set(type.name,{...type,text:type.text.replace(/^(\s+\w+\([^\n]*\)):\s*void;/gm,'$1: Promise<void>;')
        .replace(/^(\s+\w+\([^\n]*\)):\s*number;/gm,'$1: Promise<number>;')});
    }});
}
