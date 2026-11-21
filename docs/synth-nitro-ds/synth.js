// SPDX-License-Identifier: BSD-3-Clause
import { isTwoSfPath, isTwoSfSourcePath } from './2sf_source.js';
import { createTwoSfPlayer } from './2sf-player.js';

const node = (id) => document.getElementById(id);
const song = node('songSelect'), play = node('play'), pause = node('pause'), stop = node('stop');
const master = node('master'), position = node('position'), time = node('time');
const status = node('status'), playbackStatus = node('playbackStatus');
const canvas = node('waveform'), context = canvas.getContext('2d');
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 1024;
let files = [], timer = 0, wave = null;
const displayName = (path) => path.split('/').at(-1).replace(/\.(?:2sf|mini2sf)$/i, '');
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const player = createTwoSfPlayer({
	onChange: render,
	onError: (error) => { status.textContent = error.message; },
});

function draw() {
	if (!context) return;
	const { width, height } = canvas;
	context.clearRect(0, 0, width, height);
	context.strokeStyle = '#414657';
	context.beginPath();
	context.moveTo(0, height / 2);
	context.lineTo(width, height / 2);
	context.stroke();
	if (!wave) return;
	context.strokeStyle = '#ee94b8';
	context.lineWidth = 1.8;
	context.beginPath();
	for (let i = 0; i < wave.length; i++) {
		const x = i * width / (wave.length - 1);
		const y = height * (0.5 - Math.max(-1, Math.min(1, wave[i])) * 0.45);
		if (i === 0) context.moveTo(x, y);
		else context.lineTo(x, y);
	}
	context.stroke();
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
	if (playing) {
		const analyser = player.analyser;
		wave ??= new Float32Array(analyser.fftSize);
		analyser.getFloatTimeDomainData(wave);
		timer = setTimeout(render, 50);
	} else if (!paused) wave = null;
	draw();
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
song.addEventListener('change', () => render());
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
});
window.addEventListener('pagehide', () => player.stop());
draw();
