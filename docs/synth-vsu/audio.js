// SPDX-License-Identifier: BSD-3-Clause
import { createVgmSeekClient } from './vgm-seek-client.js';
import { VSU_CHANNEL_COUNT, vsuNoteOnWrites } from './vsu.js';

const PROCESSOR = 'tetorica-vsu';
const WORKLET_TIMEOUT_MS = 10000;

function validateVolume(level) {
	if (!Number.isFinite(level) || level < 0 || level > 1)
		throw new RangeError('VSU Master volume must be from 0 to 1.');
}

function validateWrite(offset, value) {
	if (!Number.isInteger(offset) || offset < 0 || offset > 0x5ff)
		throw new RangeError('Choose a VSU-relative register offset from 0x000 to 0x5FF.');
	if (!Number.isInteger(value) || value < 0 || value > 0xff)
		throw new RangeError('VSU writes take one byte.');
}

function validateMask(mask) {
	if (!Number.isInteger(mask) || mask < 0 || mask > 63)
		throw new RangeError('Choose a VSU channel mask from 0 to 63.');
}

function validLiveNoteOwner(channel, owner) {
	return Number.isInteger(channel) && channel >= 0 && channel < VSU_CHANNEL_COUNT &&
		Number.isSafeInteger(owner) && owner > 0;
}

function validateVgmPlan({ writes, durationTicks, loopTick, loopIndex } = {}) {
	if (!(writes instanceof Uint32Array) || writes.length % 3 !== 0 ||
		!Number.isInteger(durationTicks) || durationTicks < 1 || durationTicks > 0xffffffff)
		throw new TypeError('Choose a valid VSU VGM timeline.');
	if (loopTick !== null && (!Number.isInteger(loopTick) || loopTick < 0 || loopTick >= durationTicks ||
		!Number.isInteger(loopIndex) || loopIndex < 0 || loopIndex > writes.length / 3))
		throw new TypeError('Choose a valid VGM loop point.');
	return { writes, durationTicks, loopTick, loopIndex };
}

export function createVsuAudio({ volume = .6, onError = () => {}, onVgmState = () => {}, onLiveState = () => {} } = {}) {
	validateVolume(volume);
	const channelGains = Array(VSU_CHANNEL_COUNT).fill(1);
	let session = null;
	let disposed = false;
	let nextVgmId = 0;
	let nextCaptureRequest = 0;
	let liveChannel = null;
	let liveRevision = 0;

	function takeCapture(current, request) {
		const pending = current.captures.get(request);
		if (pending) {
			current.captures.delete(request);
			clearTimeout(pending.timer);
		}
		return pending;
	}

	function cancelCaptures(current, error = new DOMException('VGM playback changed before the channel could be copied.', 'AbortError')) {
		for (const request of current.captures.keys()) takeCapture(current, request).reject(error);
	}

	function cancelSeek(current, error = new DOMException('VGM playback changed before the seek completed.', 'AbortError')) {
		current?.vgmSeek?.controller.abort(error);
	}

	function reportLive(current, { source, channel, voice, playbackId, revision, sequence, edit }) {
		if (channel !== liveChannel || revision !== liveRevision || current.vgmSeek) return;
		const vgmOwnsOutput = current.vgmId && current.vgmState !== 'ended';
		if (source === 'vgm') {
			if (!vgmOwnsOutput || current.vgmStopping || current.vgmId !== playbackId) return;
		} else if (vgmOwnsOutput) return;
		// An ordinary snapshot can already be queued when the user moves a
		// control. Preserve edits on other fields even when a later edit is pending.
		if (!edit && sequence < current.liveWriteSequence) return;
		onLiveState({ source, channel, voice, playbackId, ...(edit ? { edit } : {}) });
	}

	async function close(current, error) {
		if (session !== current) return;
		session = null;
		clearTimeout(current.timer);
		current.abort.abort();
		cancelCaptures(current, error);
		cancelSeek(current, error);
		current.seekClient?.dispose();
		current.reject(error);
		current.context.removeEventListener('statechange', current.stateChanged);
		if (current.node) {
			current.node.onprocessorerror = null;
			current.node.port.onmessage = null;
			current.node.port.onmessageerror = null;
			current.node.disconnect();
			current.node.port.close();
		}
		current.output.disconnect();
		if (current.context.state !== 'closed') await current.context.close();
	}

	function startup() {
		const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
		if (!Context || typeof AudioWorkletNode === 'undefined')
			throw new Error('VSU audio requires AudioWorklet over HTTPS or localhost.');
		const context = new Context({ latencyHint: 'interactive' });
		const output = context.createGain();
		const current = { context, output, abort: new AbortController(), captures: new Map(), liveWriteSequence: 0 };
		session = current;
		const fail = error => {
			if (session !== current) return;
			void close(current, error).catch(() => {});
			if (current.active) onError(error);
		};
		current.stateChanged = () => {
			if (context.state === 'closed') fail(new Error('VSU AudioContext was closed.'));
		};
		context.addEventListener('statechange', current.stateChanged);
		const failure = new Promise((_, reject) => { current.reject = reject; });
		current.timer = setTimeout(() => fail(new Error('VSU audio did not become ready.')), WORKLET_TIMEOUT_MS);
		const load = (async () => {
			if (!context.audioWorklet) throw new Error('VSU audio requires AudioWorklet over HTTPS or localhost.');
			output.gain.value = volume;
			output.connect(context.destination);
			const bytes = fetch(new URL('./vsu.wasm?v=vsu-noise', import.meta.url), { signal: current.abort.signal }).then(response => {
				if (!response.ok) throw new Error(`Unable to load the VSU core (HTTP ${response.status}).`);
				return response.arrayBuffer();
			});
			const [wasmBinary] = await Promise.all([
				bytes, context.resume(), context.audioWorklet.addModule(new URL('./worklet.js?v=vsu-noise', import.meta.url)),
			]);
			current.abort.signal.throwIfAborted();
			current.wasmBinary = wasmBinary;
			const node = new AudioWorkletNode(context, PROCESSOR, {
				numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasmBinary },
			});
			current.node = node;
			await Promise.race([failure, new Promise(resolve => {
				node.onprocessorerror = () => fail(new Error('VSU AudioWorklet processor failed.'));
				node.port.onmessageerror = () => fail(new Error('VSU AudioWorklet response could not be decoded.'));
				node.port.onmessage = ({ data }) => {
					if (data.type === 'ready') resolve();
					if (data.type === 'error') fail(new Error(data.error));
					if (session !== current) return;
					if (data.type === 'live-state') {
						reportLive(current, data);
						return;
					}
					if (data.id !== current.vgmId) return;
					if (data.type === 'vgm-state' && (!current.vgmStopping || data.state === 'stopped')) {
						current.vgmState = data.state;
						if (data.state !== 'paused') cancelCaptures(current);
						if (data.state === 'stopped') current.vgmId = null;
						const { type, ...playback } = data;
						if (!current.vgmSeek) onVgmState(playback);
					}
					if (data.type === 'vgm-capture') {
						const pending = takeCapture(current, data.request);
						if (pending) data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.voice);
					}
				};
				node.connect(output);
			})]);
			current.abort.signal.throwIfAborted();
			clearTimeout(current.timer);
			current.active = true;
			for (const [channel, gain] of channelGains.entries()) {
				if (gain !== 1) send({ type: 'channel-gain', channel, gain });
			}
			if (liveChannel !== null) send({ type: 'live-watch', channel: liveChannel, revision: liveRevision });
		})();
		current.ready = Promise.race([load, failure]).catch(async error => {
			await close(current, error).catch(() => {});
			throw error;
		});
		return current.ready;
	}

	function send(message, transfer = []) {
		if (!session?.active) throw new Error('Call ensureReady() before using VSU audio.');
		session.node.port.postMessage(message, transfer);
	}

	function sendToVgm(message) {
		if (!session?.active || !session.vgmId || session.vgmStopping) return;
		send({ ...message, id: session.vgmId });
	}

	function startVgm(current, source, plan, { loop, mask, paused = false }, checkpoint) {
		const id = ++nextVgmId;
		// An ordinary Play starts with the supplied timeline. Subsequent seeks on
		// the same parsed song need to send only the reconstructed chip state.
		const timeline = checkpoint && current.vgmSource === source ? undefined : { ...plan, writes: plan.writes.slice() };
		const transfer = [];
		if (timeline) transfer.push(timeline.writes.buffer);
		if (checkpoint) transfer.push(checkpoint.bytes.buffer);
		send({ type: 'vgm-play', id, plan: timeline, mask, loop, paused, checkpoint }, transfer);
		cancelCaptures(current);
		current.vgmId = id;
		current.vgmSource = source;
		current.vgmStopping = false;
		current.vgmState = null;
		return id;
	}

	return {
		get context() { return session?.context ?? null; },
		get output() { return session?.output ?? null; },
		async ensureReady() {
			if (disposed) throw new Error('VSU audio was disposed.');
			if (!session) return startup();
			const current = session;
			if (current.active && current.context.state !== 'running') await current.context.resume();
			current.abort.signal.throwIfAborted();
			return current.ready;
		},
		write(offset, value) {
			validateWrite(offset, value);
			send({ type: 'write', offset, value });
		},
		writeBatch(pairs) {
			if (!Array.isArray(pairs)) throw new TypeError('Provide an array of [offset, value] VSU writes.');
			const writes = new Uint16Array(pairs.length * 2);
			for (const [index, pair] of pairs.entries()) {
				if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('Provide each VSU write as [offset, value].');
				const [offset, value] = pair;
				validateWrite(offset, value);
				writes[index * 2] = offset;
				writes[index * 2 + 1] = value;
			}
			send({ type: 'batch', writes }, [writes.buffer]);
		},
		reset() { send({ type: 'reset' }); },
		setLiveChannel(channel) {
			if (channel !== null && (!Number.isInteger(channel) || channel < 0 || channel >= 6))
				throw new RangeError('Choose a VSU channel from 0 to 5.');
			if (channel === liveChannel) return;
			liveChannel = channel;
			liveRevision++;
			if (session?.active) send({ type: 'live-watch', channel, revision: liveRevision });
		},
		writeLiveChannel({ source, channel, playbackId, register, mask, value }) {
			const current = session;
			if (!current?.active || current.vgmSeek || liveChannel === null || channel !== liveChannel) return false;
			const vgmOwnsOutput = Boolean(current.vgmId) && current.vgmState !== 'ended';
			if (source === 'vgm') {
				if (current.vgmStopping || current.vgmId !== playbackId ||
					(current.vgmState !== 'playing' && current.vgmState !== 'paused')) return false;
			} else if (source !== 'synth' || vgmOwnsOutput || playbackId !== null) return false;
			if (register !== 'LRV' && register !== 'EV0' && register !== 'EV1')
				throw new RangeError('Choose a live level or envelope register.');
			const allowedMask = register === 'EV1' ? 3 : 255;
			if (!Number.isInteger(mask) || mask < 1 || mask > allowedMask ||
				!Number.isInteger(value) || value < 0 || value > 255)
				throw new RangeError('Choose a valid live register value and mask.');
			send({ type: 'live-write', source, channel, playbackId, register, mask, value,
				revision: liveRevision, sequence: ++current.liveWriteSequence });
			return true;
		},
		liveNoteOn({ source, channel, playbackId, owner, note }) {
			const current = session;
			if (!current?.active || current.vgmSeek || channel !== liveChannel || !validLiveNoteOwner(channel, owner)) return false;
			if (source === 'vgm') {
				if (current.vgmStopping || current.vgmId !== playbackId || current.vgmState !== 'playing') return false;
			} else if (source !== 'synth' || playbackId !== null || (current.vgmId && current.vgmState !== 'ended')) return false;
			send({ type: 'live-note-on', source, channel, playbackId, owner, revision: liveRevision,
				writes: vsuNoteOnWrites(channel, note) });
			return true;
		},
		liveNoteOff({ source, channel, playbackId, owner }) {
			const current = session;
			if (!current?.active || !validLiveNoteOwner(channel, owner)) return false;
			if (source === 'vgm') {
				if (current.vgmSeek || current.vgmStopping || current.vgmId === null || current.vgmId !== playbackId) return false;
			} else if (source !== 'synth' || playbackId !== null) return false;
			send({ type: 'live-note-off', source, channel, playbackId, owner });
			return true;
		},
		playVgm(source, { loop = false, mask = 63 } = {}) {
			validateMask(mask);
			const plan = validateVgmPlan(source);
			cancelSeek(session);
			return startVgm(session, source, plan, { loop: Boolean(loop), mask });
		},
		async seekVgm(source, tick, { loop = false, mask = 63, paused = true, signal } = {}) {
			validateMask(mask);
			const plan = validateVgmPlan(source);
			if (!Number.isInteger(tick) || tick < 0 || tick > plan.durationTicks)
				throw new RangeError('Choose a position within the VGM.');
			const current = session;
			if (!current?.active) throw new Error('Call ensureReady() before using VSU audio.');
			signal?.throwIfAborted();
			cancelSeek(current);
			cancelCaptures(current);
			const controller = new AbortController();
			const seek = { controller, loop: Boolean(loop), mask, paused: Boolean(paused) };
			current.vgmSeek = seek;
			const abort = () => controller.abort(signal.reason);
			signal?.addEventListener('abort', abort, { once: true });
			try {
				sendToVgm({ type: 'vgm-pause', paused: true });
				current.seekClient ??= createVgmSeekClient({
					wasmBinary: current.wasmBinary, sampleRate: current.context.sampleRate,
				});
				const checkpoint = await current.seekClient.seek(source, tick, { signal: controller.signal });
				controller.signal.throwIfAborted();
				return startVgm(current, source, plan, seek, checkpoint);
			} finally {
				signal?.removeEventListener('abort', abort);
				if (current.vgmSeek === seek) current.vgmSeek = null;
			}
		},
		pauseVgm(paused) {
			if (!paused) cancelSeek(session);
			else if (session?.vgmSeek) session.vgmSeek.paused = true;
			sendToVgm({ type: 'vgm-pause', paused: Boolean(paused) });
			if (!paused && session?.active) {
				session.vgmState = null;
				cancelCaptures(session);
			}
		},
		stopVgm() {
			cancelSeek(session);
			if (!session?.active || !session.vgmId || session.vgmStopping) return;
			sendToVgm({ type: 'vgm-stop' });
			session.vgmStopping = true;
			cancelCaptures(session);
		},
		async captureVgmChannel(channel) {
			if (!Number.isInteger(channel) || channel < 0 || channel >= 6)
				throw new RangeError('Choose a VSU channel from 0 to 5.');
			const current = session;
			if (!current?.active || current.vgmState !== 'paused' || current.vgmStopping || current.vgmSeek)
				throw new Error('Pause a VGM before copying a channel.');
			const request = ++nextCaptureRequest;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					takeCapture(current, request)?.reject(new Error('The VGM channel could not be read.'));
				}, WORKLET_TIMEOUT_MS);
				current.captures.set(request, { timer, resolve, reject });
				try { sendToVgm({ type: 'vgm-capture', request, channel }); }
				catch (error) { takeCapture(current, request).reject(error); }
			});
		},
		setVgmLoop(loop) {
			const repeat = Boolean(loop);
			if (session?.vgmSeek) session.vgmSeek.loop = repeat;
			sendToVgm({ type: 'vgm-loop', loop: repeat });
		},
		setVgmMask(mask) {
			validateMask(mask);
			if (session?.vgmSeek) session.vgmSeek.mask = mask;
			sendToVgm({ type: 'vgm-mask', mask });
		},
		setChannelMix(channel, { enabled, volume }) {
			if (!Number.isInteger(channel) || channel < 0 || channel >= VSU_CHANNEL_COUNT)
				throw new RangeError('Choose a VSU channel from 0 to 5.');
			if (typeof enabled !== 'boolean' || !Number.isFinite(volume) || volume < 0 || volume > 1)
				throw new RangeError('Choose a VSU channel volume from 0 to 1 and an enabled state.');
			const gain = enabled ? volume : 0;
			if (gain === channelGains[channel]) return;
			channelGains[channel] = gain;
			if (session?.active) send({ type: 'channel-gain', channel, gain });
		},
		setVolume(level) {
			validateVolume(level);
			volume = level;
			if (session) session.output.gain.setTargetAtTime(level, session.context.currentTime, .008);
		},
		async dispose() {
			disposed = true;
			if (session) await close(session, new Error('VSU audio was disposed.'));
		},
	};
}
