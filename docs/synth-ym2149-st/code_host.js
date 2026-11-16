// SPDX-License-Identifier: BSD-3-Clause
// Shared Code runtime/editor over the upper editor's existing physical APU.
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js?v=console-table-1';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js?v=draft-reconnect-1';
import { selectYmCodeDeclarations } from './code_declarations.js';
import { createYmCodeAudio } from './code_audio.js';
import {
	createYmCodeProject,
	YM_PROJECT_FILE_BYTES,
} from './code_project.js?v=draft-reconnect-1';
import { setupYmCodeFiles } from './code_files.js?v=ym-sample-1';

export const YM_STARTER_CODE = `const ym = await useSoundChip("ay8910");
setBpm(120);

// The controls above edit this same YM2149. Code uses physical CH1–CH3.
liveLoop("melody", async () => {
  ym.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.24);
  ym.noteOff(CH1);
  await beat(0.26);
});
`;
const aborted = () => new DOMException('YM Code stopped', 'AbortError');
export function setupYmCodeHost({
	ensureAudio,
	getAudio,
	getSettings,
	applySettings,
	stopKeyboard,
	stopSong = async () => {},
	beforeSoundApply = async () => {},
	beforeRun = async () => {},
	prepareOutput = async () => {},
	onBeforeNewProject = async () => {},
	downloadFile,
	onActivity = () => {},
	setStatus = () => {},
} = {}) {
	let disposed = false,
		epoch = 0,
		modeEpoch = 0,
		runtime = null,
		controls = null,
		files = null;
	const project = createYmCodeProject({
		settings: getSettings(),
		getStarterCode: () => YM_STARTER_CODE,
	});
	const audio = createYmCodeAudio({
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
	files = setupYmCodeFiles({
		project,
		getStarterCode: () => YM_STARTER_CODE,
		onBeforeNewProject,
		downloadFile,
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
			supportedSoundChips: ['ay8910'],
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
			readFile: (...args) => project.readFile(...args),
			prepareSource: (...args) => project.prepareSource(...args),
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
		allowTextFiles: true,
		maxTextLength: YM_PROJECT_FILE_BYTES,
		writeText: (path, source) => project.writeEditorText(path, source),
		editorChip: 'atari-st',
		transformDeclarations: selectYmCodeDeclarations,
		journalKey: 'tetorica-ym2149-st-synth-pending-code',
		getStarterCode: () => YM_STARTER_CODE,
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
