// SPDX-License-Identifier: BSD-3-Clause
const modules = new WeakMap();
export async function createSmsGearSongPlayer(
	context,
	output,
	plan,
	{ signal } = {},
) {
	signal?.throwIfAborted();
	let module = modules.get(context);
	if (!module) {
		module = context.audioWorklet.addModule(
			new URL("./song_worklet.js", import.meta.url),
		);
		modules.set(context, module);
		module.catch(() => modules.delete(context));
	}
	const binary = async (name) => {
		const response = await fetch(
			new URL(`../generated/${name}_wasm.wasm`, import.meta.url),
			{ signal },
		);
		if (!response.ok) throw Error(`${name} WASM HTTP ${response.status}`);
		return response.arrayBuffer();
	};
	const [opllBinary, psgBinary] = await Promise.all([
		binary("ym2413"),
		binary("segapsg"),
		module,
	]);
	signal?.throwIfAborted();
	const node = new AudioWorkletNode(context, "tetorica-smsgear-song", {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		processorOptions: { plan, opllBinary, psgBinary },
	});
	let closed = false,
		sequence = 0;
	const pending = new Map();
	let readyResolve, readyReject;
	const ready = new Promise((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	const timeout = setTimeout(
		() => readyReject(Error("Song initialization timed out")),
		15000,
	);
	node.port.onmessage = ({ data }) => {
		if (data.ready) {
			clearTimeout(timeout);
			readyResolve();
			return;
		}
		const request = pending.get(data.id);
		if (request) {
			pending.delete(data.id);
			clearTimeout(request.timeout);
			data.error
				? request.reject(Error(data.error))
				: request.resolve(data.value);
		} else if (data.error) readyReject(Error(data.error));
	};
	node.onprocessorerror = () => {
		readyReject(Error("SMSGEAR song processor failed"));
		for (const request of pending.values()) {
			clearTimeout(request.timeout);
			request.reject(Error("SMSGEAR song processor failed"));
		}
		pending.clear();
	};
	const dispose = () => {
		if (closed) return;
		closed = true;
		clearTimeout(timeout);
		readyReject(new DOMException("Song closed", "AbortError"));
		for (const request of pending.values()) {
			clearTimeout(request.timeout);
			request.reject(new DOMException("Song closed", "AbortError"));
		}
		pending.clear();
		node.port.postMessage({ method: "dispose" });
		node.disconnect();
		node.port.close();
		signal?.removeEventListener("abort", dispose);
	};
	signal?.addEventListener("abort", dispose, { once: true });
	try {
		await ready;
		signal?.throwIfAborted();
		if (closed) throw new DOMException("Song cancelled", "AbortError");
		signal?.removeEventListener("abort", dispose);
		node.connect(output);
	} catch (error) {
		dispose();
		throw error;
	}
	const request = (method, value) =>
		new Promise((resolve, reject) => {
			if (closed) {
				reject(Error("Song closed"));
				return;
			}
			const id = ++sequence,
				timeout =
					method === "seek"
						? null
						: setTimeout(() => {
								pending.delete(id);
								reject(Error("Song control timed out"));
							}, 5000);
			pending.set(id, { resolve, reject, timeout });
			node.port.postMessage({ id, method, value });
		});
	return {
		node,
		play: () => request("play"),
		pause: () => request("pause"),
		stop: () => request("reset"),
		seek: (seconds) => request("seek", seconds),
		snapshot: () => request("snapshot"),
		editSound: (value) => request("editSound", value),
		setMix: (value) => request("mix", value),
		setChannelMutes: (value) => request("channelMutes", value),
		dispose,
	};
}
