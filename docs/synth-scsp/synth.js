// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundScspVoicePanel } from '../playground/playground_scsp_voice_panel.js';
import { createAudio } from './audio.js';
import { SynthInstrument } from './instrument.js';
import { readPatch, writePatch } from './patch.js';
import { OPERATOR_NAMES, OPERATOR_KEYS, operatorCount } from './routing.js';
import { enhanceScspNumberControls } from './controls.js';
import { setupScspCodeHost } from './code_host.js';
import { setupScspSongControls, isScspSongPath } from './song_controls.js';
import { setupSynthMenu } from '../synth/synth_menu.js';
import { createSpuOutputVisualizer } from '../synth-spu/spu_synth_visualizer.js';
import { createStateObserver } from '../synth-2a03/state_observer.js';
import {
	createFretboardState,
	createFretboardLayout,
	renderFretboardControls,
	buildKeyboard,
	setInstrument,
	setFretPosition,
	setStringWindowIndex,
	midiToNoteName,
} from '../synth/synth_keyboard.js';

const $ = (id) => document.getElementById(id);
const status = (message, error = false) => {
	$('status').textContent = message;
	$('status').dataset.error = String(error);
};
const report = (error) => {
	if (error?.name !== 'AbortError') status(error?.message ?? String(error), true);
};
const clone = (value) => structuredClone(value);
let audio = null,
	opening = null,
	disposed = false,
	switchingAudioOutput = false;
let queue = Promise.resolve(),
	revision = 0,
	epoch = 0,
	sequence = 0;
let selectedOperator = 0,
	latestState = null,
	codeHost = null,
	songControls = null,
	songState = null;
let cachedPatch = null,
	soundName = null,
	operatorReads = [],
	sampleKeys = [];
let octave = 0,
	bend = 0,
	baseTranspose = 0;
const held = new Map(),
	fret = createFretboardState();
const operatorButtons = [...document.querySelectorAll('[data-operator]')];
const effectControls = [
	'effectEnabled',
	'delayTime',
	'delayFeedback',
	'effectSend',
	'effectReturn',
];
const wheels = [
	[$('pitchBend'), $('pitchBendValue')],
	[$('keyboardPitchBend'), $('keyboardPitchValue')],
];

// The passive authoring model uses the same validation and PCM allocator.
// It has no native renderer, AudioContext, timer or speaker connection.
const draftRam = new Uint8Array(524288);
const draft = new SynthInstrument({
	sampleRate: 44100,
	reset(options = {}) {
		if (options.clearRam) draftRam.fill(0);
	},
	write() {},
	loadRam(bytes, address = 0) {
		draftRam.set(bytes, address);
	},
	readRam(address, length) {
		return draftRam.slice(address, address + length);
	},
	renderInto(left, right) {
		left.fill(0);
		right.fill(0);
	},
	dispose() {},
});
cachedPatch = draft.exportPatch();
const command = (method, args = []) =>
	audio ? audio.command(method, args) : Promise.resolve(draft[method](...args));
const invoke = (method, args = []) =>
	audio ? audio.invoke(method, args) : Promise.resolve(draft.invoke(method, args));
function enqueue(action) {
	const task = queue.then(action);
	queue = task.catch(report);
	return task;
}
const visualizer = createSpuOutputVisualizer({ canvas: $('outputCanvas') });
visualizer.setMode('waveform');
function syncActivity() {
	const code = Boolean(codeHost?.isRunning());
	visualizer.setRunning(Boolean(!disposed && (code || held.size || songState?.playing)));
	observer.update({
		engine: audio,
		active: Boolean(!disposed && !document.hidden && audio && code && !switchingAudioOutput),
	});
}
function cacheAuthoring({ state, operators }) {
	for (let index = 0; index < 6; index++)
		if (operators[index]) operatorReads[index] = operators[index];
	sampleKeys = state.slots
		.slice(0, 6)
		.map((voice) => `${voice.sample.bankId}:${voice.sample.id}`);
	const sources = Object.fromEntries(
		OPERATOR_KEYS.map((key, index) => [
			key,
			{ ...operatorReads[index], voice: state.slots[index] },
		]),
	);
	baseTranspose = state.config.transpose;
	cachedPatch = writePatch({ ...state.config, transpose: baseTranspose }, sources);
	if (soundName) cachedPatch.name = soundName;
	latestState = state;
	const ids = new Set(state.voiceGroups.map((group) => group.id));
	for (const [source, note] of held)
		if (note.started && !note.pending && !ids.has(note.id)) held.delete(source);
}
async function readAuthoring(engine = audio) {
	return engine ? engine.command('readAuthoring', [sampleKeys]) : draft.readAuthoring(sampleKeys);
}
const observer = createStateObserver({
	read: (engine) => readAuthoring(engine),
	onState(value, engine) {
		if (engine !== audio) return;
		cacheAuthoring(value);
		renderState();
		highlight();
	},
	intervalMs: 100,
});
function drawConnections(state) {
	$('connectionPaths').replaceChildren();
	state.routing.inputs.forEach((sources, target) =>
		sources.forEach((source) => {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			const x = 50 + source * 100,
				y = 50 + target * 100,
				top = 15 + Math.abs(source - target) * 5;
			path.setAttribute('d', `M ${x} 105 C ${x} ${top}, ${y} ${top}, ${y} 100`);
			path.classList.toggle(
				'selected',
				source === selectedOperator || target === selectedOperator,
			);
			$('connectionPaths').append(path);
		}),
	);
	$('connections').setAttribute('aria-label', $('routingSummary').textContent);
	$('selectedOperator').textContent = OPERATOR_NAMES[selectedOperator];
}
function renderState() {
	if (!latestState || disposed) return;
	const state = latestState;
	if (!$('voice').querySelector('.is-dragging')) panel.update(state);
	const memory = $('voice').querySelector(':scope > p');
	if (memory)
		memory.textContent = memory.textContent.replace(
			'Sample RAM',
			'SCSP RAM (64 KiB reserved for DSP)',
		);
	for (const [id, value] of [
		['voiceMode', state.config.mode],
		['fmDepth', state.config.fm.depth],
		['fmRatio', state.config.fm.ratio],
		['algorithm', state.config.fm.algorithm],
		['operatorRatio', state.config.fm.ratios[selectedOperator]],
		['pitch', baseTranspose],
	]) {
		if (document.activeElement !== $(id) && !$(id).classList.contains('is-dragging'))
			$(id).value = String(value);
	}
	for (const id of ['fmDepth', 'fmRatio', 'algorithm', 'operatorRatio'])
		$(id).disabled = state.config.mode === 'pcm';
	$('capacity').textContent =
		`${state.voiceCapacity} voices · ${operatorCount(state.config.mode)} slot(s) per key · 6 source slots`;
	for (const [id, key] of [
		['delayTime', 'timeMs'],
		['delayFeedback', 'feedback'],
		['effectSend', 'send'],
		['effectReturn', 'returnLevel'],
	]) {
		if (document.activeElement !== $(id) && !$(id).classList.contains('is-dragging'))
			$(id).value = String(state.config.effect[key]);
	}
	$('effectEnabled').checked = state.config.effect.enabled;
	$('scspDspTab').textContent = state.config.effect.enabled
		? 'DSP · Experimental Delay on'
		: 'DSP · Under construction';
	const { inputs, outputs, count } = state.routing;
	$('routingSummary').textContent = inputs
		.flatMap((sources, target) =>
			sources.map((source) => `${OPERATOR_NAMES[source]} → ${OPERATOR_NAMES[target]}`),
		)
		.concat([`Output · ${outputs.map((index) => OPERATOR_NAMES[index]).join(' + ')}`])
		.join(' · ');
	drawConnections(state);
	for (const button of operatorButtons) {
		const index = Number(button.dataset.operator);
		button.setAttribute('aria-pressed', String(index === selectedOperator));
		button.textContent = `${OPERATOR_NAMES[index]} · ${index >= count ? 'Unused' : outputs.includes(index) ? 'Output' : 'Modulator'}`;
	}
	numberControls?.update();
}
async function refresh({ dirty = false } = {}) {
	const value = await readAuthoring();
	cacheAuthoring(value);
	renderState();
	highlight();
	if (dirty) {
		revision++;
		codeHost?.markSoundDirty();
	}
	return value.state;
}
function audioFailed(error) {
	const previous = audio;
	audio = null;
	epoch++;
	held.clear();
	bend = 0;
	setWheelUi(0);
	songControls?.stop();
	void codeHost?.stop().catch(() => {});
	draft.loadPatch(cachedPatch);
	sampleKeys = [];
	operatorReads = [];
	visualizer.disconnect();
	highlight();
	$('start').textContent = 'Enable audio';
	if (previous) void previous.dispose().catch(() => {});
	void refresh().catch(report);
	report(error);
}
async function ensureAudio() {
	if (disposed) throw new Error('SCSP Synth is closed');
	if (!audio && !opening) {
		$('start').disabled = true;
		status('Preparing SCSP audio…');
		opening = (async () => {
			const engine = await createAudio({
				volume: Number($('volume').value),
				onError: audioFailed,
			});
			try {
				let applied;
				do {
					applied = revision;
					await engine.command('loadPatch', [clone(cachedPatch)]);
				} while (applied !== revision);
				if (disposed) throw new Error('SCSP Synth is closed');
				await engine.command('setPitchBend', [bend]);
				engine.setVolume(Number($('volume').value));
				audio = engine;
				sampleKeys = [];
				operatorReads = [];
				visualizer.connect(engine.context, engine.outputNode);
				$('start').textContent = 'Audio ready';
				await refresh();
				syncActivity();
				return engine;
			} catch (error) {
				await engine.dispose();
				throw error;
			}
		})().finally(() => {
			opening = null;
			$('start').disabled = false;
		});
	}
	const engine = audio ?? (await opening);
	await engine.resume();
	return engine;
}
async function applySettings(value, { isCurrent = () => true } = {}) {
	readPatch(value);
	if (!isCurrent() || disposed) return false;
	return enqueue(async () => {
		if (!isCurrent() || disposed) return false;
		await command('loadPatch', [value]);
		await command('setPitchBend', [0]);
		soundName = value.name ?? null;
		bend = 0;
		setWheelUi(0);
		// A running Code session retains sounding groups and their PCM. Keep the
		// keyboard identities until keyup, then let the snapshot remove retired IDs.
		sampleKeys = [];
		operatorReads = [];
		await refresh({ dirty: true });
		status('SCSP instrument loaded.');
		return isCurrent();
	});
}
const panel = createPlaygroundScspVoicePanel({
	root: $('voice'),
	showModulation: false,
	onError: report,
	invoke: (method, args) =>
		enqueue(async () => {
			try {
				const result = await invoke(method, args);
				if (!['getPCM', 'auditionOff', 'auditionOn'].includes(method))
					await refresh({ dirty: true });
				return result;
			} catch (error) {
				document.activeElement?.blur();
				await refresh();
				throw error;
			}
		}),
});
$('voice').querySelector('[data-chip-action="scsp-hold"]').hidden = true;
$('voice').querySelectorAll(':scope > p')[1].hidden = true;
for (const paragraph of $('voice').querySelectorAll('p')) {
	if (paragraph.textContent.startsWith('Software editor:'))
		paragraph.textContent =
			'Software waveform editor · Apply updates new notes. Held and releasing notes retain their PCM. Apply before changing the editing operator.';
}
for (const label of $('voice').querySelectorAll(':scope > label'))
	if (label.textContent.startsWith('MIDI note')) label.hidden = true;
const copyButton = $('voice').querySelector('[data-chip-action="scsp-copy"]');
copyButton.textContent = 'Copy operator JavaScript';
const numberControls = enhanceScspNumberControls(document.querySelector('.synth-shell'));
panel.setConnected(true);
for (const id of ['voiceMode', 'pitch', ...effectControls]) $(id).disabled = false;
for (const button of operatorButtons) button.disabled = false;

const keyboard = document.createElement('div');
keyboard.className = 'keyboard';
$('keyboard').append(keyboard);
const tools = Object.fromEntries(
	['instrument', 'position', 'fret', 'strings', 'window'].map((name) => {
		const node = document.createElement('div');
		node.className = `fretboard-${name} ${['fret', 'strings'].includes(name) ? 'fret-display' : 'toolbar-group'}`;
		return [name, node];
	}),
);
const toolbar = document.createElement('div');
toolbar.className = 'fretboard-toolbar';
const summary = document.createElement('div');
summary.className = 'fretboard-row fretboard-summary';
summary.append(tools.fret, tools.strings);
const choices = document.createElement('div');
choices.className = 'fretboard-row';
for (const name of ['instrument', 'position', 'window']) choices.append(tools[name]);
toolbar.append(summary, choices);
$('keyboardFretboard').append(toolbar);
let layout;
function highlight() {
	const keys = new Set([...held.values()].map((note) => note.key));
	for (const button of $('keyboard').querySelectorAll('.key')) {
		const active = keys.has(button.dataset.key);
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', String(active));
	}
	syncActivity();
}
function renderKeyboard() {
	layout = createFretboardLayout({ state: fret });
	renderFretboardControls({
		instrumentRoot: tools.instrument,
		positionRoot: tools.position,
		fretDisplayRoot: tools.fret,
		stringDisplayRoot: tools.strings,
		stringWindowRoot: tools.window,
		state: fret,
		onInstrumentChange(value) {
			void stopKeyboard();
			setInstrument(fret, value);
			renderKeyboard();
		},
		onPositionPresetSelect(value) {
			void stopKeyboard();
			setFretPosition(fret, value);
			renderKeyboard();
		},
		onStringWindowChange(value) {
			void stopKeyboard();
			setStringWindowIndex(fret, value);
			renderKeyboard();
		},
	});
	const entries = layout.entries.map((entry) => ({
		...entry,
		midi: entry.midi + octave * 12,
		noteName: midiToNoteName(entry.midi + octave * 12),
	}));
	buildKeyboard({
		root: keyboard,
		rowDefs: layout.rowDefs,
		layoutEntries: entries,
		showPitch: false,
		onPointerDown(event, entry) {
			if (event.button === 0) press(`pointer:${event.pointerId}`, entry);
		},
		onPointerUp: (event) => release(`pointer:${event.pointerId}`),
		onPointerCancel: (event) => release(`pointer:${event.pointerId}`),
	});
	for (const button of keyboard.querySelectorAll('.key')) {
		const entry = entries.find((item) => item.key === button.dataset.key);
		button.disabled = entry.midi < 0 || entry.midi > 127;
		button.addEventListener('keydown', (event) => {
			if ([' ', 'Enter'].includes(event.key)) {
				event.preventDefault();
				if (!event.repeat) press(`button:${entry.key}`, entry);
			}
		});
		button.addEventListener('keyup', (event) => {
			if ([' ', 'Enter'].includes(event.key)) {
				event.preventDefault();
				release(`button:${entry.key}`);
			}
		});
	}
	$('octaveValue').textContent = `${octave >= 0 ? '+' : ''}${octave}`;
	$('octaveDown').disabled = octave <= -2;
	$('octaveUp').disabled = octave >= 3;
	highlight();
}
function press(source, entry) {
	if (switchingAudioOutput || held.has(source) || entry.midi < 0 || entry.midi > 127) return;
	const note = {
		id: `scsp-key:${++sequence}`,
		key: entry.key,
		midi: entry.midi,
		epoch,
		started: false,
		pending: false,
	};
	held.set(source, note);
	highlight();
	void enqueue(async () => {
		if (held.get(source) !== note || note.epoch !== epoch || switchingAudioOutput) return;
		const engine = await ensureAudio();
		if (held.get(source) !== note || note.epoch !== epoch || switchingAudioOutput) return;
		note.started = note.pending = true;
		const result = await engine.command('noteOn', [note.id, note.midi]);
		note.pending = false;
		if (result.stolenId)
			for (const [key, old] of held) if (old.id === result.stolenId) held.delete(key);
		await refresh();
		status(`${midiToNoteName(note.midi)} · ${held.size} held`);
	}).catch((error) => {
		if (held.get(source) === note) held.delete(source);
		highlight();
		report(error);
	});
}
function release(source) {
	const note = held.get(source);
	if (!note) return;
	held.delete(source);
	highlight();
	if (note.started)
		void enqueue(async () => {
			if (audio && note.epoch === epoch) await audio.command('noteOff', [note.id]);
		});
}
function stopKeyboard() {
	const notes = [...held.values()].filter((note) => note.started);
	epoch++;
	held.clear();
	highlight();
	return enqueue(async () => {
		for (const note of notes) if (audio) await audio.command('noteOff', [note.id]);
	});
}
async function stopAll() {
	await codeHost?.stop();
	await songControls?.stop();
	await stopKeyboard();
	await enqueue(() => command('stopVoices'));
	await refresh();
	visualizer.stop();
	status('Stopped · instrument retained.');
}
async function configure(patch, { routeChanged = false } = {}) {
	await enqueue(async () => {
		try {
			await command('setConfig', [patch]);
			if (routeChanged) {
				epoch++;
				held.clear();
			}
			await refresh({ dirty: true });
			status('Sound updated.');
		} catch (error) {
			await refresh();
			throw error;
		}
	});
}
$('start').addEventListener('click', () => {
	$('start').blur();
	void enqueue(ensureAudio).catch(report);
});
$('stop').addEventListener('click', () => {
	$('stop').blur();
	void stopAll().catch(report);
});
for (const [id, delta] of [
	['octaveDown', -1],
	['octaveUp', 1],
])
	$(id).addEventListener('click', () => {
		$(id).blur();
		void stopKeyboard();
		octave = Math.max(-2, Math.min(3, octave + delta));
		renderKeyboard();
	});
const editing = (target) => {
	const input = target?.closest?.(
		'input,select,textarea,[contenteditable="true"],dialog[open],.monaco-editor',
	);
	return input && !input.matches?.('input[type="range"],input[type="checkbox"]');
};
window.addEventListener('keydown', (event) => {
	if (event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
	const entry = layout.entries.find((item) => item.key === event.key.toLowerCase());
	if (!entry) return;
	event.preventDefault();
	if (!event.repeat)
		press(`key:${event.code || entry.key}`, { ...entry, midi: entry.midi + octave * 12 });
});
window.addEventListener('keyup', (event) =>
	release(`key:${event.code || event.key.toLowerCase()}`),
);
window.addEventListener('blur', () => {
	void stopKeyboard();
	setBend(0);
});
document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		void stopKeyboard();
		setBend(0);
	}
	syncActivity();
});
function setWheelUi(value) {
	for (const [input, output] of wheels) {
		input.value = String(value);
		output.textContent = `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
	}
}
function setBend(value) {
	bend = value;
	setWheelUi(value);
	if (!audio && !opening) return;
	void enqueue(async () => {
		await command('setPitchBend', [value]);
		await refresh();
	}).catch(report);
}
for (const [input] of wheels) {
	input.addEventListener('input', () => setBend(Number(input.value)));
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'change'])
		input.addEventListener(type, () => setBend(0));
}
function setVolume() {
	const value = Number($('volume').value);
	$('volumeValue').textContent = `${Math.round(value * 100)}%`;
	$('volume').dataset.boosted = String(value > 1);
	audio?.setVolume(value);
	visualizer.wake();
}
$('volume').addEventListener('input', setVolume);
$('volume').addEventListener('change', () => $('volume').blur());
$('voiceMode').addEventListener('change', () => {
	$('voiceMode').blur();
	void configure({ mode: $('voiceMode').value }, { routeChanged: true }).catch(report);
});
$('algorithm').addEventListener('change', () => {
	$('algorithm').blur();
	void configure({ fm: { algorithm: $('algorithm').value } }, { routeChanged: true }).catch(
		report,
	);
});
for (const [id, key] of [
	['fmDepth', 'depth'],
	['fmRatio', 'ratio'],
])
	$(id).addEventListener('change', () => {
		$(id).blur();
		void configure({ fm: { [key]: Number($(id).value) } }).catch(report);
	});
$('pitch').addEventListener('change', () => {
	$('pitch').blur();
	void configure({ transpose: Number($('pitch').value) }).catch(report);
});
$('operatorRatio').addEventListener('change', () => {
	$('operatorRatio').blur();
	const value = Number($('operatorRatio').value),
		selected = selectedOperator;
	void enqueue(async () => {
		const { state } = await readAuthoring();
		const ratios = [...state.config.fm.ratios];
		ratios[selected] = value;
		await command('setConfig', [{ fm: { ratios } }]);
		await refresh({ dirty: true });
	}).catch(report);
});
for (const button of operatorButtons)
	button.addEventListener('click', () => {
		selectedOperator = Number(button.dataset.operator);
		$('voice').querySelector(`[data-scsp-slot="${selectedOperator}"]`).click();
		if (latestState) renderState();
		button.blur();
	});
for (const [id, key] of [
	['effectEnabled', 'enabled'],
	['delayTime', 'timeMs'],
	['delayFeedback', 'feedback'],
	['effectSend', 'send'],
	['effectReturn', 'returnLevel'],
]) {
	$(id).addEventListener('change', () => {
		const value = key === 'enabled' ? $(id).checked : Number($(id).value);
		$(id).blur();
		void enqueue(async () => {
			await command('setEffect', [{ [key]: value }]);
			await refresh({ dirty: true });
			status('Experimental DSP Delay updated.');
		}).catch(report);
	});
}
for (const button of document.querySelectorAll('[data-visual-mode]'))
	button.addEventListener('click', () => {
		visualizer.setMode(button.dataset.visualMode);
		for (const peer of document.querySelectorAll('[data-visual-mode]'))
			peer.setAttribute('aria-pressed', String(peer === button));
		button.blur();
	});
const monitorResize = new ResizeObserver(() => {
	const canvas = $('outputCanvas');
	if (!canvas.clientWidth || !canvas.clientHeight) return;
	canvas.width = Math.max(240, Math.round(canvas.clientWidth));
	canvas.height = Math.max(150, Math.round(canvas.clientHeight));
	visualizer.setMode(
		document.querySelector('[data-visual-mode][aria-pressed="true"]').dataset.visualMode,
	);
});
monitorResize.observe($('outputCanvas'));
function chipTab(dsp) {
	$('scspChipPanel').hidden = dsp;
	$('scspDspPanel').hidden = !dsp;
	for (const [id, selected] of [
		['scspChipTab', !dsp],
		['scspDspTab', dsp],
	]) {
		$(id).setAttribute('aria-selected', String(selected));
		$(id).tabIndex = selected ? 0 : -1;
	}
	panel.setVisible(!dsp);
}
for (const [id, dsp] of [
	['scspChipTab', false],
	['scspDspTab', true],
])
	$(id).addEventListener('click', () => {
		$(id).blur();
		chipTab(dsp);
	});
setupSynthMenu({ document, window });
$('loadPreset').addEventListener('click', () => $('open').click());
$('open').addEventListener('change', async () => {
	const file = $('open').files?.[0];
	$('open').value = '';
	if (!file) return;
	try {
		if (file.size > 8 * 1024 * 1024) throw new Error('Preset must be at most 8 MiB');
		await applySettings(JSON.parse(await file.text()));
	} catch (error) {
		report(error);
	}
});
$('save').addEventListener('click', async () => {
	try {
		await refresh();
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(cachedPatch, null, 2) + '\n'], { type: 'application/json' }),
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'scsp-voice.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		status('Preset saved · applied PCM, operators, routing and DSP settings.');
	} catch (error) {
		report(error);
	}
});
codeHost = setupScspCodeHost({
	ensureAudio,
	getAudio: () => audio,
	getSettings: () => clone(cachedPatch),
	applySettings,
	stopKeyboard,
	onBeforeRun: async () => {
		await songControls?.stop();
		await songControls?.whenIdle();
	},
	stopSong: async () => {
		await songControls?.stop();
		await songControls?.whenIdle();
	},
	onOpenSource: (file, options) =>
		isScspSongPath(options.path) ? songControls.selectFile(file, options) : false,
	onActivity: syncActivity,
	setStatus: status,
});
songControls = setupScspSongControls({
	project: codeHost.project,
	ensureAudio,
	getAudio: () => audio,
	stopCode: async () => {
		await codeHost.stop();
		await stopKeyboard();
	},
	onState(state) {
		songState = state;
		syncActivity();
	},
	setStatus: status,
});
void codeHost.ready.then(() => songControls.refresh()).catch(report);
$('loadVgm').addEventListener('click', () => $('vgmFileInput').click());
$('vgmFileInput').addEventListener('change', async () => {
	const files = [...$('vgmFileInput').files];
	$('vgmFileInput').value = '';
	if (!files.length) return;
	try {
		await codeHost.ready;
		const paths = await codeHost.files.importFiles(files);
		const path = paths.find((value) => /\/vgm\/.*\.(?:vgm|vgz)$/i.test(value));
		if (path) await songControls.selectFile(codeHost.project.fs.get(path), { path });
	} catch (error) {
		report(error);
	}
});
for (const [buttonId, inputId] of [
	['loadSsf', 'ssfFileInput'],
	['loadSsfFolder', 'ssfFolderInput'],
]) {
	$(buttonId).addEventListener('click', () => $(inputId).click());
	$(inputId).addEventListener('change', async () => {
		const files = [...$(inputId).files];
		$(inputId).value = '';
		if (!files.length) return;
		try {
			await codeHost.ready;
			const paths = await codeHost.files.importFiles(files, { ssfOnly: true });
			const entryPath = paths.find((path) => /\.(?:ssf|minissf)$/i.test(path));
			if (entryPath) await songControls.selectFile(entryPath);
			else status(paths.length ? 'SSF libraries imported.' : 'No SSF files in this folder.');
		} catch (error) {
			report(error);
		}
	});
}
window.addEventListener('pagehide', (event) => {
	if (event.persisted) {
		void stopKeyboard();
		return;
	}
	disposed = true;
	epoch++;
	held.clear();
	observer.dispose();
	monitorResize.disconnect();
	visualizer.dispose();
	panel.dispose();
	numberControls.dispose();
	songControls.dispose();
	const previous = audio;
	audio = null;
	void codeHost.dispose().finally(() => previous?.dispose());
	draft.dispose();
});
const localDesktop =
	(location.protocol === 'tauri:' && location.hostname === 'localhost') ||
	(['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
	Object.defineProperty(window, 'tetoricaSynthAudio', {
		value: Object.freeze({
			setSwitching(value) {
				switchingAudioOutput = value === true;
				syncActivity();
			},
			async ensureReady() {
				const engine = await ensureAudio();
				return { context: engine.context, output: engine.outputNode };
			},
			async stopPlayback() {
				await stopAll();
				setBend(0);
			},
		}),
	});
	window.dispatchEvent(new Event('tetorica-synth-ready'));
}
renderKeyboard();
setVolume();
void refresh().catch(report);
