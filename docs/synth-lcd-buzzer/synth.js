// SPDX-License-Identifier: BSD-3-Clause
import { NOTE_OPTIONS, PATTERNS, renderPattern, validateBuzzerPattern } from './buzzer.js';
import { encodeWav } from '../js/wav.js';
import { noteToHz } from '../js/soundchip_pitch.js';
import { BUZZER_STARTER, setupBuzzerCode } from './code.js';
import { setupBuzzerWorkspace } from './files.js';
import { setupBuzzerPerformance } from './performance.js';
import {
	DIRECT_R, DK52_R, EQUAL_TEMPERAMENT, GATE_PRESETS, GATE_STEP_COUNT, MIN_PULSE_HALF_CYCLES, MAX_PULSE_HALF_CYCLES,
	MACHINE_CYCLE_HZ, MASTER_CLOCK_HZ, R1_DIVISOR, R1_HZ,
	buildSm510Pulse, connectRChannels, createSm510AudioCore, createRVoice, directPitchHz, readRAtTick, renderR1Pattern, renderR1Timeline, renderSm510Notes,
} from './sm510.js';
import { renderSm511Melody, renderSm511CommandCycle, renderSm511Pattern, sm511Command, sm511CommandLabel, sm511Label } from './sm511.js';
import { setupSm511MelodyEditor } from './melody_editor.js';

const byId = id => document.getElementById(id);
const fetchSm510 = window.fetch.bind(window, new URL('./sm510.wasm?v=sm511-melody', import.meta.url));
const volume = byId('volume'), status = byId('status');
const mix = Object.fromEntries(['sm510', 'sm511', 'lcd-buzzer'].map(chip => [chip, {
	level: byId(chip + 'Mix'), mute: byId(chip + 'Mute'), readout: byId(chip + 'MixValue'), output: null,
}]));
const canvas = byId('waveform'), drawing = canvas.getContext('2d');
const pitch = byId('pitch');
const toneButtons = [...byId('toneSource').querySelectorAll('[data-tone-mode]')];
const keyTracking = byId('sm510KeyTracking');
const pulseCycles = byId('sm510PulseCycles'), pulseDriveValue = byId('sm510PulseDriveValue');
const pulsePins = [byId('sm510PulseR1'), byId('sm510PulseR2')];
pulseCycles.min = MIN_PULSE_HALF_CYCLES;
pulseCycles.max = MAX_PULSE_HALF_CYCLES;
let pulseDrive = 1, manualPulseCycles = pulseCycles.valueAsNumber, heldPulse;
const rMonitorButtons = [byId('sm510MonitorR1'), byId('sm510MonitorR2'), byId('sm510MonitorDiff')];
const rMonitorModes = [
	{ label: 'R1', weights: [1, 0] },
	{ label: 'R2', weights: [0, 1] },
	{ label: 'R1 − R2', weights: [1, -1] },
];
let rMonitor = rMonitorModes[0], rMonitorOutputs;
const toneHints = {
	[DIRECT_R]: 'Direct R switches the output at whole SM510 machine cycles to set each pitch.',
	[DK52_R]: 'The CPU switches the fixed 4,096 Hz carrier on and off. Key tracking sets the keyboard’s gate rate.',
};
const tonePreference = 'tetorica-sm510-tone-source';
const chipPreference = 'tetorica-buzzer-selected-chip';
let toneMode = DIRECT_R, selectedChip = 'sm510';
try {
	const rememberedMode = localStorage.getItem(tonePreference);
	const rememberedChip = localStorage.getItem(chipPreference);
	if (Object.hasOwn(toneHints, rememberedMode)) toneMode = rememberedMode;
	if (Object.hasOwn(mix, rememberedChip)) selectedChip = rememberedChip;
	else if (rememberedMode === EQUAL_TEMPERAMENT) selectedChip = 'lcd-buzzer';
} catch {}
const sm510Play = byId('sm510Play'), sm510Stop = byId('sm510Stop'), sm510Controls = byId('sm510Controls');
const sm510Preset = byId('sm510Preset'), sm510StepTime = byId('sm510StepTime'), sm510StepValue = byId('sm510StepValue');
const sm510Gates = Array(GATE_STEP_COUNT).fill(false), sm510Buttons = [];
const sm511Play = byId('sm511Play'), sm511Stop = byId('sm511Stop'), sm511Status = byId('sm511Status');
const sm511PlayFrom = byId('sm511PlayFrom');
const romEditor = setupSm511MelodyEditor({ document, onChange: () => workspace?.melodyChanged() });
const sm511Pitch = byId('sm511Pitch'), sm511KeyTracking = byId('sm511KeyTracking');
const sm511Repeat = byId('sm511Repeat');
const sm511OctaveButtons = [...document.querySelectorAll('[data-rom-octave]')];
const sm511LengthButtons = [...document.querySelectorAll('[data-rom-length]')];
let sm511ManualPitch = 0x02, sm511LongNote = false, heldRomTone, lastRomCommand;
const noteLabels = new Map(NOTE_OPTIONS.map(({ value, label }) => [value, label]));
let pattern = validateBuzzerPattern({ notes: PATTERNS[0].notes, bpm: PATTERNS[0].bpm, gate: .65, volume: .6, loop: true });
let audio, master, clip = null, pending = null, request = 0, frame = 0;
let activeStep = -1, activeR1Step = -1, heldNote = null;
let heldChip = null, heldToneMode, melodyClip = null, melodyPending = null;
let workspace, controls;
let workspaceExpanded = false, showingExpandedChip = false;
let codeActive = false, romStarting = false, romRequest = 0, handoffEnd = 0;
let rVoice, rMode, rValue = 0, coreLoading, audioCore;
const sm510Owner = Symbol('SM510 R1 demo');
const sm510CodeOwner = Symbol('SM510 Code');
const sm511EditorOwner = Symbol('SM511 Melody ROM editor');
const sm511CodeOwner = Symbol('SM511 Code');
const transportRelease = .008;

function displayNote(note, chip = selectedChip, tone) {
	if (chip !== 'sm511') return noteLabels.get(note);
	return tone?.command === undefined ? sm511Label(note) : sm511CommandLabel(tone.command);
}
const mixLevel = chip => mix[chip].mute.checked ? 0 : Number(mix[chip].level.value) / 100;
const modeFor = chip => chip === 'lcd-buzzer' ? EQUAL_TEMPERAMENT : toneMode;
const formatHz = frequency => frequency.toLocaleString('en-US', { maximumFractionDigits: 2 });

function syncTransport() {
	const playingR1 = clip?.kind === 'sm510' || pending?.kind === 'sm510';
	const playingRom = romStarting || melodyClip?.owner === sm511EditorOwner || melodyPending?.owner === sm511EditorOwner;
	controls?.setExternalStopAvailable(playingRom);
	sm510Play.disabled = playingR1 || !sm510Gates.some(Boolean);
	sm510Stop.disabled = !playingR1;
	sm510Controls.disabled = playingR1;
	sm511Play.disabled = sm511PlayFrom.disabled = playingRom;
	sm511Stop.disabled = !playingRom && !melodyClip && !melodyPending && !codeActive;
}

function currentR() {
	if (clip?.r1Plan) {
		const tick = Math.floor((audio.currentTime - clip.start) * MASTER_CLOCK_HZ);
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
	const mode = rawMode ?? (heldChip ? heldToneMode : clip?.toneMode) ?? modeFor(chip);
	const sm511 = chip === 'sm511';
	const idleRom = idleInstrument && sm511;
	const showingMelody = sm511 && melodyClip && heldNote === null && !clip;
	const target = note === null ? null : noteToHz(note);
	const romCommand = sm511 && note !== null ? heldRomTone?.command ?? sm511Command(note) : null;
	const half = !sm511 && mode === DIRECT_R && target && audioCore?.directHalfCycles(target);
	const sounding = rawMode ? rAmplitude !== 0 : target !== null;
	const frequency = !idlePulse && !idleRom && !showingMelody && sounding && (sm511 ? audioCore?.sm511PitchHz(romCommand)
		: mode === DK52_R ? R1_HZ : rawMode ? null
		: mode === EQUAL_TEMPERAMENT ? target : half ? directPitchHz(half) : null);
	pitch.title = pulse ? '8 ms waveform view' : half && !rawMode ? `${half} machine cycles per half-wave` : '';
	if (pulse) {
		const rate = formatHz(directPitchHz(pulse.halfCycles));
		pitch.textContent = mode === DIRECT_R ? `CPU pulse · ${rate} Hz` : `4,096 Hz · ${rate} Hz gate`;
	} else if (idlePulse) pitch.textContent = 'CPU pulse · Ready';
	else if (idleRom) pitch.textContent = 'SM511 · Ready';
	else if (showingMelody) pitch.textContent = 'SM511 · Melody ROM';
	else if (rawMode === DIRECT_R) {
		const differentialLevels = ['R2 higher', '0 V', 'R1 higher'];
		const level = monitor === rMonitorModes[2] ? differentialLevels[rAmplitude + 1] : sounding ? 'High' : 'Low';
		pitch.textContent = `Direct ${monitor.label} · ${level}`;
	} else if (frequency && rawMode) pitch.textContent = `SM510 ${monitor.label} · 4,096 Hz`;
	else if (frequency) pitch.textContent = `${sm511 ? sm511CommandLabel(romCommand) : displayNote(note, chip)} · ${frequency.toFixed(2)} Hz`;
	else if (!sounding) pitch.textContent = rawMode ? `SM510 ${monitor.label} · Off` : 'Rest · silence';
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
	if (pulse || frequency) {
		const sampleRate = rawMode ? MASTER_CLOCK_HZ : 48000;
		const count = pulse ? Math.round(.008 * MASTER_CLOCK_HZ) : rawMode ? 4 * R1_DIVISOR : Math.round(.012 * sampleRate);
		const pulseSamples = pulse?.buffer.getChannelData(0);
		const waveform = sm511 ? renderSm511CommandCycle(audioCore, romCommand) : null;
		const level = frame => {
			if (pulseSamples) return pulseSamples[frame % pulseSamples.length] * 1.1;
			const firstHalf = Math.floor(frame * frequency * 2 / sampleRate) % 2 === 0;
			if (rawMode) return (firstHalf ? -rAmplitude : rAmplitude) * .18;
			const high = waveform ? waveform[Math.floor(frame * MASTER_CLOCK_HZ / sampleRate) % waveform.length] > 0 : firstHalf;
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
		for (const [chip, channel] of Object.entries(mix)) {
			channel.output = audio.createGain();
			channel.output.gain.value = mixLevel(chip);
			channel.output.connect(master);
		}
		rMonitorOutputs = rMonitor.weights.map(weight => {
			const output = audio.createGain();
			output.gain.value = weight;
			output.connect(mix.sm510.output);
			return output;
		});
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
	const { notes, bpm, gate } = pattern;
	if (chip === 'sm511') return renderSm511Pattern(core, notes, { stepSeconds: 30 / bpm, gate, sampleRate });
	return mode === EQUAL_TEMPERAMENT ? renderPattern(notes, { bpm, gate, sampleRate })
		: renderSm510Notes(core, mode, notes.map(targetHz), { stepSeconds: 30 / bpm, gate, sampleRate });
}

async function start(kind, { owner, loopOverride, r1Plan, r1Mode, chip = r1Mode ? 'sm510' : selectedChip }) {
	cancelPendingChipWork(chip);
	performance.cancelPending(chip);
	const token = ++request;
	const mode = modeFor(chip);
	pending = { kind, owner, loopOverride, r1Mode, chip };
	syncTransport();
	try {
		await ensureAudio();
		const core = r1Mode || chip === 'sm511' || mode !== EQUAL_TEMPERAMENT ? await prepareSm510() : null;
		if (token !== request) return false;
		const { sampleRate } = audio;
		let rendered, r2Samples;
		if (kind === 'sm510')
			rendered = renderR1Pattern(sm510Gates, { stepMs: Number(sm510StepTime.value), sampleRate: audio.sampleRate }, core.renderR1);
		else if (r1Plan) {
			const direct = r1Mode === DIRECT_R;
			rendered = { samples: renderR1Timeline(r1Plan, sampleRate, direct ? core.renderDirectR1 : core.renderR1) };
			r2Samples = renderR1Timeline(r1Plan, sampleRate, direct ? core.renderDirectR2 : core.renderR2);
		} else rendered = renderSequence(sampleRate, chip, mode, core);
		const { samples } = rendered;
		const buffer = audio.createBuffer(r2Samples ? 2 : 1, samples.length, sampleRate);
		buffer.copyToChannel(samples, 0);
		if (r2Samples) buffer.copyToChannel(r2Samples, 1);
		const gain = audio.createGain(), source = audio.createBufferSource();
		source.buffer = buffer;
		source.loop = kind === 'pattern' && (loopOverride ?? pattern.loop);
		const previous = chip === 'sm511' ? stopMelody() : chip === 'sm510' ? releaseR() : undefined;
		const time = Math.max(releaseClip() ?? 0, releaseClipAndKeys(chip), previous ?? 0, handoffEnd);
		const current = {
			kind, source, gain, owner, loopOverride, r1Plan, r1Mode, chip, toneMode: mode,
			start: time, duration: buffer.duration, stepFrames: rendered?.stepFrames, boundaries: rendered?.boundaries,
		};
		source.connect(gain);
		const splitter = r2Samples ? connectRChannels(gain, audio, rMonitorOutputs) : null;
		if (!splitter) gain.connect(mix[chip].output);
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
		pending = null;
		if (kind === 'pattern') {
			status.textContent = source.loop ? 'Looping pattern' : 'Playing pattern';
			animate();
		} else if (kind === 'sm510') {
			status.textContent = 'Playing R1 demo';
			animate();
		} else {
			status.textContent = 'Playing SM510 cycle sequence';
			animate();
			drawWave();
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
	const previous = mode !== rMode ? releaseR() : undefined;
	const begin = audio ? Math.max(releaseClipAndKeys('sm510'), previous ?? 0, handoffEnd) : 0;
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
	handoffEnd = Math.max(handoffEnd, stopMelody(sm511EditorOwner) ?? 0);
	if (wasStarting && !melodyClip && !melodyPending) sm511Status.textContent = 'Stopped';
	syncTransport();
}

async function playRomEditor(address = 0) {
	const commands = Uint8Array.from(romEditor.getMelody().slice(address));
	const token = ++romRequest;
	romStarting = true;
	sm511Status.textContent = 'Preparing melody';
	syncTransport();
	try {
		const retiringCode = codeActive;
		const retired = retiringCode ? controls.stop() : true;
		const [, stopped] = await Promise.all([ensureAudio(), retired]);
		if (token !== romRequest) return;
		if (stopped) {
			if (retiringCode) handoffEnd = Math.max(handoffEnd, audio.currentTime + transportRelease);
			await playMelody(commands, sm511EditorOwner);
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

async function stopTransports() {
	stopRomEditor();
	stopMelody();
	if (codeActive) await controls.stop();
}

function releaseMelody() {
	if (!melodyClip) return;
	const { source, gain } = melodyClip;
	const now = audio.currentTime, end = now + transportRelease;
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
		const heldUntil = heldChip === 'sm511' ? audio.currentTime + transportRelease : audio.currentTime;
		if (heldChip === 'sm511') performance.stopAll();
		const start = Math.max(heldUntil, previous ?? 0, stopPlayback(undefined, { chip: 'sm511' }) ?? 0, handoffEnd);
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
sm511PlayFrom.addEventListener('click', () => void playRomEditor(romEditor.getAddress()));
sm511Stop.addEventListener('click', () => void stopTransports());
const trackedRomPitch = () => (heldRomTone?.command ?? lastRomCommand ?? sm511ManualPitch) & 0x1f;
const selectedRomPitch = () => sm511KeyTracking.checked ? trackedRomPitch() : sm511ManualPitch;
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
	const mode = modeFor(chip);
	const melody = chip === 'sm511' ? Uint8Array.from(romEditor.getMelody()) : null;
	const core = chip === 'sm511' || mode !== EQUAL_TEMPERAMENT ? await prepareSm510() : null;
	const samples = melody ? renderSm511Melody(core, melody, sampleRate) : renderSequence(sampleRate, chip, mode, core).samples;
	const bytes = encodeWav({ sampleRate, channels: [samples] }, { gain: Number(volume.value) / 100 * mixLevel(chip) });
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
	getOutput: chip => ({ context: audio, master: mix[chip].output, chip }),
	async prepareTone(frequency, context, note, chip, { keyboard }) {
		if (chip === 'lcd-buzzer') return null;
		const core = await prepareSm510();
		const mode = modeFor(chip);
		if (chip === 'sm511') {
			const pitch = sm511KeyTracking.checked ? sm511Command(note) : sm511ManualPitch;
			const command = pitch | (sm511LongNote ? 0x20 : 0);
			const singleSlot = keyboard && !sm511Repeat.checked;
			const samples = singleSlot ? renderSm511Melody(core, [command], MASTER_CLOCK_HZ) : renderSm511CommandCycle(core, command);
			const buffer = context.createBuffer(1, samples.length, MASTER_CLOCK_HZ);
			buffer.copyToChannel(samples, 0);
			return { buffer, toneMode: mode, command, keyboard, loop: !singleSlot };
		}
		const halfCycles = keyTracking.checked ? core.directHalfCycles(frequency) : manualPulseCycles;
		const plan = buildSm510Pulse(mode, halfCycles, pulseDrive);
		const direct = mode === DIRECT_R;
		const r1 = renderR1Timeline(plan, MASTER_CLOCK_HZ, direct ? core.renderDirectR1 : core.renderR1);
		const r2 = renderR1Timeline(plan, MASTER_CLOCK_HZ, direct ? core.renderDirectR2 : core.renderR2);
		const buffer = context.createBuffer(1, plan.end - plan.loopStart, MASTER_CLOCK_HZ);
		const samples = buffer.getChannelData(0);
		for (let frame = 0; frame < samples.length; frame++) {
			const tick = plan.loopStart + frame;
			samples[frame] = r1[tick] - r2[tick];
		}
		return { buffer, toneMode: mode, halfCycles, startup: plan.loopStart / MASTER_CLOCK_HZ };
	},
	onBeforeNote(chip) {
		const end = stopPlayback(undefined, { chip });
		return Math.max(end ?? 0, chip === 'sm511' ? stopMelody() ?? 0 : 0, handoffEnd);
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
	for (const button of toneButtons)
		button.setAttribute('aria-pressed', String(button.dataset.toneMode === toneMode));
	byId('toneSourceDetail').textContent = toneHints[toneMode];
	byId('buzzerR1DemoLink').hidden = toneMode !== DK52_R;
	drawWave();
}
function refreshPulseTiming() {
	const cycles = keyTracking.checked ? heldPulse?.halfCycles : manualPulseCycles;
	pulseCycles.value = cycles ?? manualPulseCycles;
	if (cycles === undefined) {
		byId('sm510PulseInterval').value = 'Key tracking';
		byId('sm510PulseTiming').textContent = 'Play a key to hear the CPU pulse.';
		return;
	}
	const intervalMs = cycles * 1000 / MACHINE_CYCLE_HZ;
	const rate = `${formatHz(directPitchHz(cycles))} Hz`;
	byId('sm510PulseInterval').value = `${cycles} cycles · ${intervalMs.toFixed(2)} ms`;
	byId('sm510PulseTiming').textContent = toneMode === DIRECT_R
		? `${rate} pitch · 16,384 machine cycles/s`
		: `${rate} gate · 4,096 Hz carrier · 16,384 machine cycles/s`;
}
function retunePulse() {
	refreshPulseTiming();
	void performance.retune('sm510').catch(error => setStatus(error.message));
}
keyTracking.addEventListener('change', () => {
	if (!keyTracking.checked && heldPulse) manualPulseCycles = heldPulse.halfCycles;
	retunePulse();
});
pulseCycles.addEventListener('input', () => {
	manualPulseCycles = pulseCycles.valueAsNumber;
	keyTracking.checked = false;
	retunePulse();
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
for (const button of toneButtons) button.addEventListener('click', () => {
	if (toneMode === button.dataset.toneMode) return;
	toneMode = button.dataset.toneMode;
	try { localStorage.setItem(tonePreference, toneMode); } catch {}
	refreshToneSource();
	retunePulse();
	if (toneMode === DIRECT_R) void prepareSm510().catch(error => setStatus(error.message));
});
byId('buzzerR1DemoLink').querySelector('a').addEventListener('click', () => { byId('buzzerChipGuide').open = true; });
refreshToneSource();
refreshPulseTiming();

new ResizeObserver(drawWave).observe(canvas);
workspace = setupBuzzerWorkspace({
	document, setStatus, getPattern, stopPerformance,
	applyPattern(pattern) { applyPattern(pattern); restartPattern(); },
	getMelody: romEditor.getMelody, applyMelody: romEditor.setMelody,
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
const chipTabs = [
	['sm510', byId('buzzerSm510Tab'), byId('buzzerSm510Panel')],
	['sm511', byId('buzzerSm511Tab'), byId('buzzerSm511Panel')],
	['lcd-buzzer', byId('buzzerLcdTab'), byId('buzzerLcdPanel')],
	['mixer', byId('buzzerMixerTab'), byId('buzzerMixerPanel')],
];
const chipButtons = chipTabs.map(([, tab]) => tab);
const workspaceTabs = [...inputTabs, ...chipButtons];
let inputViewTab = keyboardTab, chipView = selectedChip;

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
	if (view !== 'mixer') {
		selectedChip = view;
		performance.refreshLabels();
		byId('buzzerMenuWav').textContent = view === 'sm511' ? 'Melody ROM · WAV' : 'Pattern · WAV';
		if (view === 'sm511' || (view === 'sm510' && toneMode === DIRECT_R))
			void prepareSm510().catch(error => setStatus(error.message));
	}
	for (const [name, , panel] of chipTabs) panel.hidden = name !== view;
	syncWorkspaceView();
	drawWave();
}
for (const [view, tab] of chipTabs) tab.addEventListener('click', () => {
	showChipView(view);
	if (view !== 'mixer') {
		try { localStorage.setItem(chipPreference, view); } catch {}
	}
	tab.focus({ preventScroll: true });
});
showChipView(selectedChip);

function showInputView(view) {
	inputViewTab = view === 'code' ? codeTab : keyboardTab;
	showingExpandedChip = false;
	keyboardPanel.hidden = view !== 'keyboard';
	syncWorkspaceView();
	drawWave();
}

controls = setupBuzzerCode({
	workspace, performance, ensureAudio, setStatus,
	now: () => audio?.currentTime ?? 0,
	onRunRequest: stopRomEditor,
	onStopRequest: stopTransports,
	onPlaybackChange(active) {
		codeActive = active;
		syncTransport();
	},
	sequence: {
		getPattern, update: updatePattern,
		play: (owner, loopOverride) => start('pattern', { owner, loopOverride }),
		stop: stopPlayback,
	},
	r1: {
		prepare: prepareSm510,
		write: writeSm510R,
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
