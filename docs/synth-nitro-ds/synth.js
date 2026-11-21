// SPDX-License-Identifier: BSD-3-Clause
import { isTwoSfPath, isTwoSfSourcePath } from './2sf_source.js';
import { createTwoSfPlayer } from './2sf-player.js';
import { createSpuOutputVisualizer } from '../synth-spu/spu_synth_visualizer.js';
import { createNdsAudio } from './nds-audio.js';
import { setupNdsKeyboard } from './nds-keyboard.js';
import { NDS_STARTER_CODE, NDS_STARTER_FILES, setupNdsCode } from './nds-code.js?v=nds-files-1';
import { createNdsProject } from './nds-project.js';
import { setupNdsFiles } from './nds-files.js';

const node = (id) => document.getElementById(id);
const song = node('songSelect'), play = node('play'), pause = node('pause'), stop = node('stop');
const master = node('master'), position = node('position'), time = node('time');
const status = node('status'), playbackStatus = node('playbackStatus');
const waveform = node('waveform'), envelope = node('envelope');
const visualizer = createSpuOutputVisualizer({ canvas: waveform, envelopeCanvas: envelope });
visualizer.setMode('waveform');
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 1024;
let files = [], timer = 0, audio, audioPromise, keyboard, code, monitoredOutput = null;
let disposing = false;
const displayName = (path) => path.split('/').at(-1).replace(/\.(?:2sf|mini2sf)$/i, '');
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const report = (error) => { if (!disposing) status.textContent = error.message; };

const player = createTwoSfPlayer({
	onChange: render,
	onError: report,
});

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
	const phase = player.getState().phase;
	const reference = !synthActive && (phase === 'playing' || phase === 'paused');
	const next = (reference ? player.analyser : audio?.analyser) ?? null;
	if (next !== monitoredOutput) {
		monitoredOutput = next;
		if (next) visualizer.connect(next.context, next);
		else visualizer.disconnect();
	}
	visualizer.setRunning(reference ? phase === 'playing' : synthActive);
	node('monitorSource').textContent = reference ? 'Monitoring 2SF' : 'Monitoring Synth';
}

function render(state = player.getState()) {
	const { path, pending, phase, switching, duration } = state;
	const playing = phase === 'playing', paused = phase === 'paused';
	play.disabled = !song.value || Boolean(pending) || switching || player.matches(song.value, files);
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
	syncMonitor();
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
	const options = songs.map(({ path }) => new Option(path, path));
	files = entries;
	song.replaceChildren(...options);
	song.disabled = false;
	status.textContent = `Loaded ${songs.length} ${songs.length === 1 ? 'song' : 'songs'}.`;
	render();
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
song.addEventListener('change', () => { song.blur(); render(); });
play.addEventListener('click', () => {
	status.textContent = '';
	void player.play(song.value, files);
});
pause.addEventListener('click', () => void player.togglePause());
stop.addEventListener('click', () => player.stop());
master.addEventListener('input', () => {
	const percent = Number(master.value);
	node('masterValue').value = `${percent}%`;
	master.classList.toggle('boost', percent > 100);
	player.setVolume(percent / 100);
	audio?.setVolume(percent / 100);
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
keyboard = setupNdsKeyboard({ ensureAudio, getAudio, onActivity: syncMonitor, onError: report });
const setStatus = message => { if (!disposing) status.textContent = message; };
const project = createNdsProject({ starterCode: NDS_STARTER_CODE, starterFiles: NDS_STARTER_FILES });
const projectFiles = setupNdsFiles({ project, setStatus, onBeforeWorkspaceReplace: () => keyboard.stop() });
code = setupNdsCode({
	project, files: projectFiles, ensureAudio, getAudio, setStatus, onActivity: syncMonitor,
});
void code.ready?.catch(report);
node('enableAudio').addEventListener('click', () => void ensureAudio().catch(report));
node('stopAll').addEventListener('click', async event => {
	const button = event.currentTarget;
	button.disabled = true;
	player.stop();
	try {
		await Promise.all([keyboard.stop(), code.stop()]);
		await audio?.chip.allSoundOff();
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
	visualizer.dispose();
	void (async () => {
		await code.controls.flush().catch(() => {});
		await code.dispose().catch(() => {});
		await Promise.allSettled([projectFiles.dispose(), audio?.dispose()]);
	})();
});
