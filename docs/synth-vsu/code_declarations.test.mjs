// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerVsuCodeCompletions, selectVsuCodeDeclarations, VSU_CODE_GLOBALS } from './code_declarations.js';
import { VSU_TIMED_MODULATION_NOISE } from './code_examples.js';
import { attachVsuTimedClient } from './timed-client.js';
import { createVsuClient } from './vsu.js';

const shared = await readFile(new URL('../playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
const selected = selectVsuCodeDeclarations(shared);

test('VSU Code declarations match the public chip client and narrow shared globals', async () => {
	const names = new Set(Array.from(selected.matchAll(/^declare (?:function|const|var) ([\w$]+)/gm), match => match[1]));
	assert.deepEqual(names, new Set(VSU_CODE_GLOBALS));
	const chip = attachVsuTimedClient(createVsuClient({}), () => {});
	const externalMethods = new Set(Object.keys(chip).filter(name => typeof chip[name] === 'function'));
	const declaredMethods = Array.from(selected.matchAll(/^  ([\w$]+)(?:<Result>)?\(/gm), match => match[1]);
	assert.deepEqual(new Set(declaredMethods.filter(name => externalMethods.has(name))), externalMethods);
	assert.doesNotMatch(selected, /declare (?:function|const) (?:createSoundChip|fm|play|CH7)\b/);

	const directory = await mkdtemp(join(tmpdir(), 'vsu-code-types-'));
	try {
		const globals = join(directory, 'globals.d.ts');
		const example = join(directory, 'timed.js');
		const checks = join(directory, 'checks.ts');
		await writeFile(globals, selected);
		await writeFile(example, 'export {};\n' + VSU_TIMED_MODULATION_NOISE);
		await writeFile(checks, `export {};
const chip = await useSoundChip('vsu');
chip.setWave(2, new Uint8Array(32));
chip.setWaveSample(2, 31, 63);
chip.setWaveBank(CH5, 2);
chip.setEnvelope(CH6, { level: 15, rate: 3, direction: 'down', enabled: true, repeat: false });
chip.resetEnvelope(CH6);
chip.noteOn(CH6, 60);
const plan = chip.build(b => b.atSample(0).resetEnvelope(CH1).noteOn(CH1, 'C4').atSeconds(0.2).noteOff(CH1));
const value: number = (await chip.compile(plan))[0].value;
const accepted: VsuScheduleReceipt = await chip.schedule(plan, { name: 'phrase', repeatSeconds: 0.5 });
const cleared: boolean = await chip.clearSchedule(accepted.name);
const patch = await file<{ name: string }>('patch.vsu.json', { type: 'json' });
await livePrepare('test', api => api.useSoundChip('vsu'));
pg.log(cleared, value, patch.name);
// @ts-expect-error only VSU is available
useSoundChip('ym2612');
// @ts-expect-error only six channels
chip.noteOn(6, 60);
// @ts-expect-error CH6 is Noise
chip.setWaveBank(CH6, 0);
// @ts-expect-error only five banks
chip.setWave(5, []);
// @ts-expect-error Envelope direction uses the VSU's up/down setting
chip.setEnvelope(CH1, { level: 15, rate: 0, direction: 'decay', enabled: true, repeat: false });
// @ts-expect-error the builder callback must be synchronous
chip.build(async b => b.noteOff(CH1));
// @ts-expect-error the compiler has no initial state option
chip.compile(plan, { initialState: 'reset' });
// @ts-expect-error there is no live state introspection on the Code API
chip.getState();
`);
		const tsc = fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url));
		try {
			execFileSync(process.execPath, [tsc, '--strict', '--allowJs', '--checkJs', '--noEmit', '--target', 'ES2022',
				'--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022', globals, example, checks]);
		} catch (error) {
			throw new Error(error.stdout?.toString() || error.message);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('literal hints resolve VSU aliases and builders and replace only the typed argument', () => {
	let provider, model, dispose, disposed = false;
	registerVsuCodeCompletions({
		monaco: { languages: {
			CompletionItemKind: { Value: 1, Constant: 2 },
			registerCompletionItemProvider(language, registered) {
				assert.equal(language, 'javascript');
				provider = registered;
				return { dispose: () => { disposed = true; } };
			},
		} },
		monacoEditor: { getModel: () => model, onDidDispose: fn => { dispose = fn; } },
	});
	function suggestions(source) {
		const [before, after] = source.split('│');
		const lines = before.split('\n');
		model = {
			getLineContent: () => lines.at(-1) + after,
			getValueInRange: () => before,
		};
		const position = { lineNumber: lines.length, column: lines.at(-1).length + 1 };
		return provider.provideCompletionItems(model, position)?.suggestions ?? [];
	}
	assert.deepEqual(suggestions(`const synth = await useSoundChip('vs│');`).map(item => item.insertText), ['vsu']);
	const opened = `const lead = await pg.useSoundChip('vsu');\n`;
	const note = suggestions(opened + `lead.noteOn(CH5, "C│2");`).find(item => item.label === 'C4');
	assert.deepEqual(note.range, { startLineNumber: 2, endLineNumber: 2, startColumn: 19, endColumn: 21 });
	assert.equal(note.detail, 'MIDI 60');
	const builder = opened + `lead.build((recorder) => {\nconst start = recorder.atSample(0);\n`;
	assert.ok(suggestions(builder + `start.atSeconds(1).noteOn(CH1, '│');`).some(item => item.label === 'G9'));
	const registers = suggestions(builder + `start.write(0x5│44, 0);`);
	assert.equal(registers.find(item => item.label === '0x51c').detail, 'CH5 SWP');
	assert.equal(registers.find(item => item.label === '0x544').detail, 'CH6 LRV');
	assert.equal(registers.some(item => item.label === '0x558'), false);
	assert.deepEqual(suggestions(`const lead = await useSoundChip('sid');\nlead.noteOn(CH1, '│');`), []);
	assert.deepEqual(suggestions(opened + `// lead.noteOn(CH1, '│');`), []);
	assert.equal(provider.provideCompletionItems({}, {}), undefined);
	dispose();
	assert.equal(disposed, true);
});
