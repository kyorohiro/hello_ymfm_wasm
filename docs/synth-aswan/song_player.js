// SPDX-License-Identifier: BSD-3-Clause
import { createAswanSongEngine, prepareAswanSongSource } from './song_engine.js';

const RATE = 44100,
	CHUNK = 256,
	LOOKAHEAD = 0.05,
	START_DELAY = 0.01;
const defaultSchedule = globalThis.setTimeout.bind(globalThis),
	defaultCancel = globalThis.clearTimeout.bind(globalThis);
const aborted = () => new DOMException('ASWAN song operation cancelled', 'AbortError');

/** One-pass reference transport borrowing the Synth context and calibrated
 * pre-Master song input. Pause keeps the native core and unconsumed buffers;
 * Resume does not rebuild the song or use a second AudioContext. */
export function createAswanSongPlayer({
	getAudio,
	beforePlay = async () => {},
	onState = () => {},
	onStatus = () => {},
	createEngine = createAswanSongEngine,
	prepareSource = prepareAswanSongSource,
	schedule = defaultSchedule,
	cancel = defaultCancel,
	yieldTask = () => new Promise((resolve) => defaultSchedule(resolve, 0)),
	nowMs = () => performance.now(),
} = {}) {
	if (typeof getAudio !== 'function') throw new TypeError('ASWAN getAudio is required');
	let source = null,
		name = '',
		active = null,
		disposed = false,
		playback = 'stopped',
		generation = 0;
	let loadGeneration = 0,
		loading = false,
		loadController = null,
		seeking = null,
		pending = Promise.resolve();
	let positionFrames = 0,
		errorMessage = '',
		liveEnabled = true,
		liveState = null,
		volume = 1;
	const enabled = Array(4).fill(true);
	const open = () => {
		if (disposed) throw new Error('ASWAN song player is disposed');
	};
	const current = (ticket) => !disposed && ticket === generation;
	const notify = (text) => {
		try {
			onStatus(text);
		} catch {}
	};
	function position(run = active) {
		if (!run) return positionFrames;
		if (playback !== 'playing') return run.basePosition;
		let frame = run.basePosition;
		for (const segment of run.segments) {
			if (segment.playAt === null || run.context.currentTime < segment.playAt) break;
			const elapsed =
				segment.offset +
				Math.max(0, Math.floor((run.context.currentTime - segment.playAt) * RATE + 1e-7));
			frame = Math.max(frame, segment.firstFrame + Math.min(segment.frames, elapsed));
		}
		return Math.min(run.renderedFrames, frame);
	}
	function publish(force = false) {
		if (!active || seeking) return;
		const frame = position();
		let index = 0;
		while (index + 1 < active.history.length && active.history[index + 1].frame <= frame)
			index++;
		if (force || liveEnabled || !liveState) liveState = structuredClone(active.history[index]);
		if (index) active.history.splice(0, index);
	}
	function getState() {
		if (['playing', 'paused'].includes(playback)) publish();
		const frame = position(),
			busy = loading || playback === 'starting' || Boolean(seeking);
		return {
			playback,
			state: playback,
			name,
			loaded: Boolean(source),
			hasSource: Boolean(source),
			loading,
			busy,
			errorMessage,
			playing: playback === 'playing',
			paused: playback === 'paused',
			isPlaying: playback === 'playing',
			isPaused: playback === 'paused',
			positionFrames: frame,
			positionSeconds: frame / RATE,
			durationSeconds: (source?.totalSamples ?? 0) / RATE,
			sampleRate: RATE,
			totalSamples: source?.totalSamples ?? 0,
			sourceClock: source?.clock ?? null,
			sourceChip: 'wonderswan',
			metadata: source?.metadata ?? null,
			warnings: source ? [...source.warnings] : [],
			format: source?.format ?? '',
			channelEnabled: [...enabled],
			liveEnabled,
			liveState,
			volume,
			seeking: Boolean(seeking),
			seekProgress: seeking?.progress ?? 0,
			canPlay: Boolean(source) && !busy && playback !== 'playing',
			canPause: playback === 'playing',
			canResume: playback === 'paused' && !busy,
			canStop: busy || Boolean(active) || frame > 0,
			canSeek: Boolean(source) && !loading && playback !== 'starting',
		};
	}
	function emit() {
		try {
			onState(getState());
		} catch {}
	}
	function cancelNodes(run) {
		if (!run) return;
		if (run.timer !== null) {
			cancel(run.timer);
			run.timer = null;
		}
		for (const segment of run.segments) {
			const node = segment.node;
			segment.node = null;
			segment.playAt = null;
			try {
				node?.stop();
			} catch {}
			try {
				node?.disconnect();
			} catch {}
		}
		run.nextTime = null;
	}
	function release(run) {
		if (!run || run.released) return;
		run.released = true;
		cancelNodes(run);
		run.gain.disconnect();
		run.engine.dispose();
	}
	function stop() {
		if (disposed) return;
		generation++;
		seeking?.controller.abort();
		seeking = null;
		loadController?.abort();
		loading = false;
		release(active);
		active = null;
		positionFrames = 0;
		playback = 'stopped';
		errorMessage = '';
		liveState = null;
		emit();
	}
	async function load(bytes, nextName = '', { signal } = {}) {
		open();
		const ticket = ++loadGeneration;
		loadController?.abort();
		const controller = new AbortController();
		loadController = controller;
		const abort = () => controller.abort();
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) controller.abort();
		loading = true;
		emit();
		try {
			const next = await prepareSource(bytes, { signal: controller.signal });
			if (disposed || ticket !== loadGeneration || controller.signal.aborted) throw aborted();
			stop();
			source = next;
			name = String(nextName || 'ASWAN reference');
			emit();
			return getState();
		} finally {
			signal?.removeEventListener('abort', abort);
			if (ticket === loadGeneration) {
				loading = false;
				loadController = null;
				emit();
			}
		}
	}
	function clear() {
		open();
		stop();
		source = null;
		name = '';
		emit();
	}
	function fail(error, run = active) {
		if (run && active !== run) return;
		positionFrames = position();
		release(active);
		active = null;
		playback = 'error';
		errorMessage = error?.message ?? String(error);
		notify(`ASWAN song playback failed: ${errorMessage}`);
		emit();
	}
	async function host(ticket) {
		await beforePlay();
		if (!current(ticket)) throw aborted();
		const audio = await getAudio();
		if (!current(ticket)) throw aborted();
		const context = audio?.context,
			output = audio?.songInputNode;
		if (!context || !output || output.context !== context || context.state === 'closed')
			throw new Error(
				'ASWAN song requires the Synth AudioContext and calibrated songInputNode',
			);
		if (context.state !== 'running') await context.resume();
		if (!current(ticket)) throw aborted();
		return { context, output };
	}
	async function createRun(ticket, selected, output) {
		const engine = await createEngine(selected);
		if (!current(ticket)) {
			engine.dispose();
			throw aborted();
		}
		let gain;
		try {
			if (engine.sampleRate() !== RATE)
				throw new Error('ASWAN reference renderer must use 44100 Hz');
			gain = output.context.createGain();
			gain.gain.value = volume;
			gain.connect(output.output);
			enabled.forEach((value, channel) => engine.setChannelMuted(channel, !value));
			return {
				...output,
				engine,
				gain,
				history: [engine.snapshot()],
				renderedFrames: 0,
				basePosition: 0,
				segments: [],
				nextTime: null,
				timer: null,
				eof: false,
				released: false,
				lastEmitTime: null,
			};
		} catch (error) {
			gain?.disconnect();
			engine.dispose();
			throw error;
		}
	}
	function scheduleSegment(run, segment) {
		const offset = Math.max(0, run.basePosition - segment.firstFrame);
		if (offset >= segment.frames) return;
		const at = Math.max(run.nextTime ?? 0, run.context.currentTime + START_DELAY);
		const node = run.context.createBufferSource();
		node.buffer = segment.buffer;
		node.connect(run.gain);
		segment.node = node;
		segment.offset = offset;
		segment.playAt = at;
		node.onended = () => {
			try {
				node.disconnect();
			} catch {}
			if (segment.node === node) segment.node = null;
		};
		node.start(at, offset / RATE);
		run.nextTime = at + (segment.frames - offset) / RATE;
	}
	function append(run, left, right, frames) {
		for (let index = 0; index < frames; index++)
			if (!Number.isFinite(left[index]) || !Number.isFinite(right[index]))
				throw new Error('Non-finite ASWAN song output');
		const buffer = run.context.createBuffer(2, frames, RATE);
		buffer.copyToChannel(left.subarray(0, frames), 0);
		buffer.copyToChannel(right.subarray(0, frames), 1);
		const segment = {
			buffer,
			frames,
			firstFrame: run.renderedFrames,
			node: null,
			offset: 0,
			playAt: null,
		};
		run.renderedFrames += frames;
		run.segments.push(segment);
		run.history.push(run.engine.snapshot());
		scheduleSegment(run, segment);
	}
	function pump(run) {
		if (active !== run || playback !== 'playing') return;
		try {
			const consumed = position();
			positionFrames = consumed;
			run.basePosition = consumed;
			publish();
			run.segments = run.segments.filter(
				(segment) => segment.firstFrame + segment.frames > consumed,
			);
			const deadline = nowMs() + 8;
			for (let chunks = 0; !run.eof && chunks < 12 && nowMs() < deadline; chunks++) {
				if ((run.renderedFrames - position()) / RATE >= LOOKAHEAD) break;
				const left = new Float32Array(CHUNK),
					right = new Float32Array(CHUNK),
					frames = run.engine.process(left, right, CHUNK);
				if (!Number.isInteger(frames) || frames < 0 || frames > CHUNK)
					throw new Error('Invalid ASWAN render length');
				if (frames) append(run, left, right, frames);
				run.eof = run.engine.ended;
				if (!frames) break;
			}
			if (run.eof && position() >= run.renderedFrames) {
				positionFrames = run.renderedFrames;
				publish(true);
				active = null;
				playback = 'ended';
				release(run);
				emit();
				return;
			}
			if (run.lastEmitTime === null || run.context.currentTime - run.lastEmitTime >= 0.05) {
				run.lastEmitTime = run.context.currentTime;
				emit();
			}
			if (active === run && playback === 'playing')
				run.timer = schedule(() => {
					run.timer = null;
					pump(run);
				}, 8);
		} catch (error) {
			fail(error, run);
		}
	}
	async function play() {
		open();
		if (loading || seeking || playback === 'starting') return false;
		if (!source) throw new Error('Choose a VGM or VGZ song first');
		if (playback === 'paused') return resume();
		if (playback === 'playing') return true;
		const ticket = ++generation;
		release(active);
		active = null;
		playback = 'starting';
		positionFrames = 0;
		liveState = null;
		errorMessage = '';
		emit();
		try {
			const output = await host(ticket),
				run = await createRun(ticket, source, output);
			if (!current(ticket)) {
				release(run);
				return false;
			}
			active = run;
			playback = 'playing';
			pump(run);
			return playback === 'playing' || playback === 'ended';
		} catch (error) {
			if (current(ticket)) fail(error);
			return false;
		}
	}
	function pause() {
		open();
		if (!active || playback !== 'playing') return false;
		generation++;
		active.basePosition = position();
		positionFrames = active.basePosition;
		publish(true);
		cancelNodes(active);
		active.segments = active.segments.filter(
			(segment) => segment.firstFrame + segment.frames > positionFrames,
		);
		playback = 'paused';
		emit();
		return true;
	}
	async function resume() {
		open();
		const run = active;
		if (!run || playback !== 'paused' || loading || seeking) return false;
		const ticket = ++generation;
		playback = 'starting';
		emit();
		try {
			const output = await host(ticket);
			if (!current(ticket) || active !== run) return false;
			if (output.context !== run.context || output.output !== run.output)
				throw new Error('Audio output changed; Stop and Play to restart');
			playback = 'playing';
			run.nextTime = null;
			for (const segment of run.segments) scheduleSegment(run, segment);
			pump(run);
			emit();
			return true;
		} catch (error) {
			if (current(ticket)) fail(error, run);
			return false;
		}
	}
	async function seek(seconds) {
		open();
		if (!source || loading || !Number.isFinite(seconds))
			throw new TypeError('Choose a song and a finite seek position');
		const target = Math.round(
			Math.max(0, Math.min(source.totalSamples / RATE, seconds)) * RATE,
		);
		const previous = active,
			previousPlayback = playback,
			previousPosition = position(),
			ticket = ++generation;
		seeking?.controller.abort();
		const controller = new AbortController();
		seeking = { controller, progress: 0 };
		if (previous) {
			previous.basePosition = previousPosition;
			cancelNodes(previous);
		}
		playback = 'seeking';
		emit();
		let next = null;
		try {
			next = await createRun(ticket, source, await host(ticket));
			const left = new Float32Array(2048),
				right = new Float32Array(2048),
				deadline = nowMs() + 30000;
			let frame = 0;
			while (frame < target) {
				if (!current(ticket) || controller.signal.aborted) throw aborted();
				if (nowMs() > deadline) throw new Error('ASWAN seek exceeded 30 seconds');
				const count = next.engine.process(left, right, Math.min(2048, target - frame));
				frame += count;
				if (!count && next.engine.ended) break;
				seeking.progress = target ? frame / target : 1;
				emit();
				await yieldTask();
			}
			if (!current(ticket) || controller.signal.aborted) throw aborted();
			next.basePosition = next.renderedFrames = frame;
			next.history = [next.engine.snapshot()];
			next.eof = next.engine.ended;
			active = next;
			positionFrames = frame;
			seeking = null;
			liveState = null;
			playback = previousPlayback === 'playing' ? 'playing' : 'paused';
			release(previous);
			next = null;
			if (playback === 'playing') pump(active);
			else publish(true);
			emit();
			return true;
		} catch (error) {
			release(next);
			if (!current(ticket)) {
				if (active !== previous) release(previous);
				return false;
			}
			seeking = null;
			active = previous;
			positionFrames = previousPosition;
			playback = previous ? 'paused' : 'stopped';
			if (previous && previousPlayback === 'playing') {
				playback = 'playing';
				for (const segment of previous.segments) scheduleSegment(previous, segment);
				pump(previous);
			}
			if (error.name !== 'AbortError') {
				errorMessage = error?.message ?? String(error);
				notify(`ASWAN seek failed: ${errorMessage}`);
			}
			emit();
			return false;
		}
	}
	function setLiveEnabled(value) {
		open();
		if (typeof value !== 'boolean') throw new TypeError('Live enabled must be boolean');
		liveEnabled = value;
		if (value) publish(true);
		emit();
	}
	function setChannelEnabled(channel, value) {
		open();
		if (!Number.isInteger(channel) || channel < 0 || channel > 3 || typeof value !== 'boolean')
			throw new TypeError('ASWAN channel needs 0..3 and boolean');
		enabled[channel] = value;
		active?.engine.setChannelMuted(channel, !value);
		emit();
		return getState();
	}
	function setVolume(value) {
		open();
		if (!Number.isFinite(value) || value < 0 || value > 3.8)
			throw new RangeError('ASWAN song volume must be 0..3.8');
		volume = value;
		if (active) active.gain.gain.value = value;
		emit();
	}
	function dispose() {
		if (disposed) return;
		stop();
		disposed = true;
		source = null;
		name = '';
	}
	const track =
		(operation) =>
		(...args) => {
			const result = operation(...args);
			pending = Promise.resolve(result).catch(() => {});
			return result;
		};
	return {
		load: track(load),
		play: track(play),
		pause,
		resume: track(resume),
		stop,
		clear,
		seek: track(seek),
		getState,
		read: getState,
		setLiveEnabled,
		setChannelEnabled,
		setVolume,
		whenIdle: () => pending,
		dispose,
	};
}
