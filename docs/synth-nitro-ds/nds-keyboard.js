// SPDX-License-Identifier: BSD-3-Clause
import { buildKeyboard, createFretboardLayout, createFretboardState } from '../synth/synth_keyboard.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import { NDS_AUDIO_CLOCK } from './nds-core.js?v=nds-sound-capture-1';
import { ndsTimerForFrequency, NDS_SOFTWARE_WAVE_FRAMES } from './nds-synth-api.js?v=nds-timer-1';
import { editNdsSound, isNdsSampleMode, ndsSoundPatch, restoreNdsSound, setupNdsSampleEditor, snapshotNdsSound } from './nds-sample-editor.js?v=nds-channel-view-1';

const CHANNELS = Array.from({ length: 16 }, (_, channel) => channel);
const AUTO = -1;
const NOISE_CLOCK_AT_C4 = 4000;
const C4_HZ = noteToHz('C4');
const LIVE_FIELDS = ['volume', 'pan', 'divider', 'duty'];
const CHANNEL_VIEW_FIELDS = ['mode', 'shape', 'volume', 'pan', 'divider', 'duty', 'loop', 'timer',
	'byteLength', 'sampleRate', 'loopStartWords', 'lengthWords', 'repeatMode', 'sourceAddress'];
const defaultSound = () => ({ name: '', mode: 'pcm16', shape: 'sine', volume: 96, pan: 64, divider: 0, duty: 3, loop: true, sample: null });
const supports = (channel, mode) => isNdsSampleMode(mode) || (mode === 'pulse' ? channel >= 8 && channel < 14 : channel >= 14);
const timerSteps = mode => mode === 'pulse' ? 8 : 1;
const timerHz = (mode, timer) => NDS_AUDIO_CLOCK / (65536 - timer) / timerSteps(mode);
const timerHex = timer => `0x${timer.toString(16).toUpperCase().padStart(4, '0')}`;
const rateFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
// The timer can cover sixteen octaves of rates. Give each octave equal slider space.
const sliderToTimer = value => 65536 - Math.round(2 ** (16 - value / 100));
const timerToSlider = timer => Math.round((16 - Math.log2(65536 - timer)) * 100);
const noiseTimerForKey = midi => ndsTimerForFrequency(NOISE_CLOCK_AT_C4 * noteToHz(midi) / C4_HZ, 1).timer;

function defaultTimer(sound) {
	const hz = sound.mode === 'pulse' ? 440 : sound.mode === 'noise' ? NOISE_CLOCK_AT_C4
		: sound.sample?.asset.sampleRate ?? C4_HZ * NDS_SOFTWARE_WAVE_FRAMES;
	return ndsTimerForFrequency(hz, timerSteps(sound.mode)).timer;
}

export function setupNdsKeyboard({ ensureAudio, ensureAuditionAudio, onActivity, onError }) {
	const node = (id) => document.getElementById(id);
	const keyboard = node('keyboard'), activity = node('ndsNoteStatus');
	const keyTracking = node('ndsKeyTracking'), rateInput = node('ndsTimerHz'), rateSlider = node('ndsTimerSlider');
	const rateLabel = node('ndsTimerRateLabel'), rateValue = node('ndsTimerValue');
	const generatedSource = node('ndsGeneratedSource');
	const dividerButtons = [...node('ndsDivider').querySelectorAll('[data-divider]')];
	const fields = Object.fromEntries(['mode', 'shape', 'volume', 'pan', 'duty', 'loop'].map(name =>
		[name, node(`nds${name[0].toUpperCase()}${name.slice(1)}`)]));
	const settings = Array.from({ length: 17 }, defaultSound);
	const held = new Map(), occupied = new Map(), auditionOccupied = new Map();
	const fret = createFretboardState();
	let selection = AUTO, octave = 0, next = 0, entries = new Map(), lastNote = '', audition = null, channelView = null;
	const getSound = () => settings[selection + 1];
	const getDisplayedSound = () => channelView ? channelView.state ?? {} : getSound();
	const canEditChannel = () => channelView?.kind === 'code' && channelView.state != null && Boolean(channelView.onEdit);
	const sampleEditor = setupNdsSampleEditor({ getSound, updateSound, getTarget: () => selection, onRangeCommit: applySampleRange, onError });
	const sampleActions = node('ndsLoadWav').closest('.sample-actions');
	const rangeControls = [fields.volume, fields.pan, fields.duty, rateSlider];
	const draggedControls = new Set();
	for (const control of rangeControls) {
		control.addEventListener('pointerdown', event => {
			if (event.button === 0 && !control.disabled) draggedControls.add(control);
		});
	}
	for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => {
		if (!draggedControls.size) return;
		draggedControls.clear();
		if (channelView) renderSettings();
	});

	function updateSound(sound) {
		settings[selection + 1] = sound;
		renderSettings();
	}

	function applySampleRange(sound) {
		const { asset, range: { loopStartWords, lengthWords } } = sound.sample;
		for (const note of occupied.values()) {
			if (note.target === selection && note.sampleAsset === asset && note.mode === sound.mode &&
				note.sampleLoop === sound.loop && note.token !== null)
				void note.chip.setOwnedSampleRange(note.channel, note.token, { loopStartWords, lengthWords }).catch(onError);
		}
	}

	function setChannelView(view) {
		const targetChanged = channelView?.kind !== view?.kind || channelView?.channel !== view?.channel;
		const changed = targetChanged || channelView?.preset !== view?.preset || channelView?.phase !== view?.phase ||
			Boolean(channelView?.onEdit) !== Boolean(view?.onEdit) ||
			CHANNEL_VIEW_FIELDS.some(key => channelView?.state?.[key] !== view?.state?.[key]);
		channelView = view;
		if (targetChanged) draggedControls.clear();
		if (changed) renderSettings();
	}

	function heldTimerNote(sound) {
		return [...occupied.values()].findLast(note => note.target === selection && note.mode === sound.mode && note.timer !== null);
	}

	function renderTimerStatus() {
		const sound = getDisplayedSound();
		const tracking = !channelView && sound.timer == null;
		const liveTimer = sound.timer ?? (channelView ? undefined : heldTimerNote(sound)?.timer);
		const timer = liveTimer ?? (channelView ? undefined : defaultTimer(sound));
		keyTracking.checked = tracking;
		if (timer === undefined) {
			rateValue.value = '—';
			rateInput.value = '';
			rateSlider.removeAttribute('aria-valuetext');
			return;
		}
		const hz = timerHz(sound.mode, timer), hzText = `${rateFormat.format(hz)} Hz`;
		if (!draggedControls.has(rateSlider) && sliderToTimer(rateSlider.valueAsNumber) !== timer) rateSlider.value = timerToSlider(timer);
		rateSlider.setAttribute('aria-valuetext', hzText);
		if (document.activeElement !== rateInput)
			rateInput.value = Math.max(Number(rateInput.min), Math.min(Number(rateInput.max), Number(hz.toFixed(3))));
		rateValue.value = liveTimer === undefined ? 'Key tracking' : `${hzText} · ${timerHex(timer)}`;
	}

	function renderSettings() {
		const sound = getDisplayedSound();
		const sampleMode = isNdsSampleMode(sound.mode);
		const editable = canEditChannel();
		for (const [key, el] of Object.entries(fields)) {
			el.disabled = Boolean(channelView) && !(editable && LIVE_FIELDS.includes(key));
			if (key === 'loop') el.checked = Boolean(sound.loop);
			else if (!draggedControls.has(el)) el.value = String(sound[key] ?? '');
		}
		for (const option of fields.mode.options) option.disabled = !channelView && selection !== AUTO && !supports(selection, option.value);
		fields.shape.closest('label').hidden = !sampleMode || !sound.shape || Boolean(sound.sample);
		fields.loop.closest('label').hidden = !sampleMode;
		fields.duty.closest('label').hidden = sound.mode !== 'pulse';
		const sourceText = { pulse: 'PSG pulse · 8 steps per cycle · CH9–CH14',
			noise: 'Noise · 15-bit LFSR · CH15–CH16', reserved: 'Reserved source mode' };
		generatedSource.textContent = sourceText[sound.mode] ?? '';
		generatedSource.hidden = !generatedSource.textContent;
		node('ndsVolumeValue').value = sound.volume ?? '—';
		node('ndsPanValue').value = sound.pan ?? '—';
		const duty = sound.duty == null ? '—' : sound.duty === 7 ? 'Low' : `${(sound.duty + 1) * 12.5}%`;
		node('ndsDutyValue').value = duty;
		fields.duty.setAttribute('aria-valuetext', sound.duty === 7 ? 'Constant low' : duty);
		for (const button of dividerButtons) {
			button.disabled = Boolean(channelView) && !editable;
			button.setAttribute('aria-pressed', String(Number(button.dataset.divider) === sound.divider));
		}
		keyTracking.closest('label').hidden = keyTracking.disabled = Boolean(channelView);
		rateInput.disabled = rateSlider.disabled = Boolean(channelView) && !editable;
		rateLabel.textContent = sampleMode ? 'PCM playback rate' : sound.mode === 'pulse' ? 'Pulse frequency' : sound.mode === 'noise' ? 'Noise clock' : 'Channel timer rate';
		rateInput.min = timerHz(sound.mode, 0);
		rateInput.max = timerHz(sound.mode, 65535);
		sampleActions.hidden = Boolean(channelView);
		renderTimerStatus();
		sampleEditor.setChannelView(channelView);
	}

	function renderHeld() {
		const activeKeys = new Set([...held.values()].map(({ entry }) => entry.key));
		for (const button of keyboard.querySelectorAll('.key'))
			button.setAttribute('aria-pressed', String(activeKeys.has(button.dataset.key)));
		activity.textContent = typeof lastNote === 'object'
			? `${lastNote.entry.noteName} · ${lastNote.voices === auditionOccupied ? '2SF ' : ''}CH ${lastNote.channel + 1} · Timer ${timerHex(lastNote.timer)}`
			: lastNote || (selection === AUTO ? 'Auto · choose a sound and play the keyboard.' : `CH ${selection + 1} · play this physical channel.`);
		renderTimerStatus();
		onActivity();
	}

	async function retuneHeldNote(note, timer, patch = {}) {
		const clock = timer ?? (note.mode === 'noise' ? noiseTimerForKey(note.entry.midi) : null);
		const state = clock == null
			? await note.chip.configureOwned(note.channel, note.token, patch, note.entry.midi)
			: await note.chip.configureOwned(note.channel, note.token, { ...patch, timer: clock });
		if (!state || note.voices.get(note.channel) !== note) return;
		note.timer = state.timer;
		renderHeld();
	}

	function setTimer(timer) {
		if (channelView) {
			if (canEditChannel() && timer !== null) void editChannel({ timer }).catch(onError);
			return;
		}
		const sound = getSound();
		if ((sound.timer ?? null) === timer) return;
		settings[selection + 1] = { ...sound, timer };
		renderTimerStatus();
		for (const note of occupied.values()) {
			if (note.target === selection && note.mode === sound.mode && note.token !== null)
				void retuneHeldNote(note, timer).catch(onError);
		}
	}

	function setField(name, value) {
		if (channelView) {
			if (canEditChannel() && LIVE_FIELDS.includes(name)) void editChannel({ [name]: value }).catch(onError);
			return;
		}
		try { updateSound(editNdsSound(getSound(), name, value)); }
		catch (error) { renderSettings(); onError(error); return; }
		if (!LIVE_FIELDS.includes(name)) return;
		for (const note of occupied.values()) {
			if (note.target === selection && note.token !== null)
				void note.chip.configureOwned(note.channel, note.token, { [name]: value }).catch(onError);
		}
	}

	async function editChannel(patch) {
		const { onEdit, state } = channelView;
		if (Object.entries(patch).every(([key, value]) => state[key] === value)) return;
		setChannelView({ ...channelView, state: { ...state, ...patch } });
		await onEdit(patch);
	}

	function allocate(target, mode) {
		if (target !== AUTO) return target;
		const queue = CHANNELS.slice(next).concat(CHANNELS.slice(0, next)).filter(channel => supports(channel, mode));
		const channel = queue.find(channel => !occupied.has(channel)) ?? queue[0];
		next = (channel + 1) % CHANNELS.length;
		return channel;
	}

	async function press(id, entry) {
		if (held.has(id)) return;
		const source = audition;
		if (source && !source.patch) return;
		const target = selection, original = getSound();
		const sound = source ? source.patch : ndsSoundPatch(original);
		const noteSettings = !source && sound.mode === 'noise' && sound.timer == null
			? { ...sound, timer: noiseTimerForKey(entry.midi) } : sound;
		const voices = source ? auditionOccupied : occupied;
		const note = { id, entry, target, mode: sound.mode, sampleAsset: source ? null : original.sample?.asset,
			sampleLoop: sound.loop, channel: null, chip: null, voices, token: null, timer: null };
		let previous;
		held.set(id, note);
		renderHeld();
		try {
			const audio = await (source ? ensureAuditionAudio() : ensureAudio());
			if (held.get(id) !== note) return;
			const chip = audio.chip.forOwner('keyboard');
			const channel = source?.channel ?? allocate(target, sound.mode);
			note.chip = chip;
			previous = voices.get(channel);
			note.channel = channel;
			voices.set(channel, note);
			const { token, timer } = await chip.noteOn(channel, entry.midi, noteSettings);
			note.token = token;
			note.timer = timer;
			if (previous && held.get(previous.id) === previous) held.delete(previous.id);
			if (held.get(id) !== note) {
				await chip.noteOff(channel, token);
				return;
			}
			lastNote = note;
			renderHeld();
			const edited = settings[target + 1];
			if (!source && edited !== original) {
				const patch = {};
				for (const field of LIVE_FIELDS) if (edited[field] !== original[field]) patch[field] = edited[field];
				if (edited.mode === sound.mode && (edited.timer ?? null) !== (sound.timer ?? null))
					void retuneHeldNote(note, edited.timer, patch).catch(onError);
				else if (Object.keys(patch).length)
					void chip.configureOwned(channel, token, patch).catch(onError);
				if (edited.sample && edited.sample.asset === note.sampleAsset && edited.sample.range !== original.sample.range &&
					edited.loop === note.sampleLoop && edited.mode === note.mode) {
					const { loopStartWords, lengthWords } = edited.sample.range;
					void chip.setOwnedSampleRange(channel, token, { loopStartWords, lengthWords }).catch(onError);
				}
			}
		} catch (error) {
			if (voices.get(note.channel) === note && previous && held.get(previous.id) === previous)
				voices.set(note.channel, previous);
			if (held.get(id) === note) release(id);
			onError(error);
		}
	}

	function release(id) {
		const note = held.get(id);
		if (!note) return;
		held.delete(id);
		if (note.voices.get(note.channel) === note) note.voices.delete(note.channel);
		if (note.token !== null) void note.chip.noteOff(note.channel, note.token).catch(onError);
		renderHeld();
	}

	async function stop() {
		if (!held.size) return;
		const chips = new Set([...held.values()].map(note => note.chip).filter(Boolean));
		held.clear();
		occupied.clear();
		auditionOccupied.clear();
		renderHeld();
		await Promise.all([...chips].map(chip => chip.stopOwned()));
	}

	function setAudition(source) {
		if (audition === source) return;
		audition = source;
		lastNote = '';
		for (const note of held.values()) {
			if (note.voices === auditionOccupied) release(note.id);
		}
		renderHeld();
	}

	function renderKeys() {
		const layout = createFretboardLayout({ state: fret, octave });
		entries = new Map(layout.entries.map(entry => [entry.key, entry]));
		buildKeyboard({ root: keyboard, rowDefs: layout.rowDefs, layoutEntries: layout.entries, showPitch: false,
			onPointerDown(event, entry) { if (event.button === 0) return press(`pointer:${event.pointerId}`, entry); },
			onPointerUp: event => release(`pointer:${event.pointerId}`),
			onPointerCancel: event => release(`pointer:${event.pointerId}`),
		});
		for (const key of keyboard.querySelectorAll('.key')) {
			const entry = entries.get(key.dataset.key);
			key.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				if (!event.repeat) void press(`button:${entry.key}`, entry);
			});
			key.addEventListener('keyup', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				release(`button:${entry.key}`);
			});
			key.addEventListener('blur', () => release(`button:${entry.key}`));
		}
		node('octaveValue').value = (octave >= 0 ? '+' : '') + octave;
		node('octaveDown').disabled = octave === -2;
		node('octaveUp').disabled = octave === 2;
		renderHeld();
	}

	function setChannel(channel) {
		if (channel === selection) return;
		sampleEditor.cancelPending();
		selection = channel;
		lastNote = '';
		renderSettings();
		renderHeld();
	}
	keyTracking.addEventListener('change', () => {
		const sound = getSound();
		setTimer(keyTracking.checked ? null : heldTimerNote(sound)?.timer ?? defaultTimer(sound));
	});
	rateSlider.addEventListener('input', () => setTimer(sliderToTimer(rateSlider.valueAsNumber)));
	rateInput.addEventListener('change', () => {
		const hz = rateInput.valueAsNumber;
		if (Number.isFinite(hz) && rateInput.validity.valid)
			setTimer(ndsTimerForFrequency(hz, timerSteps(getDisplayedSound().mode)).timer);
		rateInput.blur();
		renderTimerStatus();
	});
	rateInput.addEventListener('keydown', event => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		rateInput.blur();
	});
	for (const [name, field] of Object.entries(fields)) {
		field.addEventListener(field.type === 'range' ? 'input' : 'change', () => {
			const value = name === 'loop' ? field.checked : ['mode', 'shape'].includes(name) ? field.value : Number(field.value);
			setField(name, value);
		});
	}
	for (const button of dividerButtons)
		button.addEventListener('click', () => setField('divider', Number(button.dataset.divider)));
	for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) node(id).addEventListener('click', () => {
		void stop().catch(onError);
		octave += delta;
		renderKeys();
	});
	// Let arrows and Tab navigate native controls. An actual musical key takes
	// priority over select type-ahead, and pointer commits release select focus.
	let pointerSelect = null;
	document.addEventListener('pointerdown', event => {
		pointerSelect = event.target?.closest?.('select') ?? null;
	}, { capture: true });
	document.addEventListener('change', event => {
		const select = event.target;
		if (select !== pointerSelect) return;
		pointerSelect = null;
		setTimeout(() => { if (document.activeElement === select) select.blur(); }, 0);
	}, { capture: true });
	document.addEventListener('keydown', event => {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
		const select = event.target?.closest?.('select');
		if (select && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Enter', 'Escape', 'Tab'].includes(event.key))
			pointerSelect = null;
		if (event.target?.closest?.('textarea,[contenteditable],dialog[open],.monaco-editor,#synthCodeEditorHost,input:not([type=range]):not([type=checkbox])')) return;
		const entry = entries.get(event.key.toLowerCase());
		if (!entry) return;
		event.preventDefault();
		if (!event.repeat) void press(`key:${event.code || entry.key}`, entry);
	}, { capture: true });
	window.addEventListener('keyup', event => release(`key:${event.code || event.key.toLowerCase()}`));
	window.addEventListener('blur', () => {
		draggedControls.clear();
		void stop().catch(onError);
	});
	document.addEventListener('visibilitychange', () => { if (document.hidden) void stop().catch(onError); });
	renderSettings();
	renderKeys();
	return {
		stop, setChannel, setChannelView, setAudition, isPlaying: () => held.size > 0,
		isAuditionPlaying: () => [...held.values()].some(note => note.voices === auditionOccupied),
		cancelSampleLoad: sampleEditor.cancelPending,
		getPreset: () => snapshotNdsSound(getSound()),
		applyPreset(preset) {
			if (selection !== AUTO && !supports(selection, preset.mode))
				throw new RangeError(`CH ${selection + 1} cannot play this sound. Choose Auto or a compatible channel.`);
			const sound = restoreNdsSound(preset);
			sampleEditor.cancelPending();
			updateSound(sound);
			lastNote = sound.name;
			renderHeld();
		},
	};
}
