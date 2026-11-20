// SPDX-License-Identifier: BSD-3-Clause
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// TypeScript 7 exposes the native compiler through this API, not createProgram.
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { selectSmsGearCodeDeclarations } from "./code_declarations.js";
import { SMSGEAR_PSG_TIMED_EXAMPLE } from "./code_examples.js";

function check(declarations, source) {
	const root = resolve("."),
		directory = resolve(root, "__smsgear_timed_types__"),
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
const chip=await useSoundChip('segapsg');
const operations=chip.build(b=>{
  b.atSample(0).setPeriod(CH1,100).setNote(CH2,'C4').noteOn(CH3,60);
  b.atSeconds(.01).setAttenuation(CH4,7).setStereo(255);
  b.noise({type:'periodic',rate:'tone3',attenuation:4}).noiseOff();
});
const snapshot=await chip.captureState();
const traces:SmsGearPsgWrite[][]=await Promise.all([
  chip.compile(operations),
  chip.compile(operations,{initialState:'current'}),
  chip.compile(operations,{initialState:'reset'}),
  chip.compile(operations,{initialState:'client'}),
  chip.compile(operations,{initialState:snapshot}),
]);
for(const trace of traces)for(const row of trace){
  const time:number=row.offsetSeconds;
  if('value' in row){const value:number=row.value;const register:number=row.register;void value;void register;}
  else {const stereo:number=row.stereo;void stereo;}
  void time;
}
await chip.schedule(operations,{name:'typed',repeatSeconds:.1});
const cleared:boolean=await chip.clearSchedule('typed');
void cleared;
`;

test("SMSGEAR real timed PSG example and capture/compile variants type-check with strict public declarations", () => {
	const diagnostics = check(
		declarations,
		SMSGEAR_PSG_TIMED_EXAMPLE + "\n" + usage,
	);
	assert.equal(diagnostics.length, 0, format(diagnostics));
});

test("timed PSG completion types reject invalid tone channels, unsupported builder reset and wrong parameter types", () => {
	const negative = `
const chip=await useSoundChip('segapsg');
chip.build(b=>{
  // @ts-expect-error Noise CH4 cannot be a pitched tone noteOn target.
  b.noteOn(CH4,'C4');
  // @ts-expect-error Reset is not an operation-recorder method.
  b.reset();
  // @ts-expect-error Attenuation is a numeric hardware code.
  b.setAttenuation(CH1,'loud');
});
const operations=chip.build(b=>b.keyOn(CH1));
// @ts-expect-error schedule requires a named reservation.
await chip.schedule(operations,{});
// @ts-expect-error compile only accepts named state modes or a captured snapshot.
await chip.compile(operations,{initialState:'live'});
`;
	const diagnostics = check(declarations, negative);
	assert.equal(diagnostics.length, 0, format(diagnostics));
	// Prove the invalid examples generated diagnostics rather than being typed
	// as any: removing their expectation directives must expose each error.
	const raw = check(
		declarations,
		negative.replace(/^\s*\/\/ @ts-expect-error.*$/gm, ""),
	);
	assert(raw.length >= 5, format(raw));
	assert(
		!raw.some((d) => d.code === 2578),
		"there are no unused expect-error directives",
	);
});
