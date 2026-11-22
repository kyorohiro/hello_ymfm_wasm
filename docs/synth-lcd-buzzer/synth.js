// SPDX-License-Identifier: BSD-3-Clause
import { NOTE_OPTIONS, PATTERNS, renderNote, renderPattern, validateBuzzerPattern } from './buzzer.js';
import { encodeWav } from '../js/wav.js';
import { BUZZER_STARTER, setupBuzzerCode } from './code.js';
import { setupBuzzerWorkspace } from './files.js';
import { setupBuzzerPerformance } from './performance.js';
import { GATE_PRESETS, GATE_STEP_COUNT, MASTER_CLOCK_HZ, R1_DIVISOR, R1_HZ, renderR1Pattern } from './sm510.js';

const byId = id => document.getElementById(id);
const tempo = byId('tempo'), gate = byId('gate'), volume = byId('volume'), loop = byId('loop');
const preset = byId('preset'), play = byId('play'), stop = byId('stop'), status = byId('status');
const canvas = byId('waveform'), drawing = canvas.getContext('2d');
const pitch = byId('pitch');
const sm510Play = byId('sm510Play'), sm510Stop = byId('sm510Stop'), sm510Controls = byId('sm510Controls');
const sm510Preset = byId('sm510Preset'), sm510StepTime = byId('sm510StepTime'), sm510StepValue = byId('sm510StepValue');
const sm510Gates = Array(GATE_STEP_COUNT).fill(false), sm510Buttons = [];
const noteLabels = new Map(NOTE_OPTIONS.map(({ value, label }) => [value, label]));
const notes = PATTERNS[0].notes.slice();
const rows = [];
let audio, master, clip = null, pending = null, request = 0, frame = 0;
let inspectedStep = 0, activeStep = -1, activeR1Step = -1, heldNote = null;
let workspace;
const defaultOwner = Symbol('LCD Buzzer transport');
const sm510Owner = Symbol('SM510 R1 demo');

preset.add(new Option('Custom', 'custom'));
for (const [index, pattern] of PATTERNS.entries()) preset.add(new Option(pattern.name, String(index)));

function syncTransport() {
	const playing = clip?.kind === 'pattern' || pending?.kind === 'pattern';
	const playingR1 = clip?.kind === 'sm510' || pending?.kind === 'sm510';
	play.disabled = playing;
	stop.disabled = !clip && !pending;
	loop.disabled = playing;
	sm510Play.disabled = playingR1 || !sm510Gates.some(Boolean);
	sm510Stop.disabled = !playingR1;
	sm510Controls.disabled = playingR1;
	for (const [index, row] of rows.entries()) row.button.disabled = playing || notes[index] === null;
}

function drawWave() {
	const step = activeStep < 0 ? inspectedStep : activeStep;
	const note = heldNote ?? notes[step];
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

function showR1Step(index) {
	if (activeR1Step === index) return;
	sm510Buttons[activeR1Step]?.removeAttribute('aria-current');
	activeR1Step = index;
	sm510Buttons[index]?.setAttribute('aria-current', 'step');
}

function animate() {
	const isR1 = clip.kind === 'sm510';
	const elapsed = Math.max(0, audio.currentTime - clip.start);
	const position = clip.source.loop ? elapsed % clip.duration : elapsed;
	const elapsedFrames = Math.floor(position * audio.sampleRate);
	// Match the renderer's rounded boundaries, including tempos with fractional frames.
	let index = (isR1 ? sm510Gates : notes).length - 1;
	while (index > 0 && elapsedFrames < Math.round(index * clip.stepFrames)) index--;
	if (isR1) showR1Step(index);
	else showStep(index);
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
	showR1Step(-1);
	return end;
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

async function start(kind, step = inspectedStep, owner = defaultOwner, loopOverride) {
	const token = ++request;
	pending = { kind, owner, loopOverride };
	syncTransport();
	try {
		await ensureAudio();
		if (token !== request) return false;
		const rendered = kind === 'sm510'
			? renderR1Pattern(sm510Gates, { stepMs: Number(sm510StepTime.value), sampleRate: audio.sampleRate })
			: kind === 'pattern' ? renderSequence(audio.sampleRate) : null;
		const samples = rendered?.samples ?? renderNote(notes[step], { sampleRate: audio.sampleRate });
		const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
		buffer.copyToChannel(samples, 0);
		const gain = audio.createGain(), source = audio.createBufferSource();
		source.buffer = buffer;
		source.loop = kind === 'pattern' && (loopOverride ?? loop.checked);
		const heldUntil = heldNote === null ? audio.currentTime : audio.currentTime + .008;
		performance.stopAll();
		const time = Math.max(releaseClip() ?? audio.currentTime, heldUntil);
		const current = { kind, source, gain, owner, loopOverride, start: time, duration: buffer.duration, stepFrames: rendered?.stepFrames };
		source.connect(gain);
		gain.connect(master);
		source.onended = () => {
			source.disconnect();
			gain.disconnect();
			if (clip !== current) return;
			clip = null;
			cancelAnimationFrame(frame);
			showStep(-1);
			showR1Step(-1);
			status.textContent = kind === 'pattern' ? 'Pattern finished' : 'Ready';
			syncTransport();
		};
		source.start(time);
		clip = current;
		pending = null;
		if (kind === 'pattern') {
			status.textContent = source.loop ? 'Looping pattern' : 'Playing pattern';
			animate();
		} else if (kind === 'sm510') {
			status.textContent = 'Playing R1 demo';
			animate();
		} else {
			status.textContent = `Previewing ${noteLabels.get(notes[step]) ?? 'rest'}`;
			showStep(step);
		}
		syncTransport();
		return true;
	} catch (error) {
		if (token !== request) return false;
		pending = null;
		status.textContent = error.message;
		if (kind === 'sm510') setStatus(error.message);
		syncTransport();
		return false;
	}
}

function stopPlayback(owner) {
	if (pending && (owner === undefined || pending.owner === owner)) {
		request++;
		pending = null;
	}
	const end = clip && (owner === undefined || clip.owner === owner) ? releaseClip() : undefined;
	if (!clip && !pending && (end !== undefined || owner === undefined)) status.textContent = 'Stopped';
	syncTransport();
	return end;
}

function restartPattern() {
	const current = pending ?? clip;
	if (current?.kind === 'pattern') void start('pattern', inspectedStep, current.owner, current.loopOverride);
}

function getPattern() {
	return {
		notes: notes.slice(), bpm: Number(tempo.value), gate: Number(gate.value) / 100,
		volume: Number(volume.value) / 100, loop: loop.checked,
	};
}

function applyPattern(value) {
	const next = validateBuzzerPattern(value);
	notes.splice(0, notes.length, ...next.notes);
	tempo.value = String(next.bpm);
	gate.value = String(Math.round(next.gate * 100));
	volume.value = String(Math.round(next.volume * 100));
	loop.checked = next.loop;
	const builtIn = PATTERNS.findIndex(pattern => pattern.bpm === next.bpm && pattern.notes.every((note, index) => note === notes[index]));
	preset.value = builtIn < 0 ? 'custom' : String(builtIn);
	rows.forEach((_, index) => refreshStep(index));
	refreshControls();
	master?.gain.setTargetAtTime(Number(volume.value) / 100, audio.currentTime, .008);
	drawWave();
	syncTransport();
}

function updatePattern(settings) {
	applyPattern({ ...getPattern(), ...settings });
	workspace?.patternChanged();
	if ('notes' in settings || 'bpm' in settings || 'gate' in settings || 'loop' in settings) restartPattern();
	return getPattern();
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
		const updated = notes.slice();
		updated[index] = select.value === '' ? null : Number(select.value);
		inspectedStep = index;
		updatePattern({ notes: updated });
	});
	element.append(button, select);
	byId('steps').append(element);
	rows.push({ element, button, select });
}

function loadPattern(index) {
	const pattern = PATTERNS[index];
	if (!pattern) return;
	inspectedStep = 0;
	updatePattern({ notes: pattern.notes, bpm: pattern.bpm });
}

preset.addEventListener('change', () => loadPattern(preset.value));
tempo.addEventListener('input', () => {
	preset.value = 'custom';
	refreshControls();
});
tempo.addEventListener('change', () => { workspace.patternChanged(); restartPattern(); });
gate.addEventListener('input', refreshControls);
gate.addEventListener('change', () => { workspace.patternChanged(); restartPattern(); });
volume.addEventListener('input', () => {
	refreshControls();
	master?.gain.setTargetAtTime(Number(volume.value) / 100, audio.currentTime, .008);
});
volume.addEventListener('change', () => workspace.patternChanged());
loop.addEventListener('change', () => workspace.patternChanged());
play.addEventListener('click', () => void start('pattern'));
stop.addEventListener('click', () => stopPlayback());
sm510Play.addEventListener('click', () => void start('sm510', inspectedStep, sm510Owner));
sm510Stop.addEventListener('click', () => stopPlayback(sm510Owner));

byId('sm510Carrier').textContent = `${R1_HZ.toLocaleString('en-US')} Hz`;
byId('sm510Path').textContent = `${MASTER_CLOCK_HZ.toLocaleString('en-US')} Hz clock → ÷${R1_DIVISOR} → R1 gate → piezo`;

function refreshR1Controls() {
	sm510StepValue.value = `${sm510StepTime.value} ms`;
	for (const [index, button] of sm510Buttons.entries()) {
		button.setAttribute('aria-pressed', String(sm510Gates[index]));
		button.querySelector('span').textContent = sm510Gates[index] ? 'On' : 'Off';
	}
	syncTransport();
}

for (let index = 0; index < sm510Gates.length; index++) {
	const button = document.createElement('button');
	button.type = 'button';
	button.setAttribute('aria-label', `R1 gate ${index + 1}`);
	button.append(String(index + 1), document.createElement('span'));
	button.addEventListener('click', () => {
		sm510Gates[index] = !sm510Gates[index];
		sm510Preset.value = 'custom';
		refreshR1Controls();
	});
	byId('sm510Gates').append(button);
	sm510Buttons.push(button);
}

function loadR1Preset() {
	const pattern = GATE_PRESETS[sm510Preset.value];
	if (!pattern) return;
	sm510StepTime.value = String(pattern.stepMs);
	sm510Gates.fill(false);
	for (const index of pattern.on) sm510Gates[index] = true;
	refreshR1Controls();
}

sm510Preset.addEventListener('change', loadR1Preset);
sm510StepTime.addEventListener('input', () => {
	sm510Preset.value = 'custom';
	refreshR1Controls();
});
byId('buzzerChipGuide').addEventListener('toggle', event => {
	if (!event.currentTarget.open) stopPlayback(sm510Owner);
});
loadR1Preset();

function exportWav() {
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
	setStatus('WAV exported');
}
byId('download').addEventListener('click', exportWav);
byId('buzzerMenuWav').addEventListener('click', exportWav);

function setStatus(message) { byId('workspace-status').textContent = message; }
function stopPerformance() { stopPlayback(); performance.stopAll(); }
const performance = setupBuzzerPerformance({
	document, ensureAudio,
	getOutput: () => ({ context: audio, master }),
	onBeforeNote: () => stopPlayback(),
	onNoteChange(note) {
		heldNote = note;
		drawWave();
		if (!clip && !pending) status.textContent = note === null ? 'Ready' : `Playing ${noteLabels.get(note)}`;
	},
	onError: error => setStatus(error.message),
});

new ResizeObserver(drawWave).observe(canvas);
loadPattern(0);
workspace = setupBuzzerWorkspace({
	document, setStatus, getPattern, stopPerformance,
	applyPattern(pattern) { applyPattern(pattern); restartPattern(); },
	getStarterCode: () => BUZZER_STARTER,
});
const synthButton = byId('synthWorkspaceSynthButton'), codeButton = byId('synthWorkspaceCodeButton');
const controls = setupBuzzerCode({
	workspace, performance, ensureAudio, setStatus,
	now: () => audio?.currentTime ?? 0,
	sequence: {
		getPattern, update: updatePattern,
		play: (owner, override) => start('pattern', inspectedStep, owner, override),
		stop: stopPlayback,
	},
	onExpandedChange(expanded) {
		document.querySelector('.shell').classList.toggle('is-code-mode', expanded);
		codeButton.setAttribute('aria-pressed', String(expanded));
		synthButton.setAttribute('aria-pressed', String(!expanded));
	},
});
codeButton.addEventListener('click', () => void controls.setExpanded(true).catch(error => setStatus(error.message)));
synthButton.addEventListener('click', async () => {
	try {
		await controls.setExpanded(false);
		await controls.setMode('keyboard', { focusEditor: false });
		synthButton.focus();
	} catch (error) { setStatus(error.message); }
});
window.addEventListener('pagehide', () => { stopPerformance(); void controls.stop(); });
