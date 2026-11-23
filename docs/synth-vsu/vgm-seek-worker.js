// SPDX-License-Identifier: BSD-3-Clause
import { createVgmSeekRenderer } from './vgm-seek.js';

let renderer, plan, running = null, waiting = null;
let draining = false;

async function drain() {
	if (draining) return;
	draining = true;
	while (waiting) {
		const job = running = waiting;
		waiting = null;
		try {
			const render = await renderer;
			const result = await render.seek(job.plan, job.tick, { signal: job.controller.signal });
			if (!job.controller.signal.aborted) postMessage({ id: job.id, result }, [result.bytes.buffer]);
		} catch (error) {
			if (!job.controller.signal.aborted) postMessage({ id: job.id, error: error.message });
		}
		running = null;
	}
	draining = false;
}

self.onmessage = ({ data }) => {
	if (data.type === 'initialize') {
		renderer = WebAssembly.instantiate(data.wasmBinary)
			.then(({ instance }) => createVgmSeekRenderer(instance.exports, data.sampleRate));
		// A following seek receives the same error if the module cannot load.
		void renderer.catch(() => {});
	} else if (data.type === 'seek') {
		if (data.plan) plan = data.plan;
		running?.controller.abort();
		waiting = { id: data.id, tick: data.tick, plan, controller: new AbortController() };
		void drain();
	} else if (data.type === 'cancel') {
		if (running?.id === data.id) running.controller.abort();
		if (waiting?.id === data.id) waiting = null;
	}
};
