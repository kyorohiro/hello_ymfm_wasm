// SPDX-License-Identifier: BSD-3-Clause
const PROCESSOR = 'tetorica-vsu';
const STARTUP_TIMEOUT_MS = 10000;

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

function copyVgmPlan({ writes, durationTicks, loopTick, loopIndex } = {}) {
	if (!(writes instanceof Uint32Array) || writes.length % 3 !== 0 ||
		!Number.isInteger(durationTicks) || durationTicks < 1 || durationTicks > 0xffffffff)
		throw new TypeError('Choose a valid VSU VGM timeline.');
	if (loopTick !== null && (!Number.isInteger(loopTick) || loopTick < 0 || loopTick >= durationTicks ||
		!Number.isInteger(loopIndex) || loopIndex < 0 || loopIndex > writes.length / 3))
		throw new TypeError('Choose a valid VGM loop point.');
	return { writes: writes.slice(), durationTicks, loopTick, loopIndex };
}

export function createVsuAudio({ volume = .6, onError = () => {}, onVgmState = () => {} } = {}) {
	validateVolume(volume);
	let session = null;
	let disposed = false;
	let nextVgmId = 0;

	async function close(current, error) {
		if (session !== current) return;
		session = null;
		clearTimeout(current.timer);
		current.abort.abort();
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
		const current = { context, output, abort: new AbortController() };
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
		current.timer = setTimeout(() => fail(new Error('VSU audio did not become ready.')), STARTUP_TIMEOUT_MS);
		const load = (async () => {
			if (!context.audioWorklet) throw new Error('VSU audio requires AudioWorklet over HTTPS or localhost.');
			output.gain.value = volume;
			output.connect(context.destination);
			const bytes = fetch(new URL('./vsu.wasm', import.meta.url), { signal: current.abort.signal }).then(response => {
				if (!response.ok) throw new Error(`Unable to load the VSU core (HTTP ${response.status}).`);
				return response.arrayBuffer();
			});
			const [wasmBinary] = await Promise.all([
				bytes, context.resume(), context.audioWorklet.addModule(new URL('./worklet.js', import.meta.url)),
			]);
			current.abort.signal.throwIfAborted();
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
					if (data.type === 'vgm-state' && session === current && data.id === current.vgmId &&
						(!current.vgmStopping || data.state === 'stopped')) {
						if (data.state === 'stopped') current.vgmId = null;
						const { type, ...playback } = data;
						onVgmState(playback);
					}
				};
				node.connect(output);
			})]);
			current.abort.signal.throwIfAborted();
			clearTimeout(current.timer);
			current.active = true;
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
		playVgm(source, { loop = false, mask = 63 } = {}) {
			validateMask(mask);
			const plan = copyVgmPlan(source);
			const id = ++nextVgmId;
			send({ type: 'vgm-play', id, plan, mask, loop: Boolean(loop) }, [plan.writes.buffer]);
			session.vgmId = id;
			session.vgmStopping = false;
			return id;
		},
		pauseVgm(paused) { sendToVgm({ type: 'vgm-pause', paused: Boolean(paused) }); },
		stopVgm() {
			if (!session?.active || !session.vgmId || session.vgmStopping) return;
			sendToVgm({ type: 'vgm-stop' });
			session.vgmStopping = true;
		},
		setVgmLoop(loop) { sendToVgm({ type: 'vgm-loop', loop: Boolean(loop) }); },
		setVgmMask(mask) {
			validateMask(mask);
			sendToVgm({ type: 'vgm-mask', mask });
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
