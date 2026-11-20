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
 type SmsGearPsg = Omit<PlaygroundSegaPsg,'dispose'|'resetAll'>;
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
