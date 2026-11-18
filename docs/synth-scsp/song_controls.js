// SPDX-License-Identifier: BSD-3-Clause
import { createScspSongPlayer } from './song_player.js?v=scsp-ssf-dsp-1';
import { buildScspSongDemo } from './song_source.js';

const vgmPath = (path) => typeof path === 'string' && /^\/vgm\/.*\.(?:vgm|vgz)$/i.test(path);
const ssfPath = (path) => typeof path === 'string' && /^\/ssf\/.*\.(?:ssf|minissf)$/i.test(path);
const ssfFilePath = (path) =>
	typeof path === 'string' && /^\/ssf\/.*\.(?:ssf|minissf|ssflib)$/i.test(path);
export const isScspSongPath = (path) => vgmPath(path) || ssfPath(path);
const timeLabel = (seconds) => {
	const value = Math.max(0, Math.floor(seconds || 0));
	return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
};
const sameBytes = (first, second) =>
	first instanceof Uint8Array &&
	second instanceof Uint8Array &&
	first.length === second.length &&
	first.every((byte, index) => byte === second[index]);

/** Project-backed transport for raw SCSP reference playback. Its core is owned
 * by the player. The six authored operator settings stay in the Synth editor.
 */
export function setupScspSongControls({
	project,
	ensureAudio,
	getAudio,
	stopCode = async () => {},
	onState = () => {},
	setStatus = () => {},
	document: doc = globalThis.document,
	createPlayer = createScspSongPlayer,
} = {}) {
	const node = (id) => doc.getElementById(id),
		listeners = [];
	let selectedPath = '',
		sourceData = null,
		dependencyData = new Map(),
		operation = 0,
		loading = false,
		disposed = false,
		state = null;
	let signature = '',
		seekDraft = false,
		loadController = null;
	const report = (error) => {
		if (error?.name !== 'AbortError') setStatus(error?.message ?? String(error), true);
	};
	const run = (task) => {
		void Promise.resolve().then(task).catch(report);
	};
	const listen = (id, type, callback) => {
		const target = node(id);
		if (target) {
			target.addEventListener(type, callback);
			listeners.push(() => target.removeEventListener(type, callback));
		}
	};
	const player = createPlayer({
		getAudio,
		beforePlay: async () => {
			await stopCode();
			await ensureAudio();
		},
		onState: (next) => {
			state = next;
			render();
			onState(next);
		},
		onStatus: (message) => setStatus(message, true),
	});
	const currentState = () => state ?? player.getState();
	function render() {
		if (disposed) return;
		const current = currentState(),
			loaded = Boolean(selectedPath && sourceData);
		const play = node('scspSongPlay'),
			pause = node('scspSongPause'),
			stop = node('scspSongStop'),
			seek = node('scspSongSeek');
		if (play)
			play.disabled = !loaded || loading || current.busy || current.playing || current.paused;
		if (pause) {
			pause.disabled = !current.canPause && !current.canResume;
			const label = current.paused ? 'Resume' : 'Pause';
			// Retain the same text node between pointerdown and pointerup.
			// Replacing it on every playback tick can suppress clicks in WebKit.
			if (pause.textContent !== label) pause.textContent = label;
		}
		if (stop) stop.disabled = !current.canStop;
		if (seek) {
			seek.max = String(Math.max(0.001, current.durationSeconds));
			seek.disabled = !loaded || !current.canSeek;
			if (!seekDraft) seek.value = String(current.positionSeconds);
		}
		const position = node('scspSongPosition');
		if (position)
			position.textContent =
				timeLabel(current.positionSeconds) + ' / ' + timeLabel(current.durationSeconds);
		const message =
			loading || current.playback === 'starting'
				? 'Preparing SCSP song…'
				: current.seeking
					? 'Seeking · ' + Math.round(current.seekProgress * 100) + '%'
					: current.errorMessage ||
						(loaded
							? current.paused
								? 'Paused'
								: current.playing
									? 'Playing · SCSP reference'
									: current.playback === 'ended'
										? 'Ended'
										: 'Ready · ' + selectedPath
						: 'Import an SSF folder or SCSP VGM / VGZ, or load the demo.');
		const status = node('scspSongStatus');
		if (status) {
			status.textContent =
				message +
				(loaded && current.warnings.length ? ' · ' + current.warnings.join(' ') : '');
			status.hidden = !message;
		}
	}
	function refresh() {
		if (disposed) return;
		const files = project.fs
			.list()
			.filter((file) => file.type === 'binary' && (vgmPath(file.path) || ssfFilePath(file.path)));
		const entries = files.filter((file) => isScspSongPath(file.path));
		const nextSignature = JSON.stringify(files.map((file) => [file.path, file.revision]));
		if (nextSignature === signature) return;
		signature = nextSignature;
		const select = node('scspSongSelect');
		if (select) {
			const placeholder = doc.createElement('option');
			placeholder.value = '';
			placeholder.textContent = entries.length
				? 'Choose a SCSP song…'
				: 'Import an SSF folder or SCSP VGM / VGZ…';
			const options = entries.map((file) => {
				const option = doc.createElement('option');
				option.value = file.path;
				option.textContent = file.path.slice(5);
				option.title = file.path;
				return option;
			});
			select.replaceChildren(placeholder, ...options);
			select.disabled = !entries.length;
		}
		const selected = entries.find((file) => file.path === selectedPath);
		const dependencyChanged = [...dependencyData].some(
			([path, data]) => !sameBytes(data, project.fs.get(path)?.data),
		);
		if (
			selectedPath &&
			selectedPath !== 'Original SCSP demo' &&
			(!selected || !sameBytes(sourceData, selected.data) || dependencyChanged)
		) {
			operation++;
			loadController?.abort();
			selectedPath = '';
			sourceData = null;
			dependencyData.clear();
			player.clear();
		}
		if (select) select.value = isScspSongPath(selectedPath) ? selectedPath : '';
		render();
	}
	async function selectFile(value, { path: explicitPath, isCurrent = () => true } = {}) {
		if (disposed) return false;
		const file = typeof value === 'string' ? project.fs.get(value) : value;
		const path = explicitPath ?? (typeof value === 'string' ? value : value?.path),
			data = file?.data;
		if (!isScspSongPath(path) || !(data instanceof Uint8Array))
			throw new Error('Choose an SSF / MiniSSF in /ssf or VGM / VGZ in /vgm');
		if (selectedPath === path && sameBytes(sourceData, data)) return true;
		const ticket = ++operation,
			controller = new AbortController();
		loadController?.abort();
		loadController = controller;
		loading = true;
		render();
		try {
			const ssfFiles = ssfPath(path)
				? project.fs.list().filter((file) => file.type === 'binary' && ssfFilePath(file.path))
				: [];
			const sourceFiles = new Map(ssfFiles.map((file) => [file.path, file.data.slice()]));
			sourceFiles.set(path, data.slice());
			const sourceUnchanged = (paths = [path]) => [...new Set([path, ...paths])].every(
				(sourcePath) => sameBytes(sourceFiles.get(sourcePath), project.fs.get(sourcePath)?.data),
			);
			const settings = {
				signal: controller.signal,
				isCurrent: (paths) => !disposed && ticket === operation && isCurrent() && sourceUnchanged(paths),
			};
			if (ssfPath(path)) {
				await player.loadSsf(
					[...sourceFiles].map(([sourcePath, bytes]) => ({path: sourcePath, data: bytes})),
					path,
					settings,
				);
			} else {
				await player.load(data, path.split('/').pop(), settings);
			}
			if (disposed || ticket !== operation || !isCurrent()) return false;
			selectedPath = path;
			sourceData = data.slice();
			state = player.getState();
			const loadedPaths = ssfPath(path) ? new Set([path, ...(state.loadedFiles ?? [])]) : new Set([path]);
			dependencyData = new Map([...loadedPaths].map((loadedPath) => [loadedPath, sourceFiles.get(loadedPath)]));
			const select = node('scspSongSelect');
			if (select) select.value = path;
			setStatus('SCSP reference song loaded · ' + path);
			return true;
		} catch (error) {
			const select = node('scspSongSelect');
			if (select) select.value = isScspSongPath(selectedPath) ? selectedPath : '';
			throw error;
		} finally {
			if (!disposed && ticket === operation) {
				loadController = null;
				loading = false;
				render();
			}
		}
	}
	async function loadDemo() {
		if (disposed) return false;
		const ticket = ++operation,
			controller = new AbortController(),
			data = buildScspSongDemo();
		loadController?.abort();
		loadController = controller;
		loading = true;
		render();
		try {
			await player.load(data, 'Original SCSP demo', { signal: controller.signal });
			if (disposed || ticket !== operation) return false;
			selectedPath = 'Original SCSP demo';
			sourceData = data;
			dependencyData.clear();
			state = player.getState();
			const select = node('scspSongSelect');
			if (select) select.value = '';
			setStatus('Original SCSP VGM demo loaded');
			return true;
		} finally {
			if (!disposed && ticket === operation) {
				loadController = null;
				loading = false;
				render();
			}
		}
	}
	function stop() {
		operation++;
		loadController?.abort();
		loadController = null;
		loading = false;
		player.stop();
		render();
	}
	listen('scspSongSelect', 'change', () => {
		const select = node('scspSongSelect');
		if (select.value) run(() => selectFile(select.value));
		select.blur();
	});
	listen('scspSongPlay', 'click', () => run(() => player.play()));
	listen('scspSongPause', 'click', () =>
		run(() => (currentState().paused ? player.resume() : player.pause())),
	);
	listen('scspSongStop', 'click', stop);
	listen('scspSongDemo', 'click', () => run(loadDemo));
	listen('scspSongSeek', 'input', () => {
		seekDraft = true;
		const position = node('scspSongPosition');
		if (position)
			position.textContent =
				timeLabel(Number(node('scspSongSeek').value)) +
				' / ' +
				timeLabel(currentState().durationSeconds);
	});
	listen('scspSongSeek', 'change', () => {
		const seek = node('scspSongSeek'),
			seconds = Number(seek.value);
		seekDraft = false;
		run(() => player.seek(seconds));
		seek.blur();
	});
	const unsubscribe = project.onDidChange(refresh);
	refresh();
	render();
	return {
		player,
		selectFile,
		load: selectFile,
		loadDemo,
		refresh,
		stop,
		getState: () => player.getState(),
		whenIdle: () => player.whenIdle(),
		dispose() {
			if (disposed) return;
			disposed = true;
			operation++;
			loadController?.abort();
			unsubscribe?.();
			listeners.forEach((remove) => remove());
			player.dispose();
		},
	};
}
