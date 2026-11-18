// SPDX-License-Identifier: BSD-3-Clause
// Shared Code runtime/editor over the upper editor's existing SCSP.
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js?v=sdsp-code-review-1';
import { selectScspCodeDeclarations } from './code_declarations.js?v=scsp-fm-multi-self-1';
import { createScspCodeAudio } from './code_audio.js';
import {
	createScspCodeProject,
	SCSP_PROJECT_FILE_BYTES,
} from './code_project.js?v=scsp-fm-multi-self-1';
import { setupScspCodeFiles } from './code_files.js?v=scsp-dsp-save-1';

export const SCSP_STARTER_CODE = `const scsp = await useSoundChip('scsp');
setBpm(120);

// Play the current PCM / FM sound from the editor.
liveLoop('melody', async () => {
  await scsp.noteOn(CH1, choose(scale('C4', 'minorPentatonic', 1)));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
`;
const aborted = () => new DOMException('SCSP Code stopped', 'AbortError');
export function setupScspCodeHost({
	ensureAudio,
	getAudio,
	getSettings,
	applySettings,
	stopKeyboard,
	onBeforeRun = async () => {},
	onOpenSource = async () => false,
	stopLooper = async () => {},
	clearLooper = stopLooper,
	stopSong = async () => {},
	onActivity = () => {},
	setStatus = () => {},
} = {}) {
	let disposed = false,
		epoch = 0,
		modeEpoch = 0,
		runtime = null,
		controls = null,
		files = null;
	const project = createScspCodeProject({
		settings: getSettings(),
		getStarterCode: () => SCSP_STARTER_CODE,
	});
	const audio = createScspCodeAudio({
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
	files = setupScspCodeFiles({
		project,
		getSettings,
		applySettings,
		setStatus,
		onOpenSource,
		async onBeforeSoundApply() {
			if (!runtime?.getState().running) await stopKeyboard();
		},
		async onBeforeWorkspaceReplace() {
			await clearLooper();
			await stopSong();
			await stop();
			await stopKeyboard();
		},
	});
	function getRuntime() {
		if (runtime) return runtime;
		runtime = createPlaygroundCodeRuntime({
			supportedSoundChips: ['scsp'],
			async ensureReady() {
				const token = epoch;
				await ensureAudio();
				valid(token);
				await audio.prepare();
				valid(token);
				audio.open();
				onActivity();
			},
			now: () => getAudio()?.context.currentTime ?? 0,
			useSoundChip: (name) => audio.useSoundChip(name),
			fx: audio.fx,
			resolveNoteTarget: (...args) => audio.resolveNoteTarget(...args),
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
		maxTextLength: SCSP_PROJECT_FILE_BYTES,
		writeText: (path, source) => project.writeEditorText(path, source),
		editorChip: 'scsp',
		transformDeclarations: selectScspCodeDeclarations,
		journalKey: 'tetorica-scsp-synth-pending-code',
		getStarterCode: () => SCSP_STARTER_CODE,
		async onBeforeRun() {
			await onBeforeRun();
			await stopLooper();
			modeEpoch++;
			if (!runtime?.getState().running) await stopKeyboard();
		},
		async onModeChange() {
			await stopLooper();
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
		saveDspSetupCode: (source, options = {}) => files.saveCode({ ...options, source }),
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
