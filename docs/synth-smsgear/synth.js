// SPDX-License-Identifier: BSD-3-Clause
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
const visualizer = createSynthOutputVisualizer(),
	keys = new Map(),
	pointers = new Map(),
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
const numberNames = [
	"C",
	"C♯",
	"D",
	"D♯",
	"E",
	"F",
	"F♯",
	"G",
	"G♯",
	"A",
	"A♯",
	"B",
];
const noteName = (midi) => numberNames[midi % 12] + (Math.floor(midi / 12) - 1);
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
		status("Capture the song channel to Synth before editing its sound.");
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
	const task = createSmsGearAudio({ master: Number($("masterVolume").value) })
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
	pointers.clear();
	paintKeyboard();
}
async function stopSong() {
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
				songState,
			);
			audio.applySettings(captured, {
				section: selectedSection,
				channel: target,
			});
		}
		request.voice = audio.noteOn(
			selectedSection === "psg" ? "segapsg" : "ym2413",
			target,
			midi + pitch,
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
function paintKeyboard() {
	for (const button of $("keyboard").querySelectorAll("[data-midi]"))
		button.classList.toggle(
			"held",
			[...keys.values()].some(
				(item) => item.midi === Number(button.dataset.midi),
			),
		);
}
const KEYMAP = [
	"a",
	"w",
	"s",
	"e",
	"d",
	"f",
	"t",
	"g",
	"y",
	"h",
	"u",
	"j",
	"k",
	"o",
	"l",
	"p",
	";",
];
function buildKeyboard() {
	allKeyboardOff();
	$("keyboard").replaceChildren();
	const start = 48 + octave * 12;
	for (let i = 0; i < 36; i++) {
		const midi = start + i,
			button = document.createElement("button");
		button.type = "button";
		button.className =
			"piano-key" +
			([1, 3, 6, 8, 10].includes(midi % 12) ? " black" : "");
		button.dataset.midi = String(midi);
		button.title = `${noteName(midi)}${KEYMAP[i] ? " · " + KEYMAP[i].toUpperCase() : ""}`;
		button.setAttribute("aria-label", noteName(midi));
		const label = document.createElement("span");
		label.textContent =
			KEYMAP[i]?.toUpperCase() ?? (midi % 12 === 0 ? noteName(midi) : "");
		button.append(label);
		button.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			button.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, "pointer:" + event.pointerId);
			void press("pointer:" + event.pointerId, midi);
		});
		for (const event of [
			"pointerup",
			"pointercancel",
			"lostpointercapture",
		])
			button.addEventListener(event, (e) => {
				release("pointer:" + e.pointerId);
				pointers.delete(e.pointerId);
			});
		$("keyboard").append(button);
	}
	$("octaveValue").textContent = (octave >= 0 ? "+" : "") + octave;
}
function setPitch(value) {
	pitch = Number(value);
	for (const id of ["pitchBend", "keyboardPitchBend"])
		$(id).value = String(pitch);
	for (const id of ["pitchBendValue", "keyboardPitchValue"])
		$(id).textContent = (pitch >= 0 ? "+" : "") + pitch.toFixed(2);
	for (const item of keys.values())
		if (
			item.voice &&
			typeof item.voice.channel === "number" &&
			!(item.voice.name === "segapsg" && item.voice.channel === 3)
		)
			audio
				.getChip(item.voice.name)
				.setNote(item.voice.channel, item.midi + pitch);
}
function editing(target) {
	return Boolean(
		target?.closest(
			"dialog[open],.monaco-editor,#synthCodeEditorHost,textarea,input:not([type=range]):not([type=checkbox]),select,[contenteditable=true]",
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
	if (
		section === "opll" &&
		display.opll.rhythm.enabled &&
		/^[1-5]$/.test(key)
	) {
		event.preventDefault();
		void pressDrum(Number(key) - 1, "drum-key:" + key);
		return;
	}
	const index = KEYMAP.indexOf(key);
	if (index < 0) return;
	event.preventDefault();
	void press("key:" + key, 48 + octave * 12 + index);
});
document.addEventListener("keyup", (event) => {
	release("key:" + event.key.toLowerCase());
	release("drum-key:" + event.key);
});
window.addEventListener("blur", allKeyboardOff);
async function pressDrum(index, id) {
	if (keys.has(id)) return;
	const request = { midi: -1, voice: null };
	keys.set(id, request);
	try {
		await ensureAudio();
		if (keys.get(id) !== request) return;
		request.voice = audio.noteOn("ym2413", DRUMS[index], 60);
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
		button.disabled =
			section === "opll" &&
			display.opll.rhythm.enabled &&
			Number(button.dataset.channel) >= 6;
	}
}

function render(updateState = true) {
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
	$("psgSource").value = display.psg.source;
	$("noiseType").value = display.psg.noiseType;
	$("noiseRate").value = display.psg.noiseRate;
	$("fmInstrument").value = String(display.opll.instrument);
	$("psgSource").disabled = channel !== "auto" || !!songView();
	for (const [id, c] of controls) {
		c.updateVisual(c.get());
		for (const button of c.element.querySelectorAll("button"))
			button.disabled = !!songView();
	}
	for (const { input, bit } of panControls) {
		input.checked = !!(display.psg.stereo & (1 << bit));
		input.disabled = !!songView();
	}
	for (const id of ["noiseType", "noiseRate", "fmInstrument"])
		$(id).disabled = !!songView();
	for (const button of $("userPatch").querySelectorAll("button"))
		button.disabled = display.opll.instrument !== 0 || !!songView();
	for (const button of $("drumControls").querySelectorAll("[data-drum]"))
		button.disabled = !display.opll.rhythm.enabled;
	$("userPatchNote").textContent =
		display.opll.instrument === 0
			? "Editing the one shared hardware patch. Every instrument-0 voice changes."
			: "Built-in instruments are fixed. Choose User to hear the editable patch.";
	const ch =
		channel === "auto"
			? "Auto"
			: section === "psg" && channel === "3"
				? "Noise"
				: `CH${Number(channel) + 1}`;
	const state = source?.[selectedKind === "psg" ? "psg" : "fm"],
		voice = state?.channels?.[selected()];
	$("channelReadout").textContent =
		`${ch} · ${songView() ? "Song registers · Capture to edit" : channel === "auto" ? "software keyboard allocation; select a CH to inspect Code" : "physical channel · direct editing"}${voice ? ` · ${voice.active ? "On" : "Off"} · ${Math.round(voice.frequencyHz ?? voice.frequency ?? 0)} Hz` : ""}`;
	if (document.activeElement !== $("soundName"))
		$("soundName").value = preset.name;
	$("captureSound").disabled = !songState || section === "mixer" || songBusy;
}
function selectSection(value) {
	section = value;
	if (
		channel !== "auto" &&
		((value === "psg" && Number(channel) > 3) ||
			(value === "opll" &&
				display.opll.rhythm.enabled &&
				Number(channel) >= 6))
	)
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
	"Hardware Rhythm",
	1,
	() => display.opll.rhythm.enabled,
	(value) => {
		if (value && Number(channel) >= 6) channel = "auto";
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
for (let op = 0; op < 2; op++) {
	const card = document.createElement("section");
	card.className = "operator-card";
	const title = document.createElement("h3");
	title.textContent = `OP${op + 1} · ${op ? "Carrier" : "Modulator"}`;
	const grid = document.createElement("div");
	card.append(title, grid);
	$("operatorControls").append(card);
	const fields = [
		["multi", "MULT", 15],
		...(op ? [] : [["tl", "TL", 63]]),
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
	button.textContent = `${name} (${index + 1})`;
	mount.id = "drum_" + name;
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
							`Imported ${file.name}: ${result.voices.length} static sound(s). Select a preset in Files or Play the song.`,
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
	songAbort?.abort();
	song?.dispose();
	void host.dispose();
	void audio?.dispose();
});
