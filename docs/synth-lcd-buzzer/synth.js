// SPDX-License-Identifier: BSD-3-Clause
import { NOTE_OPTIONS, PATTERNS, validateBuzzerPattern } from './buzzer.js';
import { encodeWav } from '../js/wav.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import { BUZZER_STARTER, setupBuzzerCode } from './code.js';
import { setupBuzzerWorkspace } from './files.js';
import { setupBuzzerPerformance } from './performance.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import {
	DIRECT_R, DK52_R, GATE_PRESETS, GATE_STEP_COUNT,
	MACHINE_CYCLE_HZ, MASTER_CLOCK_HZ, R1_DIVISOR, R1_HZ,
	buildSm510Pulse, connectRChannels, createSm510AudioCore, createRVoice, readRAtTick, renderR1Pattern, renderR1Timeline, renderSm510Notes,
} from './sm510.js';
import {
	SM511_PRE_SECONDS, createSm511Controller, formatSm511MelodyCode, renderSm511Melody, renderSm511CommandCycle, renderSm511Pattern,
	sm511Command, sm511CommandLabel, sm511Label, sm511MelodyDuration, traceSm511Melody,
} from './sm511.js';
import { createSm511ControlAudio } from './sm511-control-audio.js';
import { setupSm511MelodyEditor } from './melody_editor.js';
import { createTimedSchedule } from './timed-schedule.js';

const byId = id => document.getElementById(id);
const fetchSm510 = window.fetch.bind(window, new URL('./sm510.wasm?v=sm511-control', import.meta.url));
const volume = byId('volume'), status = byId('status');
const mix = Object.fromEntries(['sm510', 'sm511'].map(chip => [chip, {
	level: byId(chip + 'Mix'), mute: byId(chip + 'Mute'), readout: byId(chip + 'MixValue'), output: null,
}]));
const canvas = byId('waveform'), drawing = canvas.getContext('2d');
const pitch = byId('pitch');
const outputCanvas = byId('outputScope'), outputDrawing = outputCanvas.getContext('2d');
const outputScopeLabel = byId('outputScopeLabel');
const scopeButtons = [...document.querySelectorAll('[data-scope-mode]')];
const outputVisualizer = createSynthOutputVisualizer({
	background: '#a7ab79', grid: '#59603f80', labels: '#343a24', trace: '#202b19',
});
let scopeMode = 'pulse', scopeFrame = null;
const keyTracking = byId('sm510KeyTracking');
const pulseCycles = byId('sm510PulseCycles'), pulseDriveValue = byId('sm510PulseDriveValue');
const dutyControl = byId('sm510Duty'), dutyValue = byId('sm510DutyValue');
const continuousGate = byId('sm510ContinuousGate');
const pulsePins = [byId('sm510PulseR1'), byId('sm510PulseR2')];
let pulseDrive = 1, manualPulseCycles = pulseCycles.valueAsNumber / 2, dividerContinuous = false, heldPulse;
const rMonitorButtons = [byId('sm510MonitorR1'), byId('sm510MonitorR2'), byId('sm510MonitorDiff')];
const rMonitorModes = [
	{ label: 'R1', weights: [1, 0] },
	{ label: 'R2', weights: [0, 1] },
	{ label: 'R1 − R2', weights: [1, -1] },
];
let rMonitor = rMonitorModes[0], rMonitorOutputs;
const toneHints = {
	[DIRECT_R]: 'Duty sets the share of the period spent in the R1 phase. When driven, R2 is high in the other phase.',
	[DK52_R]: 'Gate duty sets how long the CPU enables the 4,096 Hz carrier. At 100% or in Continuous mode, one R write holds the gate open.',
};
const tonePreference = 'tetorica-sm510-tone-source';
const dutyPreferences = { [DIRECT_R]: 'tetorica-sm510-direct-duty', [DK52_R]: 'tetorica-sm510-dk52-duty' };
const dutyPercentages = { [DIRECT_R]: 50, [DK52_R]: 50 };
const chipPreference = 'tetorica-buzzer-selected-chip';
let toneMode = DIRECT_R, selectedChip = 'sm510';
try {
	const rememberedMode = localStorage.getItem(tonePreference);
	const rememberedChip = localStorage.getItem(chipPreference);
	for (const [mode, key] of Object.entries(dutyPreferences)) {
		const rememberedDuty = Number(localStorage.getItem(key) ?? dutyPercentages[mode]);
		if (Number.isInteger(rememberedDuty * 2) && rememberedDuty >= 0 && rememberedDuty <= 100)
			dutyPercentages[mode] = rememberedDuty;
	}
	if (rememberedChip === 'lcd-buzzer') {
		localStorage.setItem(chipPreference, selectedChip);
		localStorage.setItem(tonePreference, toneMode);
	} else {
		if (Object.hasOwn(toneHints, rememberedMode)) toneMode = rememberedMode;
		if (Object.hasOwn(mix, rememberedChip)) selectedChip = rememberedChip;
	}
} catch {}
const sm510Play = byId('sm510Play'), sm510Stop = byId('sm510Stop'), sm510Controls = byId('sm510Controls');
const sm510Preset = byId('sm510Preset'), sm510StepTime = byId('sm510StepTime'), sm510StepValue = byId('sm510StepValue');
const sm510Gates = Array(GATE_STEP_COUNT).fill(false), sm510Buttons = [];
const sm511Play = byId('sm511Play'), sm511Stop = byId('sm511Stop'), sm511Status = byId('sm511Status');
const sm511RomStart = byId('sm511RomStart'), sm511RomStartValue = byId('sm511RomStartValue');
const sm511RomRepeat = byId('sm511RomRepeat');
const sm511CodePreview = byId('sm511CodePreview'), sm511CopyStatus = byId('sm511CopyStatus');
const romEditor = setupSm511MelodyEditor({
	document,
	onChange() {
		clearRomCopy();
		workspace?.melodyChanged();
		queueRomRefresh();
	},
});
const sm511Pitch = byId('sm511Pitch'), sm511KeyTracking = byId('sm511KeyTracking');
const sm511Repeat = byId('sm511Repeat');
const sm511Drive = byId('sm511PulseR'), sm511DriveValue = byId('sm511PulseDriveValue');
let sm511DriveEnabled = true, sm511PinGain;
const sm511OctaveButtons = [...document.querySelectorAll('[data-rom-octave]')];
const sm511LengthButtons = [...document.querySelectorAll('[data-rom-length]')];
let sm511ManualPitch = 0x02, sm511LongNote = false, heldRomTone, lastRomCommand;
const noteLabels = new Map(NOTE_OPTIONS.map(({ value, label }) => [value, label]));
let pattern = validateBuzzerPattern({ notes: PATTERNS[0].notes, bpm: PATTERNS[0].bpm, gate: .65, volume: .6, loop: true });
let audio, master, clip = null, pending = null, request = 0, frame = 0;
const audioTime = () => audio?.currentTime ?? 0;
// Leave time to submit both sources before their shared audio-clock start.
const scheduler = createTimedSchedule({ nextStartTime: () => audioTime() + .02 });
let activeStep = -1, activeR1Step = -1, heldNote = null;
let heldChip = null, heldToneMode, melodyClip = null, melodyPending = null;
let workspace, controls;
let workspaceExpanded = false, showingExpandedChip = false;
let codeActive = false, romStarting = false, romRequest = 0, handoffEnd = 0;
let romWaitAddress = null;
let romRefreshFrame = null, romRefreshedAt = -Infinity;
let rVoice, rMode, rValue = 0, wasmLoading, coreLoading, audioCore, sm510Module;
let sm511Control = null;
const sm510Owner = Symbol('SM510 R1 demo');
const sm510CodeOwner = Symbol('SM510 Code');
const sm511EditorOwner = Symbol('SM511 Melody ROM editor');
const sm511CodeOwner = Symbol('SM511 Code');
const transportRelease = .008;
const romRefreshIntervalMs = Math.max(SM511_PRE_SECONDS, transportRelease) * 1000;

function displayNote(note, chip = selectedChip, tone) {
	if (chip !== 'sm511') return noteLabels.get(note);
	return tone?.command === undefined ? sm511Label(note) : sm511CommandLabel(tone.command);
}
const mixLevel = chip => mix[chip].mute.checked ? 0 : Number(mix[chip].level.value) / 100;
const chipOutput = chip => chip === 'sm511' ? sm511PinGain : mix[chip].output;
const formatHz = frequency => frequency.toLocaleString('en-US', { maximumFractionDigits: 2 });
const formatDuty = duty => `${formatHz(duty * 100)}%`;
const requestedDuty = mode => dutyPercentages[mode] / 100;
const getPulseTiming = (core, mode, halfCycles) => core.pulseTiming(halfCycles, requestedDuty(mode));

function syncTransport() {
	const playingR1 = clip?.kind === 'sm510' || pending?.kind === 'sm510';
	const playingRom = romStarting || romWaitAddress !== null || melodyClip?.owner === sm511EditorOwner;
	controls?.setExternalStopAvailable(playingRom);
	sm510Play.disabled = playingR1 || !sm510Gates.some(Boolean);
	sm510Stop.disabled = !playingR1;
	sm510Controls.disabled = playingR1;
	sm511Play.disabled = playingRom;
	sm511Stop.disabled = !playingRom && !melodyClip && !melodyPending && !sm511Control && !codeActive;
}

function currentR() {
	if (clip?.r1Plan) {
		const elapsed = audio.currentTime - clip.start;
		const position = clip.source.loop && elapsed >= 0 ? elapsed % clip.duration : elapsed;
		const tick = Math.floor(position * MASTER_CLOCK_HZ);
		return readRAtTick(clip.r1Plan, tick);
	}
	if (clip?.kind === 'sm510') return sm510Gates[activeR1Step] ? 1 : 0;
	return rValue;
}

function drawWave() {
	const note = heldNote ?? pattern.notes[Math.max(0, activeStep)];
	const monitor = clip?.kind === 'sm510' ? rMonitorModes[0] : rMonitor;
	const latch = currentR();
	const r2Polarity = (clip?.r1Mode ?? rMode) === DK52_R ? -1 : 1;
	const rAmplitude = (latch & 1) * monitor.weights[0] + (latch >> 1) * monitor.weights[1] * r2Polarity;
	const showingR = rMode && (rAmplitude || (selectedChip === 'sm510' && !heldChip && !clip && !melodyClip));
	const rawMode = showingR ? rMode : clip?.r1Mode;
	const pulse = rawMode ? null : heldPulse;
	const idleInstrument = !heldChip && !clip && !rawMode && !melodyClip;
	const idlePulse = idleInstrument && selectedChip === 'sm510';
	const chip = rawMode ? 'sm510' : heldChip ?? clip?.chip ?? selectedChip;
	const mode = rawMode ?? (heldChip ? heldToneMode : clip?.toneMode) ?? toneMode;
	const sm511 = chip === 'sm511';
	const sm511DriveOff = sm511 && !sm511DriveEnabled;
	const idleRom = idleInstrument && sm511;
	const showingMelody = sm511 && melodyClip && heldNote === null && !clip;
	const target = note === null ? null : noteToHz(note);
	const romCommand = sm511 && note !== null ? heldRomTone?.command ?? sm511Command(note) : null;
	const directTiming = !rawMode && mode === DIRECT_R ? pulse?.timing ?? clip?.directPulses?.[activeStep] : null;
	const sounding = rawMode ? rAmplitude !== 0 : !sm511DriveOff && target !== null;
	const frequency = !idlePulse && !idleRom && !showingMelody && sounding && (sm511 ? audioCore?.sm511PitchHz(romCommand)
		: mode === DK52_R ? R1_HZ : directTiming?.frequency);
	pitch.title = pulse ? '8 ms waveform view' : directTiming ? `${directTiming.periodCycles} machine cycles per period` : '';
	if (pulse) {
		const timing = pulse.timing;
		if (pulse.heldLevel !== undefined) {
			const state = pulse.heldLevel > 0 ? 'R1 high' : pulse.heldLevel < 0 ? 'R2 high' : 'R1 and R2 low';
			pitch.textContent = `Direct R · ${state}`;
		} else if (directTiming) pitch.textContent = `CPU pulse · ${formatHz(timing.frequency)} Hz · ${formatDuty(timing.duty)} duty`;
		else if (timing?.frequency) pitch.textContent = `4,096 Hz · ${formatHz(timing.frequency)} Hz gate`;
		else if (timing?.duty === 0) pitch.textContent = 'DK-52 · Gate closed';
		else pitch.textContent = '4,096 Hz · Continuous';
	} else if (idlePulse) pitch.textContent = 'CPU pulse · Ready';
	else if (sm511DriveOff) pitch.textContent = 'SM511 · R off';
	else if (sm511 && sm511Control) pitch.textContent = 'SM511 · CPU control';
	else if (idleRom) pitch.textContent = 'SM511 · Ready';
	else if (showingMelody) pitch.textContent = 'SM511 · Melody ROM';
	else if (rawMode === DIRECT_R) {
		const differentialLevels = ['R2 higher', '0 V', 'R1 higher'];
		const level = monitor === rMonitorModes[2] ? differentialLevels[rAmplitude + 1] : sounding ? 'High' : 'Low';
		pitch.textContent = `Direct ${monitor.label} · ${level}`;
	} else if (frequency && rawMode) pitch.textContent = `SM510 ${monitor.label} · 4,096 Hz`;
	else if (frequency && directTiming) pitch.textContent = `${displayNote(note, chip)} · ${formatHz(frequency)} Hz · ${formatDuty(directTiming.duty)} duty`;
	else if (frequency) pitch.textContent = `${sm511 ? sm511CommandLabel(romCommand) : displayNote(note, chip)} · ${frequency.toFixed(2)} Hz`;
	else if (!sounding) pitch.textContent = rawMode ? `SM510 ${monitor.label} · Off` : 'Rest · silence';
	else pitch.textContent = `${displayNote(note, chip)} · ${sm511 ? 'SM511' : 'Direct R'}`;
	if (canvas.hidden) return;
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
	if (pulse || frequency) {
		const sampleRate = rawMode ? MASTER_CLOCK_HZ : 48000;
		const count = pulse ? Math.round(.008 * MASTER_CLOCK_HZ) : rawMode ? 4 * R1_DIVISOR : Math.round(.012 * sampleRate);
		const pulseSamples = pulse?.buffer.getChannelData(0);
		const waveform = sm511 ? renderSm511CommandCycle(audioCore, romCommand) : null;
		const level = frame => {
			if (pulseSamples) return (pulse.heldLevel ?? pulseSamples[frame % pulseSamples.length]) * 1.1;
			const highPhase = frame * frequency / sampleRate % 1 < (directTiming?.duty ?? .5);
			if (rawMode) return (highPhase ? -rAmplitude : rAmplitude) * .18;
			const high = waveform ? waveform[Math.floor(frame * MASTER_CLOCK_HZ / sampleRate) % waveform.length] > 0 : highPhase;
			return high ? .24 : -.24;
		};
		let y = center - level(0) * height;
		drawing.moveTo(left, y);
		for (let i = 1; i < count; i++) {
			const next = center - level(i) * height;
			if (next === y) continue;
			const x = left + i * (right - left) / count;
			drawing.lineTo(x, y);
			drawing.lineTo(x, next);
			y = next;
		}
		drawing.lineTo(right, y);
	} else {
		const y = rawMode === DIRECT_R ? center - rAmplitude * height * .24 : center;
		drawing.moveTo(left, y);
		drawing.lineTo(right, y);
	}
	drawing.stroke();
}

function drawOutputScope() {
	if (outputCanvas.hidden || !outputDrawing) return;
	const { width, height } = outputCanvas.getBoundingClientRect();
	if (!width || !height) return;
	const scale = window.devicePixelRatio || 1;
	const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
	if (outputCanvas.width !== pixelWidth) outputCanvas.width = pixelWidth;
	if (outputCanvas.height !== pixelHeight) outputCanvas.height = pixelHeight;
	outputDrawing.setTransform(scale, 0, 0, scale, 0, 0);
	outputVisualizer.draw({ width, height }, outputDrawing, scopeMode);
}

function scheduleOutputScope() {
	if (scopeFrame !== null || outputCanvas.hidden || audio?.state !== 'running') return;
	scopeFrame = requestAnimationFrame(() => {
		scopeFrame = null;
		drawOutputScope();
		scheduleOutputScope();
	});
}

function showStep(index) {
	if (activeStep === index) return;
	activeStep = index;
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
	if (clip.r1Plan) {
		const value = currentR();
		if (value !== clip.lastR) {
			clip.lastR = value;
			drawWave();
		}
		frame = requestAnimationFrame(animate);
		return;
	}
	const isR1 = clip.kind === 'sm510';
	const elapsed = Math.max(0, audio.currentTime - clip.start);
	const position = clip.source.loop ? elapsed % clip.duration : elapsed;
	const elapsedFrames = Math.floor(position * audio.sampleRate);
	// Match the renderer's rounded boundaries, including tempos with fractional frames.
	let index = (isR1 ? sm510Gates : pattern.notes).length - 1;
	while (index > 0 && elapsedFrames < (clip.boundaries?.[index] ?? Math.round(index * clip.stepFrames))) index--;
	if (isR1) showR1Step(index);
	else showStep(index);
	frame = requestAnimationFrame(animate);
}

function releaseClip() {
	if (!clip) return;
	const previous = clip, now = audio.currentTime, end = now + transportRelease;
	clip = null;
	cancelAnimationFrame(frame);
	previous.gain.gain.setValueAtTime(1, now);
	previous.gain.gain.linearRampToValueAtTime(0, end);
	previous.source.stop(end);
	showStep(-1);
	showR1Step(-1);
	if (previous.r1Plan) drawWave();
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
		outputVisualizer.connect(audio, [master]);
		audio.addEventListener('statechange', scheduleOutputScope);
		for (const [chip, channel] of Object.entries(mix)) {
			channel.output = audio.createGain();
			channel.output.gain.value = mixLevel(chip);
			channel.output.connect(master);
		}
		sm511PinGain = audio.createGain();
		sm511PinGain.gain.value = Number(sm511DriveEnabled);
		sm511PinGain.connect(mix.sm511.output);
		rMonitorOutputs = rMonitor.weights.map(weight => {
			const output = audio.createGain();
			output.gain.value = weight;
			output.connect(mix.sm510.output);
			return output;
		});
	}
	if (audio.state !== 'running') await audio.resume();
	scheduleOutputScope();
}

function loadSm510Wasm() {
	wasmLoading ??= fetchSm510().then(response => {
		if (!response.ok) throw new Error(`Unable to load the SM510 audio core (HTTP ${response.status}).`);
		return response.arrayBuffer();
	}).catch(error => { wasmLoading = undefined; throw error; });
	return wasmLoading;
}

function prepareSm510() {
	coreLoading ??= loadSm510Wasm().then(async binary => {
		const { instance, module } = await WebAssembly.instantiate(binary);
		sm510Module = module;
		audioCore = createSm510AudioCore(instance.exports);
		refreshPulseTiming();
		drawWave();
		return audioCore;
	}).catch(error => { coreLoading = undefined; wasmLoading = undefined; throw error; });
	return coreLoading;
}

const targetHz = note => note === null ? null : noteToHz(note);
function renderSequence(sampleRate, chip, mode, core) {
	const { notes, bpm, gate } = pattern;
	if (chip === 'sm511') return renderSm511Pattern(core, notes, { stepSeconds: 30 / bpm, gate, sampleRate });
	return renderSm510Notes(core, mode, notes.map(targetHz), { stepSeconds: 30 / bpm, gate, sampleRate, duty: requestedDuty(mode) });
}

function renderCycleSequence(core, plan, mode) {
	const direct = mode === DIRECT_R, { sampleRate } = audio;
	return {
		samples: renderR1Timeline(plan, sampleRate, direct ? core.renderDirectR1 : core.renderR1),
		r2Samples: renderR1Timeline(plan, sampleRate, direct ? core.renderDirectR2 : core.renderR2),
	};
}

function createPlaybackBuffer(samples, r2Samples, repeatSeconds) {
	const { sampleRate } = audio;
	const frames = repeatSeconds === undefined ? samples.length
		: Math.max(samples.length, Math.round(repeatSeconds * sampleRate));
	if (!frames) return null;
	const buffer = audio.createBuffer(r2Samples ? 2 : 1, frames, sampleRate);
	buffer.copyToChannel(samples, 0);
	if (r2Samples) buffer.copyToChannel(r2Samples, 1);
	return buffer;
}

async function start(kind, { owner, loopOverride, r1Plan, r1Mode, chip = r1Mode ? 'sm510' : selectedChip, fixedMode }) {
	cancelPendingChipWork(chip);
	performance.cancelPending(chip);
	const token = ++request;
	const mode = r1Mode ?? fixedMode ?? toneMode;
	pending = { kind, owner, loopOverride, r1Mode, chip, fixedMode };
	syncTransport();
	try {
		await ensureAudio();
		const core = await prepareSm510();
		if (token !== request) return false;
		const { sampleRate } = audio;
		let rendered;
		if (kind === 'sm510')
			rendered = renderR1Pattern(sm510Gates, { stepMs: Number(sm510StepTime.value), sampleRate }, core.renderR1);
		else if (r1Plan) rendered = renderCycleSequence(core, r1Plan, r1Mode);
		else rendered = renderSequence(sampleRate, chip, mode, core);
		const buffer = createPlaybackBuffer(rendered.samples, rendered.r2Samples);
		pending = null;
		playPreparedClip(kind, {
			owner, loopOverride, r1Plan, r1Mode, chip, mode, fixedMode, buffer, rendered,
			loop: kind === 'pattern' && (loopOverride ?? pattern.loop),
			notBefore: scheduler.stop(chip),
		});
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

function playPreparedClip(kind, {
	owner, loopOverride, r1Plan, r1Mode, chip, mode, fixedMode, buffer, loop, rendered, notBefore = 0,
}) {
	const gain = audio.createGain(), source = audio.createBufferSource();
	source.buffer = buffer;
	source.loop = loop;
	const previous = chip === 'sm511' ? stopMelody() : releaseR();
	const time = Math.max(releaseClip() ?? 0, releaseClipAndKeys(chip), previous ?? 0, handoffEnd, notBefore);
	const current = {
		kind, source, gain, owner, loopOverride, r1Plan, r1Mode, chip, toneMode: mode, fixedMode,
		start: time, duration: buffer.duration, stepFrames: rendered?.stepFrames, boundaries: rendered?.boundaries,
		directPulses: rendered?.directPulses,
	};
	source.connect(gain);
	const splitter = r1Plan ? connectRChannels(gain, audio, rMonitorOutputs) : null;
	if (!splitter) gain.connect(chipOutput(chip));
	source.onended = () => {
		source.disconnect();
		gain.disconnect();
		splitter?.disconnect();
		if (clip !== current) return;
		clip = null;
		cancelAnimationFrame(frame);
		showStep(-1);
		showR1Step(-1);
		if (r1Plan) drawWave();
		status.textContent = kind === 'pattern' ? 'Pattern finished' : 'Ready';
		syncTransport();
	};
	source.start(time);
	clip = current;
	if (kind === 'pattern') status.textContent = source.loop ? 'Looping pattern' : 'Playing pattern';
	else if (kind === 'sm510') status.textContent = 'Playing R1 demo';
	else status.textContent = source.loop ? 'Looping SM510 cycle sequence' : 'Playing SM510 cycle sequence';
	animate();
	if (r1Plan) drawWave();
	syncTransport();
	return time;
}

function releaseClipAndKeys(chip) {
	const ownsKeys = !chip || heldChip === chip;
	const heldUntil = ownsKeys && heldNote !== null ? audio.currentTime + transportRelease : audio.currentTime;
	if (ownsKeys) performance.stopAll();
	const clipEnd = !chip || clip?.chip === chip ? releaseClip() : undefined;
	return Math.max(clipEnd ?? audio.currentTime, heldUntil);
}

function releaseR() {
	if (!rMode) return;
	const end = rVoice?.dispose();
	rVoice = undefined;
	rMode = undefined;
	rValue = 0;
	drawWave();
	return end;
}

function writeSm510R(value, core, mode) {
	cancelPendingChipWork('sm510');
	performance.cancelPending('sm510');
	const scheduledEnd = scheduler.stop('sm510');
	const previous = mode !== rMode ? releaseR() : undefined;
	const begin = audio ? Math.max(releaseClipAndKeys('sm510'), previous ?? 0, scheduledEnd ?? 0, handoffEnd) : 0;
	rValue = value;
	rMode = mode;
	if (value && !rVoice) {
		const direct = mode === DIRECT_R;
		rVoice = createRVoice(audio, rMonitorOutputs,
			direct ? core.renderDirectR1 : core.renderR1, direct ? core.renderDirectR2 : core.renderR2);
	}
	rVoice?.setValue(value, begin);
	if (!clip && !pending) status.textContent = value ? 'SM510 R active' : 'Ready';
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

function stopPlayback(owner, { chip } = {}) {
	const owns = playback => playback && (owner === undefined || playback.owner === owner)
		&& (!chip || playback.chip === chip);
	if (owns(pending)) {
		request++;
		pending = null;
	}
	const clipEnd = owns(clip) ? releaseClip() : undefined;
	const r1End = (!chip || chip === 'sm510') && (owner === undefined || owner === sm510CodeOwner) ? releaseR() : undefined;
	const end = clipEnd === undefined ? r1End : Math.max(clipEnd, r1End ?? 0);
	if (!clip && !pending && !rValue && (end !== undefined || owner === undefined)) status.textContent = 'Stopped';
	syncTransport();
	return end;
}

function cancelRomStart() {
	romRequest++;
	romStarting = false;
}

function stopRomEditor() {
	const wasStarting = romStarting;
	cancelRomStart();
	cancelRomRefresh();
	handoffEnd = Math.max(handoffEnd, stopMelody(sm511EditorOwner) ?? 0);
	if (wasStarting && !melodyClip && !melodyPending) sm511Status.textContent = 'Stopped';
	syncTransport();
}

async function playRomEditor() {
	const token = ++romRequest;
	romStarting = true;
	sm511Status.textContent = 'Preparing melody';
	syncTransport();
	try {
		const retiringCode = codeActive;
		const retired = retiringCode ? controls.stop() : true;
		const [, stopped] = await Promise.all([ensureAudio().then(prepareSm510), retired]);
		if (token !== romRequest) return;
		if (stopped) {
			stopSm511Control();
			if (retiringCode) handoffEnd = Math.max(handoffEnd, audio.currentTime + transportRelease);
			cancelPendingChipWork('sm511');
			performance.cancelPending('sm511');
			playRomSnapshot(romEditor.getMelody(), sm511RomStart.valueAsNumber, {
				notBefore: scheduler.stop('sm511'),
			});
			romRefreshedAt = window.performance.now();
		} else sm511Status.textContent = 'Stopped';
	} catch (error) {
		if (token === romRequest) {
			sm511Status.textContent = error.message;
			setStatus(error.message);
		}
	} finally {
		if (token === romRequest) {
			romStarting = false;
			syncTransport();
		}
	}
}

function resumeRomOffset(current, slots, repeat) {
	// Follow the old clip up to the end of its short release. When Repeat is
	// switched off, finish the current pass even if release crosses its end.
	const now = audio.currentTime, duration = current.source.buffer.duration;
	const fromStart = current.offset + Math.max(0, now - current.start);
	const elapsed = current.source.loop ? fromStart % duration : fromStart;
	const advance = now >= current.start ? transportRelease : 0;
	const cursor = current.source.loop && repeat ? (elapsed + advance) % duration : elapsed + advance;
	const previous = current.rom.slots.findLast(slot => slot.offsetSeconds <= cursor);
	if (!previous || cursor >= previous.offsetSeconds + previous.durationSeconds) return null;
	const edited = slots.find(slot => slot.address === previous.address);
	if (!edited?.durationSeconds) return null;
	return edited.offsetSeconds + Math.min(cursor - previous.offsetSeconds, edited.durationSeconds);
}

function playRomSnapshot(commands, address, { current, notBefore, fadeIn = false } = {}) {
	const loop = sm511RomRepeat.checked;
	const words = Uint8Array.from(commands.slice(address));
	const slots = traceSm511Melody(words, address);
	const buffer = createPlaybackBuffer(renderSm511Melody(audioCore, words, audio.sampleRate));
	let offset = current ? resumeRomOffset(current, slots, loop) : 0;
	if (loop && buffer && (offset === null || offset >= buffer.duration)) offset = 0;
	if (!buffer || offset === null || offset >= buffer.duration) {
		handoffEnd = Math.max(handoffEnd, releaseMelody() ?? 0);
		romWaitAddress = loop && !buffer ? address : null;
		if (romWaitAddress !== null) sm511Status.textContent = `Repeat waiting at ${formatRomAddress(address)}`;
		else sm511Status.textContent = buffer ? 'Melody finished' : `Stop at ${formatRomAddress(address)}`;
		syncTransport();
		drawWave();
		return;
	}
	romWaitAddress = null;
	playPreparedMelody(buffer, sm511EditorOwner, { loop, notBefore, offset, fadeIn, rom: { address, slots } });
}

function queueRomRefresh() {
	if (romRefreshFrame !== null || (!melodyClip?.rom && romWaitAddress === null)) return;
	romRefreshFrame = requestAnimationFrame(refreshRomPlayback);
}

function cancelRomRefresh() {
	if (romRefreshFrame !== null) cancelAnimationFrame(romRefreshFrame);
	romRefreshFrame = null;
}

function refreshRomPlayback(frameTime) {
	romRefreshFrame = null;
	const current = melodyClip?.rom ? melodyClip : null;
	const previousAddress = current?.rom.address ?? romWaitAddress;
	if (previousAddress === null) return;
	// Coalesce seek and ROM inputs. Leave time for the chip's PRE instruction
	// and for the Web Audio handoff before preparing another replacement.
	if (frameTime - romRefreshedAt < romRefreshIntervalMs) {
		queueRomRefresh();
		return;
	}
	const address = sm511RomStart.valueAsNumber;
	const commands = romEditor.getMelody();
	const sameStart = address === previousAddress;
	if (sameStart && current && current.source.loop === sm511RomRepeat.checked &&
		current.rom.slots.every(slot => commands[slot.address] === slot.command)) return;
	try {
		playRomSnapshot(commands, address, { current: sameStart ? current : null, fadeIn: true });
		romRefreshedAt = window.performance.now();
	} catch (error) {
		setStatus(error.message);
	}
}

async function stopTransports() {
	stopRomEditor();
	stopMelody();
	if (codeActive) await controls.stop();
}

function releaseMelody() {
	if (!melodyClip) return;
	const { source, gain, start, fadeIn } = melodyClip;
	const now = audio.currentTime, end = now + transportRelease;
	melodyClip = null;
	if (now < start) {
		source.stop(now);
		return start;
	}
	const level = fadeIn ? Math.min(1, (now - start) / transportRelease) : 1;
	gain.gain.cancelScheduledValues(now);
	gain.gain.setValueAtTime(level, now);
	gain.gain.linearRampToValueAtTime(0, end);
	source.stop(end);
	return end;
}

function stopMelody(owner) {
	const owns = playback => playback && (owner === undefined || playback.owner === owner);
	if (owner === undefined || owner === sm511CodeOwner) stopSm511Control();
	const canceled = owns(melodyPending);
	if (canceled) melodyPending = null;
	const wasWaiting = romWaitAddress !== null && (owner === undefined || owner === sm511EditorOwner);
	if (wasWaiting) romWaitAddress = null;
	const ownedClip = owns(melodyClip) ? melodyClip : null;
	if (wasWaiting || ownedClip?.rom) cancelRomRefresh();
	const end = ownedClip ? releaseMelody() : undefined;
	if (canceled || wasWaiting || end !== undefined) {
		sm511Status.textContent = 'Stopped';
		syncTransport();
		drawWave();
	}
	return end;
}

async function playMelody(commands, owner) {
	stopSm511Control();
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
		const buffer = createPlaybackBuffer(samples);
		const scheduledEnd = scheduler.stop('sm511');
		if (!samples.length) {
			releaseMelody();
			melodyPending = null;
			sm511Status.textContent = 'Stopped';
			syncTransport();
			drawWave();
			return false;
		}
		playPreparedMelody(buffer, owner, { notBefore: scheduledEnd });
		melodyPending = null;
		return true;
	} catch (error) {
		if (melodyPending !== token) return false;
		melodyPending = null;
		sm511Status.textContent = error.message;
		syncTransport();
		throw error;
	}
}

function playPreparedMelody(buffer, owner, { loop = false, notBefore = 0, offset = 0, rom = null, fadeIn = false } = {}) {
	stopSm511Control();
	const source = audio.createBufferSource(), gain = audio.createGain();
	source.buffer = buffer;
	source.loop = loop;
	source.connect(gain);
	gain.connect(sm511PinGain);
	const previous = releaseMelody();
	const start = Math.max(releaseClipAndKeys('sm511'), previous ?? 0, handoffEnd, notBefore);
	const current = { source, gain, owner, start, offset, rom, fadeIn };
	source.onended = () => {
		source.disconnect();
		gain.disconnect();
		if (melodyClip !== current) return;
		melodyClip = null;
		if (rom) cancelRomRefresh();
		sm511Status.textContent = 'Melody finished';
		syncTransport();
		drawWave();
	};
	if (fadeIn) {
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(1, start + transportRelease);
	}
	source.start(start, offset);
	melodyClip = current;
	sm511Status.textContent = loop ? 'Looping melody' : 'Playing melody';
	syncTransport();
	drawWave();
	return start;
}

async function prepareScheduledCycles(r1Plan, r1Mode, repeatSeconds) {
	await ensureAudio();
	const core = await prepareSm510();
	const { samples, r2Samples } = renderCycleSequence(core, r1Plan, r1Mode);
	const duration = r1Plan.end / MASTER_CLOCK_HZ;
	const buffer = createPlaybackBuffer(samples, r2Samples, repeatSeconds);
	return {
		duration,
		play(notBefore) {
			const chip = 'sm510', owner = Symbol('SM510 schedule');
			cancelPendingChipWork(chip);
			performance.cancelPending(chip);
			const startTime = playPreparedClip('sm510-plan', {
				owner, r1Plan, r1Mode, chip, mode: r1Mode, buffer, notBefore,
				loop: repeatSeconds !== undefined,
			});
			return { startTime, stop: () => stopPlayback(owner, { chip }) };
		},
	};
}

async function prepareScheduledMelody(commands, repeatSeconds) {
	await ensureAudio();
	const core = await prepareSm510();
	const samples = renderSm511Melody(core, commands, audio.sampleRate);
	const buffer = samples.length ? createPlaybackBuffer(samples, null, repeatSeconds) : null;
	return makeScheduledMelody(buffer, sm511MelodyDuration(commands), repeatSeconds);
}

async function prepareSm511Instructions({ words, end, events }, repeatSeconds) {
	await ensureAudio();
	await prepareSm510();
	const controller = createSm511Controller(new WebAssembly.Instance(sm510Module).exports);
	const duration = end / MASTER_CLOCK_HZ;
	const samples = new Float32Array(Math.ceil(duration * audio.sampleRate));
	controller.load(words);
	controller.renderInto(samples, audio.sampleRate, events);
	return makeScheduledMelody(createPlaybackBuffer(samples, null, repeatSeconds), duration, repeatSeconds);
}

function makeScheduledMelody(buffer, duration, repeatSeconds) {
	return {
		duration,
		play(notBefore) {
			const owner = Symbol('SM511 schedule');
			cancelPendingChipWork('sm511');
			performance.cancelPending('sm511');
			if (!buffer) {
				stopMelody();
				return { startTime: notBefore, stop: () => {} };
			}
			const startTime = playPreparedMelody(buffer, owner, { loop: repeatSeconds !== undefined, notBefore });
			return { startTime, stop: () => stopMelody(owner) };
		},
	};
}

function stopSm511Control() {
	const current = sm511Control;
	if (!current) return;
	sm511Control = null;
	current.client?.dispose();
	current.gate?.disconnect();
	sm511Status.textContent = 'Stopped';
	syncTransport();
	drawWave();
}

function ensureSm511Control(words) {
	if (sm511Control) return sm511Control.ready;
	const rom = words.slice();
	const previous = stopMelody();
	const scheduledEnd = scheduler.stop('sm511');
	cancelPendingChipWork('sm511');
	performance.cancelPending('sm511');
	const keyEnd = audio ? releaseClipAndKeys('sm511') : 0;
	handoffEnd = Math.max(handoffEnd, previous ?? 0, scheduledEnd ?? 0, keyEnd);
	const current = {};
	sm511Control = current;
	const verify = () => {
		if (sm511Control !== current) throw new DOMException('SM511 playback was replaced.', 'AbortError');
	};
	current.ready = (async () => {
		await ensureAudio();
		const binary = await loadSm510Wasm();
		verify();
		const gate = audio.createGain();
		gate.gain.value = 0;
		gate.connect(sm511PinGain);
		current.gate = gate;
		const client = await createSm511ControlAudio(audio, gate, binary);
		if (sm511Control !== current) client.dispose();
		verify();
		current.client = client;
		await client.activate(rom);
		verify();
		gate.gain.setValueAtTime(1, Math.max(audio.currentTime, handoffEnd));
		sm511Status.textContent = 'SM511 CPU control';
		drawWave();
		return client;
	})().catch(error => {
		if (sm511Control === current) stopSm511Control();
		throw error;
	});
	syncTransport();
	return current.ready;
}

function restartPattern() {
	const current = pending ?? clip;
	if (current?.kind === 'pattern')
		void start('pattern', { owner: current.owner, loopOverride: current.loopOverride, chip: current.chip, fixedMode: current.fixedMode });
}

function getPattern() {
	return { ...pattern, notes: pattern.notes.slice(), volume: Number(volume.value) / 100 };
}

function applyPattern(value) {
	const next = validateBuzzerPattern(value);
	pattern = { ...next, gate: Math.round(next.gate * 100) / 100 };
	volume.value = String(Math.round(next.volume * 100));
	applyVolume();
	drawWave();
	syncTransport();
}

function applyVolume() {
	byId('volume-value').value = `${volume.value}%`;
	master?.gain.setTargetAtTime(Number(volume.value) / 100, audio.currentTime, .008);
}

function updatePattern(settings) {
	applyPattern({ ...getPattern(), ...settings });
	workspace?.patternChanged();
	if ('notes' in settings || 'bpm' in settings || 'gate' in settings || 'loop' in settings) restartPattern();
	return getPattern();
}

volume.addEventListener('input', applyVolume);
volume.addEventListener('change', () => workspace.patternChanged());
for (const [chip, channel] of Object.entries(mix)) {
	const updateMix = () => {
		channel.readout.value = `${channel.level.value}%`;
		channel.output?.gain.setTargetAtTime(mixLevel(chip), audio.currentTime, .008);
	};
	channel.level.addEventListener('input', updateMix);
	channel.mute.addEventListener('change', updateMix);
}
sm510Play.addEventListener('click', () => void start('sm510', { owner: sm510Owner, r1Mode: DK52_R }));
sm510Stop.addEventListener('click', () => stopPlayback(sm510Owner));
sm511Play.addEventListener('click', () => void playRomEditor());
sm511Stop.addEventListener('click', () => void stopTransports());
const formatRomAddress = address => `0x${address.toString(16).toUpperCase().padStart(2, '0')}`;
function refreshRomStart() {
	const address = formatRomAddress(sm511RomStart.valueAsNumber);
	sm511RomStartValue.value = address;
	sm511RomStart.setAttribute('aria-valuetext', address);
	clearRomCopy();
	queueRomRefresh();
}
sm511RomStart.addEventListener('input', refreshRomStart);
sm511RomStart.addEventListener('change', refreshRomStart);
sm511RomRepeat.addEventListener('change', queueRomRefresh);
function clearRomCopy() {
	sm511CodePreview.hidden = true;
	sm511CopyStatus.textContent = '';
}
byId('sm511CopyCode').addEventListener('click', async () => {
	const code = formatSm511MelodyCode(romEditor.getMelody(), sm511RomStart.valueAsNumber);
	try {
		await navigator.clipboard.writeText(code);
		sm511CodePreview.hidden = true;
		sm511CopyStatus.textContent = 'Code copied.';
	} catch {
		sm511CodePreview.value = code;
		sm511CodePreview.hidden = false;
		sm511CodePreview.focus();
		sm511CodePreview.select();
		sm511CopyStatus.textContent = 'Code selected. Copy the text below.';
	}
});
const trackedRomPitch = () => (heldRomTone?.command ?? lastRomCommand ?? sm511ManualPitch) & 0x1f;
const selectedRomPitch = () => sm511KeyTracking.checked ? trackedRomPitch() : sm511ManualPitch;

sm511Drive.addEventListener('click', () => {
	sm511DriveEnabled = !sm511DriveEnabled;
	sm511Drive.setAttribute('aria-pressed', String(sm511DriveEnabled));
	sm511DriveValue.value = sm511DriveEnabled ? '1× swing' : 'Off';
	sm511PinGain?.gain.setValueAtTime(Number(sm511DriveEnabled), audio.currentTime);
	drawWave();
});
function refreshRomNote() {
	const pitch = selectedRomPitch();
	const command = pitch | (sm511LongNote ? 0x20 : 0);
	const note = sm511CommandLabel(command);
	sm511Pitch.value = 0xd - (pitch & 0xf);
	byId('sm511PitchValue').value = note;
	sm511Pitch.setAttribute('aria-valuetext', note);
	byId('sm511Command').value = 'ROM 0x' + command.toString(16).toUpperCase().padStart(2, '0');
	for (const button of sm511OctaveButtons)
		button.setAttribute('aria-pressed', String((button.dataset.romOctave === '1') === Boolean(pitch & 0x10)));
	for (const button of sm511LengthButtons)
		button.setAttribute('aria-pressed', String((button.dataset.romLength === '1') === sm511LongNote));
}
function retuneRomNote() {
	refreshRomNote();
	void performance.retune('sm511').catch(error => setStatus(error.message));
}
function setManualRomPitch(upper) {
	sm511ManualPitch = sm511Command(49 + sm511Pitch.valueAsNumber + (upper ? 12 : 0));
	sm511KeyTracking.checked = false;
	retuneRomNote();
}
sm511Pitch.addEventListener('input', () => setManualRomPitch(Boolean(selectedRomPitch() & 0x10)));
sm511KeyTracking.addEventListener('change', () => {
	if (!sm511KeyTracking.checked) sm511ManualPitch = trackedRomPitch();
	retuneRomNote();
});
sm511Repeat.addEventListener('change', () => {
	if (heldRomTone?.keyboard) retuneRomNote();
});
for (const button of sm511OctaveButtons) button.addEventListener('click', () => {
	setManualRomPitch(button.dataset.romOctave === '1');
});
for (const button of sm511LengthButtons) button.addEventListener('click', () => {
	const longNote = button.dataset.romLength === '1';
	if (sm511LongNote === longNote) return;
	sm511LongNote = longNote;
	if (heldRomTone?.loop === false) retuneRomNote();
	else refreshRomNote();
});
refreshRomNote();

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
	const mode = toneMode;
	const melody = chip === 'sm511' ? Uint8Array.from(romEditor.getMelody()) : null;
	const core = await prepareSm510();
	const samples = melody ? renderSm511Melody(core, melody, sampleRate) : renderSequence(sampleRate, chip, mode, core).samples;
	const pinLevel = chip === 'sm511' ? Number(sm511DriveEnabled) : 1;
	const gain = Number(volume.value) / 100 * mixLevel(chip) * pinLevel;
	const bytes = encodeWav({ sampleRate, channels: [samples] }, { gain });
	const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = melody ? 'tetorica-sm511-melody.wav' : 'tetorica-lcd-buzzer.wav';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	if (!clip && !pending) status.textContent = 'WAV exported';
	setStatus('WAV exported');
}
byId('buzzerMenuWav').addEventListener('click', () => void exportWav().catch(error => setStatus(error.message)));

function setStatus(message) { byId('workspace-status').textContent = message; }
function stopPerformance() { stopRomEditor(); stopPlayback(); stopMelody(); performance.stopAll(); }
const performance = setupBuzzerPerformance({
	document, ensureAudio,
	canPlayKeyboard: () => true,
	displayNote,
	getChip: () => selectedChip,
	onRequestNote(chip) {
		if (chip === 'sm511' && romStarting) stopRomEditor();
		cancelPendingChipWork(chip);
	},
	getOutput: chip => ({ context: audio, master: chipOutput(chip), chip }),
	async prepareTone(frequency, context, note, chip, { keyboard, toneMode: fixedMode }) {
		const core = await prepareSm510();
		const mode = fixedMode ?? toneMode;
		if (chip === 'sm511') {
			const pitch = sm511KeyTracking.checked ? sm511Command(note) : sm511ManualPitch;
			const command = pitch | (sm511LongNote ? 0x20 : 0);
			const singleSlot = keyboard && !sm511Repeat.checked;
			const samples = singleSlot ? renderSm511Melody(core, [command], MASTER_CLOCK_HZ) : renderSm511CommandCycle(core, command);
			const buffer = context.createBuffer(1, samples.length, MASTER_CLOCK_HZ);
			buffer.copyToChannel(samples, 0);
			return { buffer, toneMode: mode, command, keyboard, loop: !singleSlot };
		}
		const direct = mode === DIRECT_R;
		const continuous = !direct && dividerContinuous;
		const halfCycles = continuous ? 0 : keyTracking.checked ? core.directHalfCycles(frequency) : manualPulseCycles;
		const timing = continuous ? null : getPulseTiming(core, mode, halfCycles);
		const plan = buildSm510Pulse(mode, halfCycles, pulseDrive, timing?.highCycles);
		const r1 = renderR1Timeline(plan, MASTER_CLOCK_HZ, direct ? core.renderDirectR1 : core.renderR1);
		const r2 = renderR1Timeline(plan, MASTER_CLOCK_HZ, direct ? core.renderDirectR2 : core.renderR2);
		const buffer = context.createBuffer(1, plan.end - plan.loopStart, MASTER_CLOCK_HZ);
		const samples = buffer.getChannelData(0);
		let heldLevel;
		if (direct && !timing.frequency) {
			// Show the DC level on the scope and send silence to Web Audio.
			heldLevel = r1[plan.loopStart] - r2[plan.loopStart];
		} else {
			for (let frame = 0; frame < samples.length; frame++) {
				const tick = plan.loopStart + frame;
				samples[frame] = r1[tick] - r2[tick];
			}
		}
		return { buffer, toneMode: mode, halfCycles, timing, heldLevel, startup: plan.loopStart / MASTER_CLOCK_HZ };
	},
	onBeforeNote(chip) {
		const scheduledEnd = scheduler.stop(chip);
		const end = stopPlayback(undefined, { chip });
		return Math.max(end ?? 0, scheduledEnd ?? 0, chip === 'sm511' ? stopMelody() ?? 0 : 0, handoffEnd);
	},
	onNoteChange(note, chip, mode, tone) {
		heldNote = note;
		heldChip = note === null ? null : chip;
		heldToneMode = mode;
		heldPulse = chip === 'sm510' ? tone : null;
		heldRomTone = chip === 'sm511' ? tone : null;
		if (heldRomTone) lastRomCommand = heldRomTone.command;
		refreshRomNote();
		refreshPulseTiming();
		drawWave();
		if (!clip && !pending) status.textContent = note === null ? 'Ready' : `Playing ${displayNote(note, chip, tone)}`;
	},
	onError: error => setStatus(error.message),
});
function refreshToneSource() {
	byId('toneSourceDetail').textContent = toneHints[toneMode];
	byId('buzzerR1DemoLink').hidden = toneMode !== DK52_R;
	const direct = toneMode === DIRECT_R;
	byId('sm510DutyLabel').textContent = direct ? 'R1 phase duty' : 'R1 gate duty';
	byId('sm510PulseCyclesLabel').textContent = direct ? 'Pulse period' : 'Gate period';
	dutyControl.value = String(dutyPercentages[toneMode]);
	continuousGate.hidden = direct;
	drawWave();
}
function refreshPulseTiming() {
	const heldCycles = heldToneMode === toneMode ? heldPulse?.halfCycles : undefined;
	const direct = toneMode === DIRECT_R;
	const continuous = !direct && dividerContinuous;
	continuousGate.setAttribute('aria-pressed', String(continuous));
	keyTracking.disabled = pulseCycles.disabled = dutyControl.disabled = continuous;
	dutyValue.value = formatDuty(continuous ? 1 : requestedDuty(toneMode));
	const interval = byId('sm510PulseInterval'), output = byId('sm510PulseTiming');
	if (continuous) {
		interval.value = '0 cycles · Continuous';
		output.textContent = '4,096 Hz carrier · Gate held open';
		return;
	}
	const cycles = keyTracking.checked ? heldCycles : manualPulseCycles;
	pulseCycles.value = 2 * (cycles || manualPulseCycles);
	if (!cycles) {
		interval.value = 'Key tracking';
		output.textContent = 'Play a key to hear the CPU pulse.';
		return;
	}
	const periodCycles = 2 * cycles;
	const intervalMs = periodCycles * 1000 / MACHINE_CYCLE_HZ;
	interval.value = `${periodCycles} cycles · ${intervalMs.toFixed(2)} ms`;
	const timing = audioCore && getPulseTiming(audioCore, toneMode, cycles);
	if (!timing) {
		output.textContent = 'Loading SM510 timing…';
		return;
	}
	const rate = formatHz(timing.frequency), duty = formatDuty(timing.duty);
	if (direct) {
		const outputState = timing.frequency ? `${rate} Hz` : 'Steady output · Silent';
		output.textContent = `Actual ${duty} duty · ${outputState} · HIGH ${timing.highCycles} / LOW ${timing.lowCycles} cycles`;
	} else if (!timing.frequency) {
		const gate = timing.duty === 1 ? '4,096 Hz carrier · Gate held open' : 'Gate held closed';
		output.textContent = `Actual ${duty} gate duty · ON ${timing.highCycles} / OFF ${timing.lowCycles} cycles · ${gate}`;
	} else {
		output.textContent = `Actual ${duty} gate duty · ${rate} Hz gate · ON ${timing.highCycles} / OFF ${timing.lowCycles} cycles · 4,096 Hz carrier`;
	}
}
function retunePulse(options) {
	refreshPulseTiming();
	void performance.retune('sm510', options).catch(error => setStatus(error.message));
}
function retuneCurrentPulse() {
	if (heldToneMode === toneMode && heldPulse) retunePulse();
	else refreshPulseTiming();
}
keyTracking.addEventListener('change', () => {
	if (!keyTracking.checked && heldPulse?.halfCycles && heldToneMode === toneMode) manualPulseCycles = heldPulse.halfCycles;
	retunePulse();
});
pulseCycles.addEventListener('input', () => {
	manualPulseCycles = pulseCycles.valueAsNumber / 2;
	keyTracking.checked = false;
	retunePulse();
});
dutyControl.addEventListener('input', () => {
	dutyPercentages[toneMode] = dutyControl.valueAsNumber;
	try { localStorage.setItem(dutyPreferences[toneMode], dutyControl.value); } catch {}
	retuneCurrentPulse();
});
continuousGate.addEventListener('click', () => {
	dividerContinuous = !dividerContinuous;
	retuneCurrentPulse();
});
pulsePins.forEach((button, index) => button.addEventListener('click', () => {
	const bit = 1 << index;
	pulseDrive ^= bit;
	button.setAttribute('aria-pressed', String(Boolean(pulseDrive & bit)));
	pulseDriveValue.value = ['Off', '1× swing', '1× swing', '2× swing'][pulseDrive];
	retunePulse();
}));
rMonitorButtons.forEach((button, index) => button.addEventListener('click', () => {
	rMonitor = rMonitorModes[index];
	for (const entry of rMonitorButtons) entry.setAttribute('aria-pressed', String(entry === button));
	for (const [channel, output] of (rMonitorOutputs ?? []).entries())
		output.gain.setTargetAtTime(rMonitor.weights[channel], audio.currentTime, .002);
	drawWave();
}));
byId('buzzerR1DemoLink').querySelector('a').addEventListener('click', () => { byId('buzzerChipGuide').open = true; });
refreshToneSource();
refreshPulseTiming();

new ResizeObserver(drawWave).observe(canvas);
new ResizeObserver(drawOutputScope).observe(outputCanvas);
for (const button of scopeButtons) button.addEventListener('click', () => {
	scopeMode = button.dataset.scopeMode;
	const pulse = scopeMode === 'pulse';
	for (const choice of scopeButtons) choice.setAttribute('aria-pressed', String(choice === button));
	canvas.hidden = pitch.hidden = !pulse;
	outputCanvas.hidden = outputScopeLabel.hidden = pulse;
	if (pulse) {
		if (scopeFrame !== null) cancelAnimationFrame(scopeFrame);
		scopeFrame = null;
		drawWave();
	} else {
		outputCanvas.setAttribute('aria-label', scopeMode === 'spectrum' ? 'Final output frequency spectrum' : 'Final output waveform');
		drawOutputScope();
		scheduleOutputScope();
	}
});
workspace = setupBuzzerWorkspace({
	document, setStatus, getPattern, stopPerformance,
	applyPattern(pattern) { applyPattern(pattern); restartPattern(); },
	getMelody: romEditor.getMelody,
	applyMelody(commands) { romEditor.setMelody(commands); clearRomCopy(); },
	getStarterCode: () => BUZZER_STARTER,
});
const synthButton = byId('synthWorkspaceSynthButton'), codeButton = byId('synthWorkspaceCodeButton');
const workspacePanel = byId('synthWorkspace'), expandedCodeSlot = byId('synthExpandedCodeSlot');
const chipControls = byId('buzzerChipControls');
const navigation = byId('buzzerWorkspaceNavigation'), inputHeading = byId('buzzerInputHeading');
const inputTablist = byId('buzzerInputTabs'), expandButton = byId('synthCodeExpandButton');
const chipTablist = byId('buzzerChipTabs');
const keyboardPanel = byId('synthKeyboardPanel');
const keyboardTab = byId('synthInputKeyboardTab'), codeTab = byId('synthInputCodeTab');
const inputTabs = [keyboardTab, codeTab];
const sm510PanelContent = byId('buzzerSm510Controls');
const chipTabs = [
	[DIRECT_R, byId('buzzerSm510Tab'), byId('buzzerSm510Panel')],
	[DK52_R, byId('buzzerSm510Dk52Tab'), byId('buzzerSm510Dk52Panel')],
	['sm511', byId('buzzerSm511Tab'), byId('buzzerSm511Panel')],
	['mixer', byId('buzzerMixerTab'), byId('buzzerMixerPanel')],
];
const chipButtons = chipTabs.map(([, tab]) => tab);
const workspaceTabs = [...inputTabs, ...chipButtons];
let inputViewTab = keyboardTab, chipView = selectedChip === 'sm510' ? toneMode : selectedChip;

function setTabSelected(tab, selected) {
	tab.setAttribute('aria-selected', String(selected));
	tab.tabIndex = selected ? 0 : -1;
}

function syncWorkspaceView() {
	chipControls.hidden = workspaceExpanded && !showingExpandedChip;
	expandedCodeSlot.hidden = !workspaceExpanded || showingExpandedChip;
	for (const tab of inputTabs) setTabSelected(tab, !showingExpandedChip && tab === inputViewTab);
	for (const [name, tab] of chipTabs) setTabSelected(tab, !chipControls.hidden && name === chipView);
}

function showChipView(view) {
	chipView = view;
	showingExpandedChip = workspaceExpanded;
	const isSm510 = view === DIRECT_R || view === DK52_R;
	if (view !== 'mixer') {
		selectedChip = isSm510 ? 'sm510' : view;
		if (isSm510 && view !== toneMode) {
			toneMode = view;
			refreshToneSource();
			retunePulse({ followSelectionOnly: true });
		}
		performance.refreshLabels();
		byId('buzzerMenuWav').textContent = isSm510 ? 'Pattern · WAV' : 'Melody ROM · WAV';
		void prepareSm510().catch(error => setStatus(error.message));
	}
	for (const [name, , panel] of chipTabs) {
		panel.hidden = name !== view;
		if (!panel.hidden && isSm510 && sm510PanelContent.parentElement !== panel)
			panel.append(sm510PanelContent);
	}
	syncWorkspaceView();
	drawWave();
}
for (const [view, tab] of chipTabs) tab.addEventListener('click', () => {
	showChipView(view);
	if (view !== 'mixer') {
		try {
			localStorage.setItem(chipPreference, selectedChip);
			if (selectedChip === 'sm510') localStorage.setItem(tonePreference, toneMode);
		} catch {}
	}
	tab.focus({ preventScroll: true });
});
showChipView(chipView);

function showInputView(view) {
	inputViewTab = view === 'code' ? codeTab : keyboardTab;
	showingExpandedChip = false;
	keyboardPanel.hidden = view !== 'keyboard';
	syncWorkspaceView();
	drawWave();
}

controls = setupBuzzerCode({
	workspace, performance, ensureAudio, scheduler, setStatus,
	now: audioTime,
	onRunRequest: stopRomEditor,
	onStopRequest: stopTransports,
	onPlaybackChange(active) {
		codeActive = active;
		syncTransport();
	},
	sequence: {
		getPattern, update: updatePattern,
		play: (owner, loopOverride, chip, fixedMode) => start('pattern', { owner, loopOverride, chip, fixedMode }),
		stop: stopPlayback,
	},
	r1: {
		prepare: prepareSm510,
		write: writeSm510R,
		playCycles: (r1Plan, r1Mode) => start('sm510-plan', { owner: sm510CodeOwner, r1Plan, r1Mode }),
		prepareScheduled: prepareScheduledCycles,
		stop: () => stopPlayback(sm510CodeOwner),
	},
	melody: {
		play: commands => playMelody(commands, sm511CodeOwner),
		prepareScheduled: prepareScheduledMelody,
		prepareInstructions: prepareSm511Instructions,
		stop: () => stopMelody(sm511CodeOwner),
		control: {
			reset: stopSm511Control,
			async command(words, op, operand) { return (await ensureSm511Control(words)).command(op, operand); },
			async captureState() {
				if (!sm511Control) throw new Error('Start SM511 CPU control before capturing its state.');
				return (await sm511Control.ready).getState();
			},
		},
	},
	onExpandedChange(expanded) {
		codeButton.setAttribute('aria-pressed', String(expanded));
		synthButton.setAttribute('aria-pressed', String(!expanded));
		if (expanded === workspaceExpanded) {
			syncWorkspaceView();
			return;
		}
		workspaceExpanded = expanded;
		showingExpandedChip = false;
		const focused = document.activeElement;
		if (expanded) {
			inputTablist.append(...chipButtons);
			inputTablist.setAttribute('aria-label', 'Synth workspace');
			navigation.prepend(inputTablist);
			navigation.append(expandButton);
			expandedCodeSlot.before(navigation);
			expandedCodeSlot.after(chipControls);
		} else {
			chipTablist.append(...chipButtons);
			inputTablist.setAttribute('aria-label', 'Performance input');
			inputHeading.append(inputTablist, expandButton);
			chipControls.prepend(navigation);
			workspacePanel.before(chipControls);
		}
		chipTablist.hidden = expanded;
		inputHeading.hidden = expanded;
		syncWorkspaceView();
		if (document.activeElement !== focused && (inputHeading.contains(focused) || navigation.contains(focused) || chipControls.contains(focused)))
			focused.focus({ preventScroll: true });
	},
	onViewChange: showInputView,
});
syncTransport();
function navigateTabs(tabList, getTabs) {
	tabList.addEventListener('keydown', event => {
		const tabs = getTabs();
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
navigateTabs(chipTablist, () => chipButtons);
navigateTabs(inputTablist, () => workspaceExpanded ? workspaceTabs : inputTabs);
codeButton.addEventListener('click', async () => {
	try {
		if (await controls.setMode('code', { focusEditor: false }) && await controls.setExpanded(true, { focusEditor: false }))
			codeTab.focus({ preventScroll: true });
	} catch (error) { setStatus(error.message); }
});
synthButton.addEventListener('click', async () => {
	try {
		await controls.setExpanded(false, { focusEditor: false });
		if (await controls.setMode('keyboard', { focusEditor: false })) synthButton.focus({ preventScroll: true });
	} catch (error) { setStatus(error.message); }
});
window.addEventListener('pagehide', () => { stopPerformance(); void controls.stop(); });
