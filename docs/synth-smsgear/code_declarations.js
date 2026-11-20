// SPDX-License-Identifier: BSD-3-Clause
import { selectCodeHostDeclarations } from "../synth/synth_code_declarations.js";
export function selectSmsGearCodeDeclarations(source) {
	return selectCodeHostDeclarations(source, {
		globals: [
			"context",
			"fx",
			"CH1",
			"CH2",
			"CH3",
			"CH4",
			"CH5",
			"CH6",
			"CH7",
			"CH8",
			"CH9",
			"OP1",
			"OP2",
			"console",
			"log",
			"useSoundChip",
			"file",
			"setBpm",
			"beat",
			"nextBeat",
			"sleep",
			"sleepSamples",
			"tween",
			"liveLoop",
			"livePrepare",
			"liveFx",
			"stopLoop",
			"stopAllLoops",
			"liveCleanup",
			"trackAsync",
			"scale",
			"chord",
			"lerp",
			"choose",
			"cycle",
			"rand",
			"rrange",
			"randInt",
			"pg",
		],
		customTypes: `
 declare function trackAsync(task:PromiseLike<unknown>):void;
 type SmsGearPsgMethod = 'setPeriod'|'setFrequency'|'setNote'|'noteOn'|'tone'|'keyOn'|'keyOff'|'off'|'setAttenuation'|'setNoise'|'noise'|'noiseVolume'|'noiseOff'|'setStereo'|'write';
 type SmsGearPsgBuilder = {atSample(offset:number):SmsGearPsgBuilder;atSeconds(offset:number):SmsGearPsgBuilder} & {
   [K in SmsGearPsgMethod]: (...args:Parameters<PlaygroundSegaPsg[K]>)=>SmsGearPsgBuilder
 };
 interface SmsGearPsgOperations {version:1;chip:'segapsg';referenceSampleRate:number;operations:ReadonlyArray<{time:{unit:'sample'|'seconds';value:number};order:number;method:SmsGearPsgMethod;args:unknown[]}>}
 interface SmsGearPsgSnapshot {readonly format:'tetorica-psg-state';readonly version:1;readonly instanceId:string|number;readonly frame:number;readonly sampleRate:number;readonly state:{readonly clock:number;readonly stereoEnabled:boolean;readonly periods:readonly number[];readonly attenuations:readonly number[];readonly latched:number;readonly noiseMode:number;readonly stereo:number}}
 type SmsGearPsgWrite = {offsetSeconds:number;operationIndex:number;writeIndex:number} & ({value:number;register:number;channel:number}|{stereo:number});
 type SmsGearPsg = Omit<PlaygroundSegaPsg,'dispose'|'resetAll'> & {
   /** Record once without reading or changing the chip; absolute offsets. */
   build(callback:(builder:SmsGearPsgBuilder)=>void,options?:{referenceSampleRate?:number}):SmsGearPsgOperations;
   /** Detached operation-resolution state, not an oscillator/audio save state. */
   captureState():Promise<SmsGearPsgSnapshot>;
   /** Inspect concrete PSG bytes. current uses a Worklet snapshot; client is explicitly unavailable until the local shadow is complete. */
   compile(operations:SmsGearPsgOperations,options?:{initialState?:'current'|'reset'|'client'|SmsGearPsgSnapshot}):Promise<SmsGearPsgWrite[]>;
   /** Execute via the audio sample clock. Later manual writes resolve in actual order. */
   schedule(operations:SmsGearPsgOperations,options:{name:string;repeatSeconds?:number}):Promise<unknown>;
   clearSchedule(name:string):Promise<boolean>;
 };
 type SmsGearOpll = Omit<PlaygroundYm2413,'dispose'>;
 declare function useSoundChip<Name extends 'segapsg'|'ym2413'>(name:Name):Promise<Name extends 'segapsg'?SmsGearPsg:SmsGearOpll>;
 type PlaygroundSelectedFmChannel = PlaygroundYm2413Channel;
 type PlaygroundLivePrepareAPI = SmsGearCodeAPI;
 declare const pg:SmsGearCodeAPI;
 `.replace(/^ /gm, ""),
		apiName: "SmsGearCodeAPI",
		banner: "SMSGEAR Code shares the editor Sega PSG and YM2413. Scheduling/FX are software controls.",
	});
}
