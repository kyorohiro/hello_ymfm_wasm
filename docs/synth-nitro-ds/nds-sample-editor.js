// SPDX-License-Identifier: BSD-3-Clause
import { midiToNoteName } from '../synth/synth_keyboard.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import { makeNdsSample } from './nds-synth-api.js?v=nds-timer-1';
import { encodeNdsSample, normalizeNdsSampleRange, readNdsSample, readNdsSampleRange, readNdsWav, NDS_MAX_WAV_BYTES } from './nds-sample.js?v=nds-2sf-audition-1';
import { ndsPresetChannelSettings } from './nds-preset.js?v=nds-timer-1';

export const isNdsSampleMode = mode => mode === 'pcm8' || mode === 'pcm16' || mode === 'adpcm';
const sampleFormats = {
	pcm8: { name: 'PCM8', encoding: '8-bit signed PCM' },
	pcm16: { name: 'PCM16', encoding: '16-bit signed PCM' },
	adpcm: { name: 'IMA-ADPCM', encoding: '4-bit codes · 4-byte header' },
};

export function ndsSoundPatch(sound) {
	return ndsPresetChannelSettings(snapshotNdsSound(sound));
}

export function snapshotNdsSound({ name, mode, shape, volume, pan, divider, duty, loop, timer, sample }) {
	const preset = { name, mode, shape, volume, pan, divider, duty, loop };
	if (timer != null) preset.timer = timer;
	if (!isNdsSampleMode(mode) || !sample) return preset;
	const { asset, rootNote, range: { loopStartWords, lengthWords } } = sample;
	return { ...preset, sample: { bytes: asset.bytes, sampleRate: asset.sampleRate, rootNote, loopStartWords, lengthWords } };
}

export function restoreNdsSound({ sample, ...patch }) {
	if (!sample) return { ...patch, sample: null };
	const asset = readNdsSample(sample.bytes, sample.sampleRate, patch.mode);
	const range = readNdsSampleRange(asset, { ...sample, loop: patch.loop });
	return { ...patch, sample: { asset, source: asset.pcm, rootNote: sample.rootNote, range } };
}

export function editNdsSound(sound, key, value) {
	if (!sound.sample || !['mode', 'loop'].includes(key)) return { ...sound, [key]: value };
	const next = { ...sound, [key]: value };
	if (!isNdsSampleMode(next.mode)) return next;
	const { asset, source, range } = sound.sample;
	const converted = asset.mode === next.mode ? asset : encodeNdsSample(source, asset.sampleRate, next.mode);
	return { ...next, sample: { ...sound.sample, asset: converted,
		range: normalizeNdsSampleRange(converted, { ...range, loop: next.loop }) } };
}

export function setupNdsSampleEditor({ getSound, updateSound, getTarget, onError }) {
	const node = id => document.getElementById(id);
	const panel = node('ndsSampleEditor'), wavInput = node('ndsWavInput'), load = node('ndsLoadWav');
	const rangeFields = node('ndsSampleRangeFields'), title = node('ndsSampleTitle');
	const info = node('ndsSampleInfo'), status = node('ndsSampleStatus');
	const useBuiltin = node('ndsUseBuiltin'), root = node('ndsSampleRoot'), start = node('ndsSampleStart'), end = node('ndsSampleEnd');
	const canvas = node('ndsSampleCanvas'), context = canvas.getContext('2d');
	const toolButtons = [...panel.querySelectorAll('[data-nds-wave-tool]')];
	const width = canvas.width, height = canvas.height;
	const builtinAssets = new Map();
	let request = 0, peaks, cachedSample = null, gesture = null, tool = 'range';
	let drawnAsset, drawnRange, drawnLoop;
	const y = value => height * (.5 - value * .43);

	function builtinAsset(mode, shape) {
		const key = `${mode}:${shape}`;
		if (!builtinAssets.has(key)) {
			const { bytes, frames } = makeNdsSample(mode, shape);
			builtinAssets.set(key, readNdsSample(bytes, frames * noteToHz('C4'), mode));
		}
		return builtinAssets.get(key);
	}

	function readPeaks(pcm, output, first = 0, last = width - 1) {
		for (let x = first; x <= last; x++) {
			const from = Math.floor(x * pcm.length / width);
			const to = Math.max(from + 1, Math.floor((x + 1) * pcm.length / width));
			let lo = 1, hi = -1;
			for (let index = from; index < to; index++) {
				const value = pcm[index];
				lo = Math.min(lo, value); hi = Math.max(hi, value);
			}
			output[x * 2] = lo; output[x * 2 + 1] = hi;
		}
		return output;
	}

	function draw(asset, range, repeat, stroke = null) {
		if (!context || (!stroke && asset === drawnAsset && range === drawnRange && repeat === drawnLoop)) return;
		drawnAsset = stroke ? null : asset;
		drawnRange = range;
		drawnLoop = repeat;
		const pcm = stroke?.source ?? asset.pcm;
		context.fillStyle = '#191b26';
		context.fillRect(0, 0, width, height);
		const sx = width * (range?.startFrame ?? 0) / asset.frames;
		const ex = width * (range?.endFrame ?? asset.frames) / asset.frames;
		if (range) {
			context.fillStyle = repeat ? '#9c42565c' : '#5b516a52';
			context.fillRect(repeat ? sx : 0, 0, repeat ? ex - sx : ex, height);
		}
		context.strokeStyle = '#56536a';
		context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
		context.strokeStyle = '#ed9ebb';
		context.beginPath();
		if (!range) {
			const step = width / asset.frames;
			context.moveTo(0, y(pcm[0]));
			for (let frame = 0; frame < asset.frames; frame++) {
				const level = y(pcm[frame]);
				context.lineTo(frame * step, level);
				context.lineTo((frame + 1) * step, level);
			}
			context.stroke();
			return;
		}
		if (stroke) stroke.peaks ??= readPeaks(pcm, new Float32Array(width * 2));
		else if (cachedSample !== asset) {
			cachedSample = asset;
			peaks = readPeaks(pcm, peaks ?? new Float32Array(width * 2));
		}
		const columns = stroke?.peaks ?? peaks;
		for (let x = 0; x < width; x++) {
			const high = y(columns[x * 2 + 1]), low = y(columns[x * 2]);
			context.moveTo(x + .5, high); context.lineTo(x + .5, Math.max(high + 1, low));
		}
		context.stroke();
		for (const [x, color] of [[sx, '#f9bf69'], [ex, '#9dd5f2']]) {
			context.fillStyle = color;
			context.fillRect(Math.min(width - 2, x), 0, 2, height);
		}
	}

	function endGesture() {
		const pointer = gesture?.pointer;
		gesture = null;
		if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
	}

	function canDraw(stroke, sound, asset) {
		return stroke.target === getTarget() && stroke.asset === asset && stroke.sample === sound.sample;
	}

	function render() {
		const sound = getSound();
		const sampleMode = isNdsSampleMode(sound.mode), sample = sampleMode ? sound.sample : null;
		panel.hidden = load.hidden = !sampleMode;
		useBuiltin.hidden = rangeFields.hidden = !sample;
		if (!sampleMode) { endGesture(); return; }
		panel.dataset.editable = String(Boolean(sample));
		panel.dataset.waveTool = tool;
		const asset = sample?.asset ?? builtinAsset(sound.mode, sound.shape);
		if (gesture && (gesture.target !== getTarget() || gesture.asset !== asset ||
			(gesture.tool === 'draw' && gesture.sample !== sample))) endGesture();
		const stroke = gesture?.tool === 'draw' ? gesture : null;
		const { name, encoding } = sampleFormats[asset.mode];
		title.textContent = `${name} waveform`;
		canvas.setAttribute('aria-label', tool === 'draw' ? `Draw the ${name} waveform. Release to apply.`
			: sample ? `Decoded ${name} waveform and loop range` : `Decoded ${name} built-in sample waveform`);
		for (const button of toolButtons) button.setAttribute('aria-pressed', String(button.dataset.ndsWaveTool === tool));
		const source = sample ? sound.name : 'Built-in waveform';
		const rate = sample ? ` · ${asset.sampleRate.toLocaleString()} Hz` : '';
		info.textContent = `${source ? `${source} · ` : ''}${encoding}${rate} · ${asset.frames.toLocaleString()} frames · ${asset.bytes.length.toLocaleString()} bytes · ${asset.framesPerWord} frames/word`;
		const drawHint = 'Draw · Software · Release to apply on the next note.';
		if (!sample) {
			status.textContent = tool === 'draw' ? drawHint : 'Select Draw to edit the built-in waveform.';
			draw(asset, null, sound.loop, stroke);
			return;
		}
		const { rootNote, range } = sample;
		root.value = rootNote;
		node('ndsSampleRootName').value = midiToNoteName(rootNote);
		start.value = range.startFrame; end.value = range.endFrame;
		start.step = end.step = asset.framesPerWord;
		start.max = Math.min(range.endFrame - asset.framesPerWord, (65535 - asset.headerWords) * asset.framesPerWord);
		end.min = range.startFrame + asset.framesPerWord;
		end.max = asset.frames;
		const rangeInfo = `${sound.loop ? 'Repeat' : 'One shot'} · PNT ${range.loopStartWords} · LEN ${range.lengthWords} words.`;
		status.textContent = `${rangeInfo} ${tool === 'draw' ? drawHint : 'Changes apply on the next note.'}`;
		draw(asset, range, sound.loop, stroke);
	}

	function changeRange(key, frame) {
		const sound = getSound(), sample = sound.sample;
		if (!sample) return;
		const { asset, range } = sample;
		const limit = key === 'startFrame' ? Math.min(frame, range.endFrame - asset.framesPerWord)
			: Math.max(frame, range.startFrame + asset.framesPerWord);
		updateSound({ ...sound, sample: { ...sample,
			range: normalizeNdsSampleRange(asset, { ...range, [key]: limit, loop: sound.loop }) } });
	}

	load.addEventListener('click', () => wavInput.click());
	wavInput.addEventListener('change', async () => {
		const file = wavInput.files[0]; wavInput.value = '';
		if (!file) return;
		const revision = ++request, target = getTarget();
		try {
			if (file.size > NDS_MAX_WAV_BYTES) throw new RangeError('Choose a WAV file up to 16 MiB.');
			const { pcm, sampleRate } = await readNdsWav(await file.arrayBuffer());
			if (revision !== request || target !== getTarget()) return;
			const sound = getSound(), mode = isNdsSampleMode(sound.mode) ? sound.mode : 'pcm16';
			const asset = encodeNdsSample(pcm, sampleRate, mode), range = normalizeNdsSampleRange(asset);
			updateSound({ ...sound, name: file.name.replace(/\.wave?$/i, ''), mode, loop: false,
				sample: { asset, source: pcm, rootNote: 60, range } });
		} catch (error) { if (revision === request && target === getTarget()) onError(error); }
	});
	useBuiltin.addEventListener('click', () => {
		request++;
		updateSound({ ...getSound(), name: '', sample: null, loop: true });
	});
	for (const [input, key] of [[start, 'startFrame'], [end, 'endFrame']]) input.addEventListener('change', () => {
		try { changeRange(key, input.valueAsNumber); } catch (error) { render(); onError(error); }
		input.blur();
	});
	root.addEventListener('change', () => {
		const sound = getSound(), rootNote = root.valueAsNumber;
		if (sound.sample && Number.isInteger(rootNote) && rootNote >= 0 && rootNote <= 127)
			updateSound({ ...sound, sample: { ...sound.sample, rootNote } });
		else render();
		root.blur();
	});

	function rangePoint(event) {
		const rect = canvas.getBoundingClientRect();
		return Math.round((event.clientX - rect.left) / rect.width * getSound().sample.asset.frames);
	}
	function paint(event, stroke) {
		const rect = canvas.getBoundingClientRect(), { source } = stroke;
		const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
		const value = Math.max(-1, Math.min(1, (.5 - (event.clientY - rect.top) / Math.max(1, rect.height)) / .43));
		const frame = Math.round(x * (source.length - 1));
		const previous = stroke.point ?? { frame, value };
		const first = Math.min(previous.frame, frame), last = Math.max(previous.frame, frame);
		const distance = frame - previous.frame;
		if (distance) for (let index = first; index <= last; index++) {
			const ratio = (index - previous.frame) / distance;
			source[index] = previous.value + ratio * (value - previous.value);
		}
		else source[frame] = value;
		stroke.point = { frame, value };
		if (stroke.peaks) {
			// Only bins touched by this segment need to be rescanned for the preview.
			const x0 = Math.max(0, Math.floor(first * width / source.length) - 1);
			const x1 = Math.min(width - 1, Math.ceil((last + 1) * width / source.length));
			readPeaks(source, stroke.peaks, x0, x1);
		}
	}
	function cancelGesture() {
		if (!gesture) return;
		endGesture();
		render();
	}
	for (const button of toolButtons) {
		button.addEventListener('pointerdown', event => {
			event.preventDefault();
			document.activeElement?.blur();
		});
		button.addEventListener('click', () => {
			if (tool === button.dataset.ndsWaveTool) return;
			endGesture();
			tool = button.dataset.ndsWaveTool;
			render();
		});
	}
	canvas.addEventListener('pointerdown', event => {
		if (event.button !== 0 || gesture || !isNdsSampleMode(getSound().mode)) return;
		if (tool === 'range' && !getSound().sample) return;
		event.preventDefault();
		document.activeElement?.blur();
		const sound = getSound(), target = getTarget(), pointer = event.pointerId;
		canvas.setPointerCapture(pointer);
		if (tool === 'draw') {
			const { sample } = sound, asset = sample?.asset ?? builtinAsset(sound.mode, sound.shape);
			const source = asset.pcm.slice();
			if (sample) source.set(sample.source);
			gesture = { tool, pointer, target, sample, asset, source };
			paint(event, gesture);
			draw(asset, sample?.range ?? null, sound.loop, gesture);
			return;
		}
		const frame = rangePoint(event), { startFrame, endFrame } = sound.sample.range;
		const key = Math.abs(frame - startFrame) < Math.abs(frame - endFrame) ? 'startFrame' : 'endFrame';
		gesture = { tool, pointer, key, target, asset: sound.sample.asset };
		changeRange(key, frame);
	});
	canvas.addEventListener('pointermove', event => {
		if (gesture?.pointer !== event.pointerId || gesture.target !== getTarget()) return;
		const sound = getSound();
		if (gesture.tool === 'range') {
			if (sound.sample) changeRange(gesture.key, rangePoint(event));
			return;
		}
		paint(event, gesture);
		draw(gesture.asset, sound.sample?.range ?? null, sound.loop, gesture);
	});
	canvas.addEventListener('pointerup', event => {
		if (gesture?.pointer !== event.pointerId) return;
		const stroke = gesture, sound = getSound();
		endGesture();
		if (stroke.tool !== 'draw') return;
		const sample = sound.sample, current = sample?.asset ?? (isNdsSampleMode(sound.mode) ? builtinAsset(sound.mode, sound.shape) : null);
		if (!canDraw(stroke, sound, current)) { render(); return; }
		try {
			paint(event, stroke);
			const source = stroke.source;
			const asset = encodeNdsSample(source, stroke.asset.sampleRate, sound.mode);
			const range = sample?.range ?? normalizeNdsSampleRange(asset, { loop: sound.loop });
			updateSound({ ...sound, sample: { asset, source, rootNote: sample?.rootNote ?? 60, range } });
		} catch (error) { render(); onError(error); }
	});
	for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
		if (gesture?.pointer === event.pointerId) cancelGesture();
	});
	document.addEventListener('keydown', event => {
		if (event.key !== 'Escape' || gesture?.tool !== 'draw') return;
		event.preventDefault();
		cancelGesture();
	});
	return { render, cancelPending() { request++; cancelGesture(); } };
}
