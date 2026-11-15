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
import { createAswanSongAudition } from './song_audition.js';
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
	switchingAudioOutput = false,
	preset = createDefaultPreset(),
	target = null,
	octave = 0,
	authoredPitch = 0;
let serial = 0,
	editRevision = 0,
	mixRevision = 0,
	selectionGeneration = 0,
	pendingEdits = 0,
	queue = Promise.resolve(),
	observed = null,
	displayed = null,
	displaySignature = '',
	polling = false;
let codeHost = null,
	songPlayer = null,
	audition = null,
	pauseScope = '',
	pauseBusy = false,
	manualIdentity = '',
	songState = { playing: false, paused: false },
	selectedSongPath = '',
	loadedSongKey = '';
let highlightCodeEpoch = 0,
	highlightCodeActive = false,
	observedHighlightEpoch = -1;
const highlightPreference = 'tetorica-aswan-synth-live-highlight';
try {
	$('aswanHighlightEnabled').checked = localStorage.getItem(highlightPreference) !== 'off';
} catch {}
const physical = Array.from({ length: 4 }, () => readPreset(preset)),
	notes = new Map(),
	channelEnabled = Array(4).fill(true);
const pausedDrafts = new Map();
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
const songActive = () =>
	Boolean(songState.playing || songState.paused || (songState.busy && songState.liveState));
const liveSong = () => target !== null && songActive() && songState.liveState;
const currentSound = () => displayed ?? (target === null ? preset : physical[target]);

// Only host-only preview fields live here. Hardware edits belong to the
// reference engine's sparse journal; its VGM bytes and Auto preset stay intact.
function syncPausedScope(state) {
	if (state.seeking || state.loading) {
		if (!pauseBusy) selectionGeneration++;
		pauseBusy = true;
		void audition?.setSelection(null).catch(report);
		for (const [key, note] of notes) if (note.owner === 'audition') notes.delete(key);
		return;
	}
	pauseBusy = false;
	const key =
		state.paused && state.editSession != null
			? `${state.editSession}:${state.positionFrames}`
			: '';
	if (pauseScope !== key) {
		selectionGeneration++;
		pauseScope = key;
		pausedDrafts.clear();
		for (const [source, note] of notes) if (note.owner === 'audition') notes.delete(source);
		void audition?.setSelection(null).catch(report);
	}
}
function pausedSelection() {
	if (
		!pauseScope ||
		!songState.paused ||
		songState.busy ||
		target === null ||
		!songState.liveState
	)
		return null;
	const view = aswanSongLiveView(songState.liveState, target);
	if (!view.canAudition) return null;
	const sound = readPreset(view.preset),
		draft = pausedDrafts.get(target);
	sound.envelope = draft?.envelope ?? {
		enabled: true,
		attack: 0.005,
		decay: 0,
		sustain: 1,
		release: 0.03,
	};
	if (draft?.name !== undefined) sound.name = draft.name;
	return {
		key: `${pauseScope}:${target}:${$('aswanReferenceKey').value}`,
		preset: readPreset(sound),
		channel: target,
		frequency: view.frequency,
		referenceNote: Number($('aswanReferenceKey').value),
		clock: songState.liveState.clock,
		view,
	};
}
function playingSelection() {
	if (!songState.playing || songState.busy || target === null || !songState.liveState)
		return null;
	const view = aswanSongLiveView(songState.liveState, target);
	if (!view.canPlayLive) return null;
	const manual = songPlayer?.getManualState();
	if (manual?.session == null) return null;
	return {
		key: `${manual.session}:live:${target}`,
		channel: target,
		preset: view.preset,
		view,
		session: manual.session,
		epoch: manual.epoch,
	};
}
function referenceSelection() {
	return pausedSelection() ?? playingSelection();
}
function syncManualNotes(state) {
	const manual = state.manualState,
		identity = manual?.session == null ? '' : `${manual.session}:${manual.epoch}`;
	if (identity !== manualIdentity) {
		for (const [source, note] of notes) if (note.owner === 'song') notes.delete(source);
		updatePitchUi(
			target !== null && songActive()
				? state.playing
					? (manual?.pitch ?? 0)
					: 0
				: authoredPitch,
		);
		manualIdentity = identity;
	}
	const held = new Set((manual?.voices ?? []).map((voice) => voice.id));
	for (const [source, note] of notes)
		if (note.owner === 'song' && note.started && !held.has(note.id)) notes.delete(source);
}
function syncAudition() {
	const selected = pausedSelection();
	if (audition?.read().source && selected && audition.read().source !== selected.preset.source) {
		for (const [source, note] of notes) if (note.owner === 'audition') notes.delete(source);
	}
	void audition?.setSelection(selected).catch(report);
	return selected;
}

function syncActivity() {
	if (disposed) return;
	const preview = audition?.read();
	$('aswanChannelControls').dataset.auditionState = preview?.state ?? 'idle';
	$('aswanChannelControls').dataset.auditionHeld = String(preview?.heldCount ?? 0);
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
					mix = mixRevision,
					initialPitch = authoredPitch;
				instance.setChipVolume(chipVolume);
				await instance.command('setPreset', [preset]);
				for (let ch = 0; ch < 4; ch++) {
					if (JSON.stringify(physical[ch]) !== JSON.stringify(preset))
						await instance.command('setPreset', [physical[ch], ch]);
					await instance.setChannelEnabled(ch, channelEnabled[ch]);
				}
				await instance.command('setPitch', [initialPitch]);
				synchronized =
					edit === editRevision && mix === mixRevision && initialPitch === authoredPitch;
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
	if (!highlightContext()) editor.highlightLive(null);
	if (!force && pendingEdits) return;
	const song = liveSong();
	let sound = target === null ? preset : physical[target],
		readOnly = false,
		caption;
	let capture = false,
		paused = null,
		playing = null,
		waveKnown = true;
	if (song) {
		try {
			const view = aswanSongLiveView(song, target);
			sound = view.preset;
			readOnly = true;
			caption = view.readout;
			capture = view.canCapture && !songState.busy;
			waveKnown = view.waveKnown;
			paused = pausedSelection();
			playing = playingSelection();
			if (paused) {
				sound = paused.preset;
				readOnly = false;
				caption = `Paused · CH${target + 1} keyboard audition · ${midiToNoteName(paused.referenceNote)} = ${view.frequency.toFixed(1)} Hz · edits retained on this CH`;
			} else if (playing) {
				readOnly = false;
				caption += ' · Playing · hardware edit / keyboard';
			} else if (songState.paused)
				caption += ` · ${view.auditionReason || view.reason || 'Not available for audition'}`;
			else if (songState.playing)
				caption += ` · ${view.liveReason || view.reason || 'Not available for live input'}`;
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
	const signature = JSON.stringify([
		displayed,
		target,
		readOnly,
		Boolean(paused),
		Boolean(playing),
		waveKnown,
	]);
	if (force || signature !== displaySignature) {
		displaySignature = signature;
		editor.setPreset(displayed, {
			readOnly,
			channel: target,
			paused: Boolean(paused),
			playing: Boolean(playing),
			waveKnown,
		});
		if (document.activeElement !== $('instrumentName'))
			$('instrumentName').value = displayed.name;
	}
	$('instrumentName').disabled = readOnly || Boolean(playing);
	$('aswanReferenceControl').hidden = !paused;
	$('aswanChannelControls').dataset.pausedEditable = String(Boolean(paused));
	$('aswanChannelControls').dataset.playingEditable = String(Boolean(playing));
	$('aswanChannelControls').dataset.songFrame = String(songState.liveState?.frame ?? '');
	$('aswanChannelControls').dataset.songPositionFrame = String(songState.positionFrames ?? '');
	$('aswanChannelControls').dataset.songFrequency = String(
		song ? (aswanSongLiveView(song, target).frequency ?? '') : '',
	);
	$('aswanChannelControls').dataset.songGate = String(
		song ? (aswanSongLiveView(song, target).gate ?? '') : '',
	);
	const liveOwner = songState.manualState?.voices?.find((voice) => voice.channel === target);
	$('aswanChannelControls').dataset.songKeyOwner = liveOwner?.id ?? '';
	$('aswanChannelControls').dataset.manualEpoch = String(songState.manualState?.epoch ?? '');
	$('aswanChannelControls').dataset.manualRevision = String(songState.manualRevision ?? 0);
	$('aswanChannelControls').dataset.editSession = String(songState.editSession ?? '');
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
	editor.highlightLive(highlightContext());
	syncAudition();
}
// Observe only the same values already presented by Live. VGM snapshots belong
// to heard history; Code snapshots come from the existing guarded poll.
function highlightContext() {
	if (
		disposed ||
		document.hidden ||
		$('aswanChipPanel').hidden ||
		target === null ||
		!$('aswanLiveEnabled').checked ||
		!$('aswanHighlightEnabled').checked ||
		songState.busy
	)
		return null;
	if (songActive()) {
		if (!songState.playing || !songState.liveState || songState.editSession == null)
			return null;
		const view = aswanSongLiveView(songState.liveState, target);
		return {
			channel: `vgm:${songState.editSession}:${target}`,
			physicalChannel: target,
			snapshot: { preset: displayed, frame: songState.liveState.frame },
			waveKnown: view.waveKnown,
			unknownFields:
				target === 2 &&
				(!songState.liveState.registerKnown?.[12] ||
					!songState.liveState.registerKnown?.[13])
					? [...view.unknownFields, 'sweep']
					: view.unknownFields,
		};
	}
	if (
		!highlightCodeActive ||
		observedHighlightEpoch !== highlightCodeEpoch ||
		!observed?.channels?.[target]
	)
		return null;
	return {
		channel: `code:${highlightCodeEpoch}:${target}`,
		physicalChannel: target,
		snapshot: { preset: displayed },
		waveKnown: true,
		unknownFields: [],
	};
}
function invalidateCodeHighlight() {
	highlightCodeEpoch++;
	observedHighlightEpoch = -1;
	editor.highlightLive(null);
}
function codeActivity() {
	const state = codeHost?.getState(),
		active = Boolean(state?.running && !state.busy && !state.stopping);
	if (active !== highlightCodeActive) {
		highlightCodeActive = active;
		invalidateCodeHighlight();
	}
	if (!active) editor.highlightLive(null);
	syncActivity();
}
async function applyPreset(value, { channel = target, isCurrent = () => true } = {}) {
	const next = readPreset(value),
		revision = ++editRevision;
	if (!isCurrent()) return false;
	if (liveSong() && channel !== null) {
		if (referenceSelection()) return editReferencePreset(next, currentSound());
		throw new Error('Select a complete Wave, Sweep or Noise channel to edit, or Copy to Auto.');
	}
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
	if (liveSong()) return editReferencePreset(next, before);
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
async function editReferencePreset(value, beforeValue) {
	const next = readPreset(value),
		before = readPreset(beforeValue),
		selection = referenceSelection(),
		wasPaused = Boolean(songState.paused);
	if (!selection) throw new Error('Choose a complete Wave, Sweep or Noise channel.');
	if (next.source === 'pcm')
		throw new Error('A transient DAC value cannot become an audition PCM sample.');
	const owner = songPlayer,
		session = owner.getEditSession(),
		key = selection.key,
		channel = selection.channel;
	const generation = selectionGeneration;
	const revision = ++editRevision;
	const current = () =>
		!disposed &&
		generation === selectionGeneration &&
		songPlayer === owner &&
		owner.getEditSession() === session &&
		Boolean(songState.paused) === wasPaused &&
		referenceSelection()?.key === key;
	pendingEdits++;
	try {
		return await enqueue(async () => {
			if (!current()) return false;
			const oldDraft = pausedDrafts.get(channel);
			if (wasPaused)
				pausedDrafts.set(channel, { name: next.name, envelope: { ...next.envelope } });
			try {
				owner.editVoice(channel, before, next, { session });
			} catch (error) {
				if (wasPaused) {
					if (oldDraft) pausedDrafts.set(channel, oldDraft);
					else pausedDrafts.delete(channel);
				}
				throw error;
			}
			if (!current()) return false;
			if (revision === editRevision) display(true);
			if (wasPaused) await audition.updateSelection(pausedSelection());
			visualizer.wake();
			return true;
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
editor.setHighlightEnabled($('aswanHighlightEnabled').checked);
$('aswanHighlightEnabled').addEventListener('change', () => {
	const enabled = $('aswanHighlightEnabled').checked;
	editor.setHighlightEnabled(enabled);
	try {
		localStorage.setItem(highlightPreference, enabled ? 'on' : 'off');
	} catch {}
	$('aswanHighlightEnabled').blur();
	editor.highlightLive(highlightContext());
});

async function stopKeyboard() {
	const held = [...notes.values()];
	notes.clear();
	syncActivity();
	const manual = songPlayer?.getManualState();
	let cleanup;
	try {
		if (manual?.session != null)
			cleanup = songPlayer.releaseKeyboard({ session: manual.session, epoch: manual.epoch });
	} catch (error) {
		cleanup = Promise.reject(error);
	}
	await Promise.allSettled([
		...held
			.filter((note) => note.owner !== 'audition' && note.owner !== 'song')
			.map((note) => audio?.command('noteOff', [note.id])),
		audition?.stop(),
		cleanup,
	]);
}
function selectChannel(value) {
	editor.highlightLive(null);
	selectionGeneration++;
	const wasReference = Boolean(songActive());
	void stopKeyboard().catch(report);
	target = value === 'auto' ? null : Number(value);
	if (wasReference) updatePitchUi(target === null ? authoredPitch : 0);
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
	invalidateCodeHighlight();
	$('aswanLiveEnabled').blur();
	songPlayer.setLiveEnabled($('aswanLiveEnabled').checked);
	display(true);
});
$('aswanReferenceKey').addEventListener('change', () => {
	selectionGeneration++;
	void stopKeyboard().catch(report);
	setPitch(0);
	$('aswanReferenceKey').blur();
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
	if (disposed || switchingAudioOutput || notes.has(source) || codeHost?.getState()?.busy) return;
	if (songState.busy) {
		status('Preparing the reference song…');
		return;
	}
	if (liveSong()) {
		if (songState.playing) {
			const selection = playingSelection();
			if (!selection) {
				const view = aswanSongLiveView(songState.liveState, target);
				status(view.liveReason || view.reason);
				return;
			}
			const owner = songPlayer;
			const note = {
				id: `aswan-song:${++serial}`,
				owner: 'song',
				key: entry.key,
				midi: entry.midi,
				channel: selection.channel,
				session: selection.session,
				epoch: selection.epoch,
				selectionKey: selection.key,
				generation: selectionGeneration,
				started: false,
			};
			const current = () =>
				!disposed &&
				!switchingAudioOutput &&
				notes.get(source) === note &&
				note.generation === selectionGeneration &&
				songPlayer === owner &&
				owner.getManualState().epoch === note.epoch &&
				playingSelection()?.key === note.selectionKey;
			notes.set(source, note);
			syncActivity();
			void enqueue(() => {
				if (!current()) {
					if (notes.get(source) === note) notes.delete(source);
					syncActivity();
					return;
				}
				owner.manualNoteOn(note.id, note.midi, note.channel, {
					session: note.session,
					epoch: note.epoch,
				});
				note.started = true;
				if (!current())
					owner.manualNoteOff(note.id, { session: note.session, epoch: note.epoch });
				syncManualNotes(owner.getState());
				syncActivity();
				visualizer.wake();
			}).catch((error) => {
				if (notes.get(source) === note) notes.delete(source);
				syncActivity();
				report(error);
			});
			return;
		}
		const selection = pausedSelection();
		if (!selection) {
			const view = aswanSongLiveView(songState.liveState, target);
			status(
				songState.paused
					? view.auditionReason || view.reason
					: 'Pause the song to audition the selected CH.',
			);
			return;
		}
		const note = {
			id: `aswan-trial:${++serial}`,
			owner: 'audition',
			key: entry.key,
			midi: entry.midi,
			selectionKey: selection.key,
		};
		notes.set(source, note);
		syncActivity();
		void audition
			.noteOn(note.id, note.midi, {
				isCurrent: () =>
					!disposed &&
					!switchingAudioOutput &&
					notes.get(source) === note &&
					pausedSelection()?.key === note.selectionKey,
			})
			.then((result) => {
				if (!result && notes.get(source) === note) notes.delete(source);
				syncActivity();
				visualizer.wake();
			})
			.catch((error) => {
				if (notes.get(source) === note) notes.delete(source);
				syncActivity();
				report(error);
			});
		return;
	}
	const note = { id: `aswan-key:${++serial}`, key: entry.key, midi: entry.midi, channel: target };
	notes.set(source, note);
	syncActivity();
	void enqueue(async () => {
		const host = await ensureAudio();
		if (switchingAudioOutput || notes.get(source) !== note) {
			if (notes.get(source) === note) notes.delete(source);
			syncActivity();
			return;
		}
		await host.command('noteOn', [note.id, note.midi, note.channel]);
		if (switchingAudioOutput || notes.get(source) !== note)
			await host.command('noteOff', [note.id]);
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
	if (note.owner === 'audition') {
		void audition.noteOff(note.id).catch(report);
		return;
	}
	if (note.owner === 'song') {
		void enqueue(() =>
			songPlayer.manualNoteOff(note.id, { session: note.session, epoch: note.epoch }),
		).catch(report);
		return;
	}
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
function updatePitchUi(value) {
	for (const [range, label] of pitchPairs) {
		range.value = String(value);
		label.textContent = value.toFixed(2);
	}
}
function setPitch(value) {
	updatePitchUi(value);
	if (liveSong() && songState.playing) {
		const selected = playingSelection();
		if (selected) {
			try {
				songPlayer.setManualPitch(value, {
					session: selected.session,
					epoch: selected.epoch,
				});
			} catch (error) {
				report(error);
			}
		}
	} else if (pausedSelection()) void audition.setPitch(value).catch(report);
	else if (liveSong() || songState.busy) return;
	else {
		authoredPitch = value;
		if (audio) void enqueue(() => audio.command('setPitch', [value])).catch(report);
	}
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
		editor.highlightLive(null);
		for (const [t, p] of [
			['aswanChipTab', 'aswanChipPanel'],
			['aswanMixerTab', 'aswanMixerPanel'],
		]) {
			$(t).setAttribute('aria-selected', String(t === id));
			$(t).tabIndex = t === id ? 0 : -1;
			$(p).hidden = p !== panel;
		}
		$(id).blur();
		display();
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
	syncManualNotes(state);
	syncPausedScope(state);
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
		checkPerformanceOutput();
		await codeHost?.stop();
		await stopKeyboard();
		checkPerformanceOutput();
	},
	onState: renderSong,
	onStatus: (message, error) => {
		$('aswanSongStatus').textContent = message;
		$('aswanSongStatus').dataset.error = String(error);
	},
});
audition = createAswanSongAudition({
	ensureAudio,
	getAudio: () => audio,
	onState: syncActivity,
	onError: report,
});
async function playSong() {
	checkPerformanceOutput();
	if (songState.playing) return songPlayer.pause();
	if (songState.paused) {
		const session = songPlayer.getEditSession();
		await queue;
		checkPerformanceOutput();
		if (!songState.paused || songPlayer.getEditSession() !== session) return false;
		await stopKeyboard();
		checkPerformanceOutput();
		return songPlayer.resume();
	}
	const file = codeHost.project.fs.get(selectedSongPath);
	if (!file) throw new Error('Select a VGM in Files.');
	const key = `${codeHost.files.workspaceId}:${selectedSongPath}:${file.revision}`;
	if (loadedSongKey !== key) {
		await songPlayer.load(file.data, selectedSongPath.split('/').pop());
		loadedSongKey = key;
	}
	checkPerformanceOutput();
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
	ensureAudio: () =>
		enqueue(async () => {
			checkPerformanceOutput();
			const host = await ensureAudio();
			checkPerformanceOutput();
			return host;
		}),
	getAudio: () => audio,
	getSettings: () => readPreset(preset),
	applySettings: (value, options) => {
		if (options?.isCurrent?.() === false) return false;
		selectChannel('auto');
		return applyPreset(value, { ...options, channel: null });
	},
	stopKeyboard,
	stopSong: () => songPlayer.stop(),
	beforeRun: () => {
		checkPerformanceOutput();
		invalidateCodeHighlight();
	},
	onActivity: codeActivity,
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
async function selectedSoundAfterEdits() {
	if (songState.busy) throw new DOMException('Reference selection is changing', 'AbortError');
	const selected = referenceSelection(),
		captured = readPreset(currentSound()),
		generation = selectionGeneration,
		wasPaused = Boolean(songState.paused);
	if (!selected) return captured;
	await queue;
	if (
		disposed ||
		generation !== selectionGeneration ||
		Boolean(songState.paused) !== wasPaused ||
		referenceSelection()?.key !== selected.key
	)
		throw new DOMException('Selected channel changed', 'AbortError');
	return readPreset(currentSound());
}
$('aswanCaptureButton').addEventListener('click', () => {
	$('aswanCaptureButton').blur();
	void selectedSoundAfterEdits()
		.then(async (sound) => {
			selectChannel('auto');
			await applyPreset(sound, { channel: null });
			status('Copied the edited sound to Auto. The song position is kept.');
		})
		.catch(report);
});
$('aswanSaveSelectedPreset').addEventListener('click', () => {
	$('aswanSaveSelectedPreset').blur();
	void selectedSoundAfterEdits()
		.then((value) => codeHost.files.saveSound({ value }))
		.catch(report);
});
$('aswanSaveSoundAs').addEventListener('click', () => {
	void codeHost.files.saveSound().catch(report);
});
$('instrumentName').addEventListener('change', () => {
	const before = readPreset(currentSound()),
		next = readPreset(before);
	next.name = $('instrumentName').value;
	void editVisiblePreset(next, before).catch(report);
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
	void selectedSoundAfterEdits()
		.then((sound) => download('aswan-voice.json', JSON.stringify(sound, null, 2) + '\n'))
		.catch(report);
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
		const code = presetToCode(await selectedSoundAfterEdits());
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
	const owner = audio,
		codeEpoch = highlightCodeEpoch,
		selection = selectionGeneration,
		channel = target;
	try {
		const state = await owner.read();
		if (
			!disposed &&
			audio === owner &&
			codeEpoch === highlightCodeEpoch &&
			selection === selectionGeneration &&
			target === channel &&
			$('aswanLiveEnabled').checked &&
			!songActive()
		) {
			observed = state;
			observedHighlightEpoch = highlightCodeActive ? codeEpoch : -1;
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
	void Promise.allSettled([songPlayer.dispose(), codeHost.dispose(), audition.dispose()])
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

// Desktop adapters reroute only the final Master output. The same chip,
// calibrated Mixer, reference player and visualizer remain in the Web Audio graph.
function checkPerformanceOutput() {
	if (disposed) throw new DOMException('ASWAN closed', 'AbortError');
	if (switchingAudioOutput) throw new Error('Wait for the audio output change to finish.');
}
async function stopDesktopPlayback() {
	if (disposed) return false;
	selectionGeneration++;
	authoredPitch = 0;
	updatePitchUi(0);
	await songPlayer.stop();
	await codeHost.stop();
	await stopKeyboard();
	await enqueue(async () => {
		if (!audio) return;
		await audio.command('stop');
		await audio.command('setPitch', [0]);
	});
	updatePitchUi(0);
	syncActivity();
	return true;
}
const localDesktop =
	(location.protocol === 'tauri:' && location.hostname === 'localhost') ||
	(['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (
	window.top === window &&
	localDesktop &&
	typeof window.__TAURI_INTERNALS__?.invoke === 'function'
) {
	Object.defineProperty(window, 'tetoricaSynthAudio', {
		value: Object.freeze({
			setSwitching(value) {
				switchingAudioOutput = value === true;
			},
			async ensureReady() {
				if (disposed) throw new DOMException('ASWAN closed', 'AbortError');
				const host = await ensureAudio();
				return { context: host.context, output: host.outputNode };
			},
			stopPlayback: stopDesktopPlayback,
		}),
	});
	window.dispatchEvent(new Event('tetorica-synth-ready'));
}
