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
type ScspCodeCustomOperator = ScspCodeOperator;
type ScspCodeCustomOperator2 = 0|1;
type ScspCodeCustomOperator4 = 0|1|2|3;
/** Custom2 keeps one source per receiving operator. */
type ScspCodeCustomInput<Source extends ScspCodeCustomOperator2=ScspCodeCustomOperator2> = []|[Source];
type ScspCodeCustomInput4<Source extends ScspCodeCustomOperator4=ScspCodeCustomOperator4> = []|[Source]|[Source,Source];
type ScspCodeCustomInput6<Source extends ScspCodeCustomOperator=ScspCodeCustomOperator> = []|[Source]|[Source,Source];
interface ScspCodeCustomNoSelfRouting2 {
  inputs:[ScspCodeCustomInput<1>,ScspCodeCustomInput<0>];
  /** Direct outputs are independent of which operators modulate another. */
  outputs:ScspCodeCustomOperator2[];
}
/** One self OP, optionally feeding the other OP. Self uses X32/Y0 histories. */
type ScspCodeCustomSelfRouting2 =
  {inputs:[[0],[]|[0]];outputs:ScspCodeCustomOperator2[]} |
  {inputs:[[]|[1],[1]];outputs:ScspCodeCustomOperator2[]};
type ScspCodeCustomRouting2 = ScspCodeCustomNoSelfRouting2|ScspCodeCustomSelfRouting2;
/** Duplicate sources and unsupported feedback / cycles reject atomically. */
interface ScspCodeCustomNoSelfRouting4 {
  inputs:[ScspCodeCustomInput4<Exclude<ScspCodeCustomOperator4,0>>,ScspCodeCustomInput4<Exclude<ScspCodeCustomOperator4,1>>,ScspCodeCustomInput4<Exclude<ScspCodeCustomOperator4,2>>,ScspCodeCustomInput4<Exclude<ScspCodeCustomOperator4,3>>];
  outputs:ScspCodeCustomOperator4[];
}
interface ScspCodeCustomNoSelfRouting6 {
  inputs:[ScspCodeCustomInput6<Exclude<ScspCodeCustomOperator,0>>,ScspCodeCustomInput6<Exclude<ScspCodeCustomOperator,1>>,ScspCodeCustomInput6<Exclude<ScspCodeCustomOperator,2>>,ScspCodeCustomInput6<Exclude<ScspCodeCustomOperator,3>>,ScspCodeCustomInput6<Exclude<ScspCodeCustomOperator,4>>,ScspCodeCustomInput6<Exclude<ScspCodeCustomOperator,5>>];
  outputs:ScspCodeCustomOperator[];
}
/** Replace exactly one target with its exclusive self input. Other targets
 * retain their external-only inputs; cross-operator cycles validate at runtime. */
type ScspCodeCustomSelfInputs<Inputs extends unknown[],Self extends number> = {
  [Index in keyof Inputs]: Index extends \`\${Self}\` ? [Self] : Inputs[Index];
};
type ScspCodeCustomSelfRouting4 = {
  [Self in ScspCodeCustomOperator4]: {inputs:ScspCodeCustomSelfInputs<ScspCodeCustomNoSelfRouting4['inputs'],Self>;outputs:ScspCodeCustomOperator4[]}
}[ScspCodeCustomOperator4];
type ScspCodeCustomSelfRouting6 = {
  [Self in ScspCodeCustomOperator]: {inputs:ScspCodeCustomSelfInputs<ScspCodeCustomNoSelfRouting6['inputs'],Self>;outputs:ScspCodeCustomOperator[]}
}[ScspCodeCustomOperator];
type ScspCodeCustomRouting4 = ScspCodeCustomNoSelfRouting4|ScspCodeCustomSelfRouting4;
type ScspCodeCustomRouting6 = ScspCodeCustomNoSelfRouting6|ScspCodeCustomSelfRouting6;
type ScspCodeCustomRouting = ScspCodeCustomRouting2|ScspCodeCustomRouting4|ScspCodeCustomRouting6;
/** Receiving-operator MDL code. The editor validates integer codes 0–12 at runtime. */
type ScspCodeFmDepth = number;
type ScspCodeFmDepths = [ScspCodeFmDepth,ScspCodeFmDepth,ScspCodeFmDepth,ScspCodeFmDepth,ScspCodeFmDepth,ScspCodeFmDepth];
interface ScspCodeConfig {
  mode:'pcm'|'fm2'|'fm4'|'fm6';
  fm:{depth:number;depths?:ScspCodeFmDepths;ratio:number;algorithm:'chain'|'pairs'|'branch'|'custom';ratios:number[];custom?:ScspCodeCustomRouting};
  transpose:number;
  effect:ScspCodeEffect;
}
interface ScspCodeEffect {
  enabled:boolean;timeMs:number;
  /** COEF1 multiplier, -1..4095/4096; the hardware uses floor(feedback * 4096). */
  feedback:number;
  send:number;returnLevel:number;
}
/** Signed 13-bit COEF0..2 codes (-4096..4095); multiplier = code / 4096. */
type ScspCodeDspCoefficientPatch = Partial<{0:number;1:number;2:number}>;
interface ScspCodeDspCoefficients {
  codes:[number,number,number];
  /** Existing Feedback request; the actual COEF1 code is floor(feedback * 4096). */
  feedback:number;
}
interface ScspCodeDspProgram {
  words:number[];
  custom:boolean;
  /** Advances when program words change; coefficient-only edits keep the revision. */
  revision:number;
  coefficients:ScspCodeDspCoefficients;
}
/** Raw ISEL / IMXL request, distinct from a physical slot or EFREG output. */
interface ScspCodeDspSend {input:0|1;level:number;}
/** Raw EFSDL 0..7 / EFPAN 0..31; 31 left-only, 15 right-only, 0 center. */
interface ScspCodeDspReturn {level:number;pan:number;}
interface ScspCodeDspRouting {sources:ScspCodeDspSend[];slots:ScspCodeDspSend[];}
interface ScspCodeDspApplyOptions {
  /** Supply all three entries to apply program and coefficients atomically. */
  coefficients:{0:number;1:number;2:number};
}
type ScspCodeConfigPatch = Partial<Omit<ScspCodeConfig,'fm'|'effect'>> & {fm?:Partial<ScspCodeConfig['fm']>};
type ScspCodeMix = Omit<PlaygroundScspMix,'dspInput'|'dspSend'>;
type ScspCodePresetPatch = Partial<Omit<PlaygroundScspPreset,'envelope'|'lfo'|'modulation'|'dspInput'|'dspSend'>> & {envelope?:Partial<PlaygroundScspEnvelope>;lfo?:Partial<PlaygroundScspLfo>};
interface ScspCodePortableOperator {
  bits:8|16;pcm:number[];options:PlaygroundScspPCMOptions;
  voice:Omit<PlaygroundScspPreset,'sample'|'modulation'|'dspInput'|'dspSend'>;
}
interface ScspCodePatchBase {
  format:'tetorica-scsp-voice';name?:string;
  transpose:number;effect:ScspCodeEffect;
  operators:{carrier:ScspCodePortableOperator;modulator:ScspCodePortableOperator;c:ScspCodePortableOperator;d:ScspCodePortableOperator;e:ScspCodePortableOperator;f:ScspCodePortableOperator};
}
type ScspCodeFixedFm = Omit<ScspCodeConfig['fm'],'algorithm'|'custom'> & {algorithm:'chain'|'pairs'|'branch'};
type ScspCodeCustomFm<Graph extends ScspCodeCustomRouting> = Omit<ScspCodeConfig['fm'],'algorithm'|'custom'> & {algorithm:'custom';custom:Graph};
type ScspCodePatch = ScspCodePatchBase & (
  {version:4;mode:ScspCodeConfig['mode'];fm:ScspCodeFixedFm & {depths?:never}} |
  {version:5;mode:'fm2';fm:ScspCodeCustomFm<ScspCodeCustomNoSelfRouting2> & {depths?:never}} |
  {version:6;mode:'fm4';fm:ScspCodeCustomFm<ScspCodeCustomNoSelfRouting4> & {depths?:never}} |
  {version:6;mode:'fm6';fm:ScspCodeCustomFm<ScspCodeCustomNoSelfRouting6> & {depths?:never}} |
  {version:7;mode:ScspCodeConfig['mode'];fm:ScspCodeFixedFm & {depths:ScspCodeFmDepths}} |
  {version:7;mode:'fm2';fm:ScspCodeCustomFm<ScspCodeCustomNoSelfRouting2> & {depths:ScspCodeFmDepths}} |
  {version:7;mode:'fm4';fm:ScspCodeCustomFm<ScspCodeCustomNoSelfRouting4> & {depths:ScspCodeFmDepths}} |
  {version:7;mode:'fm6';fm:ScspCodeCustomFm<ScspCodeCustomNoSelfRouting6> & {depths:ScspCodeFmDepths}} |
  {version:8;mode:'fm2';fm:ScspCodeCustomFm<ScspCodeCustomSelfRouting2>} |
  {version:9;mode:'fm4';fm:ScspCodeCustomFm<ScspCodeCustomSelfRouting4>} |
  {version:9;mode:'fm6';fm:ScspCodeCustomFm<ScspCodeCustomSelfRouting6>}
);
interface ScspCodeState extends PlaygroundScspState {
  config:ScspCodeConfig;pitchBend:number;voiceCapacity:number;sourceCount:6;codeActive:boolean;codeSession:number;
  /** Current Synth COEF0..2 signed 13-bit codes; multiplier = code / 4096. */
  dspCoefficients:[number,number,number];
  dspRouting:ScspCodeDspRouting;
  dspReturns:[ScspCodeDspReturn,ScspCodeDspReturn];
  /** App-only software release preference; excluded from portable presets. */
  clickGuard:boolean;
  /** Custom groups map authored A–F to physical slots, separately from allocation order. */
  voiceGroups:{id:string;midi:number;slots:number[];operatorSlots?:[number,number]|[number,number,number,number]|[number,number,number,number,number,number];held:boolean;order:number;mode:ScspCodeConfig['mode'];owner:{kind:'keyboard'|'code';session?:number;channel?:number}}[];
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
  /** Source level / direct Pan. DSP routing uses setDspSourceSend(). */
  setMix(operator:ScspCodeOperator,patch:Partial<ScspCodeMix>):Promise<boolean>;
  setLfo(operator:ScspCodeOperator,patch:Partial<PlaygroundScspLfo>):Promise<boolean>;
  /** Custom routing supports fm2/fm4/fm6 with at most two distinct sources per OP.
   * Every Custom FM size allows at most one self OP with only [self] as its input.
   * Custom2 keeps one source per target; other Custom4/6 targets allow two. Its hardware
   * X32/Y0 inputs average two stored generations; the existing adapter depth 0
   * disables modulation. New Auto/Code self attacks clear only their owned
   * self-slot history cells. Depth edits retain those histories and notes.
   * An explicit graph must match the active operator count. Changing mode without
   * a graph preserves surviving connections / Self and adds disconnected operators.
   * Graph changes retire Auto notes after validation; Code continues running.
   * fm.depths supplies six receiving-OP MDL codes. Omit it to use fm.depth.
   * A scalar-only fm.depth edit sets all six; an explicit depths array wins.
   * Uniform arrays normalize to the scalar form. Depth edits retain notes. */
  setConfig(patch:ScspCodeConfigPatch):Promise<ScspCodeConfig>;
  setEffect(patch:Partial<ScspCodeEffect>):Promise<ScspCodeEffect>;
  /** Live physical-slot DSP routing. null restores the Synth default send.
   * This method addresses actual CH1..CH32, unlike the logical note lanes. */
  setDspSend(slot:ScspCodeLane,patch:Partial<ScspCodeDspSend>|null):Promise<ScspCodeDspSend>;
  /** Auto source template routing; also updates its currently held groups.
   * null restores the global default. Auto allocation is Synth software. */
  setDspSourceSend(operator:ScspCodeOperator,patch:Partial<ScspCodeDspSend>|null):Promise<ScspCodeDspSend>;
  /** Independent hardware effect return. Enable gates both without losing these settings. */
  setDspReturn(output:0|1,patch:Partial<ScspCodeDspReturn>):Promise<ScspCodeDspReturn>;
  /** Parse source and check this Synth's DSP execution profile locally.
   * Returns an owned 512-word image without an audio-owner request or rendering.
   * useSoundChip() prepares audio; compilation itself does not modify it. */
  compileDsp(source:string):Uint16Array;
  /** Apply to the shared Synth DSP; does not reset held voices or Code.
   * Omit options to retain coefficients, or supply all three for atomic setup.
   * Changed setup clears the DSP RAM ring. Identical setup is a no-op.
   * Code Stop retains this session's program and coefficients. */
  applyDspProgram(words:Uint16Array|readonly number[],options?:ScspCodeDspApplyOptions):Promise<ScspCodeDspProgram>;
  /** Read the shared program and coefficient snapshot without advancing audio. */
  getDspProgram():Promise<ScspCodeDspProgram>;
  /** Read COEF0..2 and the existing Feedback value. */
  getDspCoefficients():Promise<ScspCodeDspCoefficients>;
  /** Atomically update only supplied signed COEF0..2 codes (-4096..4095).
   * Live edits retain the DSP ring and voices. COEF1 also updates Feedback. */
  setDspCoefficients(patch:ScspCodeDspCoefficientPatch):Promise<ScspCodeDspCoefficients>;
  exportPatch():Promise<ScspCodePatch>;
  /** Load portable SCSP presets 1–9. Custom two-OP uses version 5;
   * custom four/six-OP uses version 6. Mixed per-OP depth uses version 7.
   * A Custom2 self-feedback graph uses v8; Custom4/6 Self uses v9.
   * Both Self formats require a complete graph and have optional depths. */
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
