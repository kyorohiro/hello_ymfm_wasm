// Keep the public NES API and readable implementation links in the Code editor.
import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js';

export const NES_CODE_GLOBALS=Object.freeze([
  'context','fx','CH1','CH2','CH3','CH4','CH5','CH6','console','log','useSoundChip','file',
  'setBpm','beat','nextBeat','sleep','sleepSamples','tween','liveLoop','livePrepare','liveFx',
  'stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName',
  'scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg',
]);
const TYPES=`
type NesCodeChannel=0|1|2|3|4|5;
interface NesCodeEnvelope {enabled:boolean;period:number;loop:boolean}
interface NesCodeFdsEnvelope {enabled:boolean;increase:boolean;period:number;initialGain:number}
interface NesCodePreset {
  format:'tetorica-nes-fds-voice';version:7;name:string;source:'pulse'|'triangle'|'noise'|'dmc'|'fds';
  pulse:{duty:0.125|0.25|0.5|0.75;volume:number;lengthHalt:boolean;lengthIndex:number;envelope:NesCodeEnvelope;
    sweep:{enabled:boolean;period:number;negate:boolean;shift:number}};
  triangle:{control:boolean;linearReload:number;lengthIndex:number};
  noise:{volume:number;period:number;shortMode:boolean;lengthHalt:boolean;lengthIndex:number;envelope:NesCodeEnvelope};
  dmc:{data:number[];rate:number;loop:boolean;level:number};
  fds:{wave:number[];volume:number;master:number;envelope:NesCodeFdsEnvelope;envelopeClock:{masterSpeed:number;halt:boolean};
    modulation:{enabled:boolean;table:number[];rate:number;depth:number;bias:number;envelope:NesCodeFdsEnvelope}};
}
interface NesCodeState {
  preset:NesCodePreset;channelPresets:NesCodePreset[];
  voices:{id:string;midi:number;channel:NesCodeChannel}[];
  capacity:number;pitch:number;registers:number[];clock:number;
  enabled:number;fdsActive:boolean;fdsGain:number;fdsMaster:number;sample:{address:number;length:number}|null;
}
/** Borrow the editor's existing APU and FDS. All hardware calls cross its Worklet.
 * CH1/CH2 Pulse, CH3 Triangle, CH4 Noise, CH5 DMC and CH6 FDS are physical channels. */
type NesCodeClient=Omit<PlaygroundNes,'dispose'|'noteOn'|'keyOn'> & {
  readonly id:string;readonly chip:'nes';readonly channels:6;readonly fdsEnabled:true;
  /** Play the current channel settings. Noise and DMC use their selected hardware rate. */
  noteOn(channel:NesCodeChannel,note:string|number):Promise<{channel:NesCodeChannel}>;
  /** Retrigger the configured physical channel without replacing its pitch. */
  keyOn(channel:NesCodeChannel):Promise<{channel:NesCodeChannel}>;
  getState():Promise<NesCodeState>;
  allNotesOff():Promise<void>;
  /** End this lease and restore the editor sound while keeping its AudioContext. */
  dispose():Promise<void>;
};
type NesCodeSoundChipMap={nes:NesCodeClient};
type PlaygroundLivePrepareAPI=NesCodeAPI;
declare function useSoundChip<Name extends keyof NesCodeSoundChipMap>(name:Name):Promise<NesCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:NesCodeAPI;
`;

export function selectNesCodeDeclarations(source){
  return selectCodeHostDeclarations(source,{globals:NES_CODE_GLOBALS,customTypes:TYPES,apiName:'NesCodeAPI',
    banner:'2A03 Synth Code: one shared NES APU with FDS.',transformTypes(types){
      const nes=types.get('PlaygroundNes');
      if(!nes)throw Error('Shared NES declarations are missing.');
      types.set(nes.name,{...nes,text:nes.text
        .replace(/\):\s*void\s*\|\s*Promise<unknown>;/g,'):Promise<unknown>;')
        .replace(/\):\s*void;/g,'):Promise<void>;')
        .replace(/\):\s*number;/g,'):Promise<number>;')
        .replace(/(\bsetNote\([^)]*\)):\s*Promise<void>;/g,'$1:Promise<number>;')
        .replace(/(\b(?:noteOn|keyOn)\([^)]*\)):\s*Promise<void>;/g,'$1:Promise<{channel:NesCodeChannel}>;')
        .replace(/(\b(?:noteOff|keyOff|stop)\([^)]*\)):\s*Promise<void>;/g,'$1:Promise<boolean>;')
        .replace(/(\bplay\([^)]*\)):\s*Promise<void>;/g,'$1:Promise<void|{channel:NesCodeChannel}>;')});
    }});
}
