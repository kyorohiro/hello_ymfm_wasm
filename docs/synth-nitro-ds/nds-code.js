// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { createVirtualFileSystem } from '../js/tetorica_virtual_files/filesystem.js';
import { setupSynthCodeControls } from '../synth/synth_code_controls.js';
import { createSynthCodeProject } from '../synth/synth_code_project.js';
import { selectNdsCodeDeclarations } from './nds-code-declarations.js';

const INDEX = '/index.js';
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

/** Run a local script against the physical channels shared with the keyboard. */
export function createNdsCodeRuntime({
	ensureAudio,
	getAudio = () => null,
	onLog,
	onState,
	readFile,
	prepareSource = (source) => source,
}) {
	let audio = null, owner = null, revision = 0;
	const client = {
		configure: (...args) => owner.configure(...args),
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
		readFile,
		async prepareSource(source, options) {
			return channelBindings + await prepareSource(source, options);
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
	ensureAudio,
	getAudio,
	setStatus,
	onActivity = () => {},
	onViewChange,
}) {
	const fs = createVirtualFileSystem([{ path: INDEX, data: NDS_STARTER_CODE }]);
	const project = { fs, onDidChange: fs.onDidChange };
	const { readFile, prepareSource } = createSynthCodeProject(project);
	let controls = null, runtime = null;
	// The common editor's local recovery journal is the persistent copy of this
	// single document. Restore the document on load and leave the keyboard open.
	const files = {
		workspaceId: 'tetorica-nitro-ds',
		getCodeState: () => ({ mode: 'keyboard', path: INDEX }),
	};
	const getRuntime = () => (runtime ??= createNdsCodeRuntime({
		ensureAudio,
		getAudio,
		readFile,
		prepareSource,
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
		editorChip: 'nds',
		getStarterCode: () => NDS_STARTER_CODE,
		transformDeclarations: selectNdsCodeDeclarations,
		journalKey: 'tetorica-nitro-ds-code-v1',
		onViewChange,
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
