// SPDX-License-Identifier: BSD-3-Clause
import { SoundChipMixer } from '../js/soundchip_mixer.js';
import { decodeTwoSfSampleSettings, decodeTwoSfSnapshot, TWO_SF_SNAPSHOT_WORDS, validateTwoSfChannelSample } from './2sf-channel-monitor.js?v=nds-2sf-live-edit-1';
import { NDS_CHANNEL_COUNT } from './nds-core.js';

const RATE = 48000;
const BUFFER_SECONDS = 0.25;
const START_SECONDS = 0.025;
const RELEASE_SECONDS = 0.008;
const MONITOR_BLOCK_LIMIT = 48;
const MONITOR_SNAPSHOT_LIMIT = 128;
const CHANNEL_WORDS = (TWO_SF_SNAPSHOT_WORDS - 1) / NDS_CHANNEL_COUNT;
const PCM_MODES = new Set(['pcm8', 'pcm16', 'adpcm']);
const EDIT_FIELDS = { volume: [127, 0], pan: [127, 16], divider: [3, 8], duty: [7, 24], timer: [65535, 0] };
const KEEP_TIMER = 0xffffffff;

function channelEdit(channel, patch) {
	let mask = 0, control = 0, timer = KEEP_TIMER;
	for (const [field, value] of Object.entries(patch)) {
		const [limit, shift] = EDIT_FIELDS[field];
		if (field === 'timer') timer = value;
		else {
			mask |= limit << shift;
			control |= value << shift;
		}
	}
	return { channel, mask, control, timer };
}

function patchSnapshot(row, { channel, mask, control, timer }) {
	const base = 1 + channel * CHANNEL_WORDS;
	row[base] = (row[base] & ~mask) | control;
	if (timer !== KEEP_TIMER) row[base + 2] = (row[base + 2] & 0xffff0000) | timer;
}

function openWorker() {
	const worker = new Worker(new URL('./2sf-worker.js?v=nds-2sf-live-edit-1', import.meta.url), { type: 'module' });
	let pending = null, id = 0, closed = false;
	function close(error = new DOMException('Playback stopped', 'AbortError')) {
		if (closed) return;
		closed = true;
		worker.terminate();
		if (pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			pending = null;
		}
	}
	worker.onmessage = ({ data }) => {
		if (!pending || pending.id !== data.id) return;
		const request = pending;
		if (data.error && request.method !== 'edit' && request.method !== 'waveform') return close(new Error(data.error));
		pending = null;
		clearTimeout(request.timer);
		if (data.error) request.reject(new Error(data.error));
		else request.resolve(data.value);
	};
	worker.onerror = (event) => {
		event.preventDefault();
		close(new Error(event.message || 'The 2SF Worker failed.'));
	};
	worker.onmessageerror = () => close(new Error('The 2SF Worker returned unreadable data.'));
	return {
		ask(method, parameters) {
			if (closed || pending) return Promise.reject(new Error('The 2SF Worker is unavailable.'));
			return new Promise((resolve, reject) => {
				const requestId = ++id;
				const timer = setTimeout(() => close(new Error(`2SF ${method} timed out.`)), method === 'open' ? 30000 : 10000);
				pending = { id: requestId, method, resolve, reject, timer };
				try {
					worker.postMessage({ id: requestId, method, ...parameters });
				} catch (error) {
					close(error);
				}
			});
		},
		close,
	};
}

// The preview owns its output context. Suspending it retains queued PCM and
// freezes the audio clock while the Worker and its emulated DS remain alive.
export function createTwoSfPlayer({ onChange, onError }) {
	const mixer = new SoundChipMixer();
	let audio, master, analyser, volume = 0.7;
	let current = null, pending = null, last = null;
	let switching = false;

	function getState() {
		const session = current ?? last;
		const head = session?.nodes.values().next().value;
		const progress = head ? Math.max(0, Math.min(head.frames / RATE, audio.currentTime - head.start)) : 0;
		return {
			path: session?.path ?? null, pending: pending?.path ?? null, phase: session?.phase ?? 'stopped',
			position: (session?.played ?? 0) / RATE + progress,
			duration: (session?.totalFrames ?? 0) / RATE, switching,
		};
	}
	const notify = () => onChange(getState());

	// An AudioBufferSource can finish rendering before the output device plays
	// its last samples. Keep a small timeline separate from the source nodes.
	function snapshotAt(session, time) {
		let frame = -1;
		for (let index = session.timeline.length - 1; index >= 0; index--) {
			const block = session.timeline[index];
			if (time < block.start) continue;
			frame = block.frame + Math.min(block.frames - 1, Math.floor((time - block.start) * RATE));
			break;
		}
		return session.snapshots.findLast(row => row[0] <= frame) ?? null;
	}

	function monitorTime() {
		const outputTime = audio.getOutputTimestamp?.()?.contextTime;
		return outputTime > 0 && outputTime <= audio.currentTime ? outputTime : audio.currentTime;
	}

	function withChannelEdits(session, row) {
		let updated;
		if (row) for (const [channel, changes] of session.channelEdits) {
			const patch = {};
			for (const [field, { value, frame }] of changes) {
				// A row exactly at the edit frame may precede the host write.
				if (row[0] > frame) changes.delete(field);
				else patch[field] = value;
			}
			if (!changes.size) session.channelEdits.delete(channel);
			else {
				updated ??= row.slice();
				patchSnapshot(updated, channelEdit(channel, patch));
			}
		}
		return updated ?? row;
	}

	function getMonitorState(enabled = true) {
		const session = current;
		const monitorSupported = session?.monitorSupported ?? null;
		const auditionSupported = session?.auditionSupported ?? null;
		const waveformSupported = session?.waveformSupported ?? null;
		const editSupported = session?.editSupported ?? null;
		const row = monitorSupported && enabled &&
			(session.phase === 'paused' ? session.pausedSnapshot : withChannelEdits(session, snapshotAt(session, monitorTime())));
		return { monitorSupported, auditionSupported, waveformSupported, editSupported,
			snapshot: row ? decodeTwoSfSnapshot(row) : null };
	}

	// The Worker protocol accepts one RPC at a time. Queue render, capture and
	// edits together so requests can run between audio blocks without a race.
	function requestInOrder(session, run) {
		const request = (session.workerQueue?.catch(() => {}) ?? Promise.resolve()).then(run);
		session.workerQueue = request;
		function clear() {
			if (session.workerQueue === request) session.workerQueue = null;
		}
		void request.then(clear, clear);
		return request;
	}

	async function readPausedSample(channel) {
		const session = current, row = session?.pausedSnapshot;
		const stillPaused = () => session === current && session?.phase === 'paused' &&
			session.pausedSnapshot === row && !pending && !switching;
		const checkPaused = () => {
			if (!stillPaused()) throw new DOMException('Paused song changed.', 'AbortError');
		};
		checkPaused();
		if (!row) throw new Error('Pause after the song has started to audition a channel.');
		if (!session.auditionSupported) throw new Error('Update the 2SF renderer for keyboard audition.');
		decodeTwoSfSampleSettings(row, channel);
		return requestInOrder(session, async () => {
			checkPaused();
			const { bytes, unavailable } = await session.worker.ask('capture', { frame: row[0], channel });
			checkPaused();
			if (unavailable) throw new Error(unavailable);
			const settings = decodeTwoSfSampleSettings(row, channel);
			validateTwoSfChannelSample(settings, bytes);
			return { ...settings, bytes };
		});
	}

	async function readLiveWaveform(channel, frame, mode, knownRevision) {
		const session = current;
		const available = () => session && session === current && session.phase === 'playing' && !pending && !switching;
		if (!available() || !session.waveformSupported) return { unavailable: true };
		if (!Number.isInteger(channel) || channel < 0 || channel >= NDS_CHANNEL_COUNT || !Number.isInteger(frame) || !PCM_MODES.has(mode))
			throw new RangeError('Invalid 2SF waveform request.');
		return requestInOrder(session, async () => {
			if (!available() || !session.snapshots.some(row => row[0] === frame)) return { unavailable: true };
			const waveform = await session.worker.ask('waveform', { channel, frame, mode, knownRevision });
			return available() ? waveform : { unavailable: true };
		});
	}

	async function editChannel(channel, patch) {
		if (!Number.isInteger(channel) || channel < 0 || channel >= NDS_CHANNEL_COUNT ||
			!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Invalid 2SF channel edit.');
		const entries = Object.entries(patch);
		if (!entries.length || entries.some(([field, value]) => !Object.hasOwn(EDIT_FIELDS, field) ||
			!Number.isInteger(value) || value < 0 || value > EDIT_FIELDS[field][0])) throw new RangeError('Invalid 2SF channel value.');
		const session = current;
		if (!session || pending || switching) throw new DOMException('The 2SF song changed.', 'AbortError');
		if (!session.editSupported) throw new Error('Update the 2SF renderer for channel editing.');
		if (!session.editBatch) {
			const batch = { channels: new Map() };
			session.editBatch = batch;
			batch.request = requestInOrder(session, async () => {
				session.editBatch = null;
				if (session !== current) throw new DOMException('The 2SF song changed.', 'AbortError');
				const writes = [...batch.channels].map(([target, changes]) => channelEdit(target, changes));
				const frame = await session.worker.ask('edit', { writes });
				if (session !== current) throw new DOMException('The 2SF song changed.', 'AbortError');
				for (const [target, changes] of batch.channels) {
					const confirmed = session.channelEdits.get(target) ?? new Map();
					session.channelEdits.set(target, confirmed);
					for (const [field, value] of Object.entries(changes)) confirmed.set(field, { value, frame });
				}
				if (session.pausedSnapshot) for (const write of writes) patchSnapshot(session.pausedSnapshot, write);
				notify();
				return frame;
			});
		}
		const batch = session.editBatch;
		batch.channels.set(channel, { ...batch.channels.get(channel), ...patch });
		return batch.request;
	}

	function ensureAudio() {
		if (audio) return;
		audio = new AudioContext();
		master = audio.createGain();
		master.gain.value = volume;
		analyser = audio.createAnalyser();
		analyser.fftSize = 2048;
		mixer.connect('nds', 'nds', master, analyser);
		analyser.connect(audio.destination);
	}

	function retire(session) {
		clearTimeout(session.timer);
		session.worker.close();
		session.timeline.length = 0;
		session.snapshots.length = 0;
		session.pausedSnapshot = null;
		if (!session.gain) return;
		const now = audio.currentTime;
		const end = audio.state === 'running' ? now + RELEASE_SECONDS : now;
		session.gain.gain.setValueAtTime(1, now);
		session.gain.gain.linearRampToValueAtTime(0, end);
		for (const { node } of session.nodes) node.stop(end);
		session.nodes.clear();
		if (end === now) session.gain.disconnect();
		else setTimeout(() => session.gain.disconnect(), RELEASE_SECONDS * 1000 + 20);
	}

	function finish(session, phase, error) {
		if (current !== session) return;
		current = null;
		retire(session);
		session.phase = phase;
		last = session;
		if (error) onError(error);
		notify();
	}

	function schedule(session, { left, right, snapshots, ended }) {
		const buffer = audio.createBuffer(2, left.length, RATE);
		buffer.copyToChannel(left, 0);
		buffer.copyToChannel(right, 1);
		const node = audio.createBufferSource();
		node.buffer = buffer;
		node.connect(session.gain);
		const start = Math.max(session.next, audio.currentTime);
		const block = { node, start, frames: buffer.length };
		session.nodes.add(block);
		if (session.monitorSupported) {
			session.timeline.push({ start, frames: block.frames, frame: session.scheduledFrames });
			if (session.timeline.length > MONITOR_BLOCK_LIMIT) session.timeline.shift();
			for (let offset = 0; offset < (snapshots?.length ?? 0); offset += TWO_SF_SNAPSHOT_WORDS) {
				session.snapshots.push(snapshots.subarray(offset, offset + TWO_SF_SNAPSHOT_WORDS));
				if (session.snapshots.length > MONITOR_SNAPSHOT_LIMIT) session.snapshots.shift();
			}
		}
		session.scheduledFrames += block.frames;
		session.next = start + buffer.duration;
		session.ended = ended;
		node.onended = () => {
			node.disconnect();
			if (current !== session) return;
			session.nodes.delete(block);
			session.played += block.frames;
			if (session.ended && !session.nodes.size) finish(session, 'ended');
		};
		node.start(start);
	}

	async function refill(session) {
		if (session.filling || current !== session || session.phase !== 'playing') return;
		session.filling = true;
		try {
			while (!session.ended && session.phase === 'playing' && session.next - audio.currentTime < BUFFER_SECONDS) {
				const block = await requestInOrder(session, () => session.worker.ask('render'));
				if (current !== session) return;
				schedule(session, block);
			}
		} catch (error) {
			finish(session, 'error', error);
		} finally {
			session.filling = false;
			if (current === session && session.phase === 'playing' && !session.ended) {
				session.timer = setTimeout(() => refill(session), 24);
			}
		}
	}

	async function play(path, files) {
		pending?.worker.close();
		pending = null;
		let worker;
		try {
			worker = openWorker();
		} catch (error) {
			onError(error);
			notify();
			return;
		}
		const session = {
			path, files, worker, phase: 'playing', nodes: new Set(), played: 0, totalFrames: 0,
			monitorSupported: null, auditionSupported: null, waveformSupported: null, editSupported: null,
			scheduledFrames: 0, timeline: [], snapshots: [], channelEdits: new Map(),
		};
		pending = session;
		notify();
		try {
			ensureAudio();
			if (current?.phase !== 'paused') await audio.resume();
			({ totalFrames: session.totalFrames, monitorSupported: session.monitorSupported,
				auditionSupported: session.auditionSupported, waveformSupported: session.waveformSupported,
				editSupported: session.editSupported } =
				await worker.ask('open', { path, files }));
			const blocks = [];
			for (let index = 0; index < 4; index++) {
				const block = await worker.ask('render');
				blocks.push(block);
				if (block.ended) break;
			}
			if (pending !== session) return;
			await audio.resume();
			if (pending !== session) return;
			if (current) retire(current);
			last = null;
			current = session;
			pending = null;
			session.gain = audio.createGain();
			session.gain.connect(master);
			session.next = audio.currentTime + START_SECONDS;
			for (const block of blocks) schedule(session, block);
			notify();
			void refill(session);
		} catch (error) {
			if (current === session) finish(session, 'error', error);
			else if (pending === session) {
				pending = null;
				worker.close();
				onError(error);
				notify();
			}
		}
	}

	async function togglePause() {
		const session = current;
		if (!session || switching || pending) return;
		switching = true;
		notify();
		try {
			if (session.phase === 'playing') {
				const row = snapshotAt(session, monitorTime());
				session.pausedSnapshot = withChannelEdits(session, row)?.slice() ?? null;
				session.phase = 'paused';
				clearTimeout(session.timer);
				await audio.suspend();
			} else {
				await session.workerQueue?.catch(() => {});
				if (current !== session) return;
				await audio.resume();
				if (current !== session) return;
				session.phase = 'playing';
				session.pausedSnapshot = null;
				void refill(session);
			}
		} catch (error) {
			finish(session, 'error', error);
		} finally {
			switching = false;
			notify();
		}
	}

	function stop() {
		pending?.worker.close();
		pending = null;
		if (current) finish(current, 'stopped');
		last = null;
		notify();
	}

	return {
		getState, getMonitorState, readPausedSample, readLiveWaveform, editChannel, play, togglePause, stop,
		matches(path, files) { return current?.path === path && current.files === files; },
		setVolume(value) {
			volume = value;
			master?.gain.setTargetAtTime(value, audio.currentTime, 0.008);
		},
		setOutputMix(settings) {
			mixer.set('nds', settings);
		},
		get analyser() { return analyser; },
	};
}
