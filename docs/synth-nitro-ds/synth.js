// SPDX-License-Identifier: BSD-3-Clause
import { isTwoSfPath, isTwoSfSourcePath } from './2sf_source.js';
import { listSavedTwoSfSets } from './2sf-project.js';
import { createTwoSfPlayer } from './2sf-player.js?v=nds-2sf-audition-1';
import { setupTwoSfLiveView } from './2sf-live-view.js?v=nds-channels-1';
import { setupNdsChannelPicker } from './nds-channel-picker.js';
import { createSpuOutputVisualizer } from '../synth-spu/spu_synth_visualizer.js';
import { setupSynthExpandedTabs } from '../synth/synth_expanded_tabs.js?v=nds-source-controls-1';
import { createNdsAudio } from './nds-audio.js?v=nds-timer-1';
import { setupNdsKeyboard } from './nds-keyboard.js?v=nds-live-controls-1';
import { NDS_STARTER_CODE, NDS_STARTER_FILES, setupNdsCode } from './nds-code.js?v=nds-source-controls-1';
import { setupNdsSoundCapture } from './nds-sound-capture.js';
import { createNdsProject } from './nds-project.js?v=nds-sample-1';
import { setupNdsFiles } from './nds-files.js?v=nds-workspace-1';
import { isNdsPresetPath, ndsPresetChannelSettings } from './nds-preset.js?v=nds-timer-1';

const node = (id) => document.getElementById(id);
const song = node('songSelect'), play = node('play'), pause = node('pause'), stop = node('stop');
const saveSong = node('saveTwoSfSong');
const master = node('master'), position = node('position'), time = node('time');
const status = node('status'), playbackStatus = node('playbackStatus');
const waveform = node('waveform'), envelope = node('envelope');
const instrument = node('ndsInstrument');
const visualizer = createSpuOutputVisualizer({ canvas: waveform, envelopeCanvas: envelope });
visualizer.setMode('waveform');
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 1024;
let timer = 0, audio, audioPromise, keyboard, code, monitoredOutput = null;
let sessionFiles = [], sessionTracks = [], savedSets = new Map(), songOptions = new Map(), savingSong = false;
let auditionAudio, auditionAudioPromise, auditionStatus = null, auditionRevision = 0, auditionTarget = null, pausedPreset = null;
let disposing = false;
let liveEnabled = true, nextLiveUpdate = 0;
const displayName = (path) => path.split('/').at(-1).replace(/\.(?:2sf|mini2sf)$/i, '');
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const report = (error) => { if (!disposing) status.textContent = error.message; };

const player = createTwoSfPlayer({
	onChange: render,
	onError: report,
});
const channelPicker = setupNdsChannelPicker({
	onSelect({ mode, channel }) {
		if (mode === 'synth') keyboard.setChannel(channel);
		renderLive(player.getState());
	},
});
const liveView = setupTwoSfLiveView({
	getChannel: () => channelPicker.getReferenceChannel(),
	onEnabledChange(enabled) {
		liveEnabled = enabled;
		renderLive(player.getState());
	},
	onAuditionChange: () => renderLive(player.getState()),
	onCapture: captureToSynth,
});

function clearAudition() {
	if (auditionTarget === null) return;
	auditionRevision++;
	auditionTarget = null;
	auditionStatus = null;
	pausedPreset = null;
	keyboard.setAudition(null);
}

function renderLive(state) {
	nextLiveUpdate = performance.now() + 100;
	const monitor = player.getMonitorState(liveEnabled);
	channelPicker.render({ ...state, ...monitor }, monitor.snapshot);
	const { mode, channel } = channelPicker.getSelection();
	const referenceView = mode === 'reference';
	if (instrument.hidden !== referenceView) instrument.hidden = referenceView;
	if (referenceView && liveEnabled && state.phase === 'paused' && !state.pending && !state.switching) {
		const { referenceNote } = liveView.getSelection();
		const target = `${monitor.snapshot?.frame ?? 'waiting'}:${channel}:${referenceNote}`;
		if (target !== auditionTarget) {
			auditionTarget = target;
			void prepareAudition(channel, referenceNote, monitor);
		}
	} else {
		clearAudition();
	}
	liveView.render({ ...state, ...monitor, referenceView, canCapture: Boolean(pausedPreset), auditionStatus });
}

async function prepareAudition(channel, referenceNote, monitor) {
	const revision = ++auditionRevision;
	pausedPreset = null;
	keyboard.setAudition({ channel });
	if (!monitor.auditionSupported || !monitor.snapshot) {
		auditionStatus = monitor.auditionSupported === false ? 'Update the 2SF renderer for keyboard audition.'
			: 'Pause after the song starts to audition a channel.';
		return;
	}
	auditionStatus = 'Reading the paused sample…';
	try {
		const { bytes, sampleRate, loopStartWords, lengthWords, ...settings } = await player.readPausedSample(channel);
		if (revision !== auditionRevision) return;
		pausedPreset = {
			...settings, name: '2SF CH ' + (channel + 1), shape: 'sine',
			sample: { bytes, sampleRate, loopStartWords, lengthWords, rootNote: referenceNote },
		};
		auditionStatus = 'Keyboard ready · ' + pausedPreset.name;
		keyboard.setAudition({ channel, patch: ndsPresetChannelSettings(pausedPreset) });
	} catch (error) {
		if (revision !== auditionRevision) return;
		auditionStatus = error.message;
	}
	renderLive(player.getState());
}

function captureToSynth() {
	if (!pausedPreset) return;
	try {
		const preset = pausedPreset;
		keyboard.applyPreset(preset);
		channelPicker.showSynth();
		clearAudition();
		renderLive(player.getState());
		status.textContent = `${preset.name} loaded into Synth. Use Save sound as… to keep it in Files.`;
	} catch (error) {
		report(error);
	}
}

async function ensureAuditionAudio() {
	if (auditionAudio?.context.state === 'closed') auditionAudio = null;
	if (!auditionAudio) {
		auditionAudioPromise ??= createNdsAudio({ volume: Number(master.value) / 100, onError: report }).then(async instance => {
			if (disposing) {
				await instance.dispose();
				throw new DOMException('Keyboard audition stopped', 'AbortError');
			}
			auditionAudio = instance;
			instance.setVolume(Number(master.value) / 100);
			syncMonitor();
		}).finally(() => { auditionAudioPromise = null; });
		await auditionAudioPromise;
	}
	await auditionAudio.resume();
	return auditionAudio;
}

async function ensureAudio() {
	if (audio?.context.state === 'closed') audio = null;
	if (!audio) {
		audioPromise ??= createNdsAudio({ volume: Number(master.value) / 100, onError: report }).then(async instance => {
			if (disposing) {
				await instance.dispose();
				throw new DOMException('Audio initialization stopped', 'AbortError');
			}
			audio = instance;
			instance.setVolume(Number(master.value) / 100);
			node('enableAudio').textContent = 'Audio ready';
			syncMonitor();
		}).finally(() => { audioPromise = null; });
		await audioPromise;
	}
	await audio.resume();
	return audio;
}

function syncMonitor() {
	if (disposing) return;
	const synthActive = keyboard?.isPlaying() || code?.isRunning();
	const auditionActive = keyboard?.isAuditionPlaying();
	const phase = player.getState().phase;
	const reference = !synthActive && (phase === 'playing' || phase === 'paused');
	const next = (auditionActive ? auditionAudio?.analyser : reference ? player.analyser : audio?.analyser) ?? null;
	if (next !== monitoredOutput) {
		monitoredOutput = next;
		if (next) visualizer.connect(next.context, next);
		else visualizer.disconnect();
	}
	visualizer.setRunning(reference ? phase === 'playing' : synthActive);
	node('monitorSource').textContent = auditionActive ? 'Monitoring 2SF keyboard audition'
		: reference ? 'Monitoring 2SF' : 'Monitoring Synth';
}

function render(state) {
	const transportChanged = Boolean(state);
	state ??= player.getState();
	const { path, pending, phase, switching, duration } = state;
	const playing = phase === 'playing', paused = phase === 'paused';
	const selected = songOptions.get(song.value);
	const sources = selected?.group ? selected.group.sources : sessionFiles;
	play.disabled = !selected || Boolean(pending) || switching || player.matches(selected.path, sources);
	saveSong.disabled = !selected || Boolean(selected.group) || savingSong;
	pause.disabled = !(playing || paused) || Boolean(pending) || switching;
	pause.textContent = paused ? 'Resume' : 'Pause';
	stop.disabled = !(playing || paused || pending);
	const label = { playing: 'Playing', paused: 'Paused', ended: 'Ended', error: 'Playback failed', stopped: 'Stopped' }[phase];
	const title = pending ? `Preparing · ${displayName(pending)}` : path ? `${label} · ${displayName(path)}` : label;
	if (playbackStatus.textContent !== title) playbackStatus.textContent = title;
	playbackStatus.title = title;
	position.max = duration || 1;
	position.value = state.position;
	time.textContent = duration ? `${clock(state.position)} / ${clock(duration)}` : '0:00';
	clearTimeout(timer);
	if (playing) timer = setTimeout(render, 50);
	if (transportChanged || (liveEnabled && !document.hidden && performance.now() >= nextLiveUpdate)) renderLive(state);
	syncMonitor();
}

document.addEventListener('visibilitychange', () => {
	if (!document.hidden) renderLive(player.getState());
});

function updateSongOptions(preferred = song.value) {
	const options = new Map();
	const groups = [];
	function addOptions(label, paths, group) {
		if (!paths.length) return;
		const optgroup = document.createElement('optgroup');
		optgroup.label = label;
		for (const path of paths) {
			const relative = group ? path.slice(group.root.length + 1) : path;
			options.set(path, { path: relative, group });
			optgroup.append(new Option(relative, path));
		}
		groups.push(optgroup);
	}
	addOptions('Imported for this session', sessionTracks);
	for (const group of savedSets.values()) addOptions(`Saved in Files · ${group.name}`, group.tracks, group);
	songOptions = options;
	song.replaceChildren(...(groups.length ? groups : [new Option('Import a 2SF set…', '')]));
	song.disabled = !options.size;
	if (options.has(preferred)) song.value = preferred;
	render();
}

function updateSavedSongs() {
	const groups = listSavedTwoSfSets(project.savedFs);
	const next = new Map(groups.map(group => {
		const previous = savedSets.get(group.root);
		return [group.root, previous?.revision === group.revision ? previous : { ...group, sources: null }];
	}));
	if (next.size === savedSets.size && [...next].every(([root, group]) => group === savedSets.get(root))) return;
	savedSets = next;
	updateSongOptions();
}

function sourcesFor(group) {
	if (!group) return sessionFiles;
	group.sources ??= group.paths.map(path => {
		const source = project.savedFs.get(path);
		if (source?.type !== 'binary') throw new Error(`The saved 2SF source must contain binary data: ${path}`);
		return { path: path.slice(group.root.length + 1), file: new Blob([source.data]) };
	});
	return group.sources;
}

function importFiles(selected) {
	const entries = Array.from(selected, (file) => ({ path: file.webkitRelativePath || file.name, file }))
		.filter(({ path }) => isTwoSfSourcePath(path));
	const songs = entries.filter(({ path }) => isTwoSfPath(path));
	if (!songs.length) throw new Error('Choose a folder or files containing at least one 2SF or mini2SF song.');
	if (entries.length > MAX_FILES || entries.reduce((size, { file }) => size + file.size, 0) > MAX_SOURCE_BYTES)
		throw new Error('Choose up to 1024 source files and 128 MiB per set.');
	if (new Set(entries.map(({ path }) => path)).size !== entries.length)
		throw new Error('Duplicate filenames. Use folder import to keep their relative paths.');
	songs.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
	sessionFiles = entries;
	sessionTracks = songs.map(({ path }) => path);
	status.textContent = `Loaded ${songs.length} ${songs.length === 1 ? 'song' : 'songs'}.`;
	updateSongOptions(sessionTracks[0]);
}

function connectPicker(buttonId, inputId) {
	const input = node(inputId);
	node(buttonId).addEventListener('click', () => {
		node('menu').parentElement.open = false;
		input.click();
	});
	input.addEventListener('change', () => {
		try {
			if (input.files.length) importFiles(input.files);
		} catch (error) {
			status.textContent = error.message;
		} finally {
			input.value = '';
		}
	});
}

connectPicker('loadTwoSfFolder', 'twoSfFolder');
connectPicker('loadTwoSfFiles', 'twoSfFiles');
song.addEventListener('change', () => render());
play.addEventListener('click', () => {
	const selected = songOptions.get(song.value);
	if (!selected) return;
	status.textContent = '';
	try { void player.play(selected.path, sourcesFor(selected.group)); }
	catch (error) { report(error); }
});
saveSong.addEventListener('click', async () => {
	const selected = songOptions.get(song.value);
	if (!selected || selected.group || savingSong) return;
	savingSong = true;
	status.textContent = 'Saving the selected song and its libraries…';
	render();
	try {
		if (!(await projectFiles.saveReferenceSong(selected.path, sessionFiles)))
			setStatus('Wait for the current Files operation and try again.');
	} catch (error) { if (error.name !== 'AbortError') report(error); }
	finally {
		savingSong = false;
		if (!disposing) render();
	}
});
pause.addEventListener('click', () => void player.togglePause());
stop.addEventListener('click', () => player.stop());
master.addEventListener('input', () => {
	const percent = Number(master.value);
	node('masterValue').value = `${percent}%`;
	master.classList.toggle('boost', percent > 100);
	player.setVolume(percent / 100);
	audio?.setVolume(percent / 100);
	auditionAudio?.setVolume(percent / 100);
	visualizer.wake();
});

const monitorButtons = [...document.querySelectorAll('[data-monitor]')];
for (const button of monitorButtons) button.addEventListener('click', () => {
	const mode = button.dataset.monitor;
	for (const item of monitorButtons) item.setAttribute('aria-pressed', String(item === button));
	waveform.hidden = mode === 'envelope';
	envelope.hidden = mode !== 'envelope';
	visualizer.setMode(mode);
});

const getAudio = () => audio;
keyboard = setupNdsKeyboard({ ensureAudio, ensureAuditionAudio, onActivity: syncMonitor, onError: report });
const capturePanel = setupNdsSoundCapture({ ensureAudio, getAudio, keyboard });
const setStatus = message => { if (!disposing) status.textContent = message; };
const project = createNdsProject({ starterCode: NDS_STARTER_CODE, starterFiles: NDS_STARTER_FILES });
const projectFiles = setupNdsFiles({
	project, setStatus, onSelectPreset: preset => keyboard.applyPreset(preset),
	onSelectReference(path) {
		if (!songOptions.get(path)?.group) return false;
		song.value = path;
		render();
		return true;
	},
	onBeforeWorkspaceReplace() {
		keyboard.cancelSampleLoad();
		return keyboard.stop();
	},
});
const chipTab = node('ndsChipTab');
let expandedTabs;
const selectChip = button => expandedTabs.showChip(button);
code = setupNdsCode({
	project, files: projectFiles, ensureAudio, getAudio, setStatus, onActivity: syncMonitor,
	onViewChange: mode => expandedTabs?.showInput(mode),
	onExpandedChange: value => expandedTabs?.setExpanded(value),
});
expandedTabs = setupSynthExpandedTabs({ codeControls: code.controls, selectChip,
	elements: { editor: node('ndsSynthEditor'), chipTabs: [chipTab], volume: master.closest('label') },
	getChipView: () => 'ds',
});
chipTab.addEventListener('click', () => selectChip(chipTab));
void code.ready?.catch(report);
const unwatchSavedSongs = project.savedFs.onDidChange(updateSavedSongs);
updateSavedSongs();

const savedSounds = node('ndsSavedSounds');
let presetList = '';
function updateSavedSounds() {
	const { savedFs } = project;
	const paths = savedFs.listDirectories().flatMap(parent => savedFs.readdir(parent)
		.filter(isNdsPresetPath).map(name => (parent === '/' ? '' : parent) + '/' + name))
		.filter(path => savedFs.has(path)).sort((a, b) => a.localeCompare(b));
	const signature = JSON.stringify(paths);
	if (signature === presetList) return;
	presetList = signature;
	savedSounds.replaceChildren(new Option(paths.length ? 'Choose saved sound…' : 'No saved sounds', ''),
		...paths.map(path => new Option(path.split('/').at(-1).replace(/\.nds\.json$/i, ''), path)));
	savedSounds.disabled = !paths.length;
}
const unwatchSavedSounds = project.savedFs.onDidChange(updateSavedSounds);
updateSavedSounds();
savedSounds.addEventListener('change', () => {
	const path = savedSounds.value;
	savedSounds.value = '';
	if (path) void projectFiles.selectFile(path, { showSource: false }).catch(report);
});

const saveDialog = node('ndsSaveSoundDialog'), soundName = node('ndsSoundName');
const saveCommit = node('ndsSaveSoundCommit'), saveCancel = node('ndsSaveSoundCancel'), saveError = node('ndsSaveSoundError');
let soundToSave;
node('ndsSaveSound').addEventListener('click', () => {
	soundToSave = keyboard.getPreset();
	soundName.value = soundToSave.name || (soundToSave.mode === 'pulse' ? 'DS Pulse' : soundToSave.mode === 'noise' ? 'DS Noise' : `DS ${soundToSave.shape}`);
	saveError.textContent = '';
	saveDialog.showModal();
	soundName.select();
});
saveCancel.addEventListener('click', () => saveDialog.close());
saveDialog.addEventListener('cancel', event => { if (saveCommit.disabled) event.preventDefault(); });
saveDialog.addEventListener('close', () => { soundToSave = null; });
node('ndsSaveSoundForm').addEventListener('submit', async event => {
	event.preventDefault();
	if (saveCommit.disabled || !soundToSave) return;
	saveError.textContent = '';
	saveCommit.disabled = saveCancel.disabled = true;
	try {
		const saved = await projectFiles.savePreset(soundName.value, soundToSave);
		if (!saved) throw new Error('Wait for the current Files operation and try again.');
		saveDialog.close();
	} catch (error) { saveError.textContent = error.message; }
	finally { saveCommit.disabled = saveCancel.disabled = false; }
});

node('enableAudio').addEventListener('click', () => void ensureAudio().catch(report));
node('stopAll').addEventListener('click', async event => {
	const button = event.currentTarget;
	button.disabled = true;
	player.stop();
	try {
		await Promise.all([keyboard.stop(), code.stop()]);
		await Promise.all([audio?.chip.allSoundOff(), auditionAudio?.chip.allSoundOff()]);
		status.textContent = 'All sound stopped.';
	} catch (error) { report(error); }
	finally { button.disabled = false; }
});

window.addEventListener('pagehide', event => {
	player.stop();
	if (event.persisted) {
		void code.controls.flush().catch(report);
		void keyboard.stop().catch(report);
		void code.stop().catch(report);
		return;
	}
	disposing = true;
	expandedTabs.dispose();
	capturePanel.dispose();
	keyboard.cancelSampleLoad();
	unwatchSavedSongs();
	unwatchSavedSounds();
	visualizer.dispose();
	void (async () => {
		await code.controls.flush().catch(() => {});
		await code.dispose().catch(() => {});
		await Promise.allSettled([projectFiles.dispose(), audio?.dispose(), auditionAudio?.dispose()]);
	})();
});
