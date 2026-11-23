// SPDX-License-Identifier: BSD-3-Clause
import { createSm511Controller } from './sm511.js';

class Sm511ControlProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions: { wasmBinary, wasmModule } }) {
		super();
		this.queue = [];
		this.active = false;
		this.done = false;
		this.port.onmessage = ({ data }) => {
			if (data.type === 'dispose') {
				this.done = true;
				this.queue.length = 0;
				this.port.close();
			} else if (!this.done) this.queue.push(data);
		};
		try {
			const module = wasmModule instanceof WebAssembly.Module ? wasmModule : new WebAssembly.Module(wasmBinary);
			const { exports } = new WebAssembly.Instance(module);
			this.controller = createSm511Controller(exports);
			this.controller.reset();
			this.port.postMessage({ type: 'ready' });
		} catch (error) { this.fail(error); }
	}

	fail(error) {
		this.done = true;
		this.queue.length = 0;
		this.port.postMessage({ type: 'error', error: String(error?.message ?? error) });
	}

	applyRequest({ type, words, op, arg }) {
		if (type === 'activate') {
			this.active = false;
			this.controller.reset();
			this.controller.load(words);
			this.active = true;
			return;
		}
		if (type === 'state') return this.controller.getState();
		if (type === 'command' && this.active) return this.controller.apply(op, arg);
		throw new Error('SM511 CPU control requires an active ROM.');
	}

	process(inputs, outputs) {
		if (this.done) return false;
		const output = outputs[0]?.[0];
		if (!output?.length) return true;
		// Leave a full audio quantum before issuing another CPU command. Acknowledge
		// only after rendering, when native timing has applied the instruction.
		const request = this.queue.shift();
		let value;
		let requestError;
		try {
			if (request) value = this.applyRequest(request);
		} catch (error) { requestError = String(error?.message ?? error); }
		try {
			if (this.active) this.controller.renderInto(output, sampleRate);
		} catch (error) {
			output.fill(0);
			this.fail(error);
			return false;
		}
		if (request) this.port.postMessage({ id: request.id, value, error: requestError });
		return true;
	}
}

registerProcessor('tetorica-sm511-control', Sm511ControlProcessor);
