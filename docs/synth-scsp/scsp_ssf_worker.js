// SPDX-License-Identifier: BSD-3-Clause
import { createScspSsfWasmRenderer } from './scsp_ssf_wasm.js';

const wasmUrl = new URL('../generated/scsp-ssf/scsp-ssf.wasm?v=mute-1', import.meta.url);
let renderer = null;
let ready = null;
self.onmessage = async ({ data }) => {
	const { id, operation } = data;
	try {
		if (operation === 'open' && !ready) {
			ready = (async () => {
				const response = await fetch(wasmUrl);
				if (!response.ok) throw new Error(`SCSP SSF WASM could not be loaded (${response.status})`);
				renderer = await createScspSsfWasmRenderer(await response.arrayBuffer(), data.source);
			})();
			await ready;
			self.postMessage({ id });
		} else if (operation === 'render' && ready) {
			await ready;
			const block = renderer.process(data.frames, data.muteMask);
			self.postMessage({ id, block }, [block.left.buffer, block.right.buffer]);
		} else throw new Error('Invalid SCSP SSF Worker request');
	} catch (error) {
		renderer?.dispose();
		self.postMessage({ id, error: error?.message ?? String(error) });
	}
};
