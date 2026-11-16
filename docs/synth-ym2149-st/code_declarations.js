// The public AY declarations, scoped to the Atari ST editor's three physical voices.
import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js';

export const YM_CODE_GLOBALS = Object.freeze([
	'context', 'fx', 'CH1', 'CH2', 'CH3', 'console', 'log', 'useSoundChip', 'file',
	'setBpm', 'beat', 'nextBeat', 'sleep', 'sleepSamples', 'tween', 'liveLoop',
	'livePrepare', 'liveFx', 'stopLoop', 'stopAllLoops', 'liveCleanup', 'trackAsync',
	'parseNoteName', 'midiToNoteName', 'scale', 'chord', 'lerp', 'choose', 'cycle',
	'rand', 'rrange', 'randInt', 'pg',
]);
const TYPES = `
interface YmCodeVoice {
  tone:boolean;noise:boolean;volume:number;envelope:boolean;period:number;
}
interface YmCodePreset {
  format:'tetorica-ym2149-st-voice';version:1;name:string;
  voices:[YmCodeVoice,YmCodeVoice,YmCodeVoice];noisePeriod:number;
  envelope:{period:number;shape:number};
}
interface YmCodeState {
  preset:YmCodePreset;selectedChannel:PlaygroundAy8910Channel|null;pitch:number;
  activeChannels:PlaygroundAy8910Channel[];revision:number;
  registers:number[];clock:2000000;initialized:true;
}
/** Borrow the editor's existing 2 MHz YM2149. Hardware controls stay synchronous.
 * CH1..CH3 mix tone and shared noise and may use one shared hardware envelope. */
type YmCodeClient = Omit<PlaygroundAy8910,'dispose'> & {
  readonly id:string;readonly clock:2000000;
  getState():YmCodeState;
  /** End this Code lease without closing the editor's AudioContext. */
  dispose():void;
};
type YmCodeSoundChipMap={ay8910:YmCodeClient};
type PlaygroundLivePrepareAPI=YmCodeAPI;
declare function useSoundChip<Name extends keyof YmCodeSoundChipMap>(name:Name):Promise<YmCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:YmCodeAPI;
`;
export function selectYmCodeDeclarations(source) {
	return selectCodeHostDeclarations(source, {
		globals: YM_CODE_GLOBALS,
		customTypes: TYPES,
		apiName: 'YmCodeAPI',
		banner: 'YM2149 ST Synth Code: one shared AY-compatible instrument.',
		transformTypes(types) {
			if (!types.has('PlaygroundAy8910'))
				throw Error('Shared AY declarations are missing.');
		},
	});
}
