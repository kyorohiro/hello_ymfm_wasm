// SPDX-License-Identifier: BSD-3-Clause
import { NOTE_OPTIONS, PATTERNS, renderNote, renderPattern } from './buzzer.js';
import { encodeWav } from '../js/wav.js';

const byId = id => document.getElementById(id);
const tempo = byId('tempo'), gate = byId('gate'), volume = byId('volume'), loop = byId('loop');
const preset = byId('preset'), play = byId('play'), stop = byId('stop'), status = byId('status');
const canvas = byId('waveform'), drawing = canvas.getContext('2d');
const pitch = byId('pitch');
const noteLabels = new Map(NOTE_OPTIONS.map(({ value, label }) => [value, label]));
const notes = PATTERNS[0].notes.slice();
const rows = [];
let audio, master, clip = null, pending = null, request = 0, frame = 0;
let inspectedStep = 0, activeStep = -1;

preset.add(new Option('Custom', 'custom'));
for (const [index, pattern] of PATTERNS.entries()) preset.add(new Option(pattern.name, String(index)));

function syncTransport() {
	const playing = clip?.kind === 'pattern' || pending === 'pattern';
	play.disabled = playing;
	stop.disabled = !clip && !pending;
	loop.disabled = playing;
	for (const [index, row] of rows.entries()) row.button.disabled = playing || notes[index] === null;
}

function drawWave() {
	const step = activeStep < 0 ? inspectedStep : activeStep;
	const note = notes[step];
	const frequency = note === null ? null : 440 * 2 ** ((note - 69) / 12);
	pitch.textContent = frequency ? `${noteLabels.get(note)} · ${frequency.toFixed(1)} Hz` : 'Rest · silence';
	const { width, height } = canvas.getBoundingClientRect();
	if (!drawing || !width || !height) return;
	const scale = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * scale);
	canvas.height = Math.round(height * scale);
	drawing.setTransform(scale, 0, 0, scale, 0, 0);
	drawing.strokeStyle = '#5f644a55';
	drawing.lineWidth = 1;
	drawing.beginPath();
	for (let i = 1; i < 16; i++) {
		drawing.moveTo(width * i / 16, height * .13);
		drawing.lineTo(width * i / 16, height * .87);
	}
	for (const fraction of [.24, .5, .76]) {
		drawing.moveTo(0, height * fraction);
		drawing.lineTo(width, height * fraction);
	}
	drawing.stroke();
	drawing.strokeStyle = '#26321e';
	drawing.lineWidth = 3;
	drawing.lineJoin = 'round';
	drawing.lineCap = 'round';
	drawing.beginPath();
	const left = 7, right = width - 7, center = height / 2;
	if (frequency) {
		const sampleRate = 48000;
		const samples = renderNote(note, { sampleRate });
		const start = Math.round(.004 * sampleRate);
		const count = Math.round(.012 * sampleRate);
		let y = center - Math.sign(samples[start]) * height * .24;
		drawing.moveTo(left, y);
		for (let i = 1; i < count; i++) {
			const next = center - Math.sign(samples[start + i]) * height * .24;
			if (next === y) continue;
			const x = left + i * (right - left) / count;
			drawing.lineTo(x, y);
			drawing.lineTo(x, next);
			y = next;
		}
		drawing.lineTo(right, y);
	} else {
		drawing.moveTo(left, center);
		drawing.lineTo(right, center);
	}
	drawing.stroke();
}

function showStep(index) {
	if (activeStep === index) return;
	rows[activeStep]?.element.classList.remove('is-playing');
	activeStep = index;
	rows[index]?.element.classList.add('is-playing');
	drawWave();
}

function animate() {
	if (clip?.kind !== 'pattern') return;
	const elapsed = Math.max(0, audio.currentTime - clip.start);
	const elapsedFrames = Math.floor((elapsed % clip.duration) * audio.sampleRate);
	// Match the renderer's rounded boundaries, including tempos with fractional frames.
	let index = notes.length - 1;
	while (index > 0 && elapsedFrames < Math.round(index * clip.stepFrames)) index--;
	showStep(index);
	frame = requestAnimationFrame(animate);
}

function releaseClip() {
	if (!clip) return;
	const previous = clip, now = audio.currentTime, end = now + .008;
	clip = null;
	cancelAnimationFrame(frame);
	previous.gain.gain.setValueAtTime(1, now);
	previous.gain.gain.linearRampToValueAtTime(0, end);
	previous.source.stop(end);
	showStep(-1);
}

async function ensureAudio() {
	if (!audio) {
		const Audio = window.AudioContext ?? window.webkitAudioContext;
		if (!Audio) throw new Error('Web Audio is unavailable in this browser.');
		audio = new Audio();
		master = audio.createGain();
		master.gain.value = Number(volume.value) / 100;
		master.connect(audio.destination);
	}
	if (audio.state !== 'running') await audio.resume();
}

const renderSequence = sampleRate => renderPattern(notes, {
	bpm: Number(tempo.value), gate: Number(gate.value) / 100, sampleRate,
});

async function start(kind, step = inspectedStep) {
	const token = ++request;
	pending = kind;
	syncTransport();
	try {
		await ensureAudio();
		if (token !== request) return;
		const rendered = kind === 'pattern' ? renderSequence(audio.sampleRate) : null;
		const samples = rendered?.samples ?? renderNote(notes[step], { sampleRate: audio.sampleRate });
		const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
		buffer.copyToChannel(samples, 0);
		const gain = audio.createGain(), source = audio.createBufferSource();
		source.buffer = buffer;
		source.loop = kind === 'pattern' && loop.checked;
		const previous = clip;
		releaseClip();
		const time = audio.currentTime + (previous ? .008 : 0);
		const current = { kind, source, gain, start: time, duration: buffer.duration, stepFrames: rendered?.stepFrames };
		source.connect(gain);
		gain.connect(master);
		source.onended = () => {
			source.disconnect();
			gain.disconnect();
			if (clip !== current) return;
			clip = null;
			cancelAnimationFrame(frame);
			showStep(-1);
			status.textContent = kind === 'pattern' ? 'Pattern finished' : 'Ready';
			syncTransport();
		};
		source.start(time);
		clip = current;
		pending = null;
		if (kind === 'pattern') {
			status.textContent = source.loop ? 'Looping pattern' : 'Playing pattern';
			animate();
		} else {
			status.textContent = `Previewing ${noteLabels.get(notes[step]) ?? 'rest'}`;
			showStep(step);
		}
		syncTransport();
	} catch (error) {
		if (token !== request) return;
		pending = null;
		status.textContent = error.message;
		syncTransport();
	}
}

function stopPlayback() {
	request++;
	pending = null;
	releaseClip();
	status.textContent = 'Stopped';
	syncTransport();
}

function restartPattern() {
	if (clip?.kind === 'pattern' || pending === 'pattern') void start('pattern');
}

function refreshControls() {
	byId('tempo-value').value = `${tempo.value} BPM`;
	byId('gate-value').value = `${gate.value}%`;
	byId('volume-value').value = `${volume.value}%`;
}

function refreshStep(index) {
	const { element, button, select } = rows[index];
	const note = notes[index];
	select.value = note === null ? '' : String(note);
	button.setAttribute('aria-label', `Preview step ${index + 1} ${noteLabels.get(note) ?? 'rest'}`);
	element.classList.toggle('is-rest', note === null);
}

for (const [index] of notes.entries()) {
	const element = document.createElement('li'), button = document.createElement('button');
	const select = document.createElement('select');
	element.className = 'step';
	button.type = 'button';
	button.textContent = String(index + 1).padStart(2, '0');
	select.setAttribute('aria-label', `Step ${index + 1} note`);
	select.add(new Option('Rest', ''));
	for (const { value, label } of NOTE_OPTIONS) select.add(new Option(label, String(value)));
	button.addEventListener('click', () => {
		inspectedStep = index;
		drawWave();
		void start('preview', index);
	});
	select.addEventListener('change', () => {
		notes[index] = select.value === '' ? null : Number(select.value);
		inspectedStep = index;
		preset.value = 'custom';
		refreshStep(index);
		drawWave();
		syncTransport();
		restartPattern();
	});
	element.append(button, select);
	byId('steps').append(element);
	rows.push({ element, button, select });
}

function loadPattern(index) {
	const pattern = PATTERNS[index];
	if (!pattern) return;
	for (const [step, note] of pattern.notes.entries()) notes[step] = note;
	tempo.value = String(pattern.bpm);
	preset.value = String(index);
	inspectedStep = 0;
	rows.forEach((_, step) => refreshStep(step));
	refreshControls();
	drawWave();
	syncTransport();
	restartPattern();
}

preset.addEventListener('change', () => loadPattern(preset.value));
tempo.addEventListener('input', () => {
	preset.value = 'custom';
	refreshControls();
});
tempo.addEventListener('change', restartPattern);
gate.addEventListener('input', refreshControls);
gate.addEventListener('change', restartPattern);
volume.addEventListener('input', () => {
	refreshControls();
	master?.gain.setTargetAtTime(Number(volume.value) / 100, audio.currentTime, .008);
});
play.addEventListener('click', () => void start('pattern'));
stop.addEventListener('click', stopPlayback);
byId('download').addEventListener('click', () => {
	const sampleRate = 48000;
	const { samples } = renderSequence(sampleRate);
	const bytes = encodeWav({ sampleRate, channels: [samples] }, { gain: Number(volume.value) / 100 });
	const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = 'tetorica-lcd-buzzer.wav';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	if (!clip && !pending) status.textContent = 'WAV exported';
});
window.addEventListener('pagehide', stopPlayback);
new ResizeObserver(drawWave).observe(canvas);
loadPattern(0);
