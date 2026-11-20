// SPDX-License-Identifier: BSD-3-Clause
// Shared Code runtime/editor over the upper editor's existing physical APU.
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js?v=draft-reconnect-1';
import { selectAswanCodeDeclarations } from './code_declarations.js';
import { createAswanCodeAudio } from './code_audio.js';
import {
	createAswanCodeProject,
	ASWAN_PROJECT_FILE_BYTES,
} from './code_project.js?v=draft-reconnect-1';
import { setupAswanCodeFiles } from './code_files.js?v=draft-reconnect-1';

export const ASWAN_STARTER_CODE = `const ws = await useSoundChip("wonderswan");
setBpm(120);

// The controls above edit this same chip. Follow the selected sound.
liveLoop("melody", async () => {
  const state = await ws.getState();
  const source = state.editorSource;
  const channel = source === "noise" ? CH4 : source === "pcm" ? CH2 : state.preset.sweep.enabled ? CH3 : CH1;
  await ws.noteOn(channel, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.24);
  await ws.noteOff(channel);
  await beat(0.5);
});
`;
const aborted = () => new DOMException('ASWAN Code stopped', 'AbortError');
export function setupAswanCodeHost({
	ensureAudio,
	getAudio,
	getSettings,
	applySettings,
	stopKeyboard,
	stopSong = async () => {},
	beforeSoundApply = async () => {},
	beforeRun = async () => {},
	prepareOutput = async () => {},
	onActivity = () => {},
	onViewChange = () => {},
	onExpandedChange = () => {},
	setStatus = () => {},
} = {}) {
	let disposed = false,
		epoch = 0,
		modeEpoch = 0,
		runtime = null,
		controls = null,
		files = null;
	const project = createAswanCodeProject({
		settings: getSettings(),
		getStarterCode: () => ASWAN_STARTER_CODE,
	});
	const audio = createAswanCodeAudio({
		ensureReady: ensureAudio,
		getAudio,
		onLog: (line) => controls?.appendLog(line),
	});
	const valid = (token) => {
		if (disposed || token !== epoch) throw aborted();
	};
	function openOutput() {
		const state = runtime?.getState();
		if (disposed || state?.running || state?.busy || state?.stopping) return false;
		audio.open();
		return true;
	}
	async function stop() {
		const request = ++modeEpoch;
		if (controls) await controls.stop();
		else if (runtime) await runtime.stop();
		if (!disposed && request === modeEpoch && !runtime?.getState().running) audio.open();
		onActivity();
	}
	files = setupAswanCodeFiles({
		project,
		getSettings,
		applySettings,
		setStatus,
		async onBeforeSoundApply() {
			await beforeSoundApply();
			if (!runtime?.getState().running) await stopKeyboard();
		},
		async onBeforeWorkspaceReplace() {
			await stopSong();
			await stop();
			await stopKeyboard();
		},
	});
	function getRuntime() {
		if (runtime) return runtime;
		runtime = createPlaygroundCodeRuntime({
			supportedSoundChips: ['wonderswan'],
			async ensureReady() {
				const token = epoch;
				await ensureAudio();
				valid(token);
				await audio.prepare();
				valid(token);
				const owner = getAudio();
				await prepareOutput(
					owner,
					() => !disposed && token === epoch && owner === getAudio(),
				);
				valid(token);
				audio.open();
				onActivity();
			},
			now: () => getAudio()?.context.currentTime ?? 0,
			useSoundChip: (name) => audio.useSoundChip(name),
			fx: audio.fx,
			resolveNoteTarget: audio.resolveNoteTarget,
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
				const token = epoch,
					owner = getAudio();
				await audio.stop();
				if (!getAudio()) await stopKeyboard();
				else if (
					!disposed &&
					token === epoch &&
					owner === getAudio() &&
					!runtime?.getState().running
				)
					audio.open();
			},
		});
		return runtime;
	}
	controls = setupSynthCodeControls({
		project,
		files,
		getRuntime,
		keepRunningOnKeyboard: true,
		persistentExpanded: true,
		onViewChange, onExpandedChange,
		allowTextFiles: true,
		maxTextLength: ASWAN_PROJECT_FILE_BYTES,
		writeText: (path, source) => project.writeEditorText(path, source),
		editorChip: 'wonderswan',
		transformDeclarations: selectAswanCodeDeclarations,
		journalKey: 'tetorica-aswan-synth-pending-code',
		getStarterCode: () => ASWAN_STARTER_CODE,
		async onBeforeRun() {
			modeEpoch++;
			await stopSong();
			if (!runtime?.getState().running) await stopKeyboard();
			await beforeRun();
		},
		async onModeChange() {
			modeEpoch++;
			openOutput();
			onActivity();
		},
		setStatus,
	});
	return {
		project,
		files,
		controls,
		ready: controls.ready,
		isCodeMode: () => controls.isCodeMode(),
		isRunning: () => Boolean(runtime?.getState().running),
		getState: () => runtime?.getState() ?? { state: 'idle', running: false },
		stop,
		openOutput,
		markSoundDirty: () => files.markSoundDirty(),
		async dispose() {
			if (disposed) return;
			await stop();
			disposed = true;
			epoch++;
			controls.dispose();
			await files.dispose();
			await audio.dispose();
		},
	};
}
