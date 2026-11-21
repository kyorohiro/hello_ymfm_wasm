// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js';
import { selectNdsCodeDeclarations } from './nds-code-declarations.js?v=nds-code-presets-1';
import { ndsPresetChannelSettings, readNdsPreset } from './nds-preset.js?v=nds-code-presets-1';

const extraChannels = Array.from({ length: 10 }, (_, index) => ['CH' + (index + 7), index + 6]);
// The common Code runtime already injects the first six channels.
const channelBindings = 'const ' + extraChannels.map(([name, value]) => name + '=' + value).join(', ') +
	'; Object.assign(pg, {' + extraChannels.map(([name]) => name).join(', ') + '});\n';

export const NDS_STARTER_CODE = `const nds = await useSoundChip("nds");
setBpm(120);

const notes = scale("C4", "minorPentatonic", 1);
liveLoop("melody", async () => {
  await nds.noteOn(CH1, choose(notes));
  await beat(0.35);
  await nds.noteOff(CH1);
  await beat(0.15);
});
`;

export const NDS_STARTER_FILES = Object.freeze([
	{
		path: '/examples/pcm-shapes.js',
		data: `const nds = await useSoundChip("nds");
setBpm(112);

// Use the same pitch to hear three sample formats and their software templates.
/** @type {NdsCodeVoiceSettings[]} */
const samples = [
  { mode: "pcm8", shape: "triangle" },
  { mode: "pcm16", shape: "sine" },
  { mode: "adpcm", shape: "saw" },
];
liveLoop("sample-formats", async () => {
  const sample = cycle(samples);
  await nds.noteOn(CH1, "C4", sample);
  await beat(0.75);
  await nds.noteOff(CH1);
  await beat(0.25);
});
`,
	},
	{
		path: '/examples/pulse-and-noise.js',
		data: `const nds = await useSoundChip("nds");
setBpm(124);

// Pulse is available on CH9–CH14. CH15 and CH16 can play hardware Noise.
const notes = ["C4", "G4", "Bb4", "Eb5"];
await nds.configure(CH15, { mode: "noise", volume: 37 });
await nds.setFrequency(CH15, 6000);

liveLoop("pulse", async () => {
  await nds.noteOn(CH9, cycle(notes), { mode: "pulse", duty: 2, volume: 76 });
  await beat(0.32);
  await nds.noteOff(CH9);
  await beat(0.18);
});

liveLoop("noise", async () => {
  await nds.keyOn(CH15);
  await beat(0.05);
  await nds.noteOff(CH15);
  await beat(0.95);
});
`,
	},
]);

/** Run a local script against the physical channels shared with the keyboard. */
export function createNdsCodeRuntime({
	project,
	ensureAudio,
	getAudio = () => null,
	onLog,
	onState,
}) {
	const savedCode = project && createSynthCodeProject(project, { version: 'saved' });
	let audio = null, owner = null, revision = 0;
	const client = {
		configure: (...args) => owner.configure(...args),
		async loadPreset(channel, source) {
			const preset = readNdsPreset(source);
			return owner.configure(channel, ndsPresetChannelSettings(preset));
		},
		setFrequency: (...args) => owner.setFrequency(...args),
		setNote: (...args) => owner.setNote(...args),
		keyOn: (...args) => owner.keyOn(...args),
		keyOff: (...args) => owner.keyOff(...args),
		noteOn: (...args) => owner.noteOn(...args),
		noteOff: (...args) => owner.noteOff(...args),
		getState: (...args) => owner.getState(...args),
		allNotesOff: () => owner.stopOwned(),
	};
	return createPlaygroundCodeRuntime({
		supportedSoundChips: ['nds'],
		async ensureReady() {
			const token = revision;
			const nextAudio = await ensureAudio() ?? getAudio();
			if (token !== revision) throw new DOMException('Code stopped', 'AbortError');
			owner = nextAudio.chip.forOwner('code');
			audio = nextAudio;
		},
		now: () => audio?.context.currentTime ?? 0,
		useSoundChip: () => client,
		readFile: savedCode?.readFile,
		prepareSource(source, options) {
			return channelBindings + (savedCode ? savedCode.prepareSource(source, options) : source);
		},
		onLog,
		onState,
		beforeStopSoundChips() { revision++; },
		async stopSoundChips() {
			const previous = owner;
			owner = null;
			audio = null;
			await previous?.stopOwned();
		},
	});
}

export function setupNdsCode({
	project,
	files,
	ensureAudio,
	getAudio,
	setStatus,
	onActivity = () => {},
	onViewChange,
	onExpandedChange,
}) {
	let controls = null, runtime = null;
	const getRuntime = () => (runtime ??= createNdsCodeRuntime({
		project,
		ensureAudio,
		getAudio,
		onLog: (line) => controls?.appendLog(line),
		onState(state) {
			controls?.setRuntimeState(state);
			onActivity(state);
		},
	}));
	controls = setupSynthCodeControls({
		project,
		files,
		getRuntime,
		keepRunningOnKeyboard: true,
		persistentExpanded: true,
		allowTextFiles: true,
		writeText: (path, source) => project.writeEditorText(path, source),
		onBeforeRun() {
			const path = controls.activePath;
			if (!project.savedFs.has(path)) throw new Error(`Save ${path} before running Code.`);
		},
		editorChip: 'nds',
		getStarterCode: () => NDS_STARTER_CODE,
		transformDeclarations: selectNdsCodeDeclarations,
		journalKey: 'tetorica-nitro-ds-code-v1',
		onViewChange,
		onExpandedChange,
		setStatus,
	});
	return {
		controls,
		ready: controls.ready,
		stop: controls.stop,
		isRunning: () => Boolean(runtime?.getState().running),
		async dispose() { controls.dispose(); },
	};
}
