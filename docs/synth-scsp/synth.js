// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundScspVoicePanel } from '../playground/playground_scsp_voice_panel.js';
import { createAudio } from './audio.js?v=scsp-cycle2-code-1';
import { SynthInstrument } from './instrument.js?v=scsp-cycle2-code-1';
import { readPatch, writePatch } from './patch.js?v=scsp-cycle2-code-1';
import { OPERATOR_NAMES, OPERATOR_KEYS, operatorCount } from './routing.js?v=scsp-cycle2-code-1';
import { enhanceScspNumberControls } from './controls.js?v=scsp-dsp-coef-1';
import { setupScspCodeHost } from './code_host.js?v=scsp-cycle2-code-1';
import { setupScspSongControls, isScspSongPath } from './song_controls.js?v=scsp-ssf-dsp-1';
import { setupScspSsfLiveView } from './ssf_live_view.js?v=scsp-ssf-dsp-1';
import { setupScspEnvelopeControls } from './scsp_envelope_controls.js';
import { setupScspDspProgramView } from './dsp_program_view.js?v=scsp-dsp-ui-routing-1';
import { setupScspDspRoutingView } from './dsp_routing_view.js?v=scsp-dsp-ui-routing-1';
import { setupScspDspSignalFlow } from './dsp_signal_flow.js?v=scsp-dsp-flow-1';
import { setupScspCustomFmView } from './fm_custom_view.js?v=scsp-fm-multiple-self-1';
import { setupScspFmDepthView } from './fm_depth_view.js?v=scsp-fm-multiple-self-1';
import { setupScspSsfDspView } from './ssf_dsp_view.js?v=scsp-ssf-dsp-1';
import { createScspDspSetupCode } from './dsp_setup_code.js?v=scsp-dsp-ui-routing-1';
import { delayProgram, validateScspDspProgramOptions } from './dsp.js?v=scsp-dsp-ui-routing-1';
import { createScspDspExample, identifyScspDspExample, identifyScspDspProgram } from './dsp_examples.js?v=scsp-dsp-ui-routing-1';
import { validateScspSynthDspProgram } from './dsp_program.js?v=scsp-dsp-ui-routing-1';
import { setupScspChannelView } from './channel_view.js';
import { createScspSsfCapture, getScspSsfCaptureAvailability } from './ssf_capture.js?v=scsp-cycle2-code-1';
import { ScspSsfVoiceEdits } from './ssf_voice_edits.js';
import { setupSynthMenu } from '../synth/synth_menu.js';
import { createSpuOutputVisualizer } from '../synth-spu/spu_synth_visualizer.js';
import { createStateObserver } from '../synth-2a03/state_observer.js';
import {
	createFretboardState,
	createFretboardLayout,
	renderFretboardControls,
	buildKeyboard,
	setInstrument,
	setFretPosition,
	setStringWindowIndex,
	midiToNoteName,
} from '../synth/synth_keyboard.js';

const $ = (id) => document.getElementById(id);
const text = (node, value) => {
	if (node && node.textContent.trim() !== value) node.textContent = value;
};
const status = (message, error = false) => {
	$('status').textContent = message;
	$('status').dataset.error = String(error);
};
const report = (error) => {
	if (error?.name !== 'AbortError') status(error?.message ?? String(error), true);
};
const clone = (value) => structuredClone(value);
let audio = null,
	opening = null,
	disposed = false,
	switchingAudioOutput = false;
let queue = Promise.resolve(),
	draftRevision = 0,
	epoch = 0,
	sequence = 0;
let selectedOperator = 0,
	latestState = null,
	codeHost = null,
	songControls = null,
	songState = null,
	liveView = null,
	channelView = null,
	dspProgramView = null,
	dspRoutingView = null,
	dspSignalFlow = null,
	customFmView = null,
	fmDepthView = null,
	ssfDspView = null;
let editorViewKey = 'auto:0';
let cycle2Active = false;
const cycle2SaveMessage = 'Cycle 2OP is Code-only for now. Save the JavaScript; portable Cycle presets need the next update.';
function portableSound() {
	if (cycle2Active) throw new Error(cycle2SaveMessage);
	return clone(cachedPatch);
}
let renderedSampleKey = '';
let committedPcmContext = null;
let clickGuardIntent = 0,
	clickGuardApplied = true;
const editorDrafts = new Map();
const ssfVoiceEdits = new ScspSsfVoiceEdits();
let auditionSelection = null,
	loadedAuditionSelection = null,
	loadedAuditionToken = null,
	auditionSequence = 0,
	auditionGeneration = 0;
let cachedPatch = null,
	soundName = null,
	operatorReads = [],
	sampleKeys = [];
let octave = 0,
	bend = 0,
	baseTranspose = 0;
const held = new Map(),
	fret = createFretboardState();
const operatorButtons = [...document.querySelectorAll('[data-operator]')];
const effectControls = [
	'effectEnabled',
	'delayTime',
	'delayFeedback',
	'effectSend',
	'effectReturn',
];
const wheels = [
	[$('pitchBend'), $('pitchBendValue')],
	[$('keyboardPitchBend'), $('keyboardPitchValue')],
];

// The passive authoring model uses the same validation and PCM allocator.
// It has no native renderer, AudioContext, timer or speaker connection.
const draftRam = new Uint8Array(524288);
const draft = new SynthInstrument({
	sampleRate: 44100,
	reset(options = {}) {
		if (options.clearRam) draftRam.fill(0);
	},
	write() {},
	loadRam(bytes, address = 0) {
		draftRam.set(bytes, address);
	},
	readRam(address, length) {
		return draftRam.slice(address, address + length);
	},
	renderInto(left, right) {
		left.fill(0);
		right.fill(0);
	},
	dispose() {},
});
// This session's acknowledged DSP image is separate from portable voice patches.
// Cold Apply changes setup only; restoring saved draft text never reaches here.
let appliedDspWords = delayProgram();
// COEF1 belongs to the voice patch's Feedback. COEF0/2 belong to this DSP session.
let sessionDspCoefficients = { 0: 4095, 2: 4095 };
let coefficientEditSequence = 0;
let sessionDspRouting = null;
const routingMethods = ['setDspSend', 'setDspSourceSend', 'setDspReturn'];
function rememberDspRouting(state) {
	if (state.dspRoutingOverrides && state.dspReturns)
		sessionDspRouting = clone({overrides: state.dspRoutingOverrides, returns: state.dspReturns});
}
function rememberDspRoutingEdit(method, args, value) {
	if (!sessionDspRouting) return;
	if (method === 'setDspReturn') {
		const [output, patch] = args;
		sessionDspRouting.returns[output] = {...sessionDspRouting.returns[output], ...patch};
		if (output === 0 && patch.level !== undefined)
			cachedPatch = {...cachedPatch, effect: {...cachedPatch.effect, returnLevel: patch.level}};
	} else if (method === 'setDspSend' || method === 'setDspSourceSend') {
		const [index, patch] = args, values = sessionDspRouting.overrides[method === 'setDspSend' ? 'slots' : 'sources'];
		values[index] = patch === null ? null : clone(value);
	} else if (method === 'setEffect') {
		sessionDspRouting.returns[0].level = value.returnLevel;
	}
}
function restoreDspRouting(owner, memo) {
	if (!memo) return;
	for (const [key, method] of [['sources', 'setDspSourceSend'], ['slots', 'setDspSend']])
		memo.overrides[key].forEach((patch, index) => owner[method](index, patch));
	memo.returns.forEach((value, output) => owner.setDspReturn(output, value));
}
function rememberDspCoefficients(result) {
	sessionDspCoefficients = { 0: result.codes[0], 2: result.codes[2] };
	// Retain the complete ACKed setup before any asynchronous view refresh.
	// Audio failure can occur while that read is pending.
	cachedPatch = { ...cachedPatch, effect: { ...cachedPatch.effect, feedback: result.feedback } };
}
cachedPatch = draft.exportPatch();
const command = (method, args = []) => {
	if (audio) return audio.command(method, args).then(value => {
		rememberDspRoutingEdit(method, args, value);
		return value;
	});
	const value = draft[method](...args);
	if (
		!['readPhysical', 'readAuthoring', 'readDspCoefficients', 'exportPatch', 'exportIdleState'].includes(method) &&
		!(method === 'invokePhysical' && args[0] === 'getPCM')
	)
		draftRevision++;
	return Promise.resolve(value);
};
const invoke = (method, args = []) => {
	if (audio) return audio.invoke(method, args);
	const value = draft.invoke(method, args);
	if (method !== 'getPCM') draftRevision++;
	return Promise.resolve(value);
};
const physicalEditor = () => editorViewKey.startsWith('ch:');
const editInvoke = (physical, method, args) =>
	physical ? command('invokePhysical', [method, args]) : invoke(method, args);
function enqueue(action) {
	const task = queue.then(action);
	queue = task.catch(report);
	return task;
}
const visualizer = createSpuOutputVisualizer({ canvas: $('outputCanvas') });
visualizer.setMode('waveform');
function syncActivity() {
	const code = Boolean(codeHost?.isRunning());
	visualizer.setRunning(Boolean(!disposed && (code || held.size || songState?.playing)));
	observer.update({
		engine: audio,
		active: Boolean(
			!disposed &&
				!document.hidden &&
				audio &&
				(code || (channelView?.getSelected() != null && !liveView?.isActive())) &&
				!switchingAudioOutput,
		),
	});
}
function cacheAuthoring({ state, operators }) {
	for (let index = 0; index < 6; index++)
		if (operators[index]) operatorReads[index] = operators[index];
	sampleKeys = state.slots
		.slice(0, 6)
		.map((voice) => `${voice.sample.bankId}:${voice.sample.id}`);
	const sources = Object.fromEntries(
		OPERATOR_KEYS.map((key, index) => [
			key,
			{ ...operatorReads[index], voice: state.slots[index] },
		]),
	);
	baseTranspose = state.config.transpose;
	cycle2Active = state.config.fm.algorithm === 'cycle2';
	// Code is saved normally; until v11, retain the last portable base sound for
	// workspace/restart recovery. Sound-save actions must reject instead of
	// exporting this base as though it represented the running Cycle.
	if (!cycle2Active) {
		cachedPatch = writePatch({ ...state.config, transpose: baseTranspose }, sources);
		if (soundName) cachedPatch.name = soundName;
	}
	latestState = state;
	rememberDspRouting(state);
	const ids = new Set(state.voiceGroups.map((group) => group.id));
	const physicalIds = new Set((state.manualVoices ?? []).map((note) => note.id));
	for (const [source, note] of held)
		if (
			note.kind !== 'ssf' &&
			note.started &&
			!note.pending &&
			!(note.kind === 'physical' ? physicalIds : ids).has(note.id)
		)
			held.delete(source);
}
async function readAuthoring(engine = audio) {
	return engine ? engine.command('readAuthoring', [sampleKeys]) : draft.readAuthoring(sampleKeys);
}
const observer = createStateObserver({
	read: (engine) => readAuthoring(engine),
	onState(value, engine) {
		if (engine !== audio) return;
		cacheAuthoring(value);
		renderState();
		highlight();
	},
	intervalMs: 100,
});
function drawConnections(state) {
	$('connectionPaths').replaceChildren();
	state.routing.inputs.forEach((sources, target) =>
		sources.forEach((source) => {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			const x = 50 + source * 100,
				y = 50 + target * 100,
				top = 15 + Math.abs(source - target) * 5;
			path.setAttribute('d', source === target
				? `M ${x + 14} 105 C ${x + 60} 28, ${x - 60} 28, ${x - 14} 100`
				: `M ${x} 105 C ${x} ${top}, ${y} ${top}, ${y} 100`);
			path.dataset.selfFeedback = String(source === target);
			path.classList.toggle(
				'selected',
				source === selectedOperator || target === selectedOperator,
			);
			$('connectionPaths').append(path);
		}),
	);
	$('connections').setAttribute('aria-label', $('routingSummary').textContent);
	$('selectedOperator').textContent = OPERATOR_NAMES[selectedOperator];
}
function renderDspCoefficients(state, readOnly = false) {
	const codes = state.dspCoefficients;
	const family = identifyScspDspProgram(appliedDspWords);
	const exampleId = identifyScspDspExample(appliedDspWords, codes);
	const fir = family === 'fir2';
	const iir = family === 'iir1';
	const dual = family === 'routing';
	const roles = dual ? createScspDspExample('routing-gain-iir').roles : fir ? createScspDspExample('fir2-lowpass').roles
		: iir ? createScspDspExample('iir1-lowpass').roles
			: family === 'delay' ? createScspDspExample('delay').roles : ['Coefficient', 'Coefficient', 'Coefficient'];
	dspProgramView?.update({ words: appliedDspWords, codes });
	if (latestState) dspSignalFlow?.update(latestState, {
		selected: channelView?.getSelected() ?? null, operator: selectedOperator,
		program: family, readOnly,
	});
	for (let index = 0; index < 3; index++) {
		const input = $(`scspDspCoef${index}`);
		if (!input) continue;
		text(document.querySelector(`label[for="scspDspCoef${index}"]`), `COEF${index} · ${roles[index]}`);
		input.disabled = readOnly || !codes || (iir && index === 0);
		input.title = iir && index === 0 ? 'This IIR program does not read COEF0.' : '';
		if (!codes) continue;
		if (document.activeElement !== input && !input.classList.contains('is-dragging'))
			input.value = String(codes[index]);
		text($(`scspDspCoef${index}Value`), `× ${codes[index] / 4096}`);
		const word = ((codes[index] & 0x1fff) << 3).toString(16).toUpperCase().padStart(4, '0');
		text($(`scspDspCoef${index}Register`), `0x${(0x700 + index * 2).toString(16).toUpperCase()} = 0x${word}`);
	}
	$('delayTime').disabled = readOnly || fir || iir || dual;
	$('delayTime').title = fir || iir || dual ? 'This filter uses TEMP history and does not use Delay time.' : '';
	text($('scspDspFeedbackLabel'), fir ? 'Previous tap · COEF1' : iir ? 'Output feedback · COEF1' : exampleId === 'delay' ? 'Feedback' : 'COEF1 multiplier');
	text($('scspDspParametersSummary'), dual ? 'DSP defaults' : fir ? 'FIR defaults' : iir ? 'IIR defaults' : 'Delay / defaults');
	text($('scspDspParametersHint'), dual
		? 'MIXS0 feeds Gain on Return 0; MIXS1 feeds IIR on Return 1. Route voices above. Delay Time is unused.'
		: iir
		? 'This IIR reuses its previous internal output. Its state persists across samples and the coefficients set its gain and decay. COEF0 and Time are unused. Stop clears the history. Use direct level 0 for wet-only comparison.'
		: fir
		? (exampleId === 'fir2-highpass'
			? 'The high-pass example subtracts the previous sample to reduce low frequencies.'
			: exampleId === 'fir2-lowpass'
				? 'The low-pass example averages adjacent samples to reduce high frequencies.'
				: 'The FIR combines current and previous samples using the live coefficients; its response depends on both tap weights.')
			+ ' Time does not affect this FIR. Use direct level 0 for wet-only comparison and Spectrum to compare the examples.'
		: 'The built-in program produces mono Delay. Time and Enable changes clear its DSP ring. DSP reserves 64 KiB, leaving 448 KiB for PCM and guards. Edited programs may use the same parameters differently.');
}
function renderState() {
	if (!latestState || disposed) return;
	const ssfSnapshot = songControls?.player.getLiveSnapshot();
	ssfVoiceEdits.sync(songControls?.player.getEditSession() ?? null, songState?.playback, ssfSnapshot);
	const observing = liveView?.update(songState, ssfSnapshot);
	const showSsfDsp = songState?.kind === 'ssf' && liveView?.isEnabled()
		&& ['starting', 'playing', 'paused', 'seeking'].includes(songState?.playback);
	$('scspSynthDspView').hidden = Boolean(showSsfDsp);
	$('scspSsfDspView').hidden = !showSsfDsp;
	$('scspDspTab').disabled = false;
	$('scspDspPanel').dataset.source = showSsfDsp ? 'ssf' : 'synth';
	if (showSsfDsp && !$('scspDspPanel').hidden) ssfDspView?.update(ssfSnapshot, {
		slot: channelView?.getSelected() ?? liveView.getSelectedSlot(), playback: songState?.playback,
	});
	renderDspCoefficients(latestState, Boolean(observing));
	dspRoutingView?.update(latestState, {selected: channelView?.getSelected() ?? null, operator: selectedOperator, readOnly: Boolean(observing)});
	customFmView?.update(latestState, {operator: selectedOperator, readOnly: Boolean(observing)});
	fmDepthView?.update(latestState, {operator: selectedOperator, readOnly: Boolean(observing)});
	for (const id of ['effectSend', 'delayFeedback']) $(id).disabled = Boolean(observing);
	if (observing && channelView?.getSelected() === null)
		channelView.setSelected(liveView.getSelectedSlot(), { notify: false });
	if (observing && channelView) liveView.selectSlot(channelView.getSelected());
	syncAuditionSelection();
	if (observing) {
		channelView?.update({ state: latestState, ssfSnapshot, ssfActive: true });
		setEditorSections('ssf');
		envelopeControls.update({ voice: liveView.getPCM().voice, readOnly: !liveView.isEditable() });
		numberControls?.update();
		return;
	}
	const state = latestState;
	const selected = channelView?.getSelected() ?? null;
	const previousContext = editorViewKey;
	selectEditorTarget(selected);
	const sample = state.slots[panel.getSelectedChannel()]?.sample;
	const nextSampleKey = `${sample?.bankId}:${sample?.id}`;
	if (
		selected !== null &&
		previousContext === editorViewKey &&
		nextSampleKey !== renderedSampleKey &&
		committedPcmContext !== editorViewKey
	) {
		const checkpoint = panel.captureDraft?.();
		if (checkpoint) editorDrafts.set(editorViewKey, checkpoint);
	}
	if (!$('voice').querySelector('.is-dragging')) panel.update(state);
	renderedSampleKey = nextSampleKey;
	restoreEditorDraft();
	setEditorSections(selected === null ? 'auto' : 'physical');
	channelView?.update({ state });
	if (
		selected !== null &&
		document.activeElement !== $('scspPhysicalFrequency') &&
		!$('scspPhysicalFrequency').classList.contains('is-dragging')
	)
		$('scspPhysicalFrequency').value = String(state.slots[selected].frequencyHz);
	$('scspPhysicalFrequency').disabled = selected === null || !state.slots[selected]?.sample;
	envelopeControls.update({ voice: state.slots[panel.getSelectedChannel()], readOnly: false });
	const memory = $('voice').querySelector(':scope > p');
	if (memory)
		memory.textContent = memory.textContent.replace(
			'Sample RAM',
			'SCSP RAM (64 KiB reserved for DSP)',
		);
	let cycleOption = $('algorithm').querySelector('option[value="cycle2"]');
	if (state.config.fm.algorithm === 'cycle2' && !cycleOption) {
		cycleOption = document.createElement('option');
		cycleOption.value = 'cycle2';
		cycleOption.textContent = 'Cycle 2OP · Code';
		cycleOption.disabled = true;
		$('algorithm').append(cycleOption);
	} else if (state.config.fm.algorithm !== 'cycle2') cycleOption?.remove();
	for (const [id, value] of [
		['voiceMode', state.config.mode],
		['fmDepth', state.config.fm.depth],
		['fmRatio', state.config.fm.ratio],
		['algorithm', state.config.fm.algorithm],
		['operatorRatio', state.config.fm.ratios[selectedOperator]],
		['pitch', baseTranspose],
	]) {
		if (document.activeElement !== $(id) && !$(id).classList.contains('is-dragging'))
			$(id).value = String(value);
	}
	for (const id of ['fmDepth', 'fmRatio', 'algorithm', 'operatorRatio'])
		$(id).disabled = state.config.mode === 'pcm';
	$('capacity').textContent =
		`${state.voiceCapacity} voices · ${operatorCount(state.config.mode)} slot(s) per key · 6 source slots`;
	for (const [id, key] of [
		['delayTime', 'timeMs'],
		['delayFeedback', 'feedback'],
		['effectSend', 'send'],

	]) {
		if (document.activeElement !== $(id) && !$(id).classList.contains('is-dragging'))
			$(id).value = String(key === 'feedback' && state.dspCoefficients
				? state.dspCoefficients[1] / 4096 : state.config.effect[key]);
	}
	$('effectEnabled').checked = state.config.effect.enabled;
	text(
		$('scspDspTab'),
		state.config.effect.enabled
			? identifyScspDspProgram(appliedDspWords) === 'fir2' ? 'DSP · FIR on'
				: identifyScspDspProgram(appliedDspWords) === 'iir1' ? 'DSP · IIR on'
					: identifyScspDspProgram(appliedDspWords) === 'delay' ? 'DSP · Delay on' : 'DSP · On' : 'DSP',
	);
	const { inputs, outputs, count } = state.routing;
	text($('fmRatioLabel'), state.config.fm.algorithm === 'custom' ? 'Ratios B–F' : 'All modulator ratios');
	$('routingSummary').textContent = inputs
		.flatMap((sources, target) =>
			sources.map((source) => `${OPERATOR_NAMES[source]} → ${OPERATOR_NAMES[target]}`),
		)
		.concat([`Output · ${outputs.length ? outputs.map((index) => OPERATOR_NAMES[index]).join(' + ') : 'Off'}`])
		.join(' · ');
	drawConnections(state);
	for (const button of operatorButtons) {
		const index = Number(button.dataset.operator);
		const modulator = inputs.some(sources => sources.includes(index));
		button.setAttribute('aria-pressed', String(index === selectedOperator));
		button.dataset.output = String(outputs.includes(index));
		button.dataset.modulator = String(modulator);
		text(
			button,
			`${OPERATOR_NAMES[index]} · ${index >= count ? 'Unused' : outputs.includes(index) ? modulator ? 'Output + mod' : 'Output' : modulator ? 'Modulator' : 'No direct'}`,
		);
	}
	numberControls?.update();
}
function rememberEditorDraft() {
	const checkpoint = panel.captureDraft?.();
	if (checkpoint) editorDrafts.set(editorViewKey, checkpoint);
	else editorDrafts.delete(editorViewKey);
}
function selectEditorTarget(selected) {
	const slot = selected ?? selectedOperator;
	const key = selected === null ? `auto:${slot}` : `ch:${slot}`;
	if (key === editorViewKey) return;
	rememberEditorDraft();
	editorViewKey = key;
	$('voice').querySelector(`[data-scsp-slot="${slot}"]`).click();
}
function restoreEditorDraft() {
	const checkpoint = editorDrafts.get(editorViewKey);
	if (checkpoint && panel.restoreDraft?.(checkpoint)) editorDrafts.delete(editorViewKey);
}
function setEditorSections(mode) {
	const physical = mode === 'physical';
	for (const section of document.querySelectorAll('.voice-routing,.operator-panel'))
		section.hidden = mode !== 'auto';
	$('scspPhysicalControls').hidden = !physical;
	$('voice').dataset.physicalChannel = physical ? String(channelView.getSelected()) : '';
	const modulation = $('voice').querySelector('.scsp-modulation-panel');
	if (modulation) modulation.hidden = !physical;
	$('voice')
		.querySelector('[data-chip-control="scsp-modulation-padding"]')
		.closest('label').hidden = !physical;
	copyButton.hidden = mode !== 'auto';
	for (const id of ['scspSaveSoundAs', 'scspFileSaveSoundButton']) {
		text(
			$(id),
			physical
				? 'Save Auto sound…'
				: id === 'scspSaveSoundAs'
					? 'Save to presets…'
					: 'Save sound',
		);
	}
	text($('save'), physical ? 'Auto instrument JSON' : 'Instrument JSON');
}
async function refresh({ dirty = false } = {}) {
	const value = await readAuthoring();
	cacheAuthoring(value);
	renderState();
	highlight();
	if (dirty) {
		codeHost?.markSoundDirty();
	}
	return value.state;
}
function audioFailed(error) {
	const previous = audio;
	audio = null;
	epoch++;
	held.clear();
	bend = 0;
	setWheelUi(0);
	songControls?.stop();
	void codeHost?.stop().catch(() => {});
	const routingMemo = sessionDspRouting && clone(sessionDspRouting);
	draft.loadPatch(cachedPatch);
	restoreDspRouting(draft, routingMemo);
	draft.setDspCoefficients(sessionDspCoefficients);
	draftRevision++;
	sampleKeys = [];
	operatorReads = [];
	visualizer.disconnect();
	highlight();
	$('start').textContent = 'Enable audio';
	if (previous) void previous.dispose().catch(() => {});
	void refresh().catch(report);
	report(error);
}
async function ensureAudio() {
	if (disposed) throw new Error('SCSP Synth is closed');
	if (!audio && !opening) {
		$('start').disabled = true;
		status('Preparing SCSP audio…');
		opening = (async () => {
			const engine = await createAudio({
				volume: Number($('volume').value),
				onError: audioFailed,
			onConfigChange({method, value}) {
				if (disposed || audio !== engine) return;
				cycle2Active = method === 'setConfig' && value.fm.algorithm === 'cycle2';
				if (cycle2Active) status('Cycle 2OP · Code-only setup. Save the JavaScript; preset support follows.');
			},
				onDspChange({ method, args = [], value }) {
					if (disposed || audio !== engine) return;
					if (method === 'routingState') {
						sessionDspRouting = clone(value);
						return;
					}
					rememberDspRoutingEdit(method, args, value);
					if (method === 'applyDspProgram') {
						const words = validateScspSynthDspProgram(value.words);
						rememberDspCoefficients(value.coefficients);
						appliedDspWords = words;
					} else if (method === 'setDspCoefficients') rememberDspCoefficients(value);
					else if (routingMethods.includes(method)) {
						void refresh().catch(report);
						return;
					} else {
						cachedPatch = { ...cachedPatch, effect: { ...value } };
					}
					// The owner has committed. Update the restart memo and Applied view
					// now, without a read round-trip or replacing the authored draft.
					const codes = [sessionDspCoefficients[0], Math.floor(cachedPatch.effect.feedback * 4096), sessionDspCoefficients[2]];
					renderDspCoefficients({ dspCoefficients: codes }, Boolean(liveView?.isActive()));
					if (!liveView?.isActive() && document.activeElement !== $('delayFeedback') && !$('delayFeedback').classList.contains('is-dragging'))
						$('delayFeedback').value = String(codes[1] / 4096);
				},
			});
			try {
				let applied;
				// Physical CH7–CH32 edits are outside the saved Auto sound, but
				// every committed draft mutation must survive asynchronous startup.
				do {
					applied = draftRevision;
					const dspWords = Array.from(appliedDspWords);
					const coefficients = { ...sessionDspCoefficients };
					await engine.command('loadIdleState', [draft.exportIdleState()]);
					await engine.command('setDspCoefficients', [coefficients]);
					await engine.command('applyDspProgram', [dspWords]);
					await engine.command('setPitchBend', [bend]);
					await applyClickGuard(engine);
				} while (applied !== draftRevision);
				if (disposed) throw new Error('SCSP Synth is closed');
				engine.setVolume(Number($('volume').value));
				const unappliedDraft = panel.captureDraft?.();
				audio = engine;
				sampleKeys = [];
				operatorReads = [];
				visualizer.connect(engine.context, engine.outputNode);
				$('start').textContent = 'Audio ready';
				await refresh();
				if (unappliedDraft) panel.restoreDraft(unappliedDraft);
				status('Audio ready.');
				syncActivity();
				return engine;
			} catch (error) {
				await engine.dispose();
				throw error;
			}
		})().finally(() => {
			opening = null;
			$('start').disabled = false;
		});
	}
	const engine = audio ?? (await opening);
	await engine.resume();
	return engine;
}
async function applyClickGuard(engine = audio) {
	const desired = $('scspClickGuard').checked,
		request = ++clickGuardIntent;
	try {
		const accepted = engine
			? await engine.command('setClickGuard', [desired])
			: await command('setClickGuard', [desired]);
		if (typeof accepted !== 'boolean')
			throw new TypeError('SCSP Click guard did not acknowledge its setting');
		if (request === clickGuardIntent) {
			clickGuardApplied = accepted;
			$('scspClickGuard').checked = accepted;
		}
		return accepted;
	} catch (error) {
		if (request === clickGuardIntent) $('scspClickGuard').checked = clickGuardApplied;
		throw error;
	}
}
$('scspClickGuard').addEventListener('change', () => {
	$('scspClickGuard').blur();
	void applyClickGuard().catch(report);
});
async function applySettings(value, { isCurrent = () => true, onCommitted = () => {} } = {}) {
	readPatch(value);
	if (!isCurrent() || disposed) return false;
	if (liveView?.isActive()) liveView.setEnabled(false);
	return enqueue(async () => {
		if (!isCurrent() || disposed) return false;
		await command('loadPatch', [value]);
		onCommitted();
		for (const key of editorDrafts.keys())
			if (key.startsWith('auto:')) editorDrafts.delete(key);
		channelView?.setSelected(null, { notify: false });
		await command('setPitchBend', [0]);
		soundName = value.name ?? null;
		bend = 0;
		setWheelUi(0);
		// A running Code session retains sounding groups and their PCM. Keep the
		// keyboard identities until keyup, then let the snapshot remove retired IDs.
		sampleKeys = [];
		operatorReads = [];
		await refresh({ dirty: true });
		status('SCSP instrument loaded.');
		return isCurrent();
	});
}
const panel = createPlaygroundScspVoicePanel({
	root: $('voice'),
	showModulation: true,
	onError: report,
	invoke: (method, args) => {
		if (liveView?.isActive() && method !== 'getPCM')
			return editSsfVoice(liveView.getEditableTarget(), method, args[1]);
		const physical = physicalEditor();
		const contextKey = editorViewKey;
		return enqueue(async () => {
			try {
				if (liveView?.isActive() && method !== 'getPCM') {
					throw new Error(
						'SSF Live view is read-only. Turn off Live to edit the instrument.',
					);
				}
				const result = await editInvoke(physical, method, args);
				if (method === 'applyPCM') {
					editorDrafts.delete(contextKey);
					committedPcmContext = contextKey;
				}
				if (!['getPCM', 'auditionOff', 'auditionOn'].includes(method))
					await refresh({ dirty: !physical || args[0] < 6 });
				return result;
			} catch (error) {
				document.activeElement?.blur();
				await refresh();
				throw error;
			} finally {
				committedPcmContext = null;
			}
		});
	},
});
$('voice').querySelector('[data-chip-action="scsp-hold"]').hidden = true;
$('voice').querySelectorAll(':scope > p')[1].hidden = true;
for (const paragraph of $('voice').querySelectorAll('p')) {
	if (paragraph.textContent.startsWith('Software editor:'))
		paragraph.textContent =
			'Software waveform editor · Apply updates new notes. Held and releasing notes retain their PCM. Unapplied drawings stay with their editing target.';
	if (paragraph.textContent.startsWith('Try Files')) paragraph.hidden = true;
}
for (const label of $('voice').querySelectorAll(':scope > label'))
	if (label.textContent.startsWith('MIDI note')) label.hidden = true;
const copyButton = $('voice').querySelector('[data-chip-action="scsp-copy"]');
copyButton.textContent = 'Copy operator JavaScript';
const numberControls = enhanceScspNumberControls(document.querySelector('.synth-shell'));
const envelopeControls = setupScspEnvelopeControls({
	root: $('voice'),
	getSelectedSlot: () => liveView?.getEditableTarget()?.slot ?? panel.getSelectedChannel(),
	invoke: (method, args) => {
		if (liveView?.isActive())
			return editSsfVoice(liveView.getEditableTarget(), method, args[1]);
		const physical = physicalEditor();
		return enqueue(async () => {
			if (liveView?.isActive())
				throw new Error(
					'SSF Live view is read-only. Turn off Live to edit the instrument.',
				);
			try {
				const result = await editInvoke(physical, method, args);
				await refresh({ dirty: !physical || args[0] < 6 });
				return result;
			} catch (error) {
				await refresh();
				throw error;
			}
		});
	},
	onError: report,
});
panel.setConnected(true);
for (const id of ['voiceMode', 'pitch', ...effectControls]) $(id).disabled = false;
for (const button of operatorButtons) button.disabled = false;
channelView = setupScspChannelView({
	onChange(selected) {
		if (selected === null && liveView?.isActive()) liveView.setEnabled(false);
		else if (selected !== null && liveView?.isActive()) liveView.selectSlot(selected);
		renderState();
		syncActivity();
	},
});
liveView = setupScspSsfLiveView({
	panel,
	panelRoot: $('voice'),
	externalSelection: true,
	getCaptureAvailability: (target) =>
		getScspSsfCaptureAvailability(ssfVoiceEdits.projectSnapshot(target), target.slot, {
			referenceMidi: target.referenceMidi,
		}),
	getEditAvailability: (_target, playback) => ({
		available: songControls?.player.getEditSession() != null &&
			['playing', 'paused'].includes(playback?.playback),
	}),
	getAuditionEditState: (target) => ssfVoiceEdits.read(target),
	onCapture: captureSsfTarget,
	onChange() {
		if (liveView?.isEnabled() && channelView?.getSelected() === null)
			channelView.setSelected(liveView.getSelectedSlot(), { notify: false });
		if (channelView?.getSelected() !== null) liveView?.selectSlot(channelView.getSelected());
		songControls?.player.setLiveEnabled(liveView?.isEnabled() ?? true);
		renderState();
	},
});
$('scspPhysicalFrequency').addEventListener('change', () => {
	const slot = channelView.getSelected(),
		frequency = Number($('scspPhysicalFrequency').value);
	$('scspPhysicalFrequency').blur();
	if (slot === null || liveView.isActive()) return;
	void enqueue(async () => {
		try {
			await command('invokePhysical', ['setFrequency', [slot, frequency]]);
			await refresh({ dirty: slot < 6 });
		} catch (error) {
			await refresh();
			throw error;
		}
	}).catch(report);
});

const sameSsfTarget = (a, b) =>
	a === b ||
	Boolean(
		a &&
			b &&
			a.snapshot === b.snapshot &&
			a.slot === b.slot &&
			a.referenceMidi === b.referenceMidi,
	);
function syncAuditionSelection() {
	const next = liveView?.getAuditionTarget() ?? null;
	if (sameSsfTarget(next, auditionSelection)) return;
	const previous = auditionSelection;
	const previousToken = loadedAuditionToken;
	auditionGeneration++;
	auditionSelection = next;
	loadedAuditionSelection = null;
	loadedAuditionToken = null;
	for (const [source, note] of held) if (note.kind === 'ssf') held.delete(source);
	if (previous && audio)
		void enqueue(() => audio?.command('stopAudition', previousToken ? [previousToken] : [])).catch(report);
	highlight();
}
async function prepareSsfAudition(engine, target) {
	const generation = auditionGeneration;
	if (!sameSsfTarget(target, liveView?.getAuditionTarget()))
		throw new DOMException('SSF audition cancelled', 'AbortError');
	const snapshot = ssfVoiceEdits.projectSnapshot(target);
	const available = getScspSsfCaptureAvailability(snapshot, target.slot, { referenceMidi: target.referenceMidi });
	if (!available.available) throw new Error(available.reason);
	if (sameSsfTarget(target, loadedAuditionSelection) && loadedAuditionToken) return loadedAuditionToken;
	const captured = createScspSsfCapture(snapshot, target.slot, {
		referenceMidi: target.referenceMidi,
	});
	const token = `ssf-preview:${++auditionSequence}`;
	await engine.command('loadAudition', [captured.preset, token]);
	if (generation !== auditionGeneration ||
		!sameSsfTarget(target, liveView?.getAuditionTarget()) || engine !== audio) {
		await engine.command('stopAudition', [token]);
		throw new DOMException('SSF audition cancelled', 'AbortError');
	}
	loadedAuditionSelection = target;
	loadedAuditionToken = token;
	return token;
}
function editSsfVoice(target, method, patch) {
	if (!target) return Promise.reject(new Error('Play or pause an SSF channel to edit its parameters.'));
	const session = songControls?.player.getEditSession();
	const value = clone(patch);
	ssfVoiceEdits.pending(target, 1, session);
	return enqueue(async () => {
		try {
			const result = songControls.player.editVoice(target.slot, method, value, session);
			ssfVoiceEdits.commit(target, method, value, result);
			renderState();
			const preview = liveView.getAuditionTarget();
			if (audio && preview?.slot === target.slot) {
				const available = getScspSsfCaptureAvailability(ssfVoiceEdits.projectSnapshot(preview), preview.slot, {
					referenceMidi: preview.referenceMidi,
				});
				if (!available.available) {
					const token = loadedAuditionToken;
					auditionGeneration++;
					loadedAuditionSelection = null;
					loadedAuditionToken = null;
					for (const [source, note] of held) if (note.kind === 'ssf') held.delete(source);
					await audio.command('stopAudition', token ? [token] : []);
					highlight();
				} else {
					const token = await prepareSsfAudition(audio, preview);
					try {
						await audio.command('invokeAudition', [token, method, [0, value]]);
					} catch (error) {
						loadedAuditionSelection = null;
						loadedAuditionToken = null;
						await audio.command('stopAudition', [token]);
						throw error;
					}
				}
			}
			status(`SSF CH${target.slot + 1} parameters updated · song writes can overwrite manual values.`);
			return true;
		} finally {
			ssfVoiceEdits.pending(target, -1, session);
			renderState();
		}
	});
}
async function captureSsfTarget(target) {
	// Keep click-time PCM/selection, but include parameter edits already queued
	// before Capture. A new run at the same file/position is still a new owner.
	const captureSession = songControls.player.getEditSession();
	if (songState?.playing) songControls.player.pause();
	const paused = songControls.getState();
	if (!paused.paused) throw new Error('Pause the SSF song before capturing its instrument.');
	const current = () => {
		const state = songControls.getState();
		return (
			!disposed &&
			songControls.player.getEditSession() === captureSession &&
			state.paused &&
			state.entryPath === paused.entryPath &&
			state.positionSeconds === paused.positionSeconds
		);
	};
	await queue;
	if (!current()) throw new DOMException('SSF Capture cancelled', 'AbortError');
	const captured = createScspSsfCapture(ssfVoiceEdits.projectSnapshot(target), target.slot, {
		referenceMidi: target.referenceMidi,
	});
	await stopKeyboard();
	if (!current()) throw new DOMException('SSF Capture cancelled', 'AbortError');
	const preset = {
		...captured.preset,
		name: `SSF Slot ${target.slot + 1} · ${midiToNoteName(target.referenceMidi)}`,
	};
	// A successful native load is the commit point. An explicit Resume / Stop
	// after it must not report cancellation of an instrument already copied.
	let committed = false;
	if (
		!(await applySettings(preset, {
			isCurrent: () => committed || current(),
			onCommitted: () => {
				committed = true;
			},
		}))
	)
		throw new DOMException('SSF Capture cancelled', 'AbortError');
	selectedOperator = 0;
	renderState();
	status(
		`Captured SSF Slot ${target.slot + 1} to Synth · reference ${midiToNoteName(target.referenceMidi)}. ${captured.warnings.join(' ')}`,
	);
}

const keyboard = document.createElement('div');
keyboard.className = 'keyboard';
$('keyboard').append(keyboard);
const tools = Object.fromEntries(
	['instrument', 'position', 'fret', 'strings', 'window'].map((name) => {
		const node = document.createElement('div');
		node.className = `fretboard-${name} ${['fret', 'strings'].includes(name) ? 'fret-display' : 'toolbar-group'}`;
		return [name, node];
	}),
);
const toolbar = document.createElement('div');
toolbar.className = 'fretboard-toolbar';
const summary = document.createElement('div');
summary.className = 'fretboard-row fretboard-summary';
summary.append(tools.fret, tools.strings);
const choices = document.createElement('div');
choices.className = 'fretboard-row';
for (const name of ['instrument', 'position', 'window']) choices.append(tools[name]);
toolbar.append(summary, choices);
$('keyboardFretboard').append(toolbar);
let layout;
function highlight() {
	const keys = new Set([...held.values()].map((note) => note.key));
	for (const button of $('keyboard').querySelectorAll('.key')) {
		const active = keys.has(button.dataset.key);
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', String(active));
	}
	syncActivity();
}
function renderKeyboard() {
	layout = createFretboardLayout({ state: fret });
	renderFretboardControls({
		instrumentRoot: tools.instrument,
		positionRoot: tools.position,
		fretDisplayRoot: tools.fret,
		stringDisplayRoot: tools.strings,
		stringWindowRoot: tools.window,
		state: fret,
		onInstrumentChange(value) {
			void stopKeyboard();
			setInstrument(fret, value);
			renderKeyboard();
		},
		onPositionPresetSelect(value) {
			void stopKeyboard();
			setFretPosition(fret, value);
			renderKeyboard();
		},
		onStringWindowChange(value) {
			void stopKeyboard();
			setStringWindowIndex(fret, value);
			renderKeyboard();
		},
	});
	const entries = layout.entries.map((entry) => ({
		...entry,
		midi: entry.midi + octave * 12,
		noteName: midiToNoteName(entry.midi + octave * 12),
	}));
	buildKeyboard({
		root: keyboard,
		rowDefs: layout.rowDefs,
		layoutEntries: entries,
		showPitch: false,
		onPointerDown(event, entry) {
			if (event.button === 0) press(`pointer:${event.pointerId}`, entry);
		},
		onPointerUp: (event) => release(`pointer:${event.pointerId}`),
		onPointerCancel: (event) => release(`pointer:${event.pointerId}`),
	});
	for (const button of keyboard.querySelectorAll('.key')) {
		const entry = entries.find((item) => item.key === button.dataset.key);
		button.disabled = entry.midi < 0 || entry.midi > 127;
		button.addEventListener('keydown', (event) => {
			if ([' ', 'Enter'].includes(event.key)) {
				event.preventDefault();
				if (!event.repeat) press(`button:${entry.key}`, entry);
			}
		});
		button.addEventListener('keyup', (event) => {
			if ([' ', 'Enter'].includes(event.key)) {
				event.preventDefault();
				release(`button:${entry.key}`);
			}
		});
	}
	$('octaveValue').textContent = `${octave >= 0 ? '+' : ''}${octave}`;
	$('octaveDown').disabled = octave <= -2;
	$('octaveUp').disabled = octave >= 3;
	highlight();
}
function press(source, entry) {
	if (switchingAudioOutput || held.has(source) || entry.midi < 0 || entry.midi > 127) return;
	const note = {
		id: `scsp-key:${++sequence}`,
		key: entry.key,
		midi: entry.midi,
		epoch,
		started: false,
		pending: false,
		kind: liveView?.getAuditionTarget()
			? 'ssf'
			: channelView?.getSelected() != null
				? 'physical'
				: 'authored',
		slot: channelView?.getSelected() ?? null,
		target: liveView?.getAuditionTarget() ?? null,
		token: null,
	};
	held.set(source, note);
	highlight();
	void enqueue(async () => {
		if (held.get(source) !== note || note.epoch !== epoch || switchingAudioOutput) return;
		const engine = await ensureAudio();
		if (held.get(source) !== note || note.epoch !== epoch || switchingAudioOutput) return;
		if (note.kind === 'ssf') {
			if (!sameSsfTarget(note.target, liveView?.getAuditionTarget())) return;
			note.token = await prepareSsfAudition(engine, note.target);
			if (
				held.get(source) !== note ||
				!sameSsfTarget(note.target, liveView?.getAuditionTarget())
			)
				return;
		}
		note.started = note.pending = true;
		if (note.kind === 'physical' && channelView.getSelected() === note.slot)
			rememberEditorDraft();
		const result = await engine.command(
			note.kind === 'ssf'
				? 'auditionOn'
				: note.kind === 'physical'
					? 'physicalNoteOn'
					: 'noteOn',
			note.kind === 'physical' ? [note.id, note.slot, note.midi] :
				note.kind === 'ssf' ? [note.id, note.midi, note.token] : [note.id, note.midi],
		);
		note.pending = false;
		if (result.stolenId)
			for (const [key, old] of held) if (old.id === result.stolenId) held.delete(key);
		if (note.kind !== 'ssf') await refresh();
		status(
			`${note.kind === 'ssf' ? `SSF CH${note.target.slot + 1} audition · ` : note.kind === 'physical' ? `CH${note.slot + 1} · ` : ''}${midiToNoteName(note.midi)} · ${held.size} held`,
		);
	}).catch((error) => {
		if (held.get(source) === note) held.delete(source);
		highlight();
		report(error);
	});
}
function release(source) {
	const note = held.get(source);
	if (!note) return;
	held.delete(source);
	highlight();
	if (note.started)
		void enqueue(async () => {
			if (audio && note.epoch === epoch)
				await audio.command(
					note.kind === 'ssf'
						? 'auditionOff'
						: note.kind === 'physical'
							? 'physicalNoteOff'
							: 'noteOff',
					[note.id, ...(note.kind === 'ssf' ? [note.token] : [])],
				);
		});
}
function stopKeyboard() {
	const notes = [...held.values()].filter((note) => note.started);
	auditionGeneration++;
	const token = loadedAuditionToken;
	loadedAuditionSelection = null;
	loadedAuditionToken = null;
	epoch++;
	held.clear();
	highlight();
	return enqueue(async () => {
		for (const note of notes)
			if (audio)
				await audio.command(
					note.kind === 'ssf'
						? 'auditionOff'
						: note.kind === 'physical'
							? 'physicalNoteOff'
							: 'noteOff',
					[note.id, ...(note.kind === 'ssf' ? [note.token] : [])],
				);
		if (audio) await audio.command('stopAudition', token ? [token] : []);
	});
}
async function stopAll() {
	await codeHost?.stop();
	await songControls?.stop();
	await stopKeyboard();
	await enqueue(() => command('stopVoices'));
	await refresh();
	visualizer.stop();
	status('Stopped · instrument retained.');
}
async function configure(patch, { routeChanged = false } = {}) {
	await enqueue(async () => {
		if (liveView?.isActive()) {
			renderState();
			return;
		}
		try {
			const before = typeof patch === 'function' || routeChanged ? (await readAuthoring()).state.config : null;
			const next = typeof patch === 'function' ? patch({config: before}) : patch;
			if (!next) {await refresh(); return;}
			const accepted = await command('setConfig', [next]);
			const graphKey = config => JSON.stringify([config.mode, config.fm.algorithm,
				config.fm.algorithm === 'custom' ? config.fm.custom : null]);
			if (routeChanged && graphKey(before) !== graphKey(accepted)) {
				for (const [source, note] of held) if (note.kind === 'authored') held.delete(source);
			}
			await refresh({ dirty: true });
			status('Sound updated.');
		} catch (error) {
			await refresh();
			throw error;
		}
	});
}
$('start').addEventListener('click', () => {
	$('start').blur();
	void enqueue(ensureAudio).catch(report);
});
$('stop').addEventListener('click', () => {
	$('stop').blur();
	void stopAll().catch(report);
});
for (const [id, delta] of [
	['octaveDown', -1],
	['octaveUp', 1],
])
	$(id).addEventListener('click', () => {
		$(id).blur();
		void stopKeyboard();
		octave = Math.max(-2, Math.min(3, octave + delta));
		renderKeyboard();
	});
const editing = (target) => {
	const input = target?.closest?.(
		'input,select,textarea,[contenteditable="true"],dialog[open],.monaco-editor',
	);
	return input && !input.matches?.('input[type="range"],input[type="checkbox"]');
};
window.addEventListener('keydown', (event) => {
	if (event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
	const entry = layout.entries.find((item) => item.key === event.key.toLowerCase());
	if (!entry) return;
	event.preventDefault();
	if (!event.repeat)
		press(`key:${event.code || entry.key}`, {
			...entry,
			midi: entry.midi + octave * 12,
		});
});
window.addEventListener('keyup', (event) =>
	release(`key:${event.code || event.key.toLowerCase()}`),
);
window.addEventListener('blur', () => {
	void stopKeyboard();
	setBend(0);
});
document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		void stopKeyboard();
		setBend(0);
	}
	syncActivity();
});
function setWheelUi(value) {
	for (const [input, output] of wheels) {
		input.value = String(value);
		output.textContent = `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
	}
}
function setBend(value) {
	bend = value;
	setWheelUi(value);
	if (!audio && !opening) return;
	void enqueue(async () => {
		await command('setPitchBend', [value]);
		await refresh();
	}).catch(report);
}
for (const [input] of wheels) {
	input.addEventListener('input', () => setBend(Number(input.value)));
	for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'change'])
		input.addEventListener(type, () => setBend(0));
}
function setVolume() {
	const value = Number($('volume').value);
	$('volumeValue').textContent = `${Math.round(value * 100)}%`;
	$('volume').dataset.boosted = String(value > 1);
	audio?.setVolume(value);
	visualizer.wake();
}
$('volume').addEventListener('input', setVolume);
$('volume').addEventListener('change', () => $('volume').blur());
$('voiceMode').addEventListener('change', () => {
	const mode = $('voiceMode').value;
	$('voiceMode').blur();
	void configure(state => ({mode,
		...(mode === 'pcm' && state.config.fm.algorithm === 'custom' ? {fm: {algorithm: 'chain'}} : {}),
	}), { routeChanged: true }).catch(report);
});
$('algorithm').addEventListener('change', () => {
	$('algorithm').blur();
	void configure({ fm: { algorithm: $('algorithm').value } }, { routeChanged: true }).catch(
		report,
	);
});
for (const [id, key] of [
	['fmDepth', 'depth'],
	['fmRatio', 'ratio'],
])
	$(id).addEventListener('change', () => {
		$(id).blur();
		void configure({ fm: { [key]: Number($(id).value) } }).catch(report);
	});
$('pitch').addEventListener('change', () => {
	$('pitch').blur();
	void configure({ transpose: Number($('pitch').value) }).catch(report);
});
$('operatorRatio').addEventListener('change', () => {
	$('operatorRatio').blur();
	const value = Number($('operatorRatio').value),
		selected = selectedOperator;
	void enqueue(async () => {
		if (liveView?.isActive()) {
			renderState();
			return;
		}
		const { state } = await readAuthoring();
		const ratios = [...state.config.fm.ratios];
		ratios[selected] = value;
		await command('setConfig', [{ fm: { ratios } }]);
		await refresh({ dirty: true });
	}).catch(report);
});
for (const button of operatorButtons)
	button.addEventListener('click', () => {
		if (liveView?.isActive()) return;
		selectedOperator = Number(button.dataset.operator);
		if (latestState) renderState();
		button.blur();
	});
for (const [id, key] of [
	['effectEnabled', 'enabled'],
	['delayTime', 'timeMs'],
	['delayFeedback', 'feedback'],
	['effectSend', 'send'],

]) {
	$(id).addEventListener('change', () => {
		const value = key === 'enabled' ? $(id).checked : Number($(id).value);
		$(id).blur();
		void enqueue(async () => {
			if (liveView?.isActive()) {
				renderState();
				return;
			}
			try {
				await command('setEffect', [{ [key]: value }]);
				await refresh({ dirty: true });
				status('Experimental DSP parameters updated.');
			} catch (error) {
				await refresh();
				throw error;
			}
		}).catch(report);
	});
}
for (let index = 0; index < 3; index++) {
	const input = $(`scspDspCoef${index}`);
	input?.addEventListener('change', () => {
		const code = input.value.trim() === '' ? NaN : Number(input.value), request = ++coefficientEditSequence;
		input.blur();
		void enqueue(async () => {
			if (liveView?.isActive()) {
				renderState();
				return;
			}
			const feedback = $('scspDspCoefficientsStatus');
			try {
				const result = await command('setDspCoefficients', [{ [index]: code }]);
				rememberDspCoefficients(result);
				await refresh({ dirty: index === 1 });
				if (request === coefficientEditSequence && feedback) {
					feedback.textContent = `COEF${index} updated. Voices and DSP tail kept.`;
					feedback.dataset.error = 'false';
					status(feedback.textContent);
				}
			} catch (error) {
				await refresh();
				if (request === coefficientEditSequence && feedback) {
					feedback.textContent = 'Coefficient update failed: ' + error.message;
					feedback.dataset.error = 'true';
				}
				throw error;
			}
		}).catch(report);
	});
}
for (const button of document.querySelectorAll('[data-visual-mode]'))
	button.addEventListener('click', () => {
		visualizer.setMode(button.dataset.visualMode);
		for (const peer of document.querySelectorAll('[data-visual-mode]'))
			peer.setAttribute('aria-pressed', String(peer === button));
		button.blur();
	});
const monitorResize = new ResizeObserver(() => {
	const canvas = $('outputCanvas');
	if (!canvas.clientWidth || !canvas.clientHeight) return;
	canvas.width = Math.max(240, Math.round(canvas.clientWidth));
	canvas.height = Math.max(150, Math.round(canvas.clientHeight));
	visualizer.setMode(
		document.querySelector('[data-visual-mode][aria-pressed="true"]').dataset.visualMode,
	);
});
monitorResize.observe($('outputCanvas'));
function chipTab(dsp) {
	$('scspChipPanel').hidden = dsp;
	$('scspDspPanel').hidden = !dsp;
	for (const [id, selected] of [
		['scspChipTab', !dsp],
		['scspDspTab', dsp],
	]) {
		$(id).setAttribute('aria-selected', String(selected));
		$(id).tabIndex = selected ? 0 : -1;
	}
	panel.setVisible(!dsp);
	if (dsp && latestState) renderState();
}
for (const [id, dsp] of [
	['scspChipTab', false],
	['scspDspTab', true],
])
	$(id).addEventListener('click', () => {
		$(id).blur();
		chipTab(dsp);
	});
fmDepthView = setupScspFmDepthView({
	onDepth(operator, value, count) {
		return configure(state => {
			if (state.config.mode === 'pcm' || operatorCount(state.config.mode) !== count || operator >= count) return null;
			const depths = state.config.fm.depths ? [...state.config.fm.depths] : Array(6).fill(state.config.fm.depth);
			depths[operator] = value;
			return {fm: {depths}};
		});
	},
	onError: report,
});
customFmView = setupScspCustomFmView({
	onInput(operator, source, port, count) {
		return configure(state => {
			if (operatorCount(state.config.mode) !== count || state.config.fm.algorithm !== 'custom' || operator >= count) return null;
			const graph = clone(state.config.fm.custom);
			const inputs = graph.inputs[operator];
			if (port === 0) graph.inputs[operator] = source === null ? [] : source === operator ? [source] : [source, ...inputs.slice(1)];
			else {
				if (!inputs.length || inputs[0] === operator) return null;
				graph.inputs[operator] = source === null ? inputs.slice(0, 1) : [inputs[0], source];
			}
			return {fm: {custom: graph}};
		}, {routeChanged: true});
	},
	onOutput(operator, enabled, count) {
		return configure(state => {
			if (operatorCount(state.config.mode) !== count || state.config.fm.algorithm !== 'custom' || operator >= count) return null;
			const graph = clone(state.config.fm.custom);
			graph.outputs = enabled ? [...new Set([...graph.outputs, operator])].sort() : graph.outputs.filter(index => index !== operator);
			return {fm: {custom: graph}};
		}, {routeChanged: true});
	},
	onError: report,
});
ssfDspView = setupScspSsfDspView({root: $('scspSsfDspView')});
dspSignalFlow = setupScspDspSignalFlow();
dspRoutingView = setupScspDspRoutingView({
	onSource(operator) {
		selectedOperator = operator;
		renderState();
	},
	onSend(target, patch) {
		return enqueue(async () => {
			if (liveView?.isActive()) {renderState(); return;}
			await command(target.kind === 'source' ? 'setDspSourceSend' : 'setDspSend', [target.index, patch]);
			await refresh();
			status('DSP send updated. Held notes continue. Save setup to Code to keep routing.');
		});
	},
	onReturn(output, patch) {
		return enqueue(async () => {
			if (liveView?.isActive()) {renderState(); return;}
			await command('setDspReturn', [output, patch]);
			await refresh({dirty: output === 0 && patch.level !== undefined});
			status(`DSP Return ${output} updated. Voices and DSP history kept.`);
		});
	},
	onError: report,
});
dspProgramView = setupScspDspProgramView({
	getAppliedProgram: () => appliedDspWords,
	getAppliedCoefficients: () => [sessionDspCoefficients[0], Math.floor(cachedPatch.effect.feedback * 4096), sessionDspCoefficients[2]],
	async saveSetupCode() {
		const files = codeHost.files;
		await files.ready;
		const workspace = files.workspaceId, owner = audio;
		const current = () => !disposed && audio === owner && files.workspaceId === workspace;
		const cancelled = () => new DOMException('The SCSP workspace or audio changed during save.', 'AbortError');
		const snapshot = await enqueue(async () => {
			if (!current()) throw cancelled();
			// One owner turn captures program, coefficients and effect together.
			// The passive branch never acquires or renders an audio device.
			return owner ? owner.command('readDspSetup') : {...draft.readDspSetup(), words: Array.from(appliedDspWords)};
		});
		if (!current()) throw cancelled();
		return codeHost.saveDspSetupCode(createScspDspSetupCode(snapshot), { isCurrent: current });
	},
	applyProgram: (words, options) => {
		const candidate = validateScspSynthDspProgram(words);
		const setup = validateScspDspProgramOptions(options);
		return enqueue(async () => {
			if (disposed) throw new Error('SCSP Synth is closed');
			const engine = audio;
			if (!engine) {
				const coefficients = setup ? draft.setDspCoefficients(setup.coefficients) : undefined;
				if (coefficients) rememberDspCoefficients(coefficients);
				appliedDspWords = candidate;
				draftRevision++;
				await refresh({ dirty: Boolean(setup) }).catch(report);
				return { words: Array.from(candidate), active: false, ...(coefficients ? {coefficients} : {}) };
			}
			const result = await engine.command('applyDspProgram', setup ? [Array.from(candidate), setup] : [Array.from(candidate)]);
			if (audio !== engine) throw new Error('SCSP audio changed during DSP Apply. Start audio again.');
			const accepted = validateScspSynthDspProgram(result.words);
			if (!accepted.every((word, index) => word === candidate[index]))
				throw new Error('SCSP DSP reply did not match the requested program.');
			if (setup) {
				if (result.coefficients?.codes?.length !== 3 || !result.coefficients.codes.every((code, index) => code === setup.coefficients[index]))
					throw new Error('SCSP DSP reply did not match the requested coefficients.');
				rememberDspCoefficients(result.coefficients);
			}
			appliedDspWords = accepted;
			// A failed display read cannot undo an acknowledged audio transaction.
			await refresh({ dirty: Boolean(setup) }).catch(report);
			return { ...result, active: audio === engine };
		});
	},
});
setupSynthMenu({ document, window });
$('loadPreset').addEventListener('click', () => $('open').click());
$('open').addEventListener('change', async () => {
	const file = $('open').files?.[0];
	$('open').value = '';
	if (!file) return;
	try {
		if (file.size > 8 * 1024 * 1024) throw new Error('Preset must be at most 8 MiB');
		await applySettings(JSON.parse(await file.text()));
	} catch (error) {
		report(error);
	}
});
$('save').addEventListener('click', async () => {
	try {
		await refresh();
		const sound = portableSound();
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(sound, null, 2) + '\n'], {
				type: 'application/json',
			}),
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'scsp-voice.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		status('Preset saved · applied PCM, operators, routing and DSP settings.');
	} catch (error) {
		report(error);
	}
});
codeHost = setupScspCodeHost({
	ensureAudio,
	getAudio: () => audio,
	getSettings: () => clone(cachedPatch),
	getSoundSettings: portableSound,
	applySettings,
	stopKeyboard,
	onBeforeRun: async () => {
		await songControls?.stop();
		await songControls?.whenIdle();
	},
	stopSong: async () => {
		await songControls?.stop();
		await songControls?.whenIdle();
	},
	onOpenSource: (file, options) =>
		isScspSongPath(options.path) ? songControls.selectFile(file, options) : false,
	onActivity: syncActivity,
	setStatus: status,
});
songControls = setupScspSongControls({
	project: codeHost.project,
	ensureAudio,
	getAudio: () => audio,
	stopCode: async () => {
		await codeHost.stop();
		await stopKeyboard();
	},
	onState(state) {
		songState = state;
		syncActivity();
		renderState();
	},
	setStatus: status,
});
void codeHost.ready.then(() => songControls.refresh()).catch(report);
$('loadVgm').addEventListener('click', () => $('vgmFileInput').click());
$('vgmFileInput').addEventListener('change', async () => {
	const files = [...$('vgmFileInput').files];
	$('vgmFileInput').value = '';
	if (!files.length) return;
	try {
		await codeHost.ready;
		const paths = await codeHost.files.importFiles(files);
		const path = paths.find((value) => /\/vgm\/.*\.(?:vgm|vgz)$/i.test(value));
		if (path)
			await songControls.selectFile(codeHost.project.fs.get(path), {
				path,
			});
	} catch (error) {
		report(error);
	}
});
for (const [buttonId, inputId] of [
	['loadSsf', 'ssfFileInput'],
	['loadSsfFolder', 'ssfFolderInput'],
]) {
	$(buttonId).addEventListener('click', () => $(inputId).click());
	$(inputId).addEventListener('change', async () => {
		const files = [...$(inputId).files];
		$(inputId).value = '';
		if (!files.length) return;
		try {
			await codeHost.ready;
			const paths = await codeHost.files.importFiles(files, {
				ssfOnly: true,
			});
			const entryPath = paths.find((path) => /\.(?:ssf|minissf)$/i.test(path));
			if (entryPath) await songControls.selectFile(entryPath);
			else status(paths.length ? 'SSF libraries imported.' : 'No SSF files in this folder.');
		} catch (error) {
			report(error);
		}
	});
}
window.addEventListener('pagehide', (event) => {
	if (event.persisted) {
		void stopKeyboard();
		return;
	}
	disposed = true;
	dspProgramView?.dispose();
	dspRoutingView?.dispose();
	dspSignalFlow?.dispose();
	customFmView?.dispose();
	fmDepthView?.dispose();
	ssfDspView?.dispose();
	epoch++;
	held.clear();
	observer.dispose();
	monitorResize.disconnect();
	visualizer.dispose();
	liveView.dispose();
	channelView.dispose();
	envelopeControls.dispose();
	panel.dispose();
	numberControls.dispose();
	songControls.dispose();
	const previous = audio;
	audio = null;
	void codeHost.dispose().finally(() => previous?.dispose());
	draft.dispose();
});
const localDesktop =
	(location.protocol === 'tauri:' && location.hostname === 'localhost') ||
	(['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
	Object.defineProperty(window, 'tetoricaSynthAudio', {
		value: Object.freeze({
			setSwitching(value) {
				switchingAudioOutput = value === true;
				syncActivity();
			},
			async ensureReady() {
				const engine = await ensureAudio();
				return { context: engine.context, output: engine.outputNode };
			},
			async stopPlayback() {
				await stopAll();
				setBend(0);
			},
		}),
	});
	window.dispatchEvent(new Event('tetorica-synth-ready'));
}
renderKeyboard();
setVolume();
void refresh().catch(report);
