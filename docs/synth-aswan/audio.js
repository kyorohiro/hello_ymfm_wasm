// SPDX-License-Identifier: BSD-3-Clause
import {
	createAswanCodeClient,
	aswanCodeCancelled,
	validateAswanCommand,
	readAswanAuditionLoad,
	validateAswanAuditionCall,
	aswanAuditionCancelled,
} from './code_endpoint.js';
export const ASWAN_SYNTH_BALANCE = 1.172528;
const DEADLINE = 15000;
const validateVolume = (value) => {
	if (!Number.isFinite(value) || value < 0 || value > 3.8)
		throw new RangeError('ASWAN Master must be 0..3.8');
};
export async function createAudio({ volume = 0.6, onError = () => {} } = {}) {
	validateVolume(volume);
	const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
	if (!Context) throw new Error('Web Audio is unavailable');
	const context = new Context({ latencyHint: 'interactive' }),
		controller = new AbortController(),
		pending = new Map();
	let node,
		balance,
		master,
		fade,
		songInput,
		closed = false,
		closing = null,
		fatal = null,
		sequence = 0,
		readyResolve,
		rejectStartup,
		startupTimer,
		owner = null,
		generation = 0,
		stopping = null;
	let auditionGeneration = 0,
		auditionLease = null;
	const startupFailure = new Promise((_, reject) => (rejectStartup = reject));
	void startupFailure.catch(() => {});
	const check = () => {
		if (fatal) throw fatal;
		if (closed || context.state === 'closed') throw new Error('Enable ASWAN audio again');
	};
	function dispose() {
		if (closing) return closing;
		closed = true;
		generation++;
		owner = null;
		auditionGeneration++;
		auditionLease = null;
		controller.abort();
		clearTimeout(startupTimer);
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(fatal ?? new Error('ASWAN audio closed'));
		}
		pending.clear();
		context.removeEventListener('statechange', contextClosed);
		if (node) {
			node.onprocessorerror = null;
			node.port.onmessage = node.port.onmessageerror = null;
			try {
				node.port.postMessage({ method: 'dispose' });
				node.disconnect();
				node.port.close();
			} catch {}
		}
		for (const output of [balance, fade, songInput, master]) output?.disconnect();
		return (closing = Promise.resolve().then(() =>
			context.state === 'closed' ? undefined : context.close(),
		));
	}
	function fail(error) {
		if (closed || fatal) return;
		fatal = error instanceof Error ? error : new Error(String(error));
		rejectStartup(fatal);
		try {
			onError(fatal);
		} catch {}
		void dispose().catch(() => {});
	}
	function contextClosed() {
		if (context.state === 'closed' && !closed) fail(new Error('ASWAN AudioContext closed'));
	}
	context.addEventListener('statechange', contextClosed);
	try {
		if (!context.audioWorklet)
			throw new Error('ASWAN requires AudioWorklet over HTTPS or localhost');
		startupTimer = setTimeout(
			() => fail(new Error('ASWAN initialization timed out')),
			DEADLINE,
		);
		const resumed = context.resume();
		const [wasmBinary] = await Promise.race([
			Promise.all([
				fetch(new URL('../generated/wonderswan_wasm.wasm', import.meta.url), {
					signal: controller.signal,
				}).then((response) => {
					if (!response.ok) throw new Error(`ASWAN WASM HTTP ${response.status}`);
					return response.arrayBuffer();
				}),
				context.audioWorklet.addModule(new URL('./processor.js', import.meta.url)),
				resumed,
			]),
			startupFailure,
		]);
		check();
		const ready = new Promise((resolve) => (readyResolve = resolve));
		node = new AudioWorkletNode(context, 'tetorica-aswan-synth', {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			processorOptions: { wasmBinary },
		});
		node.onprocessorerror = () => fail(new Error('ASWAN processor failed'));
		node.port.onmessageerror = () => fail(new Error('ASWAN processor reply could not be read'));
		node.port.onmessage = ({ data }) => {
			if (data?.fatal) {
				fail(new Error(data.error));
				return;
			}
			if (data?.ready) {
				readyResolve();
				return;
			}
			const request = pending.get(data?.id);
			if (!request) return;
			pending.delete(data.id);
			clearTimeout(request.timer);
			if (data.error) {
				const error = new Error(data.error);
				error.name = data.name ?? 'Error';
				request.reject(error);
			} else request.resolve(data.value);
		};
		await Promise.race([ready, startupFailure]);
		check();
		clearTimeout(startupTimer);
		balance = context.createGain();
		balance.gain.value = ASWAN_SYNTH_BALANCE;
		fade = context.createGain();
		fade.gain.value = 1;
		master = context.createGain();
		master.gain.value = volume;
		songInput = context.createGain();
		songInput.gain.value = ASWAN_SYNTH_BALANCE;
		node.connect(balance);
		balance.connect(fade);
		fade.connect(master);
		songInput.connect(master);
		master.connect(context.destination);
		function command(method, args = []) {
			check();
			validateAswanCommand(method, args);
			if (method === 'stop') {
				owner = null;
				generation++;
			}
			if (method === 'stop' || method === 'beginCode') {
				auditionGeneration++;
				auditionLease = null;
			}
			const id = ++sequence;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => fail(new Error('ASWAN processor timed out')),
					DEADLINE,
				);
				pending.set(id, { resolve, reject, timer });
				try {
					node.port.postMessage({ id, method, args });
				} catch (error) {
					clearTimeout(timer);
					pending.delete(id);
					reject(error);
				}
			});
		}
		async function getAswanClient() {
			check();
			if (stopping) await stopping;
			check();
			if (owner) return owner.promise;
			const next = { generation: ++generation, client: null, begin: null, promise: null };
			owner = next;
			const current = () =>
				!closed && !fatal && owner === next && next.generation === generation;
			next.begin = command('beginCode');
			next.promise = next.begin
				.then((metadata) => {
					if (!current()) throw aswanCodeCancelled();
					return (next.client = createAswanCodeClient({
						metadata,
						isCurrent: current,
						invoke: (method, args) => {
							if (!current()) throw aswanCodeCancelled();
							return command('code', [metadata.session, method, args]);
						},
						dispose: () => stopCode(next.client),
					}));
				})
				.catch((error) => {
					if (owner === next) owner = null;
					throw error;
				});
			return next.promise;
		}
		function stopCode(expected) {
			check();
			const previous = owner;
			if (expected && previous?.client !== expected) return Promise.resolve(false);
			if (!previous) return stopping ?? Promise.resolve(false);
			owner = null;
			generation++;
			const result = (stopping = previous.begin
				.then((metadata) => command('endCode', [metadata.session]))
				.finally(() => {
					if (stopping === result) stopping = null;
				}));
			return result;
		}
		async function loadAudition(preset, options) {
			check();
			const prepared = readAswanAuditionLoad(preset, options),
				lease = {
					token: prepared.options.token,
					generation: ++auditionGeneration,
					promise: null,
				};
			auditionLease = lease;
			const current = () =>
				!closed &&
				!fatal &&
				auditionLease === lease &&
				lease.generation === auditionGeneration;
			lease.promise = command('loadAudition', [prepared.preset, prepared.options])
				.then((result) => {
					if (!current()) throw aswanAuditionCancelled();
					return result;
				})
				.catch((error) => {
					const stale = !current();
					if (auditionLease === lease) auditionLease = null;
					throw stale ? aswanAuditionCancelled() : error;
				});
			return lease.promise;
		}
		async function invokeAudition(token, method, args = []) {
			check();
			validateAswanAuditionCall(method, args);
			const lease = auditionLease;
			const valid = () =>
				!closed &&
				!fatal &&
				lease &&
				auditionLease === lease &&
				lease.token === token &&
				lease.generation === auditionGeneration;
			if (!valid()) throw aswanAuditionCancelled();
			await lease.promise;
			if (!valid()) throw aswanAuditionCancelled();
			try {
				const result = await command('invokeAudition', [token, method, args]);
				if (!valid()) throw aswanAuditionCancelled();
				return result;
			} catch (error) {
				throw valid() ? error : aswanAuditionCancelled();
			}
		}
		function stopAudition(token) {
			check();
			if (token !== undefined && (typeof token !== 'string' || !token.length))
				throw new TypeError('Invalid audition token');
			if (token !== undefined && auditionLease?.token !== token)
				return Promise.resolve(false);
			auditionGeneration++;
			auditionLease = null;
			return command('stopAudition', token === undefined ? [] : [token]);
		}
		return {
			context,
			outputNode: master,
			codeInputNode: balance,
			codeOutputNode: fade,
			codeFadeNode: fade,
			songInputNode: songInput,
			command,
			read: () => command('read'),
			getAswanClient,
			stopCode,
			loadAudition,
			invokeAudition,
			stopAudition,
			readAudition: (token) => invokeAudition(token, 'read', []),
			dispose,
			setChipVolume(value) {
				check();
				validateVolume(value);
				balance.gain.value = value;
				songInput.gain.value = value;
			},
			setChannelEnabled: (channel, enabled) =>
				command('setChannelEnabled', [channel, enabled]),
			async resume() {
				check();
				try {
					await context.resume();
					check();
				} catch (error) {
					fail(error);
					throw error;
				}
			},
			setVolume(value) {
				check();
				validateVolume(value);
				const at = context.currentTime,
					parameter = master.gain;
				parameter.cancelScheduledValues(at);
				parameter.setValueAtTime(parameter.value, at);
				parameter.linearRampToValueAtTime(value, at + 0.01);
			},
		};
	} catch (error) {
		fail(error);
		await dispose().catch(() => {});
		throw error;
	}
}
