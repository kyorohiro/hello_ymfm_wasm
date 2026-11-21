// SPDX-License-Identifier: BSD-3-Clause
import { NDS_AUDIO_CLOCK } from './nds-core.js?v=nds-sound-capture-1';
import { ndsTimerForFrequency } from './nds-synth-api.js?v=nds-sound-capture-1';

const PLAYABLE_BYTES = 16; // The DS sample player requires four words.
const ROOT_NOTE = 60;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export function setupNdsSoundCapture({ ensureAudio, getAudio, keyboard }) {
	const node = id => document.getElementById(id);
	const panel = node('ndsSoundCapture'), unit = node('ndsCaptureUnit'), format = node('ndsCaptureFormat');
	const rate = node('ndsCaptureRate'), words = node('ndsCaptureWords');
	const record = node('ndsCaptureRecord'), stop = node('ndsCaptureStop'), load = node('ndsCaptureLoad');
	const status = node('ndsCaptureStatus');
	const minRate = Math.ceil(NDS_AUDIO_CLOCK / 65536);
	rate.max = NDS_AUDIO_CLOCK;
	let timer = 0, disposed = false, busy = false, checking = false, revision = 0;
	let state = null, notice = '';

	function render() {
		const active = Boolean(state?.active);
		unit.disabled = busy;
		for (const field of [format, rate, words, record]) field.disabled = busy || active;
		stop.disabled = busy || !active;
		load.disabled = busy || active || (state?.byteLength ?? 0) < PLAYABLE_BYTES;
		const clock = state?.timerChanged ? ' · CH timer changed' : '';
		const activeRate = active ? NDS_AUDIO_CLOCK / (65536 - state.currentTimer) : null;
		const label = notice || (active
			? `Recording · ${state.format.toUpperCase()} · ${number.format(activeRate)} Hz${clock}`
			: state?.format
				? `Captured · ${state.format.toUpperCase()} · ${state.byteLength / 4} words · ${number.format(state.sampleRate)} Hz${clock}` +
					(load.disabled && !busy ? ' · 4 words needed for playback' : '')
				: 'Ready to record the Synth mixer.');
		if (status.textContent !== label) status.textContent = label;
	}

	async function refresh() {
		clearTimeout(timer);
		if (disposed || checking || !panel.open) return;
		if (!busy && !document.hidden && !panel.closest('[hidden]')) {
			checking = true;
			const request = revision;
			try {
				const audio = getAudio();
				const next = audio?.context.state === 'closed' ? null : await audio?.chip.getCaptureState(Number(unit.value));
				if (!disposed && request === revision) {
					// Keep explicit errors and load confirmation until a new
					// capture state arrives (including takes triggered by Code).
					if (next?.active && !state?.active) notice = '';
					state = next ?? null;
					render();
				}
			} catch (error) {
				if (!disposed && request === revision) {
					notice = error.message;
					render();
				}
			} finally {
				checking = false;
			}
		}
		if (!disposed && panel.open) timer = setTimeout(refresh, 125);
	}

	async function useCapture(action) {
		if (busy || disposed) return;
		busy = true;
		revision++;
		notice = '';
		render();
		try {
			const selected = Number(unit.value);
			const audio = action === 'record' ? await ensureAudio() : getAudio();
			if (disposed || !audio) return;
			if (action === 'record') {
				const hz = rate.valueAsNumber;
				const lengthWords = words.valueAsNumber;
				if (!Number.isInteger(hz) || hz < minRate || hz > NDS_AUDIO_CLOCK)
					throw new RangeError(`Capture rate must be ${minRate}–${NDS_AUDIO_CLOCK} Hz.`);
				if (!Number.isInteger(lengthWords) || lengthWords < 1 || lengthWords > 65535)
					throw new RangeError('Capture length must be 1–65535 words.');
				const { timer } = ndsTimerForFrequency(hz, 1);
				state = await audio.chip.startCapture(selected, { format: format.value, lengthWords, timer });
			} else if (action === 'stop') {
				state = await audio.chip.stopCapture(selected);
			} else {
				const clip = await audio.chip.readCapture(selected);
				if (disposed) return;
				if (clip.active || clip.bytes.length < PLAYABLE_BYTES) throw new Error('Finish recording at least four words first.');
				const name = `Capture ${selected}`;
				keyboard.applyPreset({
					...keyboard.getPreset(), name, mode: clip.format, loop: false,
					sample: { bytes: clip.bytes, sampleRate: clip.sampleRate,
						rootNote: ROOT_NOTE, loopStartWords: 0, lengthWords: clip.bytes.length / 4 },
				});
				notice = `Loaded ${name} · C4 at ${number.format(clip.sampleRate)} Hz`;
				if (clip.timerChanged) notice += ' · using the starting rate';
			}
		} catch (error) {
			notice = error.message;
		} finally {
			busy = false;
			if (!disposed) { render(); void refresh(); }
		}
	}

	unit.addEventListener('change', () => {
		revision++;
		state = null;
		notice = '';
		render();
		void refresh();
	});
	panel.addEventListener('toggle', () => void refresh());
	record.addEventListener('click', () => void useCapture('record'));
	stop.addEventListener('click', () => void useCapture('stop'));
	load.addEventListener('click', () => void useCapture('load'));
	render();
	return { dispose() { disposed = true; revision++; clearTimeout(timer); } };
}
