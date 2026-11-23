// SPDX-License-Identifier: BSD-3-Clause
const PROCESSOR_NAME = 'tetorica-sm511-control';
const TIMEOUT_MS = 5000;
const workletLoads = new WeakMap();

function loadWorklet(context) {
	let loading = workletLoads.get(context);
	if (!loading) {
		const moduleUrl = new URL('./sm511-control-worklet.js', import.meta.url);
		loading = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('SM511 AudioWorklet module did not load.')), TIMEOUT_MS);
			context.audioWorklet.addModule(moduleUrl).then(resolve, reject).finally(() => clearTimeout(timeout));
		});
		workletLoads.set(context, loading);
		loading.catch(() => workletLoads.delete(context));
	}
	return loading;
}

function createNode(context, wasmBinary, wasmModule) {
	const options = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] };
	try {
		return new AudioWorkletNode(context, PROCESSOR_NAME, {
			...options, processorOptions: { wasmBinary, wasmModule },
		});
	} catch (error) {
		if (error.name !== 'DataCloneError') throw error;
		return new AudioWorkletNode(context, PROCESSOR_NAME, {
			...options, processorOptions: { wasmBinary },
		});
	}
}

// The caller owns and resumes the AudioContext. The connection stays silent
// until an activation has loaded the ROM and the controller enables its pin.
export async function createSm511ControlAudio(context, output, wasmBinary) {
	if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined')
		throw new Error('SM511 CPU control requires AudioWorklet support.');
	const [wasmModule] = await Promise.all([WebAssembly.compile(wasmBinary), loadWorklet(context)]);
	const node = createNode(context, wasmBinary, wasmModule);
	const pending = new Map();
	let nextId = 0;
	let failure;
	let resolveReady;
	let rejectReady;
	const ready = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const readyTimer = setTimeout(() => close(new Error('SM511 AudioWorklet did not become ready.')), TIMEOUT_MS);

	function contextStateChanged() {
		if (context.state === 'closed') close(new Error('SM511 AudioContext was closed.'));
	}

	function close(error) {
		if (failure) return;
		failure = error;
		clearTimeout(readyTimer);
		rejectReady(error);
		for (const { timeout, reject } of pending.values()) {
			clearTimeout(timeout);
			reject(error);
		}
		pending.clear();
		context.removeEventListener('statechange', contextStateChanged);
		node.onprocessorerror = null;
		node.port.onmessage = null;
		node.port.onmessageerror = null;
		try { node.port.postMessage({ type: 'dispose' }); }
		finally {
			node.disconnect();
			node.port.close();
		}
	}

	function request(type, details = {}) {
		if (failure) return Promise.reject(failure);
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => close(new Error(`SM511 AudioWorklet timed out during ${type}.`)), TIMEOUT_MS);
			pending.set(id, { timeout, resolve, reject });
			try { node.port.postMessage({ type, id, ...details }); }
			catch (error) {
				pending.delete(id);
				clearTimeout(timeout);
				reject(error);
			}
		});
	}

	node.onprocessorerror = () => close(new Error('SM511 AudioWorklet processor failed.'));
	node.port.onmessageerror = () => close(new Error('SM511 AudioWorklet response could not be decoded.'));
	node.port.onmessage = ({ data }) => {
		if (data.type === 'ready') {
			clearTimeout(readyTimer);
			resolveReady();
			return;
		}
		if (data.type === 'error') {
			close(new Error(data.error));
			return;
		}
		const entry = pending.get(data.id);
		if (!entry) return;
		pending.delete(data.id);
		clearTimeout(entry.timeout);
		if (data.error) entry.reject(new Error(data.error));
		else entry.resolve(data.value);
	};
	context.addEventListener('statechange', contextStateChanged);
	try { node.connect(output); }
	catch (error) { close(error); }
	contextStateChanged();
	await ready;
	if (failure) throw failure;
	return {
		activate: words => request('activate', { words }),
		command: (op, arg = 0) => request('command', { op, arg }),
		getState: () => request('state'),
		dispose: () => close(new Error('SM511 AudioWorklet was disposed.')),
	};
}
