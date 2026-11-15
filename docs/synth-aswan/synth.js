// SPDX-License-Identifier: BSD-3-Clause
import { createAudio } from './audio.js';
import {
	createDefaultPreset,
	readPreset,
	presetToCode,
	encodePcmData,
	MAX_PCM_BYTES,
} from './preset.js';
import { createEditor } from './editor.js';
import { setupAswanCodeHost } from './code_host.js';
import { setupAswanVgmImport } from './vgm_library.js';
import { createAswanSongPlayer } from './song_player.js';
import { aswanSongLiveView } from './song_live.js';
import { setupSynthMenu } from '../synth/synth_menu.js';
import { createSpuOutputVisualizer } from '../synth-spu/spu_synth_visualizer.js';
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
import { SOUNDCHIP_MIXER_PRESETS } from '../js/soundchip_mixer_presets.js';

const $ = (id) => document.getElementById(id);
const status = (message, error = false) => {
	$('audioStatus').textContent = message;
	$('audioStatus').dataset.error = String(error);
};
const report = (error) => {
	if (error?.name !== 'AbortError') status(error?.message ?? String(error), true);
};
let audio = null,
	opening = null,
	disposed = false,
	preset = createDefaultPreset(),
	target = null,
	octave = 0,
	pitch = 0;
let serial = 0,
	editRevision = 0,
	mixRevision = 0,
	pendingEdits = 0,
	queue = Promise.resolve(),
	observed = null,
	displayed = null,
	displaySignature = '',
	polling = false;
let codeHost = null,
	songPlayer = null,
	songState = { playing: false, paused: false },
	selectedSongPath = '',
	loadedSongKey = '';
const physical = Array.from({ length: 4 }, () => readPreset(preset)),
	notes = new Map(),
	channelEnabled = Array(4).fill(true);
let chipVolume =
	SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(
		(item) => item.name === 'wonderswan',
	)?.volume ?? 1;
const visualizer = createSpuOutputVisualizer({
	canvas: $('outputCanvas'),
	envelopeCanvas: $('envelopeCanvas'),
});
let visualMode = 'envelope';
const monitorResize = new ResizeObserver(() => {
	const width = Math.max(
		100,
		Math.round($('outputCanvas').parentElement.getBoundingClientRect().width),
	);
	for (const id of ['outputCanvas', 'envelopeCanvas'])
		if ($(id).width !== width) $(id).width = width;
	visualizer.setMode(visualMode);
});
monitorResize.observe($('outputCanvas').parentElement);
const enqueue = (action) => {
	const task = queue.then(action);
	queue = task.catch(report);
	return task;
};
const songActive = () => Boolean(songState.playing || songState.paused);
const liveSong = () => target !== null && songActive() && songState.liveState;
const currentSound = () => displayed ?? (target === null ? preset : physical[target]);

function syncActivity() {
	if (disposed) return;
	visualizer.setRunning(
		notes.size > 0 || Boolean(codeHost?.isRunning()) || Boolean(songState.playing),
	);
	for (const key of $('keyboard').querySelectorAll('.key'))
		key.classList.toggle(
			'is-active',
			[...notes.values()].some((note) => note.key === key.dataset.key),
		);
}
async function ensureAudio() {
	if (audio && audio.context.state !== 'closed') {
		await audio.resume();
		return audio;
	}
	if (opening) return opening;
	opening = (async () => {
		const instance = await createAudio({
			volume: Number($('masterVolume').value),
			onError: report,
		});
		if (disposed) {
			await instance.dispose();
			throw new DOMException('ASWAN closed', 'AbortError');
		}
		try {
			let synchronized = false;
			while (!synchronized) {
				if (disposed) throw new DOMException('ASWAN closed', 'AbortError');
				const edit = editRevision,
					mix = mixRevision;
				instance.setChipVolume(chipVolume);
				await instance.command('setPreset', [preset]);
				for (let ch = 0; ch < 4; ch++) {
					if (JSON.stringify(physical[ch]) !== JSON.stringify(preset))
						await instance.command('setPreset', [physical[ch], ch]);
					await instance.setChannelEnabled(ch, channelEnabled[ch]);
				}
				synchronized = edit === editRevision && mix === mixRevision;
			}
			if (disposed) throw new DOMException('ASWAN closed', 'AbortError');
			instance.setVolume(Number($('masterVolume').value));
			audio = instance;
			visualizer.connect(instance.context, instance.outputNode);
			$('startAudio').textContent = 'Audio ready';
			status('Audio ready · play keys or Run Code.');
			return instance;
		} catch (error) {
			await instance.dispose();
			throw error;
		}
	})().finally(() => {
		opening = null;
	});
	return opening;
}
function display(force = false) {
	if (!force && pendingEdits) return;
	const song = liveSong();
	let sound = target === null ? preset : physical[target],
		readOnly = false,
		caption;
	let capture = false;
	if (song) {
		try {
			const view = aswanSongLiveView(song, target);
			sound = view.preset;
			readOnly = true;
			caption = view.readout;
			capture = view.canCapture;
		} catch (error) {
			caption = error.message;
			readOnly = true;
		}
	} else if (target !== null && $('aswanLiveEnabled').checked && observed?.channels?.[target]) {
		const channel = observed.channels[target];
		sound = codeHost?.isRunning() ? (channel.preset ?? sound) : sound;
		caption = `CH${target + 1} · ${channel.active ? 'Gate On' : 'Gate Off'} · ${(channel.frequency ?? channel.frequencyHz ?? 0).toFixed(1)} Hz · ${codeHost?.isRunning() ? 'Code + keyboard' : 'physical voice'}`;
	}
	displayed = readPreset(sound);
	const signature = JSON.stringify([displayed, target, readOnly]);
	if (force || signature !== displaySignature) {
		displaySignature = signature;
		editor.setPreset(displayed, { readOnly, channel: target });
		if (document.activeElement !== $('instrumentName'))
			$('instrumentName').value = displayed.name;
	}
	$('instrumentName').disabled = readOnly;
	$('voiceCapacity').textContent =
		sound.source === 'noise'
			? 'Noise · CH4 · one voice'
			: sound.source === 'pcm'
				? 'Voice PCM · CH2 · software supply'
				: sound.sweep.enabled
					? 'Hardware Sweep · CH3 · one voice'
					: target === null
						? 'Wave · four voices · round robin'
						: `Wave · CH${target + 1}`;
	$('aswanChannelStatus').textContent =
		caption ??
		(target === null
			? 'Auto · common instrument · edits apply to the automatic voice pool.'
			: `CH${target + 1} · display, parameters and keyboard use this physical voice.`);
	$('aswanChannelControls').dataset.origin = song
		? 'vgm'
		: codeHost?.isRunning()
			? 'code'
			: 'synth';
	$('aswanCaptureButton').disabled = !capture;
	const unknownPcm =
		target !== null && sound.source === 'pcm' && physical[target].source !== 'pcm';
	$('aswanSaveSelectedPreset').disabled =
		(Boolean(song) && !capture) || (Boolean(codeHost?.isRunning()) && unknownPcm);
	$('aswanSaveSelectedPreset').title = $('aswanSaveSelectedPreset').disabled
		? 'A running DAC value is not a complete PCM sample. Use Sounds from VGM to extract recorded PCM.'
		: '';
	for (const tab of $('aswanChannelTabs').querySelectorAll('button')) {
		const active = tab.dataset.channel === (target === null ? 'auto' : String(target));
		tab.setAttribute('aria-selected', String(active));
		tab.tabIndex = active ? 0 : -1;
		if (active) $('voiceEditor').setAttribute('aria-labelledby', tab.id);
	}
}
async function applyPreset(value, { channel = target, isCurrent = () => true } = {}) {
	const next = readPreset(value),
		revision = ++editRevision;
	if (!isCurrent()) return false;
	if (liveSong() && channel !== null)
		throw new Error('VGM Live is read-only. Copy to Auto to edit this sound.');
	// Validate routing even before audio exists, and publish only acknowledged edits.
	if (
		channel !== null &&
		((next.source === 'noise' && channel !== 3) ||
			(next.source === 'pcm' && channel !== 1) ||
			(next.sweep.enabled && channel !== 2))
	)
		throw new Error(
			'Noise uses CH4, Voice PCM uses CH2 and hardware Sweep uses CH3. Choose Auto or that channel.',
		);
	await enqueue(async () => {
		if (disposed || !isCurrent()) return;
		if (audio) await audio.command('setPreset', [next, channel]);
		if (!isCurrent()) return;
		if (channel === null) {
			preset = next;
			const pool =
				next.source === 'noise'
					? [3]
					: next.source === 'pcm'
						? [1]
						: next.sweep.enabled
							? [2]
							: [0, 1, 2, 3];
			for (const ch of pool) physical[ch] = readPreset(next);
		} else physical[channel] = next;
		observed = null;
		if (revision === editRevision) display(true);
		codeHost?.markSoundDirty();
		visualizer.wake();
	});
	return isCurrent();
}
async function loadPcm(file) {
	if (file.size > 16 * 1024 * 1024) throw new Error('Audio files must be at most 16 MiB.');
	const revision = editRevision,
		channel = target;
	const Context = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
	if (!Context) throw new Error('This browser has no offline audio decoder.');
	const decoder = new Context(1, 1, 24000),
		decoded = await decoder.decodeAudioData(await file.arrayBuffer());
	const length = Math.round(decoded.duration * 24000);
	if (!length || length > MAX_PCM_BYTES)
		throw new Error(
			'Decoded PCM must contain 1–2,097,152 samples at 24 kHz. Use a shorter file.',
		);
	if (disposed || revision !== editRevision || channel !== target) return;
	const data = new Uint8Array(length),
		channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
			decoded.getChannelData(i),
		);
	for (let i = 0; i < length; i++) {
		const pos = (i * decoded.sampleRate) / 24000,
			index = Math.min(decoded.length - 1, Math.floor(pos)),
			next = Math.min(decoded.length - 1, index + 1),
			fraction = pos - index;
		let value = 0;
		for (const samples of channels)
			value += samples[index] + (samples[next] - samples[index]) * fraction;
		data[i] = Math.max(0, Math.min(255, Math.round(128 + (value / channels.length) * 127)));
	}
	const next = readPreset(currentSound());
	next.source = 'pcm';
	next.sweep.enabled = false;
	next.name = file.name.slice(0, 80);
	next.pcm = { ...next.pcm, data: encodePcmData(data), sampleRate: 24000 };
	await applyPreset(next, { channel });
	status(`Loaded ${file.name} · 8-bit PCM · software resampling to 24 kHz. Play keys.`);
}
async function editVisiblePreset(value, beforeValue = currentSound()) {
	const next = readPreset(value),
		before = readPreset(beforeValue),
		channel = target;
	if (!audio) return applyPreset(next, { channel });
	if (liveSong()) throw new Error('Copy the VGM sound to Auto before editing.');
	const revision = ++editRevision;
	pendingEdits++;
	try {
		await enqueue(async () => {
			const state = await audio.command('editPreset', [before, next, channel]);
			observed = state;
			preset = readPreset(state.preset);
			for (let ch = 0; ch < 4; ch++)
				physical[ch] = readPreset(state.channels[ch].authoredPreset);
			if (revision === editRevision) display(true);
			codeHost?.markSoundDirty();
			visualizer.wake();
		});
	} finally {
		pendingEdits--;
	}
}
const editor = createEditor({
	root: $('voiceEditor'),
	onChange: (value, before) =>
		editVisiblePreset(value, before).catch((error) => {
			display(true);
			report(error);
		}),
	onError: report,
	onLoadAudio: loadPcm,
});

async function stopKeyboard() {
	const held = [...notes.values()];
	notes.clear();
	syncActivity();
	if (audio) await Promise.allSettled(held.map((note) => audio.command('noteOff', [note.id])));
}
function selectChannel(value) {
	void stopKeyboard().catch(report);
	target = value === 'auto' ? null : Number(value);
	displaySignature = '';
	display(true);
}
const tabs = [...$('aswanChannelTabs').querySelectorAll('button')];
for (const [index, tab] of tabs.entries()) {
	tab.addEventListener('pointerdown', (event) => {
		if (event.button === 0) event.preventDefault();
	});
	tab.addEventListener('click', () => {
		tab.blur();
		selectChannel(tab.dataset.channel);
	});
	tab.addEventListener('keydown', (event) => {
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? tabs.length - 1
					: event.key === 'ArrowRight'
						? (index + 1) % tabs.length
						: event.key === 'ArrowLeft'
							? (index + tabs.length - 1) % tabs.length
							: null;
		if (next === null) return;
		event.preventDefault();
		selectChannel(tabs[next].dataset.channel);
		tabs[next].focus();
	});
}
$('aswanLiveEnabled').addEventListener('change', () => {
	$('aswanLiveEnabled').blur();
	songPlayer.setLiveEnabled($('aswanLiveEnabled').checked);
	display(true);
});

// The common keyboard component keeps the same computer-key mapping as the
// existing Synths, in both Keyboard and Code view.
const fret = createFretboardState(),
	keyboard = document.createElement('div');
keyboard.className = 'keyboard';
$('keyboard').append(keyboard);
const tools = Object.fromEntries(
	['instrument', 'position', 'fret', 'strings', 'window'].map((name) => {
		const element = document.createElement('div');
		element.className = `fretboard-${name} toolbar-group`;
		return [name, element];
	}),
);
const toolbar = document.createElement('div');
toolbar.className = 'fretboard-toolbar';
const summary = document.createElement('div');
summary.className = 'fretboard-row fretboard-summary';
summary.append(tools.fret, tools.strings);
const choices = document.createElement('div');
choices.className = 'fretboard-row';
choices.append(tools.instrument, tools.position, tools.window);
toolbar.append(summary, choices);
$('keyboardFretboard').append(toolbar);
let layout;
function renderKeyboard() {
	layout = createFretboardLayout({ state: fret, octave });
	renderFretboardControls({
		instrumentRoot: tools.instrument,
		positionRoot: tools.position,
		fretDisplayRoot: tools.fret,
		stringDisplayRoot: tools.strings,
		stringWindowRoot: tools.window,
		state: fret,
		onInstrumentChange: (value) => {
			void stopKeyboard();
			setInstrument(fret, value);
			renderKeyboard();
		},
		onPositionPresetSelect: (value) => {
			void stopKeyboard();
			setFretPosition(fret, value);
			renderKeyboard();
		},
		onStringWindowChange: (value) => {
			void stopKeyboard();
			setStringWindowIndex(fret, value);
			renderKeyboard();
		},
	});
	buildKeyboard({
		root: keyboard,
		rowDefs: layout.rowDefs,
		layoutEntries: layout.entries,
		showPitch: false,
		onPointerDown(event, entry) {
			if (event.button === 0) press(`pointer:${event.pointerId}`, entry);
		},
		onPointerUp: (event) => release(`pointer:${event.pointerId}`),
		onPointerCancel: (event) => release(`pointer:${event.pointerId}`),
	});
	$('octaveValue').textContent = `${octave >= 0 ? '+' : ''}${octave}`;
	$('octaveDown').disabled = octave <= -2;
	$('octaveUp').disabled = octave >= 2;
}
function press(source, entry) {
	if (disposed || notes.has(source) || codeHost?.getState()?.busy) return;
	if (liveSong()) {
		status('VGM Live shows the recorded channel. Copy to Auto to play this sound.');
		return;
	}
	const note = { id: `aswan-key:${++serial}`, key: entry.key, midi: entry.midi, channel: target };
	notes.set(source, note);
	syncActivity();
	void enqueue(async () => {
		const host = await ensureAudio();
		if (notes.get(source) !== note) return;
		await host.command('noteOn', [note.id, note.midi, note.channel]);
		if (notes.get(source) !== note) await host.command('noteOff', [note.id]);
		visualizer.wake();
	}).catch((error) => {
		if (notes.get(source) === note) notes.delete(source);
		syncActivity();
		report(error);
	});
}
function release(source) {
	const note = notes.get(source);
	if (!note) return;
	notes.delete(source);
	syncActivity();
	void enqueue(() => audio?.command('noteOff', [note.id])).catch(report);
}
const inputBlocked = (event) =>
	Boolean(
		event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			event.target?.closest(
				'input,textarea,select,[contenteditable="true"],.monaco-editor,[role="dialog"],.synth-menu-panel',
			),
	);
window.addEventListener('keydown', (event) => {
	if (event.repeat || inputBlocked(event)) return;
	const entry = layout?.entries.find((item) => item.key === event.key.toLowerCase());
	if (entry) {
		event.preventDefault();
		press(`key:${event.code}`, entry);
	}
});
window.addEventListener('keyup', (event) => release(`key:${event.code}`));
window.addEventListener('blur', () => {
	void stopKeyboard();
});
for (const [id, delta] of [
	['octaveDown', -1],
	['octaveUp', 1],
])
	$(id).addEventListener('click', () => {
		$(id).blur();
		void stopKeyboard();
		octave = Math.max(-2, Math.min(2, octave + delta));
		renderKeyboard();
	});
const pitchPairs = [
	[$('pitchBend'), $('pitchValue')],
	[$('keyboardPitchBend'), $('keyboardPitchValue')],
];
function setPitch(value) {
	pitch = value;
	for (const [range, label] of pitchPairs) {
		range.value = String(value);
		label.textContent = value.toFixed(2);
	}
	if (audio) void enqueue(() => audio.command('setPitch', [value])).catch(report);
}
for (const [range] of pitchPairs) {
	range.addEventListener('input', () => setPitch(Number(range.value)));
	for (const type of ['pointerup', 'pointercancel'])
		range.addEventListener(type, () => {
			setPitch(0);
			range.blur();
		});
	range.addEventListener('keyup', (event) => {
		if (event.key === 'Escape' || event.key === 'Home') setPitch(0);
	});
}
$('startAudio').addEventListener('click', () => {
	$('startAudio').blur();
	void enqueue(ensureAudio).catch(report);
});
$('stopAudio').addEventListener('click', () => {
	$('stopAudio').blur();
	notes.clear();
	void (async () => {
		await songPlayer.stop();
		await codeHost.stop();
		await enqueue(() => audio?.command('stop'));
		syncActivity();
		status('All sound stopped.');
	})().catch(report);
});
$('masterVolume').addEventListener('input', () => {
	const value = Number($('masterVolume').value);
	$('masterVolumeValue').textContent = `${Math.round(value * 100)}%`;
	$('masterVolume').dataset.boosted = String(value > 1);
	audio?.setVolume(value);
	visualizer.wake();
});
$('masterVolume').addEventListener('change', () => $('masterVolume').blur());
$('aswanChipVolume').value = String(chipVolume);
$('aswanChipVolumeValue').textContent = `${Math.round(chipVolume * 100)}%`;
$('aswanChipVolume').addEventListener('input', () => {
	mixRevision++;
	chipVolume = Number($('aswanChipVolume').value);
	$('aswanChipVolumeValue').textContent = `${Math.round(chipVolume * 100)}%`;
	audio?.setChipVolume(chipVolume);
	visualizer.wake();
});
$('aswanChipVolume').addEventListener('change', () => $('aswanChipVolume').blur());
for (const button of $('aswanMixerChannels').querySelectorAll('button'))
	button.addEventListener('click', () => {
		mixRevision++;
		const ch = Number(button.dataset.mixChannel);
		channelEnabled[ch] = !channelEnabled[ch];
		button.setAttribute('aria-pressed', String(channelEnabled[ch]));
		button.textContent = `CH${ch + 1} ${channelEnabled[ch] ? 'On' : 'Off'}`;
		if (audio) void audio.setChannelEnabled(ch, channelEnabled[ch]).catch(report);
		songPlayer.setChannelEnabled(ch, channelEnabled[ch]);
		button.blur();
	});
for (const [id, panel] of [
	['aswanChipTab', 'aswanChipPanel'],
	['aswanMixerTab', 'aswanMixerPanel'],
])
	$(id).addEventListener('click', () => {
		for (const [t, p] of [
			['aswanChipTab', 'aswanChipPanel'],
			['aswanMixerTab', 'aswanMixerPanel'],
		]) {
			$(t).setAttribute('aria-selected', String(t === id));
			$(t).tabIndex = t === id ? 0 : -1;
			$(p).hidden = p !== panel;
		}
		$(id).blur();
	});
for (const button of document.querySelectorAll('[data-visual-mode]'))
	button.addEventListener('click', () => {
		const mode = (visualMode = button.dataset.visualMode);
		visualizer.setMode(mode);
		$('envelopeCanvas').hidden = mode !== 'envelope';
		$('outputCanvas').hidden = mode === 'envelope';
		for (const item of document.querySelectorAll('[data-visual-mode]'))
			item.setAttribute('aria-pressed', String(item === button));
		button.blur();
	});
$('outputCanvas').hidden = true;

// Songs and instruments retain their own data. Reference audio uses the same
// AudioContext, calibrated gain, Master and monitor as Keyboard / Code.
const seconds = (value) =>
	`${Math.floor((value ?? 0) / 60)}:${String(Math.floor((value ?? 0) % 60)).padStart(2, '0')}`;
function renderSong(state) {
	songState = state;
	const active = state.playing || state.paused;
	$('aswanSongPlayer').dataset.state = state.playing
		? 'playing'
		: state.paused
			? 'paused'
			: 'stopped';
	const label = state.playing ? 'Pause' : state.paused ? 'Resume' : 'Play';
	if ($('aswanSongPlayButton').textContent !== label)
		$('aswanSongPlayButton').textContent = label;
	$('aswanSongPlayButton').disabled = !selectedSongPath || Boolean(state.busy);
	$('aswanSongStopButton').disabled = !active && !state.busy;
	const seek = $('aswanSongSeek');
	seek.max = String(state.durationSeconds ?? 0);
	seek.disabled = !selectedSongPath || !state.loaded || Boolean(state.busy);
	if (document.activeElement !== seek) seek.value = String(state.positionSeconds ?? 0);
	$('aswanSongPosition').textContent = seconds(state.positionSeconds);
	$('aswanSongSeekPosition').textContent =
		`${seconds(state.positionSeconds)} / ${seconds(state.durationSeconds)}`;
	display();
	syncActivity();
}
songPlayer = createAswanSongPlayer({
	getAudio: ensureAudio,
	beforePlay: async () => {
		await codeHost?.stop();
		await stopKeyboard();
	},
	onState: renderSong,
	onStatus: (message, error) => {
		$('aswanSongStatus').textContent = message;
		$('aswanSongStatus').dataset.error = String(error);
	},
});
async function playSong() {
	if (songState.playing) return songPlayer.pause();
	if (songState.paused) return songPlayer.resume();
	const file = codeHost.project.fs.get(selectedSongPath);
	if (!file) throw new Error('Select a VGM in Files.');
	const key = `${codeHost.files.workspaceId}:${selectedSongPath}:${file.revision}`;
	if (loadedSongKey !== key) {
		await songPlayer.load(file.data, selectedSongPath.split('/').pop());
		loadedSongKey = key;
	}
	return songPlayer.play();
}
$('aswanSongPlayButton').addEventListener('click', () => {
	$('aswanSongPlayButton').blur();
	void playSong().catch(report);
});
$('aswanSongStopButton').addEventListener('click', () => {
	$('aswanSongStopButton').blur();
	songPlayer.stop();
});
$('aswanSongSeek').addEventListener('change', () => {
	const value = Number($('aswanSongSeek').value);
	$('aswanSongSeek').blur();
	void songPlayer.seek(value).catch(report);
});
$('aswanSongSelect').addEventListener('change', () => {
	selectedSongPath = $('aswanSongSelect').value;
	loadedSongKey = '';
	songPlayer.clear();
	$('aswanSongPlayButton').disabled = !selectedSongPath;
	$('aswanSongSelect').blur();
});
codeHost = setupAswanCodeHost({
	ensureAudio: () => enqueue(ensureAudio),
	getAudio: () => audio,
	getSettings: () => readPreset(preset),
	applySettings: (value, options) => {
		if (options?.isCurrent?.() === false) return false;
		selectChannel('auto');
		return applyPreset(value, { ...options, channel: null });
	},
	stopKeyboard,
	stopSong: () => songPlayer.stop(),
	onActivity: syncActivity,
	setStatus: status,
});
const unsubscribeProject = codeHost.project.onDidChange(refreshSongFiles);
function refreshSongFiles() {
	const files = codeHost.project.listEntries().filter((entry) => /\.vg[mz]$/i.test(entry.path));
	const selector = $('aswanSongSelect'),
		previous = selectedSongPath;
	selector.replaceChildren();
	const empty = new Option(files.length ? 'Select a VGM' : 'No VGM files', '');
	selector.append(empty);
	for (const file of files)
		selector.append(new Option(file.path.replace(/^\/vgm\//, ''), file.path));
	selectedSongPath = files.some((file) => file.path === previous)
		? previous
		: (files[0]?.path ?? '');
	selector.value = selectedSongPath;
	const selected = files.find((file) => file.path === selectedSongPath);
	const key = `${codeHost.files.workspaceId}:${selectedSongPath}:${selected?.revision}`;
	if (selectedSongPath !== previous || (loadedSongKey && loadedSongKey !== key)) {
		loadedSongKey = '';
		songPlayer.clear();
	}
	$('aswanSongPlayButton').disabled = !selectedSongPath;
}
const library = setupAswanVgmImport({
	root: $('vgmImport'),
	onSource: (source, options) => codeHost.files.saveSongSource(source, options),
	onSounds: async (sounds, options) => {
		const saved = await codeHost.files.saveVgmSounds(sounds, options);
		renderSounds(sounds.voices);
		return saved;
	},
	onStatus: (message, error) => {
		if (error) status(message, true);
	},
});
function renderSounds(voices) {
	const root = $('vgmLibrary');
	root.replaceChildren();
	root.className = 'aswan-vgm-voices';
	for (const voice of voices.slice(0, 100)) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = voice.preset.name;
		button.addEventListener('click', () => {
			button.blur();
			selectChannel('auto');
			void applyPreset(voice.preset, { channel: null }).catch(report);
		});
		root.append(button);
	}
}
$('aswanCaptureButton').addEventListener('click', () => {
	const sound = readPreset(currentSound());
	selectChannel('auto');
	void applyPreset(sound, { channel: null })
		.then(() => status('Copied the observed sound to Auto. The song position is kept.'))
		.catch(report);
});
$('aswanSaveSelectedPreset').addEventListener('click', () => {
	const sound = readPreset(currentSound());
	$('aswanSaveSelectedPreset').blur();
	void codeHost.files.saveSound({ value: sound }).catch(report);
});
$('aswanSaveSoundAs').addEventListener('click', () => {
	void codeHost.files.saveSound().catch(report);
});
$('instrumentName').addEventListener('change', () => {
	const next = readPreset(currentSound());
	next.name = $('instrumentName').value;
	void applyPreset(next).catch(report);
});
function download(name, text) {
	const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('savePreset').addEventListener('click', () => {
	download('aswan-voice.json', JSON.stringify(readPreset(currentSound()), null, 2) + '\n');
	$('savePreset').blur();
});
$('loadPreset').addEventListener('click', () => {
	$('loadPreset').blur();
	$('presetFileInput').click();
});
$('presetFileInput').addEventListener('change', async () => {
	const file = $('presetFileInput').files?.[0];
	$('presetFileInput').value = '';
	if (!file) return;
	try {
		if (file.size > 4 * 1024 * 1024) throw new Error('Preset must be at most 4 MiB.');
		await applyPreset(readPreset(JSON.parse(await file.text())));
		status('Preset loaded.');
	} catch (error) {
		report(error);
	}
});
$('resetPreset').addEventListener('click', () => {
	$('resetPreset').blur();
	void applyPreset(createDefaultPreset()).catch(report);
});
$('copyCode').addEventListener('click', async () => {
	try {
		const code = presetToCode(currentSound());
		$('codeOutput').value = code;
		$('codeOutput').hidden = false;
		try {
			await navigator.clipboard.writeText(code);
			status('JavaScript copied.');
		} catch {
			status('JavaScript ready below.');
		}
	} catch (error) {
		report(error);
	}
	$('copyCode').blur();
});
setupSynthMenu({ document, window });

const poll = setInterval(async () => {
	if (
		disposed ||
		document.hidden ||
		polling ||
		!audio ||
		target === null ||
		!$('aswanLiveEnabled').checked ||
		songActive()
	)
		return;
	polling = true;
	const owner = audio;
	try {
		const state = await owner.read();
		if (!disposed && audio === owner) {
			observed = state;
			display();
		}
	} catch (error) {
		report(error);
	} finally {
		polling = false;
	}
}, 125);
window.addEventListener('pagehide', (event) => {
	void stopKeyboard();
	void songPlayer.stop();
	void codeHost.stop();
	if (event.persisted) return;
	disposed = true;
	clearInterval(poll);
	unsubscribeProject();
	monitorResize.disconnect();
	library.dispose();
	editor.dispose();
	visualizer.dispose();
	const owner = audio;
	audio = null;
	void Promise.allSettled([songPlayer.dispose(), codeHost.dispose()])
		.finally(() => owner?.dispose())
		.catch(() => {});
});
renderKeyboard();
display(true);
refreshSongFiles();
void codeHost.ready
	.then(() => {
		refreshSongFiles();
		display(true);
	})
	.catch(report);
