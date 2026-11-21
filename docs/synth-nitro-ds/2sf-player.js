// SPDX-License-Identifier: BSD-3-Clause
import { decodeTwoSfSampleSettings, decodeTwoSfSnapshot, TWO_SF_SNAPSHOT_WORDS, validateTwoSfChannelSample } from './2sf-channel-monitor.js?v=nds-channel-view-1';

const RATE = 48000;
const BUFFER_SECONDS = 0.25;
const START_SECONDS = 0.025;
const RELEASE_SECONDS = 0.008;
const MONITOR_BLOCK_LIMIT = 48;
const MONITOR_SNAPSHOT_LIMIT = 128;

function openWorker() {
	const worker = new Worker(new URL('./2sf-worker.js?v=nds-2sf-audition-1', import.meta.url), { type: 'module' });
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
		if (data.error) return close(new Error(data.error));
		const request = pending;
		pending = null;
		clearTimeout(request.timer);
		request.resolve(data.value);
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
				pending = { id: requestId, resolve, reject, timer };
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

	function getMonitorState(enabled = true) {
		const session = current;
		const monitorSupported = session?.monitorSupported ?? null;
		const auditionSupported = session?.auditionSupported ?? null;
		const row = monitorSupported && enabled &&
			(session.phase === 'paused' ? session.pausedSnapshot : snapshotAt(session, monitorTime()));
		return { monitorSupported, auditionSupported, snapshot: row ? decodeTwoSfSnapshot(row) : null };
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
		const settings = decodeTwoSfSampleSettings(row, channel);
		// The Worker allows one RPC at a time. Drain any render already in
		// flight and serialize requests from rapid channel/reference changes.
		const request = (session.sampleRequest?.catch(() => {}) ?? Promise.resolve()).then(async () => {
			await session.renderRequest;
			checkPaused();
			const { bytes, unavailable } = await session.worker.ask('capture', { frame: row[0], channel });
			checkPaused();
			if (unavailable) throw new Error(unavailable);
			validateTwoSfChannelSample(settings, bytes);
			return { ...settings, bytes };
		});
		session.sampleRequest = request;
		try {
			return await request;
		} finally {
			if (session.sampleRequest === request) session.sampleRequest = null;
		}
	}

	function ensureAudio() {
		if (audio) return;
		audio = new AudioContext();
		master = audio.createGain();
		master.gain.value = volume;
		analyser = audio.createAnalyser();
		analyser.fftSize = 2048;
		master.connect(analyser).connect(audio.destination);
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
				session.renderRequest = session.worker.ask('render');
				const block = await session.renderRequest;
				session.renderRequest = null;
				if (current !== session) return;
				schedule(session, block);
			}
		} catch (error) {
			finish(session, 'error', error);
		} finally {
			session.renderRequest = null;
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
			monitorSupported: null, auditionSupported: null, scheduledFrames: 0, timeline: [], snapshots: [],
		};
		pending = session;
		notify();
		try {
			ensureAudio();
			if (current?.phase !== 'paused') await audio.resume();
			({ totalFrames: session.totalFrames, monitorSupported: session.monitorSupported,
				auditionSupported: session.auditionSupported } =
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
				session.pausedSnapshot = snapshotAt(session, monitorTime());
				session.phase = 'paused';
				clearTimeout(session.timer);
				await audio.suspend();
			} else {
				await session.sampleRequest?.catch(() => {});
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
		getState, getMonitorState, readPausedSample, play, togglePause, stop,
		matches(path, files) { return current?.path === path && current.files === files; },
		setVolume(value) {
			volume = value;
			master?.gain.setTargetAtTime(value, audio.currentTime, 0.008);
		},
		get analyser() { return analyser; },
	};
}
