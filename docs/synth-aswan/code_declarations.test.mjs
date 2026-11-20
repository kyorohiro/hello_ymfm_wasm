import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ASWAN_CODE_GLOBALS, selectAswanCodeDeclarations } from './code_declarations.js';
import { ASWAN_TIMED_EXAMPLE } from './code_examples.js';
import { ASWAN_STARTER_CODE } from './code_host.js';
import { definitionSource, sourcePosition } from '../playground/playground_monaco_definitions.js';
const shared = await readFile(
		new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url),
		'utf8',
	),
	selected = selectAswanCodeDeclarations(shared);
test('ASWAN declarations expose one four-channel borrowed chip and shared timing/Files helpers', () => {
	const names = [
		...new Set(
			[...selected.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm)].map((m) => m[1]),
		),
	].sort();
	assert.deepEqual(names, [...ASWAN_CODE_GLOBALS].sort());
	assert.doesNotMatch(
		selected,
		/declare (?:function|const) (?:fm|sid|play|createSoundChip|CH5|CH6|OP1)\b/,
	);
	assert.doesNotMatch(selected, /interface Playground(?:Sid|Ps1|Nes|Snes)|type FMApi/);
	assert.match(selected, /keyOn\(channel:PlaygroundWonderSwanChannel\):Promise<void>/);
});
test('ASWAN async controls, valid source types and channel limits typecheck, including starter', async () => {
	const work = await mkdtemp(join(tmpdir(), 'aswan-code-types-'));
	try {
		await writeFile(join(work, 'globals.d.ts'), selected);
		await writeFile(join(work, 'starter.js'), 'export {};\n' + ASWAN_STARTER_CODE);
        await writeFile(join(work, 'timed.js'), 'export {};\n' + ASWAN_TIMED_EXAMPLE);
		await writeFile(
			join(work, 'entry.ts'),
			`export {};
const ws=await useSoundChip('wonderswan');
const hz:Promise<number>=ws.setNote(CH3,'E3');await hz;
const write:Promise<void>=ws.setWaveform(CH1,new Uint8Array(32));await write;
await ws.setSweep({enabled:true,step:-9,time:3});await ws.setNoise({enabled:true,type:7,reset:true});
await ws.setVolume(CH4,8,7);await ws.setVoiceMode(true);await ws.writeVoice(128);await ws.writeRegister(0x90,1);
await ws.loadMemory(new Uint8Array(32),0x2000);await ws.noteOn(CH2,60);await ws.noteOff(CH2);await ws.keyOff(CH4);
const plan=ws.build(b=>{b.atSample(20).setNote(CH1,'C4');b.setNoise({enabled:true,reset:true});},{referenceSampleRate:48000});
const snapshot=await ws.captureState();
await ws.compile(plan,{initialState:snapshot});await ws.compile(plan,{initialState:'reset'});
await ws.schedule(plan,{name:'test',repeatSeconds:.1});await ws.clearSchedule('test');
// @ts-expect-error gates are immediate, outside this bounded recorder
ws.build(b=>b.noteOn(CH1,'C4'));
// @ts-expect-error RAM transfers are outside timed parameter operations
ws.build(b=>b.setWaveform(CH1,[0,1]));
const state=await ws.getState();const source:'wave'|'noise'|'pcm'=state.editorSource;state.registers[0];state.memory[0];state.channels[0];
await livePrepare('state',async api=>api.useSoundChip('wonderswan'));pg.log(source);await ws.dispose();
// @ts-expect-error the Synth borrows one ASWAN
await useSoundChip('sid');
// @ts-expect-error only four physical channels
await ws.noteOn(4,'C4');
// @ts-expect-error hardware writes acknowledge asynchronously
const sync:void=ws.keyOff(CH4);
// @ts-expect-error a Synth lease cannot alter the clock
await ws.setClock(4000000);
// @ts-expect-error no independent chip factory
await ws.prepareTimeline({});
// @ts-expect-error no global FM-style play helper
play('C4');
`,
		);
		const compiler = fileURLToPath(
			new URL('../../node_modules/typescript/bin/tsc', import.meta.url),
		);
		execFileSync(
			process.execPath,
			[
				compiler,
				'--strict',
				'--checkJs',
				'--allowJs',
				'--noEmit',
				'--skipLibCheck',
				'false',
				'--target',
				'ES2022',
				'--module',
				'ESNext',
				'--moduleResolution',
				'Bundler',
				'--lib',
				'ES2022',
				join(work, 'globals.d.ts'),
				join(work, 'entry.ts'),
				join(work, 'starter.js'),
                join(work, 'timed.js'),
			],
			{ stdio: 'pipe' },
		);
	} catch (error) {
		throw Error(error.stdout?.toString() || error.message);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
});
test('ASWAN API methods retain readable implementation links in Monaco', async () => {
	const source = await readFile(new URL('../js/wonderswansynth.js', import.meta.url), 'utf8'),
		lines = selected.split('\n');
	for (const symbol of ['setNote', 'setWaveform', 'setNoise', 'setSweep']) {
		const line = lines.findIndex((text) => text.trimStart().startsWith(symbol + '('));
		assert(line >= 0);
		assert.deepEqual(
			definitionSource(
				selected,
				{ lineNumber: line + 1, column: lines[line].indexOf(symbol) + 1 },
				'wonderswan',
				{ runtimeFile: 'playground_code_runtime.js' },
			),
			{ file: 'wonderswansynth.js', symbol },
		);
		assert(sourcePosition(source, symbol).lineNumber > 1);
	}
});
