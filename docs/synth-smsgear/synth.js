// SPDX-License-Identifier: BSD-3-Clause
import {
	buildKeyboard as buildSharedKeyboard,
	createFretboardLayout,
	createFretboardState,
} from "../synth/synth_keyboard.js";
import { RHYTHM_KEYS, assignedDrums, keyboardAction } from "./performance.js";
import { buildSongEdit } from "./song_edit.js";
import { setupPerformanceSelects } from "./performance_select.js";
import { createOpllEnvelopeEditor } from "./opll_envelope.js";
import { createParamControl } from "../synth/synth_controls.js";
import { createSynthOutputVisualizer } from "../synth/synth_output_visualizer.js";
import { setupSynthExpandedTabs } from "../synth/synth_expanded_tabs.js";
import { YM2413_INSTRUMENTS } from "../js/ym2413synth.js";
import {
	createDefaultPreset,
	readPreset,
	presetFromRegisters,
	capturePreset,
} from "./preset.js";
import { createSmsGearAudio, DRUMS, SOURCE_GAINS } from "./audio.js";
import { setupSmsGearCodeHost } from "./code_host.js";
import { readSmsGearVgm } from "./vgm_import.js";
import { createSmsGearSongPlayer } from "./song_player.js";
const $ = (id) => document.getElementById(id),
	clone = structuredClone;
let preset = createDefaultPreset(),
	accepted = readPreset(preset),
	audio = null,
	audioPending = null,
	host,
	expanded;
let section = "psg",
	channel = "auto",
	octave = 0,
	pitch = 0,
	nextVoice = 0,
	liveState = null,
	songState = null,
	frozenSongState = null,
	song = null,
	songPath = null,
	songEpoch = 0,
	songAbort = null,
	songBusy = false,
	songMode = "stopped";
let monitor = "envelope",
	display = preset,
	polling = false,
	envelopeAnalyser = null;
const rmsSamples = new Float32Array(512),
	rmsHistory = [];
const envelopeEditors = [];
const fretboard = createFretboardState();
let keyboardLayout;
const visualizer = createSynthOutputVisualizer(),
	keys = new Map(),
	controls = new Map(),
	panControls = [];
const mix = {
	segapsg: { volume: SOURCE_GAINS.segapsg, enabled: true },
	ym2413: { volume: SOURCE_GAINS.ym2413, enabled: true },
};
const channelMutes = {
	segapsg: Array(4).fill(false),
	ym2413: Array(9).fill(false),
};
let seekDraft = false;
const report = (error) => status(error?.message ?? String(error));
function status(message) {
	$("audioStatus").textContent = message;
}
const songView = () => $("songView").value === "song" && songState;
const songDisplay = () => frozenSongState ?? songState;
const selected = () => (channel === "auto" ? 0 : Number(channel));
const kind = () => (section === "opll" ? "opll" : "psg");

function control(
	id,
	label,
	max,
	get,
	set,
	{ boolean = false, category = "" } = {},
) {
	const c = createParamControl({
		label,
		min: 0,
		max,
		step: 1,
		value: get(),
		onChange: (value) => {
			try {
				set(value);
			} catch (error) {
				report(error);
				render();
			}
		},
		booleanMode: boolean,
		category,
	});
	$(id).append(c.element);
	controls.set(id, { ...c, get });
	return c;
}
function settingsEdit(change) {
	if (songView()) {
		if (!song || songBusy) {
			status("Wait for the song operation to finish.");
			return;
		}
		const next = clone(display);
		change(next);
		const valid = readPreset(next),
			player = song;
		const command = buildSongEdit(kind(), selected(), display, valid);
		if (!command.changes.length) return;
		display = valid;
		if (songMode === "paused")
			audio?.applySettings(valid, {
				section: kind(),
				channel: selected(),
			});
		render(false);
		void player
			.editSound(command)
			.then(() => player.snapshot())
			.then((state) => {
				if (song !== player) return;
				songState = state;
				if (!$("songLive").checked) frozenSongState = clone(state);
				render();
				status(
					"Edited the song channel. Later VGM writes may overwrite these controls.",
				);
			})
			.catch((error) => {
				if (song === player) {
					render();
					report(error);
				}
			});
		return;
	}
	if (channel === "auto" && !host.files.canEditSound()) {
		status("Finish the active JSON edit before changing sound controls.");
		return;
	}
	const value = clone(display);
	value.section = kind();
	change(value);
	const valid = readPreset(value);
	if (channel === "auto") {
		host.files.validateSoundEdit(valid);
		preset = valid;
		if (host.files.isAutoApply()) {
			accepted = readPreset(valid);
			audio?.applySettings(accepted, { section: kind() });
		}
		host.markSoundDirty(preset);
	} else
		audio?.applySettings(valid, {
			section: kind(),
			channel: Number(channel),
		});
	display = valid;
	render(false);
}
async function applySettings(value, options = {}) {
	if (options.isCurrent && !options.isCurrent()) return false;
	const next = readPreset(value),
		draft = readPreset(options.displayPreset ?? value);
	preset = draft;
	section = draft.section;
	channel = "auto";
	if (options.applyAudio !== false) {
		accepted = next;
		audio?.applySettings(next);
	}
	render();
	return true;
}
async function ensureAudio() {
	if (audio) {
		await audio.context.resume();
		return audio;
	}
	if (audioPending) return audioPending;
	const task = createSmsGearAudio({
		master: Number($("masterVolume").value),
		onError: report,
	})
		.then((owner) => {
			audio = owner;
			owner.applySettings(accepted);
			for (const [name, value] of Object.entries(mix))
				owner.setMix(name, value);
			visualizer.connect(owner.context, [owner.masterNode]);
			envelopeAnalyser = owner.context.createAnalyser();
			envelopeAnalyser.fftSize = 512;
			owner.masterNode.connect(envelopeAnalyser);
			$("startAudio").textContent = "Audio ready";
			status("Audio ready. Play the keyboard or Code.");
			return owner;
		})
		.finally(() => {
			if (audioPending === task) audioPending = null;
		});
	audioPending = task;
	return task;
}
function allKeyboardOff() {
	for (const item of keys.values()) audio?.noteOff(item.voice);
	keys.clear();
	paintKeyboard();
}
async function stopSong() {
	const wasSongView = Boolean(songView());
	songEpoch++;
	songAbort?.abort();
	songAbort = null;
	song?.dispose();
	song = null;
	songBusy = false;
	songMode = "stopped";
	songState = null;
	frozenSongState = null;
	seekDraft = false;
	$("songTime").textContent = "0:00 / 0:00";
	$("songReadout").textContent = "No reference song loaded.";
	$("songView").value = "synth";
	if (wasSongView) {
		allKeyboardOff();
		audio?.applySettings(accepted);
		channel = "auto";
		liveState = null;
	}
	updateTransport();
	render();
}
async function stopAll() {
	await stopSong();
	await host.stop();
	allKeyboardOff();
	audio?.stopAll();
	status("All sound stopped.");
}
function pickChannel() {
	if (channel !== "auto") return Number(channel);
	if (section === "psg" && preset.psg.source === "noise") return 3;
	const count = section === "psg" ? 3 : display.opll.rhythm.enabled ? 6 : 9,
		used = new Set([...keys.values()].map((v) => v.voice?.channel));
	for (let i = 0; i < count; i++) {
		const ch = (nextVoice + i) % count;
		if (!used.has(ch)) {
			nextVoice = (ch + 1) % count;
			return ch;
		}
	}
	return nextVoice++ % count;
}
async function press(id, midi) {
	if (keys.has(id)) return;
	const request = { midi, voice: null };
	keys.set(id, request);
	try {
		await ensureAudio();
		if (keys.get(id) !== request) return;
		const selectedSection = kind(),
			paused = songView() && song && songMode === "paused",
			target = paused ? selected() : pickChannel();
		if (paused) {
			const captured = presetFromRegisters(
				selectedSection,
				target,
				songDisplay(),
			);
			audio.applySettings(captured, {
				section: selectedSection,
				channel: target,
			});
		}
		request.voice = audio.noteOn(
			selectedSection === "psg" ? "segapsg" : "ym2413",
			target,
			midi,
			pitch,
		);
		paintKeyboard();
	} catch (error) {
		keys.delete(id);
		paintKeyboard();
		report(error);
	}
}
function release(id) {
	const held = keys.get(id);
	if (!held) return;
	keys.delete(id);
	audio?.noteOff(held.voice);
	paintKeyboard();
}
function keyAction(key) {
	return keyboardAction(key, {
		section,
		channel,
		rhythm: display.opll.rhythm.enabled,
		entries: keyboardLayout?.entries ?? [],
	});
}
function playKeyboardEntry(id, entry) {
	const action = keyAction(entry.key);
	if (action?.kind === "drum") return pressDrum(action.index, id);
	if (action?.kind === "note") return press(id, action.midi);
}
function paintKeyboard() {
	for (const button of $("keyboard").querySelectorAll("[data-key]")) {
		const entry = keyboardLayout.entries.find(
				(value) => value.key === button.dataset.key,
			),
			action = keyAction(entry.key);
		button.disabled = !action;
		button.querySelector("span").textContent =
			action?.kind === "drum"
				? RHYTHM_KEYS[action.index].short
				: action
					? entry.noteName
					: "—";
		button.setAttribute(
			"aria-label",
			`${entry.label} · ${action?.kind === "drum" ? RHYTHM_KEYS[action.index].label : action ? entry.noteName : "Not assigned on this Rhythm channel"}`,
		);
		button.classList.toggle(
			"is-active",
			[...keys.values()].some((item) =>
				action?.kind === "drum"
					? item.voice?.channel === action.drum
					: action?.kind === "note" && item.midi === entry.midi,
			),
		);
	}
}
function buildKeyboard() {
	allKeyboardOff();
	keyboardLayout = createFretboardLayout({ state: fretboard, octave });
	buildSharedKeyboard({
		root: $("keyboard"),
		rowDefs: keyboardLayout.rowDefs,
		layoutEntries: keyboardLayout.entries,
		showPitch: false,
		onPointerDown: (event, entry) =>
			Promise.resolve(
				playKeyboardEntry("pointer:" + event.pointerId, entry),
			).catch(report),
		onPointerUp: (event) => release("pointer:" + event.pointerId),
		onPointerCancel: (event) => release("pointer:" + event.pointerId),
	});
	$("octaveValue").textContent = (octave >= 0 ? "+" : "") + octave;
	paintKeyboard();
}

function setPitch(value) {
	pitch = Number(value);
	for (const id of ["pitchBend", "keyboardPitchBend"])
		$(id).value = String(pitch);
	for (const id of ["pitchBendValue", "keyboardPitchValue"])
		$(id).textContent = (pitch >= 0 ? "+" : "") + pitch.toFixed(2);
	for (const item of keys.values())
		audio?.retune(item.voice, item.midi, pitch);
}
function editing(target) {
	return Boolean(
		target?.closest(
			"dialog[open],.monaco-editor,#synthCodeEditorHost,textarea,input:not([type=range]):not([type=checkbox]),[contenteditable=true]",
		),
	);
}
document.addEventListener("keydown", (event) => {
	if (
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.repeat ||
		editing(event.target)
	)
		return;
	const key = event.key.toLowerCase();
	const entry = keyboardLayout?.entries.find((value) => value.key === key);
	if (!entry) return;
	event.preventDefault();
	void Promise.resolve(playKeyboardEntry("key:" + key, entry)).catch(report);
});
document.addEventListener("keyup", (event) => {
	release("key:" + event.key.toLowerCase());
});
window.addEventListener("blur", allKeyboardOff);
async function pressDrum(index, id) {
	if (keys.has(id)) return;
	const request = { midi: -1, voice: null };
	keys.set(id, request);
	try {
		await ensureAudio();
		if (keys.get(id) !== request) return;
		if (songView() && song && songMode === "paused") {
			const captured = presetFromRegisters(
				"opll",
				RHYTHM_KEYS[index].channel,
				songDisplay(),
			);
			audio.applySettings(captured, {
				section: "opll",
				channel: RHYTHM_KEYS[index].channel,
			});
			// HH/Cymbal and the other drums use the shared physical oscillators.
			for (const ch of [6, 7, 8]) {
				const voice = songDisplay().fm.channels[ch];
				if (
					songDisplay().fm.clock === audio.opll.clock ||
					!voice.frequency
				)
					audio.opll.setPitch(ch, voice.fnum, voice.block);
				else audio.opll.setFrequency(ch, voice.frequency);
			}
		}
		request.voice = audio.noteOn("ym2413", DRUMS[index], 60);
		paintKeyboard();
	} catch (error) {
		keys.delete(id);
		report(error);
	}
}
function renderChannels() {
	const parent = $("channelTabs");
	parent.hidden = section === "mixer";
	if (parent.hidden) return;
	// Live polling must not replace a button between pointerdown and click.
	// Only switching chips changes the physical channel list.
	if (parent.dataset.chip !== section) {
		const count = section === "opll" ? 9 : 4;
		const buttons = [
			"auto",
			...Array.from({ length: count }, (_, i) => String(i)),
		].map((value) => {
			const button = document.createElement("button");
			button.type = "button";
			button.setAttribute("role", "tab");
			button.dataset.channel = value;
			button.textContent =
				value === "auto"
					? "Auto"
					: section === "psg" && value === "3"
						? "Noise"
						: `CH${Number(value) + 1}`;
			button.addEventListener("click", () => {
				channel = value;
				render();
			});
			return button;
		});
		parent.replaceChildren(...buttons);
		parent.dataset.chip = section;
	}
	for (const button of parent.children) {
		button.setAttribute(
			"aria-selected",
			String(channel === button.dataset.channel),
		);
		button.disabled = !!songView() && button.dataset.channel === "auto";
		const value = button.dataset.channel;
		if (section === "opll" && Number(value) >= 6)
			button.textContent = display.opll.rhythm.enabled
				? `CH${Number(value) + 1} · ${assignedDrums(value)
						.map((d) => d.short)
						.join(" / ")}`
				: `CH${Number(value) + 1}`;
	}
}

function render(updateState = true) {
	if (songView() && channel === "auto") channel = "0";
	const blocked = !!songView() && (!song || songBusy);
	const source = songView() ? songDisplay() : liveState,
		selectedKind = kind();
	if (updateState)
		display =
			(channel !== "auto" || songView()) && source
				? presetFromRegisters(selectedKind, selected(), source)
				: preset;
	for (const name of ["psg", "opll", "mixer"]) {
		$(name + "Panel").hidden = section !== name;
		$(name + "Tab").setAttribute("aria-selected", String(section === name));
	}
	renderChannels();
	if (keyboardLayout) paintKeyboard();
	for (const editor of envelopeEditors) editor.invalidate();
	$("psgSource").value = display.psg.source;
	$("noiseType").value = display.psg.noiseType;
	$("noiseRate").value = display.psg.noiseRate;
	$("fmInstrument").value = String(display.opll.instrument);
	$("psgSource").disabled = channel !== "auto" || !!songView();
	for (const [id, c] of controls) {
		c.updateVisual(c.get());
		for (const button of c.element.querySelectorAll("button"))
			button.disabled = blocked;
	}
	for (const { input, bit } of panControls) {
		input.checked = !!(display.psg.stereo & (1 << bit));
		input.disabled = blocked;
	}
	for (const id of ["noiseType", "noiseRate", "fmInstrument"])
		$(id).disabled =
			blocked ||
			(id !== "fmInstrument" && !!songView() && selected() !== 3);
	for (const button of $("userPatch").querySelectorAll(
		".param-control button",
	))
		button.disabled =
			display.opll.instrument !== 0 || blocked || rhythmChannel();
	for (const button of $("drumControls").querySelectorAll("[data-drum]"))
		button.disabled = !display.opll.rhythm.enabled;
	$("editUserPatch").hidden = display.opll.instrument === 0;
	$("editUserPatch").disabled = blocked || rhythmChannel();
	$("userPatchNote").textContent = songView()
		? "Edits go directly to the song. User patch / Rhythm are shared; later VGM writes may overwrite edits. Capture keeps a Synth copy."
		: display.opll.instrument === 0
			? "Editing the one shared hardware patch. Every instrument-0 voice changes."
			: "Fixed ROM instrument: operators cannot be edited. Select User to edit the stored User patch (the fixed ROM sound is not copied).";

	updateRhythmView();
	const ch =
		channel === "auto"
			? "Auto"
			: section === "psg" && channel === "3"
				? "Noise"
				: `CH${Number(channel) + 1}`;
	const state = source?.[selectedKind === "psg" ? "psg" : "fm"],
		voice = state?.channels?.[selected()];
	$("channelReadout").textContent =
		`${ch} · ${songView() ? "Song channel · direct editing" : channel === "auto" ? "software keyboard allocation; select a CH to inspect Code" : "physical channel · direct editing"}${voice ? ` · ${voice.active ? "On" : "Off"} · ${Math.round(voice.frequencyHz ?? voice.frequency ?? 0)} Hz` : ""}`;
	if (rhythmChannel())
		$("channelReadout").textContent = `${ch} · Rhythm · ${assignedDrums(
			channel,
		)
			.map(
				(d) =>
					d.label +
					(source?.fm?.rhythm
						? source.fm.rhythm[d.name]
							? " On"
							: " Off"
						: ""),
			)
			.join(" / ")}`;
	if (document.activeElement !== $("soundName"))
		$("soundName").value = preset.name;
	$("captureSound").disabled = !songState || section === "mixer" || songBusy;
}
function selectSection(value) {
	section = value;
	if (channel !== "auto" && value === "psg" && Number(channel) > 3)
		channel = "auto";
	render();
	expanded?.showChip($(value + "Tab"));
}
for (const name of ["psg", "opll", "mixer"])
	$(name + "Tab").addEventListener("click", () => selectSection(name));
$("psgSource").addEventListener("change", (event) =>
	settingsEdit((v) => {
		v.psg.source = event.target.value;
		v.section = "psg";
	}),
);
for (const [id, field] of [
	["noiseType", "noiseType"],
	["noiseRate", "noiseRate"],
])
	$(id).addEventListener("change", (event) =>
		settingsEdit((v) => {
			v.psg[field] = event.target.value;
		}),
	);
$("fmInstrument").replaceChildren(
	...YM2413_INSTRUMENTS.map(
		(name, index) => new Option(`${index} · ${name}`, String(index)),
	),
);
$("fmInstrument").addEventListener("change", (event) =>
	settingsEdit((v) => {
		v.opll.instrument = Number(event.target.value);
		v.section = "opll";
	}),
);
$("soundName").addEventListener("change", (event) => {
	try {
		const next = readPreset({ ...preset, name: event.target.value });
		host.files.validateSoundEdit(next);
		preset = next;
		host.markSoundDirty(preset);
	} catch (error) {
		report(error);
		render();
	}
});
control(
	"psgAttenuation",
	"Attenuation · 0 loud / 15 silent",
	15,
	() => display.psg.attenuation,
	(value) =>
		settingsEdit((v) => {
			v.psg.attenuation = value;
		}),
);
control(
	"fmAttenuation",
	"Attenuation",
	15,
	() => display.opll.attenuation,
	(value) =>
		settingsEdit((v) => {
			v.opll.attenuation = value;
		}),
);
control(
	"fmSustain",
	"Sustain",
	1,
	() => display.opll.sustain,
	(value) =>
		settingsEdit((v) => {
			v.opll.sustain = Boolean(value);
		}),
	{ boolean: true },
);
control(
	"rhythmEnabled",
	"Shared Rhythm · CH7–9",
	1,
	() => display.opll.rhythm.enabled,
	(value) => {
		allKeyboardOff();
		settingsEdit((v) => {
			v.opll.rhythm.enabled = Boolean(value);
		});
	},
	{ boolean: true },
);
control(
	"feedback",
	"Feedback",
	7,
	() => display.opll.userPatch.feedback,
	(value) =>
		settingsEdit((v) => {
			v.opll.userPatch.feedback = value;
		}),
);
for (let ch = 0; ch < 4; ch++) {
	const box = document.createElement("div");
	box.append(document.createTextNode(ch === 3 ? "Noise" : `Tone ${ch + 1}`));
	for (const [label, bit] of [
		["L", ch + 4],
		["R", ch],
	]) {
		const wrap = document.createElement("label"),
			input = document.createElement("input");
		input.type = "checkbox";
		input.setAttribute("aria-label", `PSG CH${ch + 1} ${label}`);
		wrap.append(input, document.createTextNode(label));
		box.append(wrap);
		panControls.push({ input, bit });
		input.addEventListener("change", () =>
			settingsEdit((v) => {
				v.psg.stereo = input.checked
					? v.psg.stereo | (1 << bit)
					: v.psg.stereo & ~(1 << bit);
			}),
		);
	}
	$("stereoControls").append(box);
}
function rhythmChannel() {
	return (
		section === "opll" &&
		display.opll.rhythm.enabled &&
		channel !== "auto" &&
		Number(channel) >= 6
	);
}
function updateRhythmView() {
	$("melodyControls").hidden = rhythmChannel();
	$("userPatch").hidden = rhythmChannel();
	const assigned = assignedDrums(channel);
	$("rhythmReadout").textContent =
		channel === "auto"
			? `Shared chip mode · ${display.opll.rhythm.enabled ? "6 melody voices + 5 drums (keys 1–5)" : "9 melody voices; Rhythm Off"}`
			: Number(channel) >= 6
				? `CH${Number(channel) + 1} · ${assigned.map((d) => d.label + " (" + d.key + ")").join(" / ")} · ${display.opll.rhythm.enabled ? "Rhythm voices" : "Rhythm Off: melody channel"}`
				: "Shared Rhythm mode reserves CH7–9; this channel stays melodic.";
	for (const box of $("drumControls").children) {
		box.hidden = !(
			channel === "auto" ||
			assigned.some((d) => d.name === box.dataset.drumGroup)
		);
		for (const button of box.querySelectorAll(".param-control button"))
			button.disabled =
				!display.opll.rhythm.enabled || (!!songView() && songBusy);
	}
	for (const id of ["fmAttenuation", "fmSustain"])
		for (const button of $(id).querySelectorAll("button"))
			button.disabled = (!!songView() && songBusy) || rhythmChannel();
	$("fmInstrument").disabled = (!!songView() && songBusy) || rhythmChannel();
}
envelopeEditors.push(
	createOpllEnvelopeEditor({
		root: $("opllEnvelope"),
		getOperators: () =>
			display.opll.userPatch.operators.map((op, i) =>
				i ? { ...op, tl: display.opll.attenuation, tlMax: 15 } : op,
			),
		getSustain: () => display.opll.sustain,
		canEdit: () =>
			section === "opll" &&
			display.opll.instrument === 0 &&
			!(songView() && songBusy) &&
			!rhythmChannel(),
		getSelectionKey: () =>
			`${section}:${channel}:${preset.name}:${songView() ? "song" : "synth"}`,
		onEdit: (op, patch) =>
			settingsEdit((value) => {
				const { tl, ...rest } = patch;
				Object.assign(value.opll.userPatch.operators[op], rest);
				if (tl !== undefined) {
					if (op) value.opll.attenuation = tl;
					else value.opll.userPatch.operators[op].tl = tl;
				}
			}),
	}),
);
$("editUserPatch").addEventListener("click", () =>
	settingsEdit((value) => {
		value.opll.instrument = 0;
	}),
);

const operatorHeadings = [
	["OP", "Operator"],
	["MULT", "Multiplier"],
	["TL", "OP1 total level; carrier uses channel attenuation"],
	["KSL", "Key scale level"],
	["AR", "Attack rate"],
	["DR", "Decay rate"],
	["SL", "Sustain level"],
	["RR", "Release rate"],
	["AM", "Amplitude modulation"],
	["VIB", "Vibrato"],
	["EGT", "Envelope sustain"],
	["KSR", "Key scale rate"],
	["WAVE", "Half-sine waveform"],
];
const operatorHeader = document.createElement("div");
operatorHeader.className = "operator-header";
for (const [label, title] of operatorHeadings) {
	const cell = document.createElement("span");
	cell.textContent = label;
	cell.title = title;
	if (["AR", "DR", "SL", "RR", "EGT"].includes(label))
		cell.className = "envelope-heading";
	operatorHeader.append(cell);
}
$("operatorControls").append(operatorHeader);
for (let op = 0; op < 2; op++) {
	const card = document.createElement("section");
	card.className = "operator-card";
	card.dataset.operator = String(op);
	card.setAttribute(
		"aria-label",
		`OP${op + 1} · ${op ? "Carrier" : "Modulator"}`,
	);
	const title = document.createElement("h3");
	title.textContent = `OP${op + 1}`;
	title.title = op ? "Carrier" : "Modulator";
	const grid = document.createElement("div");
	card.append(title, grid);
	$("operatorControls").append(card);
	const fields = [
		["multi", "MULT", 15],
		["tl", "TL", 63],
		["ksl", "KSL", 3],
		["ar", "AR", 15],
		["dr", "DR", 15],
		["sl", "SL", 15],
		["rr", "RR", 15],
		["am", "AM", 1],
		["vibrato", "Vibrato", 1],
		["egt", "EG sustain", 1],
		["ksr", "KSR", 1],
		["waveform", "Half sine", 1],
	];
	for (const [field, label, max] of fields) {
		const id = `op${op}_${field}`,
			mount = document.createElement("div");
		mount.id = id;
		grid.append(mount);
		if (op === 1 && field === "tl") {
			mount.className = "operator-level-placeholder";
			mount.textContent = "—";
			mount.title = "Carrier level uses channel Attenuation";
			continue;
		}
		control(
			id,
			label,
			max,
			() => display.opll.userPatch.operators[op][field],
			(value) =>
				settingsEdit((v) => {
					v.opll.userPatch.operators[op][field] = [
						"am",
						"vibrato",
						"egt",
						"ksr",
					].includes(field)
						? Boolean(value)
						: Number(value);
				}),
			{
				boolean: ["am", "vibrato", "egt", "ksr", "waveform"].includes(
					field,
				),
				category: ["ar", "dr", "sl", "rr", "egt"].includes(field)
					? "envelope"
					: "",
			},
		);
	}
}
DRUMS.forEach((name, index) => {
	const box = document.createElement("div"),
		button = document.createElement("button"),
		mount = document.createElement("div");
	button.type = "button";
	button.dataset.drum = name;
	button.textContent = `${RHYTHM_KEYS[index].label} (${index + 1})`;
	mount.id = "drum_" + name;
	box.dataset.drumGroup = name;
	box.append(button, mount);
	$("drumControls").append(box);
	button.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		button.setPointerCapture(event.pointerId);
		void pressDrum(index, "drum:" + index);
	});
	for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
		button.addEventListener(event, () => release("drum:" + index));
	control(
		mount.id,
		"Attenuation",
		15,
		() => display.opll.rhythm[name],
		(value) =>
			settingsEdit((v) => {
				v.opll.rhythm[name] = value;
			}),
	);
});
for (const [name, label] of [
	["segapsg", "PSG"],
	["ym2413", "YM2413"],
]) {
	const row = document.createElement("div");
	row.className = "mix-row";
	const text = document.createElement("strong");
	text.textContent = label;
	const enabled = document.createElement("button");
	enabled.type = "button";
	enabled.id = "mix_" + name + "_enabled";
	enabled.textContent = "On";
	enabled.setAttribute("aria-pressed", "true");
	const slider = document.createElement("input");
	slider.id = "mix_" + name;
	slider.type = "range";
	slider.min = "0";
	slider.max = "2";
	slider.step = ".01";
	slider.value = String(mix[name].volume);
	slider.setAttribute("aria-label", label + " output gain");
	const value = document.createElement("output");
	value.textContent = Math.round(mix[name].volume * 100) + "%";
	const apply = () => {
		audio?.setMix(name, mix[name]);
		void song?.setMix(mix).catch(report);
	};
	enabled.addEventListener("click", () => {
		mix[name].enabled = !mix[name].enabled;
		enabled.textContent = mix[name].enabled ? "On" : "Off";
		enabled.setAttribute("aria-pressed", String(mix[name].enabled));
		apply();
	});
	slider.addEventListener("input", () => {
		mix[name].volume = Number(slider.value);
		value.textContent = Math.round(Number(slider.value) * 100) + "%";
		apply();
	});
	row.append(text, enabled, slider, value);
	$("mixerControls").append(row);
}
for (const [name, label, count] of [
	["segapsg", "PSG", 4],
	["ym2413", "YM2413", 9],
]) {
	const group = document.createElement("div");
	group.className = "song-mute-group";
	const heading = document.createElement("strong");
	heading.textContent = label;
	group.append(heading);
	for (let ch = 0; ch < count; ch++) {
		const button = document.createElement("button"),
			channelName =
				name === "segapsg" && ch === 3 ? "Noise" : `CH${ch + 1}`;
		button.type = "button";
		button.id = `songMute_${name}_${ch}`;
		const update = () => {
			const muted = channelMutes[name][ch];
			button.textContent = `${channelName} · ${muted ? "Muted" : "On"}`;
			button.setAttribute("aria-pressed", String(muted));
			button.setAttribute(
				"aria-label",
				`${muted ? "Unmute" : "Mute"} VGM ${label} ${channelName}`,
			);
		};
		button.addEventListener("click", () => {
			channelMutes[name][ch] = !channelMutes[name][ch];
			update();
			void song?.setChannelMutes(channelMutes).catch(report);
		});
		update();
		group.append(button);
	}
	$("songChannelMutes").append(group);
}
function updateTransport() {
	const cache = songState?.seekCache;
	$("songCache").disabled = songBusy || Boolean(song && !cache?.supported);
	$("songCacheLabel").title =
		cache?.reason ||
		"Keep original native checkpoints in memory. Manual edits are not cached; Mixer changes clear FM checkpoints.";

	const loaded = Boolean($("songSelect").value);
	$("songPlay").disabled = !loaded || songBusy;
	$("songPause").disabled = !song || songBusy;
	$("songStop").disabled = !song;
	$("songSeek").disabled = !song || songBusy;
	$("songSeek").max = String((songState?.totalSamples ?? 0) / 44100);
	if (!seekDraft)
		$("songSeek").value = String(
			(songState?.seekTargetSamples ?? songState?.timeSamples ?? 0) /
				44100,
		);
	$("songPause").textContent = songMode === "paused" ? "Resume" : "Pause";
	if (songState && songState.timeSamples >= songState.totalSamples)
		$("songPause").disabled = true;
}
function updateSongs() {
	const select = $("songSelect"),
		previous = select.value,
		files = host.project
			.listEntries()
			.filter(
				(file) =>
					file.path.startsWith("/vgm/") &&
					/\.(?:vgm|vgz)$/i.test(file.path),
			);
	select.replaceChildren();
	for (const file of files)
		select.add(new Option(file.path.slice(5), file.path));
	if (files.some((file) => file.path === previous)) select.value = previous;
	select.disabled = !files.length;
	if (!files.length) select.add(new Option("Import VGM / VGZ…", ""));
	updateTransport();
}
async function playSong() {
	if (songBusy) return;
	const token = ++songEpoch,
		controller = new AbortController();
	songAbort?.abort();
	songAbort = controller;
	songBusy = true;
	updateTransport();
	try {
		const path = $("songSelect").value,
			bytes = await host.project.readFile(path, { type: "arrayBuffer" }),
			plan = await readSmsGearVgm(bytes, { signal: controller.signal });
		const owner = await ensureAudio();
		if (token !== songEpoch) return;
		await host.stop();
		allKeyboardOff();
		owner.stopAll();
		const player = await createSmsGearSongPlayer(
			owner.context,
			owner.masterNode,
			plan,
			{ signal: controller.signal },
		);
		if (token !== songEpoch) {
			player.dispose();
			return;
		}
		song?.dispose();
		song = player;
		frozenSongState = null;
		songPath = path;
		await song.setMix(mix);
		await song.setChannelMutes(channelMutes);
		await song.setSeekCache($("songCache").checked);
		await song.play();
		songMode = "playing";
		$("songView").value = "song";
		songState = await song.snapshot();
		render();
		status(`Playing ${path.split("/").pop()}`);
	} catch (error) {
		if (error.name !== "AbortError") report(error);
	} finally {
		if (token === songEpoch) {
			songBusy = false;
			updateTransport();
		}
	}
}
$("songPlay").addEventListener("click", () => void playSong());
$("songCache").addEventListener("change", () => {
	const player = song;
	if (!player) return;
	void player
		.setSeekCache($("songCache").checked)
		.then(() => player.snapshot())
		.then((state) => {
			if (player !== song) return;
			songState = state;
			updateTransport();
		})
		.catch(report);
});
$("songSeek").addEventListener("input", () => {
	seekDraft = true;
});
$("songSeek").addEventListener("pointercancel", () => {
	seekDraft = false;
	updateTransport();
});
$("songSeek").addEventListener(
	"change",
	() =>
		void (async () => {
			const seconds = Number($("songSeek").value),
				player = song;
			seekDraft = false;
			if (!player || songBusy) {
				updateTransport();
				return;
			}
			songBusy = true;
			songMode = "seeking";
			allKeyboardOff();
			updateTransport();
			render();
			try {
				const result = await player.seek(seconds);
				if (song !== player) return;
				songState = result;
				frozenSongState = $("songLive").checked ? null : clone(result);
				songMode = result.playing
					? "playing"
					: result.timeSamples >= result.totalSamples
						? "ended"
						: "paused";
			} catch (error) {
				if (song === player) report(error);
			} finally {
				if (song === player) {
					songBusy = false;
					updateTransport();
					render();
				}
			}
		})(),
);
$("songPause").addEventListener(
	"click",
	() =>
		void (async () => {
			if (!song || songBusy) return;
			const player = song,
				next = songMode === "paused" ? "playing" : "paused";
			songBusy = true;
			updateTransport();
			try {
				if (next === "paused") await player.pause();
				else await player.play();
				if (song === player) {
					songMode = next;
					songState = await player.snapshot();
					render();
				}
			} finally {
				if (song === player) {
					songBusy = false;
					updateTransport();
				}
			}
		})().catch(report),
);
$("songStop").addEventListener("click", () => void stopSong());
$("songSelect").addEventListener("change", () => void stopSong());
$("songView").addEventListener("change", () => render());
$("songLive").addEventListener("change", () => {
	frozenSongState = $("songLive").checked ? null : clone(songState);
	render();
});
$("captureSound").addEventListener("click", () => {
	if (!songState) return;
	const captured = capturePreset(kind(), selected(), songDisplay());
	preset = captured;
	accepted = readPreset(captured);
	audio?.applySettings(captured);
	section = captured.section;
	channel = "auto";
	$("songView").value = "synth";
	host.files.adoptExternalSound(captured);
	render();
	status(
		"Captured static sound to Synth. Song transport is kept. Save it with + Instrument in Files.",
	);
});
$("loadVgm").addEventListener("click", () => {
	$("synthMenu").open = false;
	$("vgmFileInput").click();
});
$("vgmFileInput").addEventListener(
	"change",
	() =>
		void (async () => {
			const files = [...$("vgmFileInput").files];
			$("vgmFileInput").value = "";
			for (const file of files) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				try {
					const result = await host.files.importVgm(bytes, {
						name: file.name,
					});
					if (result)
						status(
							`Imported ${file.name}: ${result.voices.length} static sound(s). Select a preset in Files or Play the song.${result.warnings.length ? " " + result.warnings.join(" ") : ""}`,
						);
				} catch (error) {
					try {
						await host.files.saveSongSource({
							name: file.name,
							bytes,
						});
					} catch {}
					report(error);
				}
			}
			updateSongs();
		})().catch(report),
);
$("masterVolume").addEventListener("input", () => {
	const value = Number($("masterVolume").value);
	$("masterVolumeValue").textContent = Math.round(value * 100) + "%";
	$("masterVolume").style.accentColor = value > 1 ? "#f79532" : "#3487ff";
	audio?.setMaster(value);
});
for (const id of ["pitchBend", "keyboardPitchBend"]) {
	$(id).addEventListener("input", () => setPitch($(id).value));
	$(id).addEventListener("dblclick", () => setPitch(0));
}
for (const [id, delta] of [
	["octaveDown", -1],
	["octaveUp", 1],
])
	$(id).addEventListener("click", () => {
		octave = Math.max(-2, Math.min(3, octave + delta));
		buildKeyboard();
	});
for (const button of document.querySelectorAll("[data-monitor]"))
	button.addEventListener("click", () => {
		monitor = button.dataset.monitor;
		for (const item of document.querySelectorAll("[data-monitor]"))
			item.setAttribute("aria-selected", String(item === button));
	});
$("startAudio").addEventListener(
	"click",
	() => void ensureAudio().catch(report),
);
$("stopAudio").addEventListener("click", () => void stopAll().catch(report));
setupPerformanceSelects(
	["psgSource", "noiseType", "noiseRate", "fmInstrument"].map($),
);
// Menus/selects release performance focus after pointer selection, as in the other Synths.
document.addEventListener("change", (event) => {
	if (event.target.matches("select,input[type=checkbox]"))
		event.target.blur();
});
host = setupSmsGearCodeHost({
	ensureAudio,
	getAudio: () => audio,
	getSettings: () => readPreset(preset),
	applySettings,
	stopKeyboard: allKeyboardOff,
	stopSong,
	setStatus: status,
	onActivity: () => render(),
	onViewChange: (mode) => expanded?.showInput(mode),
	onExpandedChange: (value) => expanded?.setExpanded(value),
});
expanded = setupSynthExpandedTabs({
	codeControls: host.controls,
	selectChip: (button) => selectSection(button.dataset.chip),
	elements: {
		editor: $("smsgearSynthEditor"),
		chipTabs: [$("psgTab"), $("opllTab"), $("mixerTab")],
		volume: $("smsgearMasterControl"),
	},
	getChipView: (button) => button.dataset.chip,
});
host.project.onDidChange(updateSongs);
await host.ready;
updateSongs();
buildKeyboard();
render();
async function poll() {
	if (!polling && audio) {
		polling = true;
		const owner = audio,
			player = song;
		try {
			liveState = await owner.readState();
			if (player && song === player) {
				songState = await player.snapshot();
				if (
					songMode === "playing" &&
					songState.timeSamples >= songState.totalSamples
				)
					songMode = "ended";
				const seconds = songState.timeSamples / 44100,
					total = songState.totalSamples / 44100;
				const fmt = (value) =>
					`${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
				$("songTime").textContent = fmt(seconds) + " / " + fmt(total);
				$("songReadout").textContent =
					`${songState.seeking ? `Seeking to ${fmt(songState.seekTargetSamples / 44100)} · ${fmt(seconds)} prepared…` : songState.playing ? "Playing" : "Paused / ended"} · ${songPath?.split("/").pop() ?? ""}`;
				updateTransport();
			}
			if (channel !== "auto" || songView()) render();
		} catch (error) {
			if (
				owner === audio &&
				(!player || player === song) &&
				error.name !== "AbortError"
			)
				report(error);
		} finally {
			polling = false;
		}
	}
	setTimeout(poll, 150);
}
void poll();
function draw() {
	const canvas = $("outputCanvas"),
		ctx = canvas.getContext("2d");
	if (monitor !== "envelope") visualizer.draw(canvas, ctx, monitor);
	else {
		rmsSamples.fill(0);
		envelopeAnalyser?.getFloatTimeDomainData(rmsSamples);
		const rms = Math.sqrt(
				rmsSamples.reduce((sum, x) => sum + x * x, 0) /
					rmsSamples.length,
			),
			db = Math.max(-90, 20 * Math.log10(Math.max(1e-6, rms)));
		rmsHistory.push(db);
		if (rmsHistory.length > 240) rmsHistory.shift();
		ctx.fillStyle = "#101b24";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.font = "12px sans-serif";
		ctx.fillStyle = "#b4c3d9";
		ctx.fillText("OUTPUT RMS · after Master · not hardware ADSR", 12, 17);
		ctx.beginPath();
		ctx.strokeStyle = "#4cd9ed";
		rmsHistory.forEach((value, i) => {
			const x = 12 + (i * (canvas.width - 24)) / 239,
				y = 30 + (1 - (value + 90) / 90) * (canvas.height - 45);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		});
		ctx.stroke();
	}
	requestAnimationFrame(draw);
}
draw();
window.addEventListener("pagehide", () => {
	allKeyboardOff();
	for (const editor of envelopeEditors) editor.dispose();
	songAbort?.abort();
	song?.dispose();
	void host.dispose();
	void audio?.dispose();
});
