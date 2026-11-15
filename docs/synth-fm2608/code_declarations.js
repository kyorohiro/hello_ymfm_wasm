import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js?v=shared-code-hosts-1';

const globals = [
  'context','fx','CH1','CH2','CH3','CH4','CH5','CH6','OP1','OP2','OP3','OP4',
  'console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples',
  'tween','liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup',
  'trackAsync','parseNoteName','midiToNoteName','scale','chord','lerp','choose','cycle',
  'rand','rrange','randInt','pg',
];

const types = `
type Fm2608CodeFm = Pick<FMApi,
  'reset'|'setPreset'|'setOperator'|'setOperators'|'setAlgo'|'setPan'|'setLfo'|
  'setChannel3SpecialMode'|'setChannel3SpecialFrequency'|'setFrequency'|'setNote'|
  'setBlockFnum'|'noteOnRaw'|'keyOn'|'noteOn'|'noteOff'|'write'|'rawWrite'|
  'writeAddress'|'writeData'>;
type Fm2608PcmSource = {channels:ArrayLike<number>[];sampleRate:number}|Uint8Array|ArrayBuffer;
/** The same physical YM2608 as the upper controls. FM CH1..CH6 are 0..5.
 * SSG channels are 0..2, Rhythm voices are 0..5, and ADPCM-B has one voice.
 * dispose/allNotesOff release this Code client's notes while the editor stays open. */
interface Fm2608CodeClient extends Fm2608CodeFm {
  readonly id:'ym2608';
  readonly chip:'ym2608';
  readonly clock:number;
  keyOff(channel:YM2612Channel):void;
  setModulation(channel:YM2612Channel,ams:YM2612Ams,pms:YM2612Pms):void;
  allNotesOff():void;
  dispose():void;
  ssg:{
    setFrequency(channel:0|1|2,hz:number):number;
    setNote(channel:0|1|2,note:string|number):number;
    noteOn(channel:0|1|2,note:string|number):void;
    keyOn(channel:0|1|2):void;
    keyOff(channel:0|1|2):void;
    off(channel:0|1|2):void;
    tone(channel:0|1|2,options:{frequency?:number;period?:number;volume?:number;envelope?:boolean}):number;
    noise(channel:0|1|2,options?:{period?:number;volume?:number;envelope?:boolean}):void;
    setTonePeriod(channel:0|1|2,period:number):void;
    setMixer(channel:0|1|2,options:{tone:boolean;noise:boolean}):void;
    setVolume(channel:0|1|2,volume:number,envelope?:boolean):void;
    /** Shared across the three SSG channels. Writing shape restarts it. */
    setEnvelope(options:{period:number;shape:number}):void;
    reset():void;
  };
  rhythm:{
    loadRom(bytes:Uint8Array):Promise<void>;
    setVolume(volume:number):void;
    setVoice(voice:number|string,options:{volume?:number;left?:boolean;right?:boolean}):void;
    keyOn(voice:number|string|Array<number|string>):void;
    keyOff(voice:number|string|Array<number|string>):void;
    reset():void;
  };
  adpcm:{
    /** Local PCM/WAV -> mono ADPCM-B, then select the sample. Does not Key On. */
    loadSample(source:Fm2608PcmSource,options?:{address?:number;sampleRate?:number}):Promise<{
      start:number;end:number;frames:number;paddedFrames:number;sampleRate:number;deltaN:number;duration:number;
    }>;
    loadMemory(bytes:Uint8Array|ArrayBuffer,address?:number):Promise<void>;
    setSample(range:{start:number;end:number}):void;
    setVolume(volume:number):void;
    setPan(left:boolean,right:boolean):void;
    setPlaybackRate(rate:number):number;
    setDeltaN(value:number):void;
    keyOn(options?:{repeat?:boolean}):void;
    keyOff():void;
    reset():void;
  };
}
type Fm2608CodeSoundChipMap = {ym2608:Fm2608CodeClient};
type PlaygroundSelectedFmChannel = YM2612Channel;
type PlaygroundLivePrepareAPI = Fm2608CodeAPI;
declare function useSoundChip<Name extends keyof Fm2608CodeSoundChipMap>(name:Name):Promise<Fm2608CodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:Fm2608CodeAPI;
`;

export function selectFm2608CodeDeclarations(source) {
  return selectCodeHostDeclarations(source, {
    globals, customTypes:types, apiName:'Fm2608CodeAPI',
    banner:'FM2608 Synth Code borrows the editor YM2608 / OPNA and its four sound sections.',
  });
}
