// SPDX-License-Identifier: BSD-3-Clause
import { buzzerMidi, NOTE_OPTIONS } from './buzzer.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import {
	buildKeyboard, createFretboardLayout, createFretboardState, setFretPosition,
} from '../synth/synth_keyboard.js';

const labels = new Map(NOTE_OPTIONS.map(({ value, label }) => [value, label]));
const ATTACK = .002;
const RELEASE = .008;
const PERIOD_FRAMES = 512;
const MAX_OCTAVE = 2;
const MAX_FRET = 12;
const KEYBOARD_HINT = 'Play the pads or their matching keys';
const PERFORMANCE_KEY_EXCLUSIONS = [
	'input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="reset"], [type="submit"])',
	'textarea', 'select', '[contenteditable]', '.monaco-editor', '#synthCodeEditorHost', '.synth-menu-panel',
].join(', ');

/** One software voice with ownership shared by the Code and Keyboard inputs. */
export function createBuzzerVoice({ ensureAudio, getOutput, prepareTone, getChip, onRequestNote, onBeforeNote, onNoteChange }) {
	let active = null, pending = null, disposed = false;
	let waveContext, waveform, silenceAt = 0;
	let retuneRequest = 0;

	function release() {
		if (!active) return;
		const { source, gain, context, start } = active;
		active = null;
		const now = context.currentTime;
		const level = Math.min(1, Math.max(0, (now - start) / ATTACK));
		gain.gain.cancelScheduledValues(now);
		gain.gain.setValueAtTime(level, now);
		silenceAt = level > 0 ? now + RELEASE : now;
		gain.gain.linearRampToValueAtTime(0, silenceAt);
		source.stop(silenceAt);
	}

	function startTone({ midi, frequency, owner, context, master, chip }, tone, previousOutputEnd = 0) {
		if (!tone && context !== waveContext) {
			waveform = context.createBuffer(1, PERIOD_FRAMES, context.sampleRate);
			const samples = waveform.getChannelData(0);
			samples.fill(.2, 0, PERIOD_FRAMES / 2);
			samples.fill(-.2, PERIOD_FRAMES / 2);
			waveContext = context;
			silenceAt = 0;
		}
		release();
		const start = Math.max(context.currentTime, silenceAt, previousOutputEnd) + (tone?.startup ?? 0);
		const source = context.createBufferSource(), gain = context.createGain();
		source.buffer = tone?.buffer ?? waveform;
		source.loop = true;
		source.playbackRate.value = tone ? 1 : frequency * PERIOD_FRAMES / context.sampleRate;
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(1, start + ATTACK);
		source.connect(gain);
		gain.connect(master);
		source.onended = () => { source.disconnect(); gain.disconnect(); };
		source.start(start);
		active = { source, gain, context, master, chip, start, owner, midi, frequency };
		onNoteChange(midi, chip, tone?.toneMode, tone);
	}

	async function noteOn(note, owner) {
		const midi = buzzerMidi(note), frequency = noteToHz(midi);
		if (owner == null) throw new TypeError('A buzzer note needs an owner.');
		if (disposed) return false;
		retuneRequest++;
		const token = { owner, chip: getChip?.() };
		pending = token;
		try {
			onRequestNote?.(token.chip);
			await ensureAudio();
			if (pending !== token || disposed) return false;
			const output = getOutput(token.chip);
			const { context, chip } = output;
			const tone = prepareTone ? await prepareTone(frequency, context, midi, chip) : null;
			if (pending !== token || disposed) return false;
			const previousOutputEnd = onBeforeNote(chip) ?? 0;
			// The host retires the sequencer before this gate takes ownership.
			if (pending !== token || disposed) return false;
			startTone({ ...output, midi, frequency, owner }, tone, previousOutputEnd);
			return true;
		} catch (error) {
			if (pending === token && !disposed) throw error;
			return false;
		} finally {
			if (pending === token) pending = null;
		}
	}

	async function retune(chip) {
		const previous = active;
		const selected = () => !getChip || getChip() === chip;
		if (disposed || pending || !prepareTone || !previous || previous.chip !== chip || !selected()) return false;
		const request = ++retuneRequest;
		const isCurrent = () => request === retuneRequest && active === previous && !pending && !disposed && selected();
		let tone;
		try {
			tone = await prepareTone(previous.frequency, previous.context, previous.midi, previous.chip);
		} catch (error) {
			if (isCurrent()) throw error;
			return false;
		}
		if (!isCurrent()) return false;
		startTone(previous, tone);
		return true;
	}

	function noteOff(owner) {
		if (pending?.owner === owner) pending = null;
		if (!active || active.owner !== owner) return;
		release();
		onNoteChange(null);
	}

	function stopAll() {
		pending = null;
		if (!active) return;
		release();
		onNoteChange(null);
	}

	return {
		noteOn, noteOff, retune, stopAll,
		cancelPending(chip) { if (pending?.chip === chip) pending = null; },
		getNote: () => active?.midi ?? null,
		isIdle: () => !active && !pending,
		dispose() { disposed = true; stopAll(); },
	};
}

export function setupBuzzerPerformance({
	document, ensureAudio, getOutput, prepareTone, canPlayKeyboard, displayNote = note => labels.get(note),
	getChip, onRequestNote, onBeforeNote = () => {}, onNoteChange = () => {}, onError = () => {},
}) {
	const byId = id => document.getElementById(id), window = document.defaultView;
	const keyboard = byId('buzzerKeyboard');
	const status = byId('buzzerKeyboardStatus'), octaveValue = byId('buzzerOctaveValue'), fretValue = byId('buzzerFretValue');
	const octaveDown = byId('buzzerOctaveDown'), octaveUp = byId('buzzerOctaveUp');
	const fretDown = byId('buzzerFretDown'), fretUp = byId('buzzerFretUp');
	const held = new Map(), listeners = new AbortController();
	const fretboard = createFretboardState();
	let octave = 1, entries = new Map();
	const voice = createBuzzerVoice({
		ensureAudio, getOutput, prepareTone, getChip, onRequestNote, onBeforeNote,
		onNoteChange(note, chip, toneMode, tone) {
			status.textContent = note === null ? KEYBOARD_HINT : `Playing ${displayNote(note, chip)}`;
			onNoteChange(note, chip, toneMode, tone);
		},
	});

	const listen = (target, type, action) => target.addEventListener(type, action, { signal: listeners.signal });

	function showHeld() {
		const pressed = new Set([...held.values()].map(({ entry }) => entry.key));
		for (const key of keyboard.querySelectorAll('.key')) {
			const active = pressed.has(key.dataset.key);
			key.classList.toggle('is-held', active);
			key.setAttribute('aria-pressed', String(active));
		}
	}

	async function sound(input) {
		try {
			await voice.noteOn(input.entry.midi, input.owner);
		} catch (error) {
			held.delete(input.id);
			showHeld();
			onError(error);
		}
	}

	function press(id, entry) {
		if (!canPlayKeyboard() || held.has(id) || !labels.has(entry.midi)) return;
		const input = { id, entry, owner: Symbol(id) };
		held.set(id, input);
		showHeld();
		void sound(input);
	}

	function release(id) {
		const input = held.get(id);
		if (!input) return;
		held.delete(id);
		voice.noteOff(input.owner);
		showHeld();
		const previous = [...held.values()].at(-1);
		if (previous && voice.isIdle()) void sound(previous);
	}

	function stopKeyboard() {
		const inputs = [...held.values()];
		held.clear();
		for (const input of inputs) voice.noteOff(input.owner);
		showHeld();
	}

	function stopAll() {
		held.clear();
		voice.stopAll();
		showHeld();
	}

	function refreshLabels() {
		for (const key of keyboard.querySelectorAll('.key')) {
			const entry = entries.get(key.dataset.key);
			const name = labels.has(entry.midi) ? displayNote(entry.midi) : entry.noteName;
			key.querySelector('span').textContent = name;
			key.setAttribute('aria-label', `${entry.label} · ${name}`);
		}
	}

	function drawKeys() {
		const layout = createFretboardLayout({ state: fretboard, octave });
		entries = new Map(layout.entries.map(entry => [entry.key, entry]));
		buildKeyboard({
			root: keyboard, rowDefs: layout.rowDefs, layoutEntries: layout.entries, showPitch: false,
			onPointerDown(event, entry, button) {
				if (event.button !== 0) return;
				button.focus({ preventScroll: true });
				press(`pointer:${event.pointerId}`, entry);
			},
			onPointerUp: event => release(`pointer:${event.pointerId}`),
			onPointerCancel: event => release(`pointer:${event.pointerId}`),
		});
		for (const key of keyboard.querySelectorAll('.key')) {
			const entry = entries.get(key.dataset.key), id = `button:${entry.key}`;
			key.disabled = !labels.has(entry.midi);
			key.addEventListener('keydown', event => {
				if (event.key !== ' ' && event.key !== 'Enter') return;
				event.preventDefault();
				if (!event.repeat) press(id, entry);
			});
			key.addEventListener('keyup', event => {
				if (event.key !== ' ' && event.key !== 'Enter') return;
				event.preventDefault();
				release(id);
			});
			key.addEventListener('blur', () => release(id));
		}
		octaveValue.value = octave ? `+${octave}` : '0';
		fretValue.value = String(fretboard.horizontalFretPosition);
		octaveDown.disabled = octave === 0;
		octaveUp.disabled = octave === MAX_OCTAVE;
		fretDown.disabled = fretboard.horizontalFretPosition === 0;
		fretUp.disabled = fretboard.horizontalFretPosition === MAX_FRET;
		showHeld();
		refreshLabels();
	}

	function changePosition(nextOctave, nextFret) {
		stopKeyboard();
		octave = Math.min(MAX_OCTAVE, Math.max(0, nextOctave));
		setFretPosition(fretboard, Math.min(MAX_FRET, nextFret));
		drawKeys();
	}

	listen(octaveDown, 'click', () => changePosition(octave - 1, fretboard.horizontalFretPosition));
	listen(octaveUp, 'click', () => changePosition(octave + 1, fretboard.horizontalFretPosition));
	listen(fretDown, 'click', () => changePosition(octave, fretboard.horizontalFretPosition - 1));
	listen(fretUp, 'click', () => changePosition(octave, fretboard.horizontalFretPosition + 1));
	listen(document, 'keydown', event => {
		if (!canPlayKeyboard() || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey
			|| event.target?.closest?.(PERFORMANCE_KEY_EXCLUSIONS)
			|| document.querySelector('dialog[open]')) return;
		const entry = entries.get(event.key.toLowerCase());
		if (!entry || !labels.has(entry.midi)) return;
		event.preventDefault();
		if (!event.repeat) press(`key:${event.code || entry.key}`, entry);
	});
	listen(window, 'keyup', event => release(`key:${event.code || event.key.toLowerCase()}`));
	listen(window, 'blur', stopKeyboard);
	listen(document, 'visibilitychange', () => { if (document.hidden) stopKeyboard(); });
	status.textContent = KEYBOARD_HINT;
	drawKeys();

	return {
		noteOn: voice.noteOn, noteOff: voice.noteOff, retune: voice.retune, stopAll, stopKeyboard, refreshLabels,
		cancelPending: voice.cancelPending, getNote: voice.getNote,
		dispose() { listeners.abort(); stopKeyboard(); voice.dispose(); },
	};
}
