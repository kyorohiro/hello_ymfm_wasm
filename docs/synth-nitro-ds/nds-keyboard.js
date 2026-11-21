// SPDX-License-Identifier: BSD-3-Clause
import { buildKeyboard, createFretboardLayout, createFretboardState } from '../synth/synth_keyboard.js';
import { editNdsSound, isNdsSampleMode, ndsSoundPatch, restoreNdsSound, setupNdsSampleEditor, snapshotNdsSound } from './nds-sample-editor.js';

const CHANNELS = Array.from({ length: 16 }, (_, channel) => channel);
const AUTO = -1;
const defaultSound = () => ({ name: '', mode: 'pcm16', shape: 'sine', volume: 96, pan: 64, divider: 0, duty: 3, loop: true, sample: null });
const supports = (channel, mode) => isNdsSampleMode(mode) || (mode === 'pulse' ? channel >= 8 && channel < 14 : channel >= 14);

export function setupNdsKeyboard({ ensureAudio, getAudio, onActivity, onError }) {
	const node = (id) => document.getElementById(id);
	const channelSelect = node('ndsChannel'), keyboard = node('keyboard'), activity = node('ndsNoteStatus');
	const fields = Object.fromEntries(['mode', 'shape', 'volume', 'pan', 'divider', 'duty', 'loop'].map(name =>
		[name, node(`nds${name[0].toUpperCase()}${name.slice(1)}`)]));
	const settings = Array.from({ length: 17 }, defaultSound);
	const held = new Map(), occupied = new Map();
	const fret = createFretboardState();
	let selection = AUTO, octave = 0, next = 0, entries = new Map(), lastNote = '';
	const getSound = () => settings[selection + 1];
	const sampleEditor = setupNdsSampleEditor({ getSound, updateSound, getTarget: () => selection, onError });

	function updateSound(sound) {
		settings[selection + 1] = sound;
		renderSettings();
	}

	function renderSettings() {
		const sound = getSound();
		for (const [key, el] of Object.entries(fields)) {
			if (key === 'loop') el.checked = sound.loop;
			else el.value = String(sound[key]);
		}
		for (const option of fields.mode.options) option.disabled = selection !== AUTO && !supports(selection, option.value);
		fields.shape.disabled = !isNdsSampleMode(sound.mode) || Boolean(sound.sample);
		fields.loop.disabled = !isNdsSampleMode(sound.mode);
		fields.duty.disabled = sound.mode !== 'pulse';
		node('ndsVolumeValue').value = sound.volume;
		node('ndsPanValue').value = sound.pan;
		sampleEditor.render();
	}

	function renderHeld() {
		const activeKeys = new Set([...held.values()].map(({ entry }) => entry.key));
		for (const button of keyboard.querySelectorAll('.key'))
			button.setAttribute('aria-pressed', String(activeKeys.has(button.dataset.key)));
		activity.textContent = lastNote || (selection === AUTO ? 'Auto · choose a sound and play the keyboard.' : `CH ${selection + 1} · play this physical channel.`);
		onActivity();
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
		const target = selection, sound = ndsSoundPatch(getSound());
		const note = { id, entry, target, channel: null, token: null };
		let previous;
		held.set(id, note);
		renderHeld();
		try {
			const chip = (await ensureAudio()).chip.forOwner('keyboard');
			if (held.get(id) !== note) return;
			const channel = allocate(target, sound.mode);
			previous = occupied.get(channel);
			note.channel = channel;
			occupied.set(channel, note);
			const { token, timer } = await chip.noteOn(channel, entry.midi, sound);
			note.token = token;
			if (previous && held.get(previous.id) === previous) held.delete(previous.id);
			if (held.get(id) !== note) {
				await chip.noteOff(channel, token);
				return;
			}
			lastNote = `${entry.noteName} · CH ${channel + 1} · Timer 0x${timer.toString(16).toUpperCase().padStart(4, '0')}`;
			renderHeld();
		} catch (error) {
			if (occupied.get(note.channel) === note && previous && held.get(previous.id) === previous)
				occupied.set(note.channel, previous);
			if (held.get(id) === note) release(id);
			onError(error);
		}
	}

	function release(id) {
		const note = held.get(id);
		if (!note) return;
		held.delete(id);
		if (occupied.get(note.channel) === note) occupied.delete(note.channel);
		if (note.token !== null) {
			const chip = getAudio()?.chip.forOwner('keyboard');
			void chip?.noteOff(note.channel, note.token).catch(onError);
		}
		renderHeld();
	}

	async function stop() {
		if (!held.size) return;
		held.clear();
		occupied.clear();
		renderHeld();
		await getAudio()?.chip.forOwner('keyboard').stopOwned();
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

	channelSelect.append(...CHANNELS.map(channel => new Option(`CH ${channel + 1}`, channel)));
	channelSelect.addEventListener('change', () => {
		sampleEditor.cancelPending();
		selection = channelSelect.value === 'auto' ? AUTO : Number(channelSelect.value);
		lastNote = '';
		channelSelect.blur();
		renderSettings();
		renderHeld();
	});
	for (const [name, field] of Object.entries(fields)) {
		field.addEventListener(field.type === 'range' ? 'input' : 'change', () => {
			const value = name === 'loop' ? field.checked : ['mode', 'shape'].includes(name) ? field.value : Number(field.value);
			if (field.type !== 'range') field.blur();
			try { updateSound(editNdsSound(getSound(), name, value)); }
			catch (error) { renderSettings(); onError(error); return; }
			if (!['volume', 'pan', 'divider', 'duty'].includes(name)) return;
			const chip = getAudio()?.chip.forOwner('keyboard');
			for (const note of occupied.values()) {
				if (note.target === selection && note.token !== null)
					void chip?.configureOwned(note.channel, note.token, { [name]: value }).catch(onError);
			}
		});
	}
	for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) node(id).addEventListener('click', () => {
		void stop().catch(onError);
		octave += delta;
		renderKeys();
	});
	window.addEventListener('keydown', event => {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
		if (event.target?.closest?.('textarea,select,[contenteditable],dialog[open],.monaco-editor,#synthCodeEditorHost,input:not([type=range]):not([type=checkbox])')) return;
		const entry = entries.get(event.key.toLowerCase());
		if (!entry) return;
		event.preventDefault();
		if (!event.repeat) void press(`key:${event.code || entry.key}`, entry);
	});
	window.addEventListener('keyup', event => release(`key:${event.code || event.key.toLowerCase()}`));
	window.addEventListener('blur', () => void stop().catch(onError));
	document.addEventListener('visibilitychange', () => { if (document.hidden) void stop().catch(onError); });
	renderSettings();
	renderKeys();
	return {
		stop, isPlaying: () => held.size > 0, cancelSampleLoad: sampleEditor.cancelPending,
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
