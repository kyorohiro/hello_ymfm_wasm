// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { AswanInstrument } from './instrument.js';
import { validateAswanCommand } from './code_endpoint.js';
class AswanProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions = {} } = {}) {
		super();
		this.dead = false;
		this.ready = WonderSwanAudioEngine.create({
			moduleFactory: factory,
			moduleOptions: { wasmBinary: processorOptions.wasmBinary },
			outputSampleRate: sampleRate,
		})
			.then((core) => {
				if (this.dead) {
					core.dispose();
					return;
				}
				this.instrument = new AswanInstrument(core);
				this.port.postMessage({ ready: true, state: this.instrument.read() });
			})
			.catch((error) => this.port.postMessage({ fatal: true, error: error.message }));
		this.port.onmessage = ({ data }) => {
			if (data.method === 'dispose') {
				this.dead = true;
				this.instrument?.dispose();
				return;
			}
			void this.ready.then(() => {
				if (this.dead) return;
				try {
					validateAswanCommand(data.method, data.args ?? []);
					const value = this.instrument[data.method](...(data.args ?? []));
					this.port.postMessage({ id: data.id, value });
				} catch (error) {
					this.port.postMessage({ id: data.id, error: error.message, name: error.name });
				}
			});
		};
	}
	process(_inputs, outputs) {
		if (this.dead) return false;
		const [left, right] = outputs[0] ?? [];
		if (left && right) {
			if (this.instrument) this.instrument.process(left, right, left.length);
			else {
				left.fill(0);
				right.fill(0);
			}
		}
		return true;
	}
}
registerProcessor('tetorica-aswan-synth', AswanProcessor);
