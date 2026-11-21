// SPDX-License-Identifier: BSD-3-Clause
import { midiToNoteName } from '../synth/synth_keyboard.js';
import { encodeNdsSample, normalizeNdsSampleRange, readNdsSample, readNdsSampleRange, readNdsWav, NDS_MAX_WAV_BYTES } from './nds-sample.js?v=nds-2sf-audition-1';
import { ndsPresetChannelSettings } from './nds-preset.js?v=nds-2sf-audition-1';

export const isNdsSampleMode = mode => mode === 'pcm8' || mode === 'pcm16' || mode === 'adpcm';
const formatNames = { pcm8: 'PCM8', pcm16: 'PCM16', adpcm: 'IMA-ADPCM' };

export function ndsSoundPatch(sound) {
	return ndsPresetChannelSettings(snapshotNdsSound(sound));
}

export function snapshotNdsSound({ name, mode, shape, volume, pan, divider, duty, loop, sample }) {
	const preset = { name, mode, shape, volume, pan, divider, duty, loop };
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
	const useBuiltin = node('ndsUseBuiltin'), root = node('ndsSampleRoot'), start = node('ndsSampleStart'), end = node('ndsSampleEnd');
	const canvas = node('ndsSampleCanvas'), context = canvas.getContext('2d');
	const width = canvas.width, height = canvas.height;
	let request = 0, peaks, cachedSample = null, drag = null;

	function draw(sample, repeat) {
		if (!context) return;
		const { asset, range } = sample;
		if (cachedSample !== asset) {
			cachedSample = asset;
			peaks = new Float32Array(width * 2);
			for (let x = 0; x < width; x++) {
				const from = Math.floor(x / width * asset.frames);
				const to = Math.max(from + 1, Math.floor((x + 1) / width * asset.frames));
				let lo = 1, hi = -1;
				for (let index = from; index < to; index++) {
					const value = asset.pcm[index];
					lo = Math.min(lo, value); hi = Math.max(hi, value);
				}
				peaks[x * 2] = lo; peaks[x * 2 + 1] = hi;
			}
		}
		const sx = width * range.startFrame / asset.frames, ex = width * range.endFrame / asset.frames;
		context.fillStyle = '#191b26';
		context.fillRect(0, 0, width, height);
		context.fillStyle = repeat ? '#9c42565c' : '#5b516a52';
		context.fillRect(repeat ? sx : 0, 0, repeat ? ex - sx : ex, height);
		context.strokeStyle = '#56536a';
		context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
		const y = v => height * (.5 - v * .43);
		context.strokeStyle = '#ed9ebb';
		context.beginPath();
		for (let x = 0; x < width; x++) {
			const high = y(peaks[x * 2 + 1]), low = y(peaks[x * 2]);
			context.moveTo(x + .5, high); context.lineTo(x + .5, Math.max(high + 1, low));
		}
		context.stroke();
		for (const [x, color] of [[sx, '#f9bf69'], [ex, '#9dd5f2']]) {
			context.fillStyle = color;
			context.fillRect(Math.min(width - 2, x), 0, 2, height);
		}
	}

	function render() {
		const sound = getSound();
		const sample = isNdsSampleMode(sound.mode) ? sound.sample : null;
		panel.hidden = useBuiltin.hidden = !sample;
		if (!sample) return;
		const { asset, rootNote, range } = sample;
		root.value = rootNote;
		node('ndsSampleRootName').value = midiToNoteName(rootNote);
		start.value = range.startFrame; end.value = range.endFrame;
		start.step = end.step = asset.framesPerWord;
		start.max = Math.min(range.endFrame - asset.framesPerWord, (65535 - asset.headerWords) * asset.framesPerWord);
		end.min = range.startFrame + asset.framesPerWord;
		end.max = asset.frames;
		const title = sound.name ? `${sound.name} · ` : '';
		node('ndsSampleInfo').textContent = `${title}${formatNames[asset.mode]} · ${asset.sampleRate.toLocaleString()} Hz · ${asset.frames.toLocaleString()} frames · ${asset.framesPerWord} frames/word`;
		node('ndsSampleStatus').textContent = `${sound.loop ? 'Repeat' : 'One shot'} · PNT ${range.loopStartWords} · LEN ${range.lengthWords} words. Changes apply on the next note.`;
		draw(sample, sound.loop);
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

	function point(event) {
		const rect = canvas.getBoundingClientRect();
		return Math.round((event.clientX - rect.left) / rect.width * getSound().sample.asset.frames);
	}
	canvas.addEventListener('pointerdown', event => {
		if (event.button !== 0 || !getSound().sample) return;
		event.preventDefault();
		const frame = point(event), { startFrame, endFrame } = getSound().sample.range;
		const key = Math.abs(frame - startFrame) < Math.abs(frame - endFrame) ? 'startFrame' : 'endFrame';
		drag = { pointer: event.pointerId, key, target: getTarget() };
		canvas.setPointerCapture(event.pointerId);
		changeRange(key, frame);
	});
	canvas.addEventListener('pointermove', event => {
		if (drag?.pointer === event.pointerId && drag.target === getTarget() && getSound().sample) changeRange(drag.key, point(event));
	});
	canvas.addEventListener('lostpointercapture', () => { drag = null; });
	return { render, cancelPending() { request++; drag = null; } };
}
