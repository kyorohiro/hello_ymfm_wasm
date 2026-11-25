// SPDX-License-Identifier: BSD-3-Clause
import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js';

const globals=['context','console','log','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween',
  'fx','liveFx','liveLoop','livePrepare','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName',
  'scale','chord','lerp','choose','cycle','rand','rrange','randInt','useSoundChip','midi','pg',
  ...Array.from({length:16},(_,i)=>'CH'+(i+1))];

const types=`
interface FM21290Voice {
  /** Allocate a voice for a MIDI note, 0–127. */
  noteOn(note:number,velocity?:number):void;
  noteOff(note:number):void;
  getPreset():DX7PresetState;
  setPreset(preset:DX7Preset):Promise<void>;
  setOperator(operator:DX7Operator,patch:DX7OperatorParams):Promise<void>;
  setFeedback(feedback:number):Promise<void>;
}
interface FM21290Builder {
  atSeconds(seconds:number):this;
  atSample(sample:number):this;
  writeRegister(address:number,value:number):this;
  keyOn(channel:PlaygroundMidiChannel,note:number,velocity?:number):this;
  keyOff(channel:PlaygroundMidiChannel):this;
}
interface FM21290Write {offsetSeconds:number;register:number;value:number;}
interface FM21290Plan {chip:'fm21290';version:1;referenceSampleRate:number;writes:FM21290Write[];}
interface FM21290Chip extends FM21290Voice {
  build(record:(builder:FM21290Builder)=>void,options?:{referenceSampleRate?:number}):FM21290Plan;
  compile(plan:FM21290Plan):Promise<FM21290Write[]>;
  schedule(plan:FM21290Plan,options:{name:string;repeatSeconds?:number}):Promise<unknown>;
  clearSchedule(name:string):Promise<boolean>;
  /** Gate one physical OPS/EGS voice (CH1–CH16). */
  keyOn(channel:PlaygroundMidiChannel,note:number,velocity?:number):void;
  keyOff(channel:PlaygroundMidiChannel):void;
  setSustain(down:boolean):void;
  writeRegister(address:number,value:number):void;
}
type FM21290Clients={fm21290:FM21290Chip;dx7:FM21290Voice};
declare function useSoundChip<Name extends keyof FM21290Clients>(name:Name):Promise<FM21290Clients[Name]>;
interface FM21290Part {
  noteOn(note:number,velocity?:number):void;
  noteOff(note:number):void;
  /** CC64, 0–127. */
  sustain(value:number):void;
  /** CC1, 0–127. */
  modWheel(value:number):void;
  /** 14-bit MIDI bend, center 8192. */
  pitchBend(value:number):void;
  finish():void;
}
interface FM21290Midi {
  createPart():FM21290Part;
  createTimeline():{waitUntil(seconds:number):Promise<void>};
  /** Logical MIDI channel for note output. */
  output(destination:'tetorica-fm21290',options?:{channel?:PlaygroundMidiChannel}):Pick<PlaygroundMidiOutput,'noteOn'|'noteOff'|'play'>;
}
declare const midi:FM21290Midi;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(note:number):string;
type PlaygroundLivePrepareAPI=FM21290CodeAPI;
declare const pg:FM21290CodeAPI;
`;

export function selectFM21290Declarations(source){
  return selectCodeHostDeclarations(source,{globals,customTypes:types,apiName:'FM21290CodeAPI',
    banner:'Tetorica FM21290 Synth Live Coding'});
}
