// The public WonderSwan declarations, scoped to this editor's four physical channels.
import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js';

export const ASWAN_CODE_GLOBALS = Object.freeze([
	'context',
	'fx',
	'CH1',
	'CH2',
	'CH3',
	'CH4',
	'console',
	'log',
	'useSoundChip',
	'file',
	'setBpm',
	'beat',
	'nextBeat',
	'sleep',
	'sleepSamples',
	'tween',
	'liveLoop',
	'livePrepare',
	'liveFx',
	'stopLoop',
	'stopAllLoops',
	'liveCleanup',
	'trackAsync',
	'parseNoteName',
	'midiToNoteName',
	'scale',
	'chord',
	'lerp',
	'choose',
	'cycle',
	'rand',
	'rrange',
	'randInt',
	'pg',
]);
const TYPES = `
interface AswanOperationBuilder {
  /** Absolute offset from reservation start; default reference rate is 44100 Hz. */
  atSample(offset:number):AswanOperationBuilder;
  atSeconds(offset:number):AswanOperationBuilder;
  setVolume(channel:PlaygroundWonderSwanChannel,left:number,right?:number):AswanOperationBuilder;
  setPan(channel:PlaygroundWonderSwanChannel,left:number,right?:number):AswanOperationBuilder;
  setFrequency(channel:PlaygroundWonderSwanChannel,hz:number):AswanOperationBuilder;
  setNote(channel:PlaygroundWonderSwanChannel,note:string|number):AswanOperationBuilder;
  /** Synth note with software envelope. Not compilable as a hardware-only trace. */
  noteOn(channel:PlaygroundWonderSwanChannel,note:string|number):AswanOperationBuilder;
  /** Release only this reservation's current note, with the existing software fade. */
  noteOff(channel:PlaygroundWonderSwanChannel):AswanOperationBuilder;
  /** Raw hardware Gate; use setNote for pitch, with no software envelope. */
  keyOn(channel:PlaygroundWonderSwanChannel):AswanOperationBuilder;
  keyOff(channel:PlaygroundWonderSwanChannel):AswanOperationBuilder;
  setNoise(options:{enabled:boolean;type?:number;reset?:boolean}):AswanOperationBuilder;
  setSweep(options:{enabled:boolean;step?:number;time?:number}):AswanOperationBuilder;
}
interface AswanOperations {
  version:1;chip:'wonderswan';referenceSampleRate:number;
  operations:Array<{time:{unit:'sample'|'seconds';value:number};order:number;method:string;args:unknown[]}>;
}
interface AswanTimedSnapshot {
  readonly format:'tetorica-wonderswan-state';readonly version:1;readonly instanceId:string;
  readonly frame:number;readonly sampleRate:number;
  readonly state:{readonly clock:number;readonly initialized:boolean;readonly registers:readonly number[];readonly memory:readonly number[]};
}
interface AswanTimedReceipt {
  name:string;entries:number;sampleRate:number;startFrame?:number;repeatSeconds?:number;staged?:boolean;
}

interface AswanCodePreset {
  format:'tetorica-aswan-voice';version:1;name:string;source:'wave'|'noise'|'pcm';
  wave:number[];left:number;right:number;
  sweep:{enabled:boolean;step:number;time:number};noise:{type:number};
  envelope:{enabled:boolean;attack:number;decay:number;sustain:number;release:number};
  pcm:{data:string;sampleRate:number;rootNote:number;loop:boolean};
}
interface AswanCodeState {
  clock:number;initialized:boolean;registers:number[];memory:number[];
  /** Selected Auto source. Code still addresses all four physical channels. */
  editorSource:'wave'|'noise'|'pcm';preset:AswanCodePreset;
  pitch:number;capacity:number;frame:number;codeActive:boolean;
  channels:Array<{channel:number;index:number;preset:AswanCodePreset;authoredPreset:AswanCodePreset;
    left:number;right:number;baseLeft:number;baseRight:number;frequency:number;frequencyHz:number;
    active:boolean;enabled:boolean;gate:boolean;owner:'code'|'keyboard'|null}>;
  voices:Array<{id:string;midi:number;channel:number;released:boolean;kind:'code'|'keyboard'}>;
}
/** Borrow the editor's existing ASWAN. Every hardware call acknowledges asynchronously.
 * Four Wave channels; CH2 can be PCM, CH3 Sweep and CH4 Noise. */
type AswanCodeClient = Pick<PlaygroundWonderSwan,
  'initialize'|'writeRegister'|'writeMemory'|'loadMemory'|'setWaveform'|'setVolume'|'setPan'|
  'setFrequency'|'setNote'|'keyOn'|'keyOff'|'noteOn'|'allNotesOff'|'setNoise'|'setSweep'|'setVoiceMode'|'writeVoice'> & {
  readonly id:string;readonly chip:'wonderswan';readonly channels:4;readonly channelCount:4;readonly clock:3072000;
  getState():Promise<AswanCodeState>;
  /** Record once without reading or changing live state. Parameter, Synth note and raw Gate operations. */
  build(callback:(builder:AswanOperationBuilder)=>void,options?:{referenceSampleRate?:number}):AswanOperations;
  /** Detached sent-register metadata, not oscillator/LFSR/Sweep phase. */
  captureState():Promise<AswanTimedSnapshot>;
  /** Predict hardware writes without changing audio. Soft noteOn/noteOff and incomplete client state are explicitly rejected. */
  compile(operations:AswanOperations,options?:{initialState?:'current'|'reset'|'client'|AswanTimedSnapshot}):Promise<Array<{offsetSeconds:number;register:number;value:number;operationIndex:number;writeIndex:number}>>;
  /** Sample-clock parameter reservation. Apply replaces names; Stop cancels owners. */
  schedule(operations:AswanOperations,options:{name:string;repeatSeconds?:number}):Promise<AswanTimedReceipt>;
  clearSchedule(name:string):Promise<boolean>;
  /** Release the selected physical channel, using the current software release setting. */
  noteOff(channel:PlaygroundWonderSwanChannel):Promise<void>;
  /** End this Code lease without closing the editor's AudioContext. */
  dispose():Promise<void>;
};
type AswanCodeSoundChipMap={wonderswan:AswanCodeClient};
type PlaygroundLivePrepareAPI=AswanCodeAPI;
declare function useSoundChip<Name extends keyof AswanCodeSoundChipMap>(name:Name):Promise<AswanCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:AswanCodeAPI;
`;
export function selectAswanCodeDeclarations(source) {
	return selectCodeHostDeclarations(source, {
		globals: ASWAN_CODE_GLOBALS,
		customTypes: TYPES,
		apiName: 'AswanCodeAPI',
		banner: 'ASWAN Synth Code: one shared WonderSwan, no independent chip factory.',
		transformTypes(types) {
			const chip = types.get('PlaygroundWonderSwan');
			if (!chip) throw Error('Shared WonderSwan declarations are missing.');
			types.set(chip.name, {
				...chip,
				text: chip.text
					.replace(/^(\s+\w+\([^\n]*\)):void;/gm, '$1:Promise<void>;')
					.replace(/^(\s+\w+\([^\n]*\)):number;/gm, '$1:Promise<number>;'),
			});
		},
	});
}
