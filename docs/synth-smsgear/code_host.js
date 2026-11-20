// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from "../js/playground_code_runtime.js";
import { setupSynthCodeControls } from "../synth/synth_code_controls.js";
import {
	createSmsGearCodeProject,
	SMSGEAR_PROJECT_FILE_BYTES,
} from "./code_project.js";
import { setupSmsGearCodeFiles } from "./code_files.js";
import { selectSmsGearCodeDeclarations } from "./code_declarations.js";
import { createSmsGearCodeAudio } from "./code_audio.js";
import { SMSGEAR_PSG_EXAMPLE } from "./code_examples.js";
export function setupSmsGearCodeHost({
	ensureAudio,
	getAudio,
	getSettings,
	applySettings,
	stopKeyboard,
	stopSong,
	onActivity = () => {},
	onViewChange = () => {},
	onExpandedChange = () => {},
	setStatus = () => {},
}) {
	let runtime = null,
		controls = null,
		epoch = 0;
	const project = createSmsGearCodeProject({
		settings: getSettings(),
		getStarterCode: () => SMSGEAR_PSG_EXAMPLE,
		includeExamples: true,
	});
	const audio = createSmsGearCodeAudio({
		ensureReady: ensureAudio,
		getAudio,
		onLog: (line) => controls?.appendLog(line),
	});
	const stop = async () => {
		if (controls) await controls.stop();
		audio.open();
	};
	const files = setupSmsGearCodeFiles({
		project,
		getSettings,
		applySettings,
		setStatus,
		onBeforeSoundApply: async () => {
			if (!runtime?.getState().running) stopKeyboard();
		},
		onBeforeWorkspaceReplace: async () => {
			await stop();
			await stopSong();
			stopKeyboard();
		},
	});
	const getRuntime = () =>
		(runtime ??= createPlaygroundCodeRuntime({
			supportedSoundChips: ["segapsg", "ym2413"],
			async ensureReady() {
				const token = epoch;
				await ensureAudio();
				if (token !== epoch)
					throw new DOMException("Code cancelled", "AbortError");
				await audio.prepare();
				audio.open();
			},
			now: () => getAudio()?.context.currentTime ?? 0,
			useSoundChip: (name) => audio.useSoundChip(name),
			fx: audio.fx,
			resolveNoteTarget: (target, method, args) =>
				Number.isInteger(args[0]) ? { target, channel: args[0] } : null,
			readFile: (...args) => project.readSavedFile(...args),
			prepareSource: (...args) => project.prepareSavedSource(...args),
			onLog: (line) => controls?.appendLog(line),
			onState: (state) => {
				controls?.setRuntimeState(state);
				onActivity();
			},
			beforeStopSoundChips() {
				epoch++;
				return audio.beforeStop();
			},
			async stopSoundChips() {
				await audio.stop();
				audio.open();
				onActivity();
			},
		}));
	controls = setupSynthCodeControls({
		project,
		files,
		getRuntime,
		keepRunningOnKeyboard: true,
		persistentExpanded: true,
		allowTextFiles: true,
		maxTextLength: SMSGEAR_PROJECT_FILE_BYTES,
		writeText: (path, value) => project.writeEditorText(path, value),
		editorChip: "master-system",
		transformDeclarations: selectSmsGearCodeDeclarations,
		journalKey: "tetorica-smsgear-pending-code",
		getStarterCode: () => SMSGEAR_PSG_EXAMPLE,
		async onBeforeRun() {
			await stopSong();
			if (!runtime?.getState().running) stopKeyboard();
		},
		onModeChange() {
			onActivity();
		},
		onViewChange,
		onExpandedChange,
		setStatus,
	});
	return {
		project,
		files,
		controls,
		ready: controls.ready,
		stop,
		isRunning: () => Boolean(runtime?.getState().running),
		getState: () => runtime?.getState() ?? { running: false },
		openOutput: () => audio.open(),
		markSoundDirty: (value) => files.markSoundDirty(value),
		async dispose() {
			await stop();
			controls.dispose();
			await files.dispose();
			await audio.dispose();
		},
	};
}
