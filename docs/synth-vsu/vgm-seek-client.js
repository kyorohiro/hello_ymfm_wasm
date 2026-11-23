// SPDX-License-Identifier: BSD-3-Clause

const canceled = () => new DOMException('VGM seek canceled.', 'AbortError');

export function createVgmSeekClient({ wasmBinary, sampleRate }) {
	let worker = null, loadedPlan = null, pending = null, nextId = 0, disposed = false;

	function finish() {
		const request = pending;
		pending = null;
		request?.signal?.removeEventListener('abort', request.abort);
		return request;
	}

	function cancel(reason) {
		const request = finish();
		if (!request) return;
		request.reject(reason);
		worker.postMessage({ type: 'cancel', id: request.id });
	}

	function closeWorker(error) {
		finish()?.reject(error);
		worker?.terminate();
		worker = null;
		loadedPlan = null;
	}

	function startWorker() {
		const next = new Worker(new URL('./vgm-seek-worker.js', import.meta.url), { type: 'module' });
		worker = next;
		next.onmessage = ({ data }) => {
			if (worker !== next || data.id !== pending?.id) return;
			const request = finish();
			if (data.error) request.reject(new Error(data.error));
			else request.resolve(data.result);
		};
		next.onerror = event => {
			if (worker !== next) return;
			event.preventDefault();
			closeWorker(new Error(event.message || 'Could not load the VGM seek worker.'));
		};
		next.onmessageerror = () => {
			if (worker === next) closeWorker(new Error('Could not read the VGM seek state.'));
		};
		next.postMessage({ type: 'initialize', wasmBinary, sampleRate });
	}

	return {
		async seek(plan, tick, { signal } = {}) {
			if (disposed) throw canceled();
			signal?.throwIfAborted();
			if (!Number.isInteger(tick) || tick < 0 || tick > plan.durationTicks)
				throw new RangeError('Choose a position within the VGM track.');
			cancel(canceled());
			return new Promise((resolve, reject) => {
				const id = ++nextId;
				if (!worker) startWorker();
				const changed = plan !== loadedPlan;
				const writes = changed ? plan.writes.slice() : null;
				const abort = () => {
					if (pending?.id === id) cancel(signal.reason ?? canceled());
				};
				pending = { id, signal, abort, resolve, reject };
				signal?.addEventListener('abort', abort, { once: true });
				try {
					worker.postMessage({ type: 'seek', id, tick, plan: changed ? { writes, durationTicks: plan.durationTicks } : null },
						writes ? [writes.buffer] : []);
					loadedPlan = plan;
				} catch (error) { closeWorker(error); }
			});
		},
		dispose() {
			disposed = true;
			closeWorker(canceled());
		},
	};
}
