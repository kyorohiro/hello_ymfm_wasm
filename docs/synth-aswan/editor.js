// SPDX-License-Identifier: BSD-3-Clause
// Passive WonderSwan instrument controls; audio starts only through the host.
import { createDefaultPreset, readPreset } from './preset.js';

export function waveShape(shape) {
	return Array.from({ length: 32 }, (_, i) => {
		if (shape === 'triangle') return Math.round(15 * (1 - Math.abs(i / 16 - 1)));
		if (shape === 'saw') return Math.round((i * 15) / 31);
		if (shape === 'square') return i < 16 ? 15 : 0;
		return Math.round(7.5 + 7.5 * Math.sin((i * Math.PI) / 16));
	});
}
export function createEditor({
	root,
	onChange = () => {},
	onError = () => {},
	onLoadAudio = async () => {},
}) {
	const doc = root.ownerDocument,
		win = doc.defaultView ?? globalThis;
	const cleanups = [],
		fields = new Map(),
		pointerControls = new WeakSet(),
		parameterDrags = new Set();
	let preset = createDefaultPreset(),
		disposed = false,
		stroke = null;
	let view = { readOnly: false, channel: null },
		loading = false;
	const make = (tag, className, text) => {
		const element = doc.createElement(tag);
		if (className) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	};
	const listen = (element, type, listener, options) => {
		element.addEventListener(type, listener, options);
		cleanups.push(() => element.removeEventListener(type, listener, options));
	};
	const report = (error) => {
		if (!disposed) onError(error);
	};
	function commit(mutator) {
		if (disposed || view.readOnly) return;
		try {
			const before = readPreset(preset),
				next = readPreset(before);
			mutator(next);
			preset = readPreset(next);
			render();
			Promise.resolve(onChange(readPreset(preset), before)).catch(report);
		} catch (error) {
			render();
			report(error);
		}
	}
	function performanceFocus(input) {
		listen(input, 'pointerdown', () => pointerControls.add(input));
		listen(input, 'keydown', (event) => {
			pointerControls.delete(input);
			if (event.key === 'Enter' || event.key === 'Escape') {
				// Native select navigation is allowed to finish before returning to keys.
				queueMicrotask(() => input.blur());
			}
		});
		listen(input, 'change', () => {
			if (pointerControls.has(input)) {
				pointerControls.delete(input);
				queueMicrotask(() => input.blur());
			}
		});
		listen(input, 'blur', () => pointerControls.delete(input));
	}
	function field(parent, label, id) {
		const row = make('label', 'aswan-field');
		row.htmlFor = id;
		row.append(make('span', '', label));
		parent.append(row);
		return row;
	}
	function select(parent, label, id, choices, get, set, { local = false } = {}) {
		const row = make('div', 'aswan-field aswan-choice-field'),
			title = make('span', '', label);
		title.id = `${id}Label`;
		row.dataset.choice = id;
		row.append(title);
		parent.append(row);
		const group = make('div', 'aswan-choice-group');
		group.id = id;
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-labelledby', title.id);
		row.append(group);
		let disabled = false;
		const buttons = choices.map(([value, text]) => {
			const button = make('button', 'aswan-choice', text);
			button.type = 'button';
			button.dataset.choiceFor = id;
			button.dataset.choiceValue = String(value);
			button.dataset.value = String(value);
			button.setAttribute('role', 'radio');
			listen(button, 'pointerdown', (event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				doc.activeElement?.blur();
			});
			listen(button, 'click', () => choose(String(value)));
			group.append(button);
			return button;
		});
		function refresh() {
			const selected = String(get(preset));
			group.setAttribute('aria-disabled', String(disabled));
			for (const button of buttons) {
				const checked = button.dataset.choiceValue === selected;
				button.setAttribute('aria-checked', String(checked));
				button.disabled = disabled;
				button.tabIndex = checked && !disabled ? 0 : -1;
			}
		}
		function choose(value, focus = false) {
			if (
				disabled ||
				buttons.find((button) => button.dataset.choiceValue === value)?.disabled
			)
				return;
			if (value !== String(get(preset))) {
				if (local) {
					set(preset, value);
					render();
				} else commit((preset) => set(preset, value));
			}
			if (focus) buttons.find((button) => button.dataset.choiceValue === value)?.focus();
		}
		listen(group, 'keydown', (event) => {
			if (disabled) return;
			const available = buttons.filter((button) => !button.disabled);
			if (!available.length) return;
			const current = Math.max(
				0,
				available.findIndex((button) => button.dataset.choiceValue === String(get(preset))),
			);
			let index;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
				index = (current + 1) % available.length;
			else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
				index = (current + available.length - 1) % available.length;
			else if (event.key === 'Home') index = 0;
			else if (event.key === 'End') index = available.length - 1;
			else return;
			event.preventDefault();
			event.stopPropagation();
			choose(available[index].dataset.choiceValue, true);
		});
		const control = {
			setDisabled(value) {
				disabled = Boolean(value || view.readOnly);
				refresh();
			},
		};
		fields.set(id, { input: group, get, update: refresh, setDisabled: control.setDisabled });
		return control;
	}
	function number(parent, label, id, min, max, get, set, step = 1, { fractional = false } = {}) {
		const row = make('div', 'aswan-field'),
			title = make('span', '', label);
		title.id = `${id}Label`;
		row.append(title);
		parent.append(row);
		const group = make('div', 'aswan-stepper');
		group.setAttribute('role', 'group');
		group.setAttribute('aria-labelledby', title.id);
		row.append(group);
		const minus = make('button', 'aswan-stepper-button', '−'),
			plus = make('button', 'aswan-stepper-button', '+');
		const output = make('output', 'aswan-stepper-value');
		output.id = id;
		output.tabIndex = 0;
		output.setAttribute('role', 'spinbutton');
		output.setAttribute('aria-labelledby', title.id);
		output.setAttribute('aria-valuemin', String(min));
		output.setAttribute('aria-valuemax', String(max));
		output.title = 'Drag left or right, or use the arrow keys.';
		let disabled = false,
			drag = null;
		for (const [button, delta, verb] of [
			[minus, -1, 'Decrease'],
			[plus, 1, 'Increase'],
		]) {
			button.type = 'button';
			button.dataset.stepperFor = id;
			button.dataset.stepperDelta = String(delta);
			button.setAttribute('aria-label', `${verb} ${label}`);
			listen(button, 'pointerdown', (event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				doc.activeElement?.blur();
			});
			listen(button, 'click', () => adjust(get(preset) + delta * step));
		}
		group.append(minus, output, plus);
		function refresh() {
			const value = get(preset),
				shown = fractional
					? value.toLocaleString('en-US', {
							useGrouping: false,
							maximumFractionDigits: 3,
						})
					: String(value);
			output.textContent = fractional && Number(shown) !== value ? `≈${shown}` : shown;
			output.title = `${value} · Drag left or right, or use the arrow keys.`;
			output.setAttribute('aria-valuenow', String(value));
			output.setAttribute('aria-disabled', String(disabled));
			group.setAttribute('aria-disabled', String(disabled));
			output.tabIndex = disabled ? -1 : 0;
			minus.disabled = disabled || value <= min;
			plus.disabled = disabled || value >= max;
		}
		function adjust(value) {
			if (disabled) return;
			const next = Math.max(
				min,
				Math.min(max, fractional ? value : Math.round(value / step) * step),
			);
			if (next !== get(preset)) commit((value) => set(value, next));
		}
		listen(group, 'keydown', (event) => {
			let next;
			if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = get(preset) + step;
			else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
				next = get(preset) - step;
			else if (event.key === 'PageUp') next = get(preset) + step * 10;
			else if (event.key === 'PageDown') next = get(preset) - step * 10;
			else if (event.key === 'Home') next = min;
			else if (event.key === 'End') next = max;
			else return;
			event.preventDefault();
			event.stopPropagation();
			adjust(next);
		});
		listen(output, 'pointerdown', (event) => {
			if (disabled || event.button !== 0) return;
			event.preventDefault();
			doc.activeElement?.blur();
			drag = { id: event.pointerId, x: event.clientX, value: get(preset) };
			parameterDrags.add(output);
			output.setPointerCapture(event.pointerId);
			output.classList.add('is-dragging');
		});
		listen(output, 'pointermove', (event) => {
			if (drag?.id === event.pointerId)
				adjust(drag.value + Math.round((event.clientX - drag.x) / 8) * step);
		});
		function endDrag(event) {
			if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
			const pointer = drag.id;
			drag = null;
			output.classList.remove('is-dragging');
			parameterDrags.delete(output);
			if (output.hasPointerCapture?.(pointer)) output.releasePointerCapture(pointer);
		}
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
			listen(output, type, endDrag);
		listen(win, 'blur', endDrag);
		const control = {
			setDisabled(value) {
				disabled = Boolean(value || view.readOnly);
				if (disabled) endDrag();
				refresh();
			},
		};
		fields.set(id, { input: output, get, update: refresh, setDisabled: control.setDisabled });
		return control;
	}
	function checkbox(parent, label, id, get, set) {
		const row = field(parent, label, id);
		row.classList.add('aswan-check');
		const input = make('input');
		input.type = 'checkbox';
		input.id = id;
		row.prepend(input);
		fields.set(id, { input, get });
		listen(input, 'change', () => commit((value) => set(value, input.checked)));
		performanceFocus(input);
		return input;
	}
	function card(title, id) {
		const element = make('details', 'aswan-card');
		element.open = true;
		if (id) element.id = id;
		const summary = make('summary', '', title),
			content = make('div', 'aswan-card-content');
		element.append(summary, content);
		body.append(element);
		return { element, content };
	}
	function section(parent, title) {
		const element = make('div', 'aswan-subsection');
		element.append(make('h4', '', title));
		parent.append(element);
		return element;
	}
	function group(parent) {
		const element = make('div', 'aswan-fields');
		parent.append(element);
		return element;
	}
	function help(parent, text) {
		const element = make('p', 'aswan-help', text);
		parent.append(element);
		return element;
	}
	const body = make('div', 'aswan-editor');
	root.append(body);
	const sourceBar = make('div', 'aswan-source-bar');
	body.append(sourceBar);
	select(
		sourceBar,
		'Source',
		'source',
		[
			['wave', 'Wavetable'],
			['noise', 'Noise · CH4'],
			['pcm', 'Voice PCM · CH2'],
		],
		(p) => p.source,
		(p, v) => {
			p.source = v;
			if (v !== 'wave') p.sweep.enabled = false;
		},
	);
	const hint = make('p', 'aswan-help');
	sourceBar.append(hint);
	const waveCard = card('Waveform · 32 × 4-bit', 'waveSection');
	const canvas = make('canvas');
	canvas.id = 'waveCanvas';
	canvas.width = 900;
	canvas.height = 190;
	canvas.setAttribute('role', 'img');
	canvas.setAttribute('aria-label', 'Draw a 32-sample four-bit waveform');
	waveCard.content.append(canvas);
	const waveButtons = group(waveCard.content);
	for (const shape of ['sine', 'triangle', 'saw', 'square']) {
		const button = make('button', '', shape[0].toUpperCase() + shape.slice(1));
		button.type = 'button';
		button.dataset.shape = shape;
		listen(button, 'pointerdown', (e) => {
			if (e.button === 0) {
				e.preventDefault();
				doc.activeElement?.blur();
			}
		});
		listen(button, 'click', () =>
			commit((p) => {
				p.wave = waveShape(shape);
			}),
		);
		waveButtons.append(button);
	}
	help(
		waveCard.content,
		'Software drawing writes the real 32-point, 4-bit wave RAM. Edits apply immediately and preserve held notes.',
	);
	const stereo = card('Level & stereo · hardware', 'levelSection'),
		levels = group(stereo.content);
	number(
		levels,
		'Left volume · 0–15',
		'volumeLeft',
		0,
		15,
		(p) => p.left,
		(p, v) => {
			p.left = v;
		},
	);
	number(
		levels,
		'Right volume · 0–15',
		'volumeRight',
		0,
		15,
		(p) => p.right,
		(p, v) => {
			p.right = v;
		},
	);
	const pcmGains = [
		[0, 'Mute'],
		[7, 'Half'],
		[15, 'Full'],
	];
	select(
		levels,
		'Left Voice route',
		'pcmLeftGain',
		pcmGains,
		(p) => (p.left >= 8 ? 15 : p.left ? 7 : 0),
		(p, v) => {
			p.left = Number(v);
		},
	);
	select(
		levels,
		'Right Voice route',
		'pcmRightGain',
		pcmGains,
		(p) => (p.right >= 8 ? 15 : p.right ? 7 : 0),
		(p, v) => {
			p.right = Number(v);
		},
	);
	const levelHelp = help(stereo.content, '');
	const sweepCard = card('Pitch Sweep · hardware · CH3', 'sweepSection'),
		sweeps = group(sweepCard.content);
	checkbox(
		sweeps,
		'Enable hardware Sweep',
		'sweepEnabled',
		(p) => p.sweep.enabled,
		(p, v) => {
			p.sweep.enabled = v;
		},
	);
	number(
		sweeps,
		'Sweep step · signed register delta',
		'sweepStep',
		-128,
		127,
		(p) => p.sweep.step,
		(p, v) => {
			p.sweep.step = v;
		},
	);
	number(
		sweeps,
		'Sweep time · hardware code',
		'sweepTime',
		0,
		31,
		(p) => p.sweep.time,
		(p, v) => {
			p.sweep.time = v;
		},
	);
	help(
		sweepCard.content,
		'CH3 only. Sweep adds the signed step to its frequency register at the selected hardware interval. Auto uses CH3 when enabled.',
	);
	const noiseCard = card('Noise · hardware · CH4', 'noiseSection'),
		noises = group(noiseCard.content);
	select(
		noises,
		'Noise LFSR tap',
		'noiseType',
		Array.from({ length: 8 }, (_, i) => [i, String(i)]),
		(p) => p.noise.type,
		(p, v) => {
			p.noise.type = Number(v);
		},
	);
	help(
		noiseCard.content,
		'Eight hardware noise configurations. Note changes affect the shift clock, not a guaranteed musical pitch.',
	);
	const pcmCard = card('Voice PCM · CH2 · software sample supply', 'pcmSection'),
		pcm = group(pcmCard.content);
	const loadAudio = make('button', '', 'Load audio…');
	loadAudio.type = 'button';
	loadAudio.id = 'loadAudio';
	const audioInput = make('input', 'file-input');
	audioInput.type = 'file';
	audioInput.accept = 'audio/*';
	audioInput.id = 'audioFileInput';
	pcm.append(loadAudio, audioInput);
	const pcmInfo = help(
		pcmCard.content,
		'Load audio, then play the keyboard. Voice PCM replaces CH2’s wave output.',
	);
	pcmInfo.id = 'pcmInfo';
	number(
		pcm,
		'Root MIDI note',
		'pcmRootNote',
		0,
		127,
		(p) => p.pcm.rootNote,
		(p, v) => {
			p.pcm.rootNote = v;
		},
	);
	number(
		pcm,
		'Source sample rate · Hz',
		'pcmSampleRate',
		1000,
		192000,
		(p) => p.pcm.sampleRate,
		(p, v) => {
			p.pcm.sampleRate = v;
		},
		100,
	);
	checkbox(
		pcm,
		'Loop · software',
		'pcmLoop',
		(p) => p.pcm.loop,
		(p, v) => {
			p.pcm.loop = v;
		},
	);
	help(
		pcmCard.content,
		'Software supplies unsigned 8-bit samples to the hardware Voice DAC. Playback rate, root note, looping and this Envelope are host features; this does not emulate HyperVoice or DMA.',
	);
	listen(loadAudio, 'click', () => {
		loadAudio.blur();
		audioInput.click();
	});
	listen(audioInput, 'change', async () => {
		const file = audioInput.files?.[0];
		audioInput.value = '';
		if (!file || loading || view.readOnly) return;
		loading = true;
		loadAudio.disabled = true;
		try {
			await onLoadAudio(file);
		} catch (error) {
			report(error);
		} finally {
			loading = false;
			render();
		}
	});
	const envCard = card('Envelope · software', 'envelopeSection'),
		envelopes = group(envCard.content);
	checkbox(
		envelopes,
		'Enable software Envelope',
		'envelopeEnabled',
		(p) => p.envelope.enabled,
		(p, v) => {
			p.envelope.enabled = v;
		},
	);
	for (const [name, label, max, step] of [
		['attack', 'Attack · s', 10, 0.005],
		['decay', 'Decay · s', 10, 0.01],
		['sustain', 'Sustain · 0–1', 1, 0.05],
		['release', 'Release · s', 10, 0.005],
	]) {
		number(
			envelopes,
			label,
			'envelope' + name[0].toUpperCase() + name.slice(1),
			0,
			max,
			(p) => p.envelope[name],
			(p, v) => {
				p.envelope[name] = Number(v.toFixed(4));
			},
			step,
			{ fractional: true },
		);
	}
	help(
		envCard.content,
		'WonderSwan has no hardware ADSR. The host automates its real volume steps; noteOff and keyboard release use this Envelope. Raw keyOff gates immediately.',
	);
	function draw() {
		const ctx = canvas.getContext('2d'),
			w = canvas.width,
			h = canvas.height;
		if (!ctx) return;
		ctx.fillStyle = '#19242c';
		ctx.fillRect(0, 0, w, h);
		ctx.strokeStyle = '#334752';
		ctx.lineWidth = 1;
		for (let y = 0; y < 16; y++) {
			const at = 10 + (h - 20) * (1 - y / 15);
			ctx.beginPath();
			ctx.moveTo(0, at);
			ctx.lineTo(w, at);
			ctx.stroke();
		}
		ctx.strokeStyle = '#79c8e8';
		ctx.lineWidth = 2;
		ctx.beginPath();
		preset.wave.forEach((v, i) => {
			const x = (i * w) / 32,
				y = 10 + (h - 20) * (1 - v / 15);
			if (!i) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
			ctx.lineTo(((i + 1) * w) / 32, y);
		});
		ctx.stroke();
	}
	const point = (e) => {
		const rect = canvas.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(31, Math.floor(((e.clientX - rect.left) / rect.width) * 32))),
			y: Math.max(
				0,
				Math.min(
					15,
					Math.round((1 - (e.clientY - rect.top - 10) / (rect.height - 20)) * 15),
				),
			),
		};
	};
	function paint(e) {
		const to = point(e),
			from = stroke?.last ?? to;
		commit((p) => {
			for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
				p.wave[x] =
					from.x === to.x
						? to.y
						: Math.round(from.y + ((to.y - from.y) * (x - from.x)) / (to.x - from.x));
			}
		});
		if (stroke) stroke.last = to;
	}
	listen(canvas, 'pointerdown', (e) => {
		if (e.button !== 0 || view.readOnly) return;
		e.preventDefault();
		doc.activeElement?.blur();
		stroke = { id: e.pointerId, last: point(e) };
		canvas.setPointerCapture?.(e.pointerId);
		paint(e);
	});
	listen(canvas, 'pointermove', (e) => {
		if (stroke?.id === e.pointerId) paint(e);
	});
	function finish(e) {
		if (!stroke || (e?.pointerId !== undefined && e.pointerId !== stroke.id)) return;
		const id = stroke.id;
		stroke = null;
		if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
	}
	for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
		listen(canvas, name, finish);
	function render() {
		waveCard.element.hidden = preset.source !== 'wave';
		sweepCard.element.hidden = preset.source !== 'wave';
		noiseCard.element.hidden = preset.source !== 'noise';
		pcmCard.element.hidden = preset.source !== 'pcm';
		for (const name of ['volumeLeft', 'volumeRight'])
			fields.get(name).input.closest('.aswan-field').hidden = preset.source === 'pcm';
		for (const name of ['pcmLeftGain', 'pcmRightGain'])
			fields.get(name).input.closest('.aswan-field').hidden = preset.source !== 'pcm';
		levelHelp.textContent =
			preset.source === 'pcm'
				? 'Voice PCM has three hardware output levels per side: Mute, Half or Full. The four-bit Wave/Noise volumes are not used in this mode.'
				: 'Independent four-bit hardware volume per side: 0–15, linear steps. Master controls the final output separately.';
		for (const field of fields.values()) {
			if (field.update) field.update();
			else if (field.input.type === 'checkbox') field.input.checked = field.get(preset);
			field.setDisabled?.(view.readOnly);
			if (field.input.type === 'checkbox') field.input.disabled = view.readOnly;
		}
		for (const button of fields.get('source').input.querySelectorAll('button')) {
			const source = button.dataset.choiceValue;
			button.disabled =
				view.readOnly ||
				(view.channel !== null &&
					((source === 'noise' && view.channel !== 3) ||
						(source === 'pcm' && view.channel !== 1)));
		}
		fields.get('sweepEnabled').input.disabled =
			view.readOnly || (view.channel !== null && view.channel !== 2);
		for (const button of waveButtons.querySelectorAll('button'))
			button.disabled = view.readOnly;
		loadAudio.disabled = loading || view.readOnly;
		const length = preset.pcm.data
			? Math.floor((preset.pcm.data.length * 3) / 4) -
				(preset.pcm.data.endsWith('==') ? 2 : preset.pcm.data.endsWith('=') ? 1 : 0)
			: 0;
		pcmInfo.textContent = length
			? `${length.toLocaleString()} samples · ${(length / preset.pcm.sampleRate).toFixed(2)} s · unsigned 8-bit`
			: 'No PCM loaded. Load audio, then play the keyboard.';
		hint.textContent = view.readOnly
			? 'Live VGM observation · Copy to Auto to edit.'
			: preset.source === 'noise'
				? 'Hardware CH4 · one Noise voice.'
				: preset.source === 'pcm'
					? 'CH2 Voice DAC · software sample playback.'
					: preset.sweep.enabled
						? 'Hardware Sweep · CH3 · one voice.'
						: '32 samples · 4-bit wave RAM · four voices in Auto.';
		draw();
	}
	render();
	return {
		setPreset(value, options = {}) {
			preset = readPreset(value);
			view = { readOnly: false, channel: null, ...options };
			render();
		},
		getPreset() {
			return readPreset(preset);
		},
		dispose() {
			disposed = true;
			finish();
			for (const cleanup of cleanups) cleanup();
			root.replaceChildren();
		},
	};
}
