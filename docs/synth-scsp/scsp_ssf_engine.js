// SPDX-License-Identifier: BSD-3-Clause
const REQUEST_TIMEOUT_MS = 10000;

/** Run the sound CPU away from the transport thread. One bounded request can
 * be outstanding at a time, and stopping tears down the whole instance.
 */
export async function createScspSsfEngine(source, { signal } = {}) {
	signal?.throwIfAborted();
	if (typeof Worker !== 'function') throw new Error('SSF playback requires browser Workers');
	const worker = new Worker(new URL('./scsp_ssf_worker.js', import.meta.url), {
		type: 'module',
		name: 'scsp-ssf-reference',
	});
	let nextId = 1,
		pending = null,
		closed = false;
	const aborted = () => new DOMException('SSF playback cancelled', 'AbortError');
	const onAbort = () => dispose(aborted());
	signal?.addEventListener('abort', onAbort, { once: true });

	function dispose(error = aborted()) {
		if (closed) return;
		closed = true;
		signal?.removeEventListener('abort', onAbort);
		worker.terminate();
		if (pending) {
			clearTimeout(pending.timeout);
			pending.reject(error);
			pending = null;
		}
	}
	worker.onmessage = ({ data }) => {
		if (!pending || pending.id !== data?.id) return;
		if (data.error) return dispose(new Error(data.error));
		const request = pending;
		pending = null;
		clearTimeout(request.timeout);
		request.resolve(data.block);
	};
	worker.onerror = (event) => {
		event.preventDefault();
		dispose(new Error(event.message || 'SCSP SSF Worker failed'));
	};
	worker.onmessageerror = () => dispose(new Error('SCSP SSF Worker returned an unreadable message'));

	function ask(operation, payload, transfer = []) {
		if (closed) return Promise.reject(aborted());
		if (pending) return Promise.reject(new Error('SCSP SSF render already pending'));
		return new Promise((resolve, reject) => {
			const id = nextId++;
			const timeout = setTimeout(
				() => dispose(new Error(`SCSP SSF ${operation} exceeded its 10-second deadline`)),
				REQUEST_TIMEOUT_MS,
			);
			pending = { id, timeout, resolve, reject };
			try {
				worker.postMessage({ id, operation, ...payload }, transfer);
			} catch (error) {
				dispose(error);
			}
		});
	}
	try {
		const { totalSamples, lengthSeconds, fadeSeconds, volume } = source;
		const ram = source.ram.slice();
		await ask('open', { source: { ram, totalSamples, lengthSeconds, fadeSeconds, volume } }, [ram.buffer]);
		return { process: (frames) => ask('render', { frames }), dispose };
	} catch (error) {
		dispose(error);
		throw error;
	}
}
