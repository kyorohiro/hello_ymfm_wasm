// SPDX-License-Identifier: BSD-3-Clause
import { NOTE_OPTIONS, PATTERNS, renderNote, renderPattern, validateBuzzerPattern } from './buzzer.js';
import { encodeWav } from '../js/wav.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import { BUZZER_STARTER, setupBuzzerCode } from './code.js';
import { setupBuzzerWorkspace } from './files.js';
import { setupBuzzerPerformance } from './performance.js';
import {
	DIRECT_R, DK52_R, EQUAL_TEMPERAMENT, GATE_PRESETS, GATE_STEP_COUNT,
	MACHINE_CYCLE_HZ, MASTER_CLOCK_HZ, R1_DIVISOR, R1_HZ, R_WRITE_CYCLES, TICKS_PER_MACHINE_CYCLE,
	createSm510AudioCore, createR1Voice, directPitchHz, renderR1Pattern, renderR1Timeline, renderSm510Notes,
} from './sm510.js';
import { SM511_DEMO, renderSm511Melody, renderSm511NoteCycle, renderSm511Pattern, sm511Command, sm511Label } from './sm511.js';

const byId = id => document.getElementById(id);
const fetchSm510 = window.fetch.bind(window, new URL('./sm510.wasm?v=sm511-melody', import.meta.url));
const tempo = byId('tempo'), gate = byId('gate'), volume = byId('volume'), loop = byId('loop');
const sequencerPanel = byId('buzzerStepSequencerPanel');
const masterMix = byId('buzzerMasterMix');
const mix = Object.fromEntries(['sm510', 'sm511'].map(chip => [chip, {
	level: byId(chip + 'Mix'), mute: byId(chip + 'Mute'), readout: byId(chip + 'MixValue'), output: null,
}]));
const preset = byId('preset'), play = byId('play'), stop = byId('stop'), status = byId('status');
const canvas = byId('waveform'), drawing = canvas.getContext('2d');
const pitch = byId('pitch');
const toneSource = byId('toneSource'), toneSourceDetail = byId('toneSourceDetail');
const toneHints = {
	[DIRECT_R]: 'Pitches use whole SM510 machine cycles.',
	[DK52_R]: 'All notes gate the fixed 4,096 Hz carrier.',
	[EQUAL_TEMPERAMENT]: 'Software comparison with A4 tuned to 440 Hz.',
};
const tonePreference = 'tetorica-sm510-tone-source';
try {
	const remembered = localStorage.getItem(tonePreference);
	if (Object.hasOwn(toneHints, remembered)) toneSource.value = remembered;
} catch {}
toneSourceDetail.textContent = toneHints[toneSource.value];
const sm510Play = byId('sm510Play'), sm510Stop = byId('sm510Stop'), sm510Controls = byId('sm510Controls');
const sm510Preset = byId('sm510Preset'), sm510StepTime = byId('sm510StepTime'), sm510StepValue = byId('sm510StepValue');
const sm510Gates = Array(GATE_STEP_COUNT).fill(false), sm510Buttons = [];
const sm511Play = byId('sm511Play'), sm511Stop = byId('sm511Stop'), sm511Status = byId('sm511Status');
const noteLabels = new Map(NOTE_OPTIONS.map(({ value, label }) => [value, label]));
const notes = PATTERNS[0].notes.slice();
const rows = [];
let audio, master, clip = null, pending = null, request = 0, frame = 0;
let inspectedStep = 0, activeStep = -1, activeR1Step = -1, heldNote = null;
let selectedChip = 'sm510', heldChip = null, melodyClip = null, melodyPending = null;
let workspace;
let codeR1, codeR1Mode, coreLoading, audioCore;
const defaultOwner = Symbol('LCD Buzzer transport');
const sm510Owner = Symbol('SM510 R1 demo');
const sm510CodeOwner = Symbol('SM510 Code');
const sm511DemoOwner = Symbol('SM511 demo');
const sm511CodeOwner = Symbol('SM511 Code');

const displayNote = (note, chip = selectedChip) => chip === 'sm511' ? sm511Label(note) : noteLabels.get(note);
const mixLevel = chip => mix[chip].mute.checked ? 0 : Number(mix[chip].level.value) / 100;

preset.add(new Option('Custom', 'custom'));
for (const [index, pattern] of PATTERNS.entries()) preset.add(new Option(pattern.name, String(index)));

function syncTransport() {
	const playing = clip?.kind === 'pattern' || pending?.kind === 'pattern';
	const playingR1 = clip?.kind === 'sm510' || pending?.kind === 'sm510';
	play.disabled = playing;
	stop.disabled = !clip && !pending && !codeR1?.enabled;
	loop.disabled = playing;
	sm510Play.disabled = playingR1 || !sm510Gates.some(Boolean);
	sm510Stop.disabled = !playingR1;
	sm510Controls.disabled = playingR1;
	sm511Play.disabled = melodyClip?.owner === sm511DemoOwner || melodyPending?.owner === sm511DemoOwner;
	sm511Stop.disabled = !melodyClip && !melodyPending;
	for (const [index, row] of rows.entries()) row.button.disabled = playing || notes[index] === null;
}

function drawWave() {
	const step = activeStep < 0 ? inspectedStep : activeStep;
	const note = heldNote ?? notes[step];
	const rawMode = codeR1?.enabled ? codeR1Mode : clip?.r1Mode;
	const chip = rawMode ? 'sm510' : heldChip ?? clip?.chip ?? selectedChip;
	const mode = rawMode ?? clip?.toneMode ?? toneSource.value;
	const sm511 = chip === 'sm511';
	const showingMelody = sm511 && melodyClip && heldNote === null && !clip;
	const target = note === null ? null : noteToHz(note);
	const half = !sm511 && mode === DIRECT_R && target && audioCore?.directHalfCycles(target);
	const sounding = rawMode ? clip?.kind !== 'sm510' || sm510Gates[activeR1Step] : target !== null;
	const frequency = !showingMelody && sounding && (sm511 ? audioCore?.sm511PitchHz(sm511Command(note))
		: mode === DK52_R ? R1_HZ : rawMode ? null
		: mode === EQUAL_TEMPERAMENT ? target : half ? directPitchHz(half) : null);
	pitch.title = half && !rawMode ? `${half} machine cycles per half-wave` : '';
	if (showingMelody) pitch.textContent = 'SM511 · Melody ROM';
	else if (rawMode === DIRECT_R) pitch.textContent = codeR1?.enabled ? 'Direct R1 · High' : 'Direct R1 · Cycle sequence';
	else if (frequency && rawMode) pitch.textContent = 'SM510 R1 · 4,096 Hz';
	else if (frequency) pitch.textContent = `${displayNote(note, chip)} · ${frequency.toFixed(2)} Hz`;
	else if (!sounding) pitch.textContent = rawMode ? 'SM510 R1 · Off' : 'Rest · silence';
	else pitch.textContent = `${displayNote(note, chip)} · ${sm511 ? 'SM511' : 'Direct R'}`;
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
		const count = Math.round(.012 * sampleRate);
		const waveform = sm511 ? renderSm511NoteCycle(audioCore, note) : null;
		const level = frame => (waveform
			? waveform[Math.floor(frame * MASTER_CLOCK_HZ / sampleRate) % waveform.length] > 0
			: Math.floor(frame * frequency * 2 / sampleRate) % 2 === 0) ? 1 : -1;
		let y = center - level(0) * height * .24;
		drawing.moveTo(left, y);
		for (let i = 1; i < count; i++) {
			const next = center - level(i) * height * .24;
			if (next === y) continue;
			const x = left + i * (right - left) / count;
			drawing.lineTo(x, y);
			drawing.lineTo(x, next);
			y = next;
		}
		drawing.lineTo(right, y);
	} else {
		const y = rawMode === DIRECT_R && codeR1?.enabled ? center - height * .24 : center;
		drawing.moveTo(left, y);
		drawing.lineTo(right, y);
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
	drawWave();
}

function animate() {
	const isR1 = clip.kind === 'sm510';
	const elapsed = Math.max(0, audio.currentTime - clip.start);
	const position = clip.source.loop ? elapsed % clip.duration : elapsed;
	const elapsedFrames = Math.floor(position * audio.sampleRate);
	// Match the renderer's rounded boundaries, including tempos with fractional frames.
	let index = (isR1 ? sm510Gates : notes).length - 1;
	while (index > 0 && elapsedFrames < (clip.boundaries?.[index] ?? Math.round(index * clip.stepFrames))) index--;
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
	if (previous.kind === 'sm510-plan') drawWave();
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
		for (const [chip, channel] of Object.entries(mix)) {
			channel.output = audio.createGain();
			channel.output.gain.value = mixLevel(chip);
			channel.output.connect(master);
		}
	}
	if (audio.state !== 'running') await audio.resume();
}

function prepareSm510() {
	coreLoading ??= fetchSm510().then(async response => {
		if (!response.ok) throw new Error(`Unable to load the SM510 audio core (HTTP ${response.status}).`);
		const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
		audioCore = createSm510AudioCore(instance.exports);
		drawWave();
		return audioCore;
	}).catch(error => { coreLoading = undefined; throw error; });
	return coreLoading;
}

const targetHz = note => note === null ? null : noteToHz(note);
function renderSequence(sampleRate, chip, mode, core) {
	const bpm = Number(tempo.value), noteGate = Number(gate.value) / 100;
	if (chip === 'sm511') return renderSm511Pattern(core, notes, { stepSeconds: 30 / bpm, gate: noteGate, sampleRate });
	return mode === EQUAL_TEMPERAMENT ? renderPattern(notes, { bpm, gate: noteGate, sampleRate })
		: renderSm510Notes(core, mode, notes.map(targetHz), { stepSeconds: 30 / bpm, gate: noteGate, sampleRate });
}

async function start(kind, { step = inspectedStep, owner = defaultOwner, loopOverride, r1Plan, r1Mode, chip = r1Mode ? 'sm510' : selectedChip } = {}) {
	cancelPendingChipWork(chip);
	performance.cancelPending(chip);
	const token = ++request;
	const mode = toneSource.value;
	pending = { kind, owner, loopOverride, r1Mode, chip };
	syncTransport();
	try {
		await ensureAudio();
		const core = r1Mode || chip === 'sm511' || mode !== EQUAL_TEMPERAMENT ? await prepareSm510() : null;
		if (token !== request) return false;
		let rendered;
		if (kind === 'sm510')
			rendered = renderR1Pattern(sm510Gates, { stepMs: Number(sm510StepTime.value), sampleRate: audio.sampleRate }, core.renderR1);
		else if (kind === 'sm510-plan')
			rendered = { samples: renderR1Timeline(r1Plan, audio.sampleRate, r1Mode === DIRECT_R ? core.renderDirectR1 : core.renderR1) };
		else if (kind === 'pattern') rendered = renderSequence(audio.sampleRate, chip, mode, core);
		else if (chip === 'sm511')
			rendered = renderSm511Pattern(core, [notes[step]], { stepSeconds: .125, sampleRate: audio.sampleRate });
		else if (mode !== EQUAL_TEMPERAMENT)
			rendered = renderSm510Notes(core, mode, [targetHz(notes[step])], { stepSeconds: .18, sampleRate: audio.sampleRate });
		const samples = rendered?.samples ?? renderNote(notes[step], { sampleRate: audio.sampleRate });
		const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
		buffer.copyToChannel(samples, 0);
		const gain = audio.createGain(), source = audio.createBufferSource();
		source.buffer = buffer;
		source.loop = kind === 'pattern' && (loopOverride ?? loop.checked);
		const previous = chip === 'sm511' ? stopMelody() : releaseCodeR1();
		const time = Math.max(releaseClip() ?? 0, releaseClipAndKeys(chip), previous ?? 0);
		const current = {
			kind, source, gain, owner, loopOverride, r1Mode, chip, toneMode: mode,
			start: time, duration: buffer.duration, stepFrames: rendered?.stepFrames, boundaries: rendered?.boundaries,
		};
		source.connect(gain);
		gain.connect(mix[chip].output);
		source.onended = () => {
			source.disconnect();
			gain.disconnect();
			if (clip !== current) return;
			clip = null;
			cancelAnimationFrame(frame);
			showStep(-1);
			showR1Step(-1);
			if (kind === 'sm510-plan') drawWave();
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
		} else if (kind === 'sm510-plan') {
			status.textContent = 'Playing SM510 cycle sequence';
			drawWave();
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
		setStatus(error.message);
		syncTransport();
		if (kind === 'sm510-plan') throw error;
		return false;
	}
}

function releaseClipAndKeys(chip) {
	const ownsKeys = !chip || heldChip === chip;
	const heldUntil = ownsKeys && heldNote !== null ? audio.currentTime + .008 : audio.currentTime;
	if (ownsKeys) performance.stopAll();
	const clipEnd = !chip || clip?.chip === chip ? releaseClip() : undefined;
	return Math.max(clipEnd ?? audio.currentTime, heldUntil);
}

function releaseCodeR1() {
	if (!codeR1) return;
	const end = codeR1.dispose();
	codeR1 = undefined;
	drawWave();
	return end;
}

function writeCodeR1(enabled, core, mode) {
	if (mode === codeR1Mode && enabled === Boolean(codeR1?.enabled)) return;
	if (enabled) {
		cancelPendingChipWork('sm510');
		performance.cancelPending('sm510');
		const previous = mode !== codeR1Mode ? releaseCodeR1() : undefined;
		const begin = Math.max(releaseClipAndKeys('sm510'), previous ?? 0);
		codeR1Mode = mode;
		codeR1 ??= createR1Voice(audio, mix.sm510.output, mode === DIRECT_R ? core.renderDirectR1 : core.renderR1);
		codeR1.setGate(true, begin);
		status.textContent = 'Playing SM510 R1';
	} else {
		if (mode !== codeR1Mode || !codeR1) return;
		codeR1.setGate(false);
		if (!clip && !pending) status.textContent = 'Ready';
	}
	drawWave();
	syncTransport();
}

function cancelPendingChipWork(chip) {
	if (pending?.chip === chip) {
		request++;
		pending = null;
	}
	if (chip === 'sm511' && melodyPending) {
		melodyPending = null;
		sm511Status.textContent = melodyClip ? 'Playing melody' : 'Stopped';
	}
	syncTransport();
}

function stopPlayback(owner, { noteSourceOnly = false, chip } = {}) {
	const owns = playback => playback && (owner === undefined || playback.owner === owner)
		&& (!noteSourceOnly || !playback.r1Mode) && (!chip || playback.chip === chip);
	if (owns(pending)) {
		request++;
		pending = null;
	}
	const clipEnd = owns(clip) ? releaseClip() : undefined;
	const r1End = !noteSourceOnly && chip !== 'sm511' && (owner === undefined || owner === sm510CodeOwner) ? releaseCodeR1() : undefined;
	const end = clipEnd === undefined ? r1End : Math.max(clipEnd, r1End ?? 0);
	if (!clip && !pending && !codeR1?.enabled && (end !== undefined || owner === undefined)) status.textContent = 'Stopped';
	syncTransport();
	return end;
}

function releaseMelody() {
	if (!melodyClip) return;
	const { source, gain } = melodyClip;
	const now = audio.currentTime, end = now + .008;
	melodyClip = null;
	gain.gain.setValueAtTime(1, now);
	gain.gain.linearRampToValueAtTime(0, end);
	source.stop(end);
	return end;
}

function stopMelody(owner) {
	const owns = playback => playback && (owner === undefined || playback.owner === owner);
	const canceled = owns(melodyPending);
	if (canceled) melodyPending = null;
	const end = owns(melodyClip) ? releaseMelody() : undefined;
	if (canceled || end !== undefined) {
		sm511Status.textContent = 'Stopped';
		syncTransport();
		drawWave();
	}
	return end;
}

async function playMelody(commands, owner) {
	cancelPendingChipWork('sm511');
	performance.cancelPending('sm511');
	const token = { owner };
	melodyPending = token;
	sm511Status.textContent = 'Preparing melody';
	syncTransport();
	try {
		await ensureAudio();
		const core = await prepareSm510();
		if (melodyPending !== token) return false;
		const samples = renderSm511Melody(core, commands, audio.sampleRate);
		const previous = releaseMelody();
		if (!samples.length) {
			melodyPending = null;
			sm511Status.textContent = 'Stopped';
			syncTransport();
			drawWave();
			return false;
		}
		const source = audio.createBufferSource(), gain = audio.createGain();
		source.buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
		source.buffer.copyToChannel(samples, 0);
		source.connect(gain);
		gain.connect(mix.sm511.output);
		const heldUntil = heldChip === 'sm511' ? audio.currentTime + .008 : audio.currentTime;
		if (heldChip === 'sm511') performance.stopAll();
		const start = Math.max(heldUntil, previous ?? 0, stopPlayback(undefined, { chip: 'sm511' }) ?? 0);
		const current = { source, gain, owner };
		source.onended = () => {
			source.disconnect();
			gain.disconnect();
			if (melodyClip !== current) return;
			melodyClip = null;
			sm511Status.textContent = 'Melody finished';
			syncTransport();
			drawWave();
		};
		source.start(start);
		melodyClip = current;
		melodyPending = null;
		sm511Status.textContent = 'Playing melody';
		syncTransport();
		drawWave();
		return true;
	} catch (error) {
		if (melodyPending !== token) return false;
		melodyPending = null;
		sm511Status.textContent = error.message;
		syncTransport();
		throw error;
	}
}

function restartPattern() {
	const current = pending ?? clip;
	if (current?.kind === 'pattern')
		void start('pattern', { owner: current.owner, loopOverride: current.loopOverride, chip: current.chip });
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
	masterMix.value = volume.value;
	byId('buzzerMasterMixValue').value = `${volume.value}%`;
}

function refreshStep(index) {
	const { element, button, select } = rows[index];
	const note = notes[index];
	select.value = note === null ? '' : String(note);
	button.setAttribute('aria-label', `Preview step ${index + 1} ${note === null ? 'rest' : displayNote(note)}`);
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
		void start('preview', { step: index });
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
masterMix.addEventListener('input', () => {
	volume.value = masterMix.value;
	volume.dispatchEvent(new Event('input'));
});
masterMix.addEventListener('change', () => workspace.patternChanged());
for (const [chip, channel] of Object.entries(mix)) {
	const updateMix = () => {
		channel.readout.value = `${channel.level.value}%`;
		channel.output?.gain.setTargetAtTime(mixLevel(chip), audio.currentTime, .008);
	};
	channel.level.addEventListener('input', updateMix);
	channel.mute.addEventListener('change', updateMix);
}
loop.addEventListener('change', () => workspace.patternChanged());
play.addEventListener('click', () => void start('pattern'));
stop.addEventListener('click', () => stopPlayback());
sm510Play.addEventListener('click', () => void start('sm510', { owner: sm510Owner, r1Mode: DK52_R }));
sm510Stop.addEventListener('click', () => stopPlayback(sm510Owner));
sm511Play.addEventListener('click', () => void playMelody(Uint8Array.from(SM511_DEMO), sm511DemoOwner).catch(error => setStatus(error.message)));
sm511Stop.addEventListener('click', () => stopMelody());

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

async function exportWav() {
	const sampleRate = 48000;
	const chip = selectedChip;
	const mode = toneSource.value;
	const core = chip === 'sm511' || mode !== EQUAL_TEMPERAMENT ? await prepareSm510() : null;
	const { samples } = renderSequence(sampleRate, chip, mode, core);
	const bytes = encodeWav({ sampleRate, channels: [samples] }, { gain: Number(volume.value) / 100 * mixLevel(chip) });
	const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = 'tetorica-lcd-buzzer.wav';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	if (!clip && !pending) status.textContent = 'WAV exported';
	setStatus('WAV exported');
}
for (const id of ['download', 'buzzerMenuWav'])
	byId(id).addEventListener('click', () => void exportWav().catch(error => setStatus(error.message)));

function setStatus(message) { byId('workspace-status').textContent = message; }
function stopPerformance() { stopPlayback(); stopMelody(); performance.stopAll(); }
const performance = setupBuzzerPerformance({
	document, ensureAudio,
	canPlayKeyboard: () => sequencerPanel.hidden,
	displayNote,
	getChip: () => selectedChip,
	onRequestNote: cancelPendingChipWork,
	getOutput: chip => ({ context: audio, master: mix[chip].output, chip }),
	async prepareTone(frequency, context, note, chip) {
		const mode = toneSource.value;
		if (chip === 'sm510' && mode === EQUAL_TEMPERAMENT) return null;
		const core = await prepareSm510();
		let samples;
		if (chip === 'sm511') samples = renderSm511NoteCycle(core, note);
		else if (mode === DIRECT_R) {
			const half = core.directHalfCycles(frequency);
			samples = core.renderDirectNote(half, half * 2 * TICKS_PER_MACHINE_CYCLE, MASTER_CLOCK_HZ);
		} else {
			const start = R_WRITE_CYCLES * TICKS_PER_MACHINE_CYCLE;
			samples = core.renderR1(Uint32Array.of(start, 1), start + R1_DIVISOR, MASTER_CLOCK_HZ).subarray(start);
		}
		const buffer = context.createBuffer(1, samples.length, MASTER_CLOCK_HZ);
		buffer.copyToChannel(samples, 0);
		return { buffer, startup: chip === 'sm510' ? R_WRITE_CYCLES / MACHINE_CYCLE_HZ : 0 };
	},
	onBeforeNote(chip) {
		const end = stopPlayback(undefined, { chip });
		return chip === 'sm511' ? Math.max(end ?? 0, stopMelody() ?? 0) : end;
	},
	onNoteChange(note, chip) {
		heldNote = note;
		heldChip = note === null ? null : chip;
		drawWave();
		if (!clip && !pending) status.textContent = note === null ? 'Ready' : `Playing ${displayNote(note, chip)}`;
	},
	onError: error => setStatus(error.message),
});
toneSource.addEventListener('change', () => {
	stopPlayback(undefined, { noteSourceOnly: true, chip: 'sm510' });
	if (heldChip !== 'sm511') performance.stopAll();
	toneSourceDetail.textContent = toneHints[toneSource.value];
	try { localStorage.setItem(tonePreference, toneSource.value); } catch {}
	drawWave();
	if (toneSource.value === DIRECT_R) void prepareSm510().catch(error => setStatus(error.message));
});
if (toneSource.value === DIRECT_R) void prepareSm510().catch(error => setStatus(error.message));

new ResizeObserver(drawWave).observe(canvas);
loadPattern(0);
workspace = setupBuzzerWorkspace({
	document, setStatus, getPattern, stopPerformance,
	applyPattern(pattern) { applyPattern(pattern); restartPattern(); },
	getStarterCode: () => BUZZER_STARTER,
});
const synthButton = byId('synthWorkspaceSynthButton'), codeButton = byId('synthWorkspaceCodeButton');
const keyboardPanel = byId('synthKeyboardPanel');
const keyboardTab = byId('synthInputKeyboardTab'), codeTab = byId('synthInputCodeTab');
const sequencerTab = byId('buzzerStepSequencerTab');
const inputTabs = [keyboardTab, codeTab, sequencerTab];
const chipTabs = [
	['sm510', byId('buzzerSm510Tab'), byId('buzzerSm510Panel')],
	['sm511', byId('buzzerSm511Tab'), byId('buzzerSm511Panel')],
	['mixer', byId('buzzerMixerTab'), byId('buzzerMixerPanel')],
];

for (const [view, tab] of chipTabs) tab.addEventListener('click', () => {
	if (view !== 'mixer') {
		selectedChip = view;
		performance.refreshLabels();
		for (const index of rows.keys()) refreshStep(index);
		if (view === 'sm511') void prepareSm510().catch(error => setStatus(error.message));
	}
	for (const [name, button, panel] of chipTabs) {
		button.setAttribute('aria-selected', String(name === view));
		button.tabIndex = name === view ? 0 : -1;
		panel.hidden = name !== view;
	}
	tab.focus({ preventScroll: true });
	drawWave();
});

function showInputView(view) {
	const selectedTab = view === 'sequencer' ? sequencerTab : view === 'code' ? codeTab : keyboardTab;
	for (const tab of inputTabs) {
		tab.setAttribute('aria-selected', String(tab === selectedTab));
		tab.tabIndex = tab === selectedTab ? 0 : -1;
	}
	sequencerPanel.hidden = view !== 'sequencer';
	keyboardPanel.hidden = view !== 'keyboard';
	if (view === 'sequencer') performance.stopKeyboard();
}

const controls = setupBuzzerCode({
	workspace, performance, ensureAudio, setStatus,
	now: () => audio?.currentTime ?? 0,
	sequence: {
		getPattern, update: updatePattern,
		play: (owner, loopOverride) => start('pattern', { owner, loopOverride }),
		stop: stopPlayback,
	},
	r1: {
		prepare: prepareSm510,
		write: writeCodeR1,
		playCycles: (r1Plan, r1Mode) => start('sm510-plan', { owner: sm510CodeOwner, r1Plan, r1Mode }),
		stop: () => stopPlayback(sm510CodeOwner),
	},
	melody: {
		play: commands => playMelody(commands, sm511CodeOwner),
		stop: () => stopMelody(sm511CodeOwner),
	},
	onExpandedChange(expanded) {
		codeButton.setAttribute('aria-pressed', String(expanded));
		synthButton.setAttribute('aria-pressed', String(!expanded));
	},
	onViewChange: showInputView,
});
sequencerTab.addEventListener('click', async () => {
	sequencerTab.focus();
	try {
		if (await controls.setMode('keyboard', { focusEditor: false })) {
			showInputView('sequencer');
			sequencerTab.focus({ preventScroll: true });
		}
	} catch (error) { setStatus(error.message); }
});
function navigateTabs(tabList, tabs) {
	tabList.addEventListener('keydown', event => {
		const index = tabs.indexOf(event.target);
		if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const last = tabs.length - 1;
		const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
			: (index + (event.key === 'ArrowRight' ? 1 : last)) % tabs.length;
		tabs[next].click();
	}, true);
}
navigateTabs(byId('buzzerChipTabs'), chipTabs.map(([, tab]) => tab));
navigateTabs(byId('buzzerInputTabs'), inputTabs);
codeButton.addEventListener('click', async () => {
	try {
		if (await controls.setExpanded(true, { focusEditor: false })) codeTab.focus({ preventScroll: true });
	} catch (error) { setStatus(error.message); }
});
synthButton.addEventListener('click', async () => {
	try {
		await controls.setExpanded(false, { focusEditor: false });
		if (await controls.setMode('keyboard', { focusEditor: false })) synthButton.focus({ preventScroll: true });
	} catch (error) { setStatus(error.message); }
});
window.addEventListener('pagehide', () => { stopPerformance(); void controls.stop(); });
