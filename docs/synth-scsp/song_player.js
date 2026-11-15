// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { prepareScspSongSource } from './song_source.js';
import { prepareScspSsfSource } from './ssf_source.js';
import { createScspSsfRenderer } from './ssf_renderer.js';
import { createScspSsfLiveHistory } from './ssf_live_history.js';

const RATE = 44100,
	CHUNK = 256,
	LOOKAHEAD = 0.05,
	START_DELAY = 0.01;
const nativeSchedule = globalThis.setTimeout.bind(globalThis);
const nativeCancel = globalThis.clearTimeout.bind(globalThis);
const later = () => new Promise((resolve) => nativeSchedule(resolve, 0));
const aborted = () => new DOMException('SCSP song operation cancelled', 'AbortError');
let wasmBinary = null;

async function createCore() {
	wasmBinary ??= fetch(new URL('../generated/scsp_wasm.wasm', import.meta.url))
		.then((response) => {
			if (!response.ok) throw new Error(`SCSP song WASM HTTP ${response.status}`);
			return response.arrayBuffer();
		})
		.catch((error) => {
			wasmBinary = null;
			throw error;
		});
	return Scsp.create({ moduleFactory: factory, moduleOptions: { wasmBinary: await wasmBinary } });
}

/** Sample-exact, one-pass replay of an already validated SCSP source. The
 * caller owns the core and provides output buffers at its native 44.1-kHz rate.
 */
export function createScspSongRenderer(core, source) {
	if (core?.sampleRate !== RATE || typeof core.renderInto !== 'function')
		throw new TypeError('SCSP song requires a 44100 Hz SCSP core');
	const { bytes } = source,
		view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let position = source.header.dataOffset,
		wait = 0,
		framesRendered = 0,
		ended = false;
	core.reset({ clearRam: true });
	core.prepare?.(2048);
	function process(left, right, frames) {
		if (
			!(left instanceof Float32Array) ||
			!(right instanceof Float32Array) ||
			!Number.isInteger(frames) ||
			frames < 0 ||
			frames > Math.min(left.length, right.length)
		)
			throw new RangeError('Invalid SCSP song output buffers');
		const count = Math.min(frames, source.totalSamples - framesRendered);
		let offset = 0;
		while (offset < count) {
			while (!wait && !ended) {
				const command = bytes[position];
				if (command === 0xc5) {
					const address = (bytes[position + 1] << 8) | bytes[position + 2],
						value = bytes[position + 3];
					core.write(
						address & ~1,
						address & 1 ? value : value << 8,
						address & 1 ? 0x00ff : 0xff00,
					);
					position += 4;
				} else if (command === 0x67) {
					const size = view.getUint32(position + 3, true),
						address = view.getUint32(position + 7, true);
					core.loadRam(bytes.subarray(position + 11, position + 7 + size), address);
					position += 7 + size;
				} else if (command === 0x61) {
					wait = view.getUint16(position + 1, true);
					position += 3;
				} else if (
					command === 0x62 ||
					command === 0x63 ||
					(command >= 0x70 && command <= 0x7f)
				) {
					wait = command === 0x62 ? 735 : command === 0x63 ? 882 : (command & 15) + 1;
					position++;
				} else if (command === 0x66) {
					ended = true;
					position++;
				} else throw new Error('Invalid prepared SCSP replay command');
			}
			if (ended) break;
			const length = Math.min(wait, count - offset);
			core.renderInto(left, right, length, offset);
			offset += length;
			wait -= length;
		}
		framesRendered += offset;
		if (framesRendered >= source.totalSamples) ended = true;
		return offset;
	}
	return {
		process,
		get framesRendered() {
			return framesRendered;
		},
		get ended() {
			return ended;
		},
	};
}

/** Independent SCSP reference transport borrowing the Synth's AudioContext and
 * final Master input. Pausing retains the native core and unconsumed PCM.
 */
export function createScspSongPlayer({
	getAudio,
	beforePlay = async () => {},
	onState = () => {},
	onStatus = () => {},
	createEngine = createCore,
	createSsfEngine = createScspSsfRenderer,
	schedule = nativeSchedule,
	cancel = nativeCancel,
	yieldTask = later,
	nowMs = () => performance.now(),
} = {}) {
	if (typeof getAudio !== 'function') throw new TypeError('getAudio is required');
	let source = null,
		name = '',
		active = null,
		disposed = false,
		playback = 'stopped',
		positionFrames = 0;
	let generation = 0,
		loadGeneration = 0,
		loadController = null,
		loading = false,
		seeking = null,
		errorMessage = '';
	let pending = Promise.resolve();
	let liveEnabled = true;
	let editSequence = 0;
	const open = () => {
		if (disposed) throw new Error('SCSP song player is disposed');
	};
	const current = (ticket) => !disposed && ticket === generation;
	const notify = (message) => {
		try {
			onStatus(message);
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
	function getState() {
		const busy = loading || playback === 'starting' || Boolean(seeking),
			frames = position();
		return {
			playback,
			state: playback,
			loaded: Boolean(source),
			hasSource: Boolean(source),
			name,
			loading,
			busy,
			errorMessage,
			playing: playback === 'playing',
			running: playback === 'playing',
			paused: playback === 'paused',
			sampleRate: RATE,
			positionFrames: frames,
			positionSeconds: frames / RATE,
			totalSamples: source?.totalSamples ?? 0,
			durationSeconds: (source?.totalSamples ?? 0) / RATE,
			format: source?.format ?? '',
			kind: source?.kind ?? (source ? 'vgm' : ''),
			liveEnabled,
			entryPath: source?.entryPath ?? '',
			loadedFiles: source?.loadedFiles ? [...source.loadedFiles] : [],
			metadata: source?.metadata ?? null,
			sourceChip: 'scsp',
			sourceClock: source?.clock ?? null,
			warnings: source ? [...source.warnings] : [],
			seeking: Boolean(seeking),
			seekProgress: seeking?.progress ?? 0,
			canPlay: Boolean(source) && !busy && playback !== 'playing',
			canPause: playback === 'playing',
			canResume: playback === 'paused' && !busy,
			canStop: busy || Boolean(active) || frames > 0,
			canSeek: Boolean(source) && !loading && playback !== 'starting',
		};
	}
	function getLiveSnapshot() {
		if (!liveEnabled || !active || active.source.kind !== 'ssf') return null;
		return active.liveHistory.at(position());
	}
	function editVoice(slot, method, patch, expectedSession) {
		open();
		const run = active;
		if (expectedSession !== undefined && expectedSession !== run?.editSession) throw aborted();
		if (
			!run || run.source.kind !== 'ssf' || loading || seeking ||
			!['playing', 'paused'].includes(playback) || typeof run.renderer.editVoice !== 'function'
		)
			throw new Error('Play or pause an SSF song before editing its channel.');
		// Already queued PCM keeps its timeline. This synchronous mutation applies
		// at the renderer's next boundary; snapshots later follow the audible PCM.
		return { ...run.renderer.editVoice(slot, method, patch), session: run.editSession };
	}
	function captureLive(run) {
		if (liveEnabled && run.source.kind === 'ssf' && run.renderer.readSnapshot)
			run.liveHistory.push(run.renderer.readSnapshot());
	}
	function setLiveEnabled(value) {
		open();
		if (typeof value !== 'boolean') throw new TypeError('Live enabled must be boolean');
		if (liveEnabled === value) return;
		liveEnabled = value;
		if (value && active && playback === 'playing') {
			active.liveHistory.clear();
			captureLive(active);
		}
		emit();
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
			if (!node) continue;
			node.onended = null;
			try {
				node.stop();
			} catch {}
			try {
				node.disconnect();
			} catch {}
		}
		run.nextTime = null;
	}
	function release(run) {
		if (!run || run.released) return;
		run.released = true;
		cancelNodes(run);
		run.gain?.disconnect();
		run.renderer.dispose?.();
		run.core?.dispose();
		run.segments.length = 0;
		run.liveHistory.clear();
	}
	function stop() {
		if (disposed) return;
		generation++;
		loadGeneration++;
		loadController?.abort();
		loadController = null;
		loading = false;
		seeking?.controller.abort();
		seeking = null;
		release(active);
		active = null;
		playback = 'stopped';
		positionFrames = 0;
		errorMessage = '';
		emit();
	}
	async function loadSource(prepare, nextName = '', { signal, isCurrent = () => true } = {}) {
		open();
		const ticket = ++loadGeneration,
			controller = new AbortController();
		loadController?.abort();
		loadController = controller;
		const abort = () => controller.abort();
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) controller.abort();
		loading = true;
		emit();
		try {
			const next = await prepare(controller.signal);
			if (
				disposed ||
				ticket !== loadGeneration ||
				controller.signal.aborted ||
				!isCurrent(next.loadedFiles)
			)
				throw aborted();
			// Commit only after complete source validation. A failed import keeps the
			// previous source and its current transport available.
			loadController = null;
			stop();
			source = next;
			name = String(nextName || 'SCSP song');
			emit();
			return getState();
		} finally {
			signal?.removeEventListener('abort', abort);
			if (loadController === controller) {
				loadController = null;
				loading = false;
				emit();
			}
		}
	}
	function load(bytes, nextName, options) {
		return loadSource(
			(signal) => prepareScspSongSource(bytes, { signal, yieldTask }),
			nextName,
			options,
		);
	}
	function loadSsf(entries, entryPath, options) {
		return loadSource(
			async (signal) => {
				const prepared = await prepareScspSsfSource(entries, entryPath, { signal });
				const lengthSeconds = prepared.lengthSeconds ?? 180;
				const durationSeconds = lengthSeconds + prepared.fadeSeconds;
				const warnings = [...prepared.warnings];
				if (prepared.lengthSeconds === null)
					warnings.push('No length tag. Preview uses a 3-minute song length.');
				return {
					...prepared,
					lengthSeconds,
					durationSeconds,
					totalSamples: Math.round(durationSeconds * RATE),
					metadata: Object.fromEntries(prepared.tags),
					warnings,
				};
			},
			entryPath.split('/').pop(),
			options,
		);
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
		notify(`SCSP song playback failed · ${errorMessage}`);
		emit();
	}
	async function host(ticket) {
		await beforePlay();
		if (!current(ticket)) throw aborted();
		const audio = await getAudio();
		if (!current(ticket)) throw aborted();
		const context = audio?.context,
			output = audio?.songInputNode ?? audio?.outputNode;
		if (!context || !output || output.context !== context || context.state === 'closed')
			throw new Error('SCSP song requires the Synth AudioContext and Master input');
		if (context.state !== 'running') await context.resume();
		if (!current(ticket)) throw aborted();
		return { context, output };
	}
	async function createRun(ticket, selected, output) {
		let core, renderer, gain;
		try {
			if (selected.kind === 'ssf') renderer = await createSsfEngine(selected);
			else {
				core = await createEngine(selected.header);
				renderer = createScspSongRenderer(core, selected);
			}
			if (!current(ticket)) throw aborted();
			gain = output.context.createGain();
			gain.connect(output.output);
			const run = {
				core,
				renderer,
				...output,
				gain,
				source: selected,
				basePosition: 0,
				renderedFrames: 0,
				segments: [],
				nextTime: null,
				timer: null,
				eof: false,
				released: false,
				lastEmitTime: null,
				liveHistory: createScspSsfLiveHistory(),
				editSession: ++editSequence,
			};
			captureLive(run);
			return run;
		} catch (error) {
			gain?.disconnect();
			renderer?.dispose?.();
			core?.dispose();
			throw error;
		}
	}
	function scheduleSegment(run, segment) {
		const offset = Math.max(0, run.basePosition - segment.firstFrame);
		if (offset >= segment.frames) return;
		const at = Math.max(run.nextTime ?? 0, run.context.currentTime + START_DELAY),
			node = run.context.createBufferSource();
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
				throw new Error('SCSP renderer produced non-finite PCM');
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
		scheduleSegment(run, segment);
	}
	function pump(run) {
		if (active !== run || playback !== 'playing') return;
		try {
			if (run.context.state === 'closed')
				throw new Error('SCSP song AudioContext was closed');
			const consumed = position();
			positionFrames = consumed;
			run.basePosition = consumed;
			run.liveHistory.prune(consumed);
			run.segments = run.segments.filter(
				(segment) => segment.firstFrame + segment.frames > consumed,
			);
			const deadline = nowMs() + 8;
			for (let chunks = 0; !run.eof && chunks < 12 && nowMs() < deadline; chunks++) {
				if ((run.renderedFrames - position()) / RATE >= LOOKAHEAD) break;
				const left = new Float32Array(CHUNK),
					right = new Float32Array(CHUNK),
					frames = run.renderer.process(left, right, CHUNK);
				captureLive(run);
				if (frames) append(run, left, right, frames);
				run.eof = run.renderer.ended;
				if (!frames) break;
			}
			if (run.eof && position() >= run.renderedFrames) {
				positionFrames = run.renderedFrames;
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
		if (!source) throw new Error('Choose a SCSP VGM or VGZ song first');
		if (playback === 'paused') return resume();
		if (playback === 'playing') return true;
		const ticket = ++generation;
		release(active);
		active = null;
		playback = 'starting';
		positionFrames = 0;
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
		const run = active;
		if (!run || playback !== 'playing') return false;
		run.basePosition = position();
		positionFrames = run.basePosition;
		cancelNodes(run);
		run.segments = run.segments.filter(
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
				throw new Error('Audio output changed. Stop and Play to restart the SCSP song');
			playback = 'playing';
			run.nextTime = null;
			for (const segment of run.segments) scheduleSegment(run, segment);
			pump(run);
			emit();
			return playback === 'playing' || playback === 'ended';
		} catch (error) {
			if (current(ticket)) fail(error, run);
			return false;
		}
	}
	async function seek(seconds) {
		open();
		if (!source || loading || !Number.isFinite(seconds))
			throw new TypeError('Choose a SCSP song and a finite seek time');
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
			const output = await host(ticket);
			next = await createRun(ticket, source, output);
			const left = new Float32Array(2048),
				right = new Float32Array(2048),
				deadline = nowMs() + 30000;
			let frame = 0;
			while (frame < target) {
				if (!current(ticket) || controller.signal.aborted) throw aborted();
				if (nowMs() > deadline) throw new Error('SCSP seek exceeded 30 seconds');
				const frames = next.renderer.process(left, right, Math.min(2048, target - frame));
				frame += frames;
				if (frame >= target - 4096) {
					captureLive(next);
					next.liveHistory.prune(frame);
				}
				if (!frames && next.renderer.ended) break;
				seeking.progress = target ? frame / target : 1;
				emit();
				await yieldTask();
			}
			if (!current(ticket) || controller.signal.aborted) throw aborted();
			next.basePosition = next.renderedFrames = frame;
			next.eof = next.renderer.ended;
			active = next;
			positionFrames = frame;
			seeking = null;
			errorMessage = '';
			playback = previousPlayback === 'playing' ? 'playing' : 'paused';
			release(previous);
			next = null;
			if (playback === 'playing') pump(active);
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
				notify(`SCSP seek failed · ${errorMessage}`);
			}
			emit();
			return false;
		}
	}
	function dispose() {
		if (disposed) return;
		stop();
		disposed = true;
		source = null;
		name = '';
	}
	const track = (task) => {
		pending = task.then(
			() => {},
			() => {},
		);
		return task;
	};
	return {
		load: (...args) => track(load(...args)),
		loadSsf: (...args) => track(loadSsf(...args)),
		play: () => track(play()),
		pause,
		resume: () => track(resume()),
		stop,
		clear,
		seek: (seconds) => track(seek(seconds)),
		getState,
		getLiveSnapshot,
		editVoice,
		getEditSession: () => active?.editSession ?? null,
		setLiveEnabled,
		read: getState,
		whenIdle: () => pending,
		dispose,
	};
}
