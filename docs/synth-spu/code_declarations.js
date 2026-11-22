import {selectCodeHostDeclarations} from '../synth/synth_code_declarations.js?v=shared-code-hosts-1';

export const SPU_CODE_GLOBALS=Object.freeze([
  'context','fx','CH1','CH2','CH3','CH4','CH5','CH6','console','log','useSoundChip','file','setBpm','beat','nextBeat','sleep','sleepSamples','tween',
  'liveLoop','livePrepare','liveFx','stopLoop','stopAllLoops','liveCleanup','trackAsync','parseNoteName','midiToNoteName',
  'scale','chord','lerp','choose','cycle','rand','rrange','randInt','pg',
  'readVab','prepareVabTone','exportVab','MAX_VAB_FILE_BYTES',
]);
const SPU_TYPES=`
interface SpuCodePmon {enabled:boolean;waveform:'sine'|'triangle'|'saw'|'square';ratio:number;depth:number;decayMs:number;}
interface SpuCodeNoise {enabled:boolean;clock:number;}
interface SpuCodeMorph {enabled:boolean;a:number[];b:number[];amount:number;}
type SpuCodeVoiceState = PlaygroundPs1State['channels'][number] & {
  channel:PlaygroundPs1Channel;active:boolean;type:'spu-adpcm';rawRegisters:number[];
  noiseClock:number;pmonSettings:SpuCodePmon;morphSettings:SpuCodeMorph;
  adpcmPreview:{sample:number;pcm:readonly number[];preview:true;source:'sample-start';history:'zero-at-sample-start';decodedFrames:number;sampleByteLength:number}|null;
  adpcmPreviewUnavailable:string|null;
};
type SpuCodeState = Omit<PlaygroundPs1State,'sampleRate'|'channels'> & {
  sampleRate:number;nativeSampleRate:44100;
  kind:'ps1';codeActive:true;channels:SpuCodeVoiceState[];
  auditions:{channel:PlaygroundPs1Channel;id:string}[];
  /** App-only software click guard; raw keyOn/keyOff always bypass it. */
  clickGuard:boolean;
  pmon:SpuCodePmon;noise:SpuCodeNoise;morph:SpuCodeMorph;
  hostAudio:{sampleId:number|null;frames:number;duration:number;loop:boolean}|null;
  polyphony:12|24;
  pmonSampleReserved:boolean;samplePcmSource:{sampleId:number;token:string}|null;
};
/** Borrow the upper editor's SPU, its samples and its current sound.
 * All hardware operations are acknowledged asynchronously. */
type SpuCodeClient = Omit<PlaygroundPs1,'getState'|'snapshot'|'dispose'|'noteOn'|'noteOff'|'keyOn'|'keyOff'|'allNotesOff'> & {
  readonly id:string;readonly chip:'ps1';
  /** Synth only: follow Click guard for this voice; note pitch uses the current sample's declared root. */
  noteOn(channel:PlaygroundPs1Channel,note?:string|number):Promise<void>;
  /** Follow Click guard and preserve keyboard-owned notes. Long and infinite ADSR releases remain intact. */
  noteOff(channel:PlaygroundPs1Channel):Promise<boolean>;
  /** Raw KON. Bypasses Click guard; setNote changes the pitch before triggering. */
  keyOn(channel:PlaygroundPs1Channel):Promise<void>;
  /** Raw KOFF on a Code voice. Bypasses Click guard and follows the programmed ADSR release. */
  keyOff(channel:PlaygroundPs1Channel):Promise<boolean>;
  /** Release sounding Code voices and preserve keyboard-owned voices. */
  allNotesOff():Promise<void>;
  getState():Promise<SpuCodeState>;
  /** Inspection copy at the Worklet output rate with separate nativeSampleRate. */
  snapshot():Promise<SpuCodeState & {ram:Uint8Array;registers:Uint16Array}>;
  /** Stop this Code session and restore the editor sound; never close its shared audio context. */
  dispose():Promise<void>;
};
type SpuCodeSoundChipMap = {ps1:SpuCodeClient};
type PlaygroundLivePrepareAPI = SpuCodeAPI;
declare function useSoundChip<Name extends keyof SpuCodeSoundChipMap>(name:Name):Promise<SpuCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:SpuCodeAPI;
`;

/** Use the same PS1 interfaces and source locations as Playground. Only the
 * methods that actually cross this Worklet port are changed to Promise<void>. */
export function selectSpuCodeDeclarations(source){
  return selectCodeHostDeclarations(source,{globals:SPU_CODE_GLOBALS,customTypes:SPU_TYPES,apiName:'SpuCodeAPI',
    banner:'SPU Synth Code: one shared PS1 SPU, no independent chip factory.',transformTypes(types){
      const ps1=types.get('PlaygroundPs1');
      if(!ps1)throw Error('Shared PS1 SPU declarations are missing.');
      types.set(ps1.name,{...ps1,text:ps1.text.replace(/^(  \w+\([^\n]*\)):void;/gm,'$1:Promise<void>;')});
    }});
}
