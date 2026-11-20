// SPDX-License-Identifier: BSD-3-Clause
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// TypeScript 7 exposes the native compiler through this API, not createProgram.
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { selectSmsGearCodeDeclarations } from "./code_declarations.js";
import {
	SMSGEAR_FM_TIMED_EXAMPLE,
	SMSGEAR_FM_EXAMPLE,
} from "./code_examples.js";

function check(declarations, source) {
	const root = resolve("."),
		directory = resolve(root, "__smsgear_opll_timed_types__"),
		config = resolve(directory, "tsconfig.json");
	const api = new API({
		cwd: root,
		fs: createVirtualFileSystem({
			[config]: JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					skipLibCheck: false,
					target: "es2022",
					module: "esnext",
					types: [],
					lib: ["es2022"],
				},
				files: ["globals.d.ts", "example.ts"],
			}),
			[resolve(directory, "globals.d.ts")]: declarations,
			[resolve(directory, "example.ts")]: source + "\nexport {};\n",
		}),
	});
	try {
		const snapshot = api.updateSnapshot({ openProjects: [config] });
		try {
			const project = snapshot.getProject(config);
			assert(project, "the strict virtual TypeScript project was loaded");
			const program = project.program;
			return [
				...program.getConfigFileParsingDiagnostics(),
				...program.getProgramDiagnostics(),
				...program.getSyntacticDiagnostics(),
				...program.getBindDiagnostics(),
				...program.getGlobalDiagnostics(),
				...program.getSemanticDiagnostics(),
			];
		} finally {
			snapshot.dispose();
		}
	} finally {
		api.close();
	}
}
const format = (diagnostics) =>
	diagnostics
		.map(
			(d) => `${d.fileName ?? "<config>"}:${d.pos} TS${d.code} ${d.text}`,
		)
		.join("\n");
const input = await readFile(
	new URL("../playground/tetorica-playground-globals.d.ts", import.meta.url),
	"utf8",
);
const declarations = selectSmsGearCodeDeclarations(input);
const usage = `
const chip=await useSoundChip('ym2413');
const operations=chip.build(b=>{
  b.atSample(0).setUserOperator(OP1,{tl:24,ar:15,dr:4});
  b.setUserOperator(OP2,{multi:2,ar:12,dr:5});
  b.setUserPatch([0,0,0,0,0,0,0,0]);
  b.setPreset(CH9,{instrument:0,userPatch:{feedback:2}});
  b.atSeconds(.01).noteOn(CH9,'C4').setAttenuation(CH9,5).noteOff(CH9);
  b.setRhythm({enabled:true,snare:true,hiHat:true});
  b.setRhythmLevel('snare',6).setRhythmLevels({cymbal:4,tom:7});
});
const snapshot=await chip.captureState();
const traces:PlaygroundYm2413CompiledWrite[][]=await Promise.all([
  chip.compile(operations),
  chip.compile(operations,{initialState:'current'}),
  chip.compile(operations,{initialState:'reset'}),
  chip.compile(operations,{initialState:'client'}),
  chip.compile(operations,{initialState:snapshot}),
]);
for(const trace of traces)for(const row of trace){
  const time:number=row.offsetSeconds;
  const value:number=row.value;
  const register:number=row.register;
  const intentMask:number|undefined=row.intentMask;
  void time;void value;void register;void intentMask;
}
await chip.schedule(operations,{name:'typed',repeatSeconds:.1});
const cleared:boolean=await chip.clearSchedule('typed');
void cleared;
`;

test("SMSGEAR actual OPLL timed example and capture/compile variants type-check against strict public declarations", () => {
	const diagnostics = check(
		declarations,
		SMSGEAR_FM_TIMED_EXAMPLE + "\n" + usage,
	);
	assert.equal(diagnostics.length, 0, format(diagnostics));
});

test("SMSGEAR existing immediate OPLL example stays valid in its own Code entry", () => {
	const diagnostics = check(declarations, SMSGEAR_FM_EXAMPLE);
	assert.equal(diagnostics.length, 0, format(diagnostics));
});

test("OPLL builder types reject carrier TL, invalid channels/drums, reset and non-plain patch data", () => {
	const negative = `
const chip=await useSoundChip('ym2413');
chip.build(b=>{
  b.setUserOperator(OP1,{tl:24});
  // @ts-expect-error Carrier TL is not a user-patch parameter; use channel attenuation.
  b.setUserOperator(OP2,{tl:24});
  // @ts-expect-error The tenth melodic channel does not exist (CH9 is valid zero-based8).
  b.noteOn(9,'C4');
  // @ts-expect-error OPLL percussion names are a fixed hardware set.
  b.setRhythmLevel('kick',4);
  // @ts-expect-error Unknown Rhythm trigger names are rejected.
  b.setRhythm({kick:true});
  // @ts-expect-error Reset is not a recorder operation.
  b.reset();
  // @ts-expect-error Recorded patches use plain number arrays, not typed arrays.
  b.setUserPatch(new Uint8Array(8));
  // @ts-expect-error A recorded nested preset also requires plain patch data.
  b.setPreset(CH1,{instrument:0,userPatch:new Uint8Array(8)});
});
const operations=chip.build(b=>b.keyOn(CH1));
// @ts-expect-error Reservation settings need a name.
await chip.schedule(operations,{});
// @ts-expect-error compile accepts only documented state baselines or snapshots.
await chip.compile(operations,{initialState:'live'});
`;
	const diagnostics = check(declarations, negative);
	assert.equal(diagnostics.length, 0, format(diagnostics));
	// Compiler diagnostics must appear when suppression directives are removed.
	const raw = check(
		declarations,
		negative.replace(/^\s*\/\/ @ts-expect-error.*$/gm, ""),
	);
	assert(raw.length >= 9, format(raw));
	assert(
		!raw.some((d) => d.code === 2578),
		"there are no unused expect-error directives",
	);
});
