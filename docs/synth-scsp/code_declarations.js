import { selectCodeHostDeclarations } from '../synth/synth_code_declarations.js?v=shared-code-hosts-1';

const globals = [
	'context',
	'fx',
	'CH1',
	'CH2',
	'CH3',
	'CH4',
	'CH5',
	'CH6',
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
];
const types = `
type ScspCodeLane = 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31;
type ScspCodeOperator = 0|1|2|3|4|5;
interface ScspCodeConfig {
  mode:'pcm'|'fm2'|'fm4'|'fm6';
  fm:{depth:number;ratio:number;algorithm:'chain'|'pairs'|'branch';ratios:number[]};
  transpose:number;
  effect:ScspCodeEffect;
}
interface ScspCodeEffect {enabled:boolean;timeMs:number;feedback:number;send:number;returnLevel:number;}
type ScspCodeConfigPatch = Partial<Omit<ScspCodeConfig,'fm'|'effect'>> & {fm?:Partial<ScspCodeConfig['fm']>};
type ScspCodePresetPatch = Partial<Omit<PlaygroundScspPreset,'envelope'|'lfo'|'modulation'>> & {envelope?:Partial<PlaygroundScspEnvelope>;lfo?:Partial<PlaygroundScspLfo>};
interface ScspCodePortableOperator {
  bits:8|16;pcm:number[];options:PlaygroundScspPCMOptions;
  voice:Omit<PlaygroundScspPreset,'sample'|'modulation'>;
}
interface ScspCodePatch {
  format:'tetorica-scsp-voice';version:4;name?:string;
  mode:ScspCodeConfig['mode'];fm:ScspCodeConfig['fm'];transpose:number;effect:ScspCodeEffect;
  operators:{carrier:ScspCodePortableOperator;modulator:ScspCodePortableOperator;c:ScspCodePortableOperator;d:ScspCodePortableOperator;e:ScspCodePortableOperator;f:ScspCodePortableOperator};
}
interface ScspCodeState extends PlaygroundScspState {
  config:ScspCodeConfig;pitchBend:number;voiceCapacity:number;sourceCount:6;codeActive:boolean;codeSession:number;
  /** App-only software release preference; excluded from portable presets. */
  clickGuard:boolean;
  voiceGroups:{id:string;midi:number;slots:number[];held:boolean;order:number;mode:ScspCodeConfig['mode'];owner:{kind:'keyboard'|'code';session?:number;channel?:number}}[];
  /** Keyboard owners of physical CH tabs, separate from Auto / Code groups. */
  manualVoices:{id:string;slot:number;midi:number;baseFrequencyHz:number;held:boolean;order:number}[];
  codeLanes:{channel:number;midi:number;groupId:string|null;slots:number[]}[];
}
/** Borrow the editor's PCM / FM sound and voice allocator.
 * Note and pitch methods address logical performance lanes 0..31.
 * Source editing methods address authored operators A–F, numbered 0..5.
 * Await edits and notes to preserve their Worklet execution order. */
interface ScspCodeClient {
  readonly id:string;readonly chip:'scsp';readonly apiKind:'scsp-performance';
  readonly channels:32;readonly channelCount:32;readonly logicalChannels:32;readonly operators:6;
  readonly sampleRate:44100;readonly nativeSampleRate:44100;
  isCurrent():boolean;
  loadPCM(pcm:Int8Array|Int16Array,options:PlaygroundScspPCMOptions):Promise<PlaygroundScspSample>;
  getPCM(operator:ScspCodeOperator):Promise<{voice:PlaygroundScspPreset;sample:PlaygroundScspSample;pcm:Int8Array|Int16Array}>;
  applyPCM(operator:ScspCodeOperator,pcm:Int8Array|Int16Array,options:PlaygroundScspPCMOptions):Promise<PlaygroundScspSample>;
  setPreset(operator:ScspCodeOperator,patch:ScspCodePresetPatch):Promise<boolean>;
  setEnvelope(operator:ScspCodeOperator,patch:Partial<PlaygroundScspEnvelope>):Promise<boolean>;
  setMix(operator:ScspCodeOperator,patch:Partial<PlaygroundScspMix>):Promise<boolean>;
  setLfo(operator:ScspCodeOperator,patch:Partial<PlaygroundScspLfo>):Promise<boolean>;
  setConfig(patch:ScspCodeConfigPatch):Promise<ScspCodeConfig>;
  setEffect(patch:Partial<ScspCodeEffect>):Promise<ScspCodeEffect>;
  exportPatch():Promise<ScspCodePatch>;
  /** Load an existing portable SCSP preset, version 1 through 4. */
  loadPatch(patch:unknown):Promise<boolean>;
  setFrequency(lane:ScspCodeLane,hz:number):Promise<number>;
  setNote(lane:ScspCodeLane,note:string|number):Promise<number>;
  noteOn(lane:ScspCodeLane,note:string|number):Promise<{slots:number[];stolenId:string|null}>;
  keyOn(lane:ScspCodeLane):Promise<{slots:number[];stolenId:string|null}>;
  /** Release this lane's current group using the Synth's software Click guard preference. Long hardware releases remain intact. */
  noteOff(lane:ScspCodeLane):Promise<boolean>;
  /** Raw hardware release for this logical lane's current group. Bypasses Click guard; does not address a physical CH tab or stop another owner. */
  keyOff(lane:ScspCodeLane):Promise<boolean>;
  getState():Promise<ScspCodeState>;
  allNotesOff():Promise<boolean>;
  dispose():Promise<unknown>;
}
type ScspCodeSoundChipMap = {scsp:ScspCodeClient};
type PlaygroundLivePrepareAPI = ScspCodeAPI;
declare function useSoundChip<Name extends keyof ScspCodeSoundChipMap>(name:Name):Promise<ScspCodeSoundChipMap[Name]>;
declare function trackAsync(task:PromiseLike<unknown>):void;
declare function parseNoteName(note:string):number;
declare function midiToNoteName(midi:number):string;
declare const pg:ScspCodeAPI;
`;
export function selectScspCodeDeclarations(source) {
	return selectCodeHostDeclarations(source, {
		globals,
		customTypes: types,
		apiName: 'ScspCodeAPI',
		banner: 'SCSP Synth Code: shared PCM / FM performance lanes and source operators.',
	});
}
