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
