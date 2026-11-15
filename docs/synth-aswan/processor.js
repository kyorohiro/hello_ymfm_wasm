// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { AswanInstrument } from './instrument.js';
import {
	validateAswanCommand,
	readAswanAuditionLoad,
	validateAswanAuditionCall,
	aswanAuditionCancelled,
} from './code_endpoint.js';
class AswanProcessor extends AudioWorkletProcessor {
	constructor({ processorOptions = {} } = {}) {
		super();
		this.dead = false;
		this.audition = null;
		this.auditionLoading = null;
		this.auditionToken = null;
		this.pendingAuditionToken = null;
		this.auditionGeneration = 0;
		this.auditionOptions = null;
		this.auditionLeft = new Float32Array(128);
		this.auditionRight = new Float32Array(128);
		this.ready = WonderSwanAudioEngine.create({
			moduleFactory: async (options) => (this.module = await factory(options)),
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
				this.invalidateAudition();
				this.audition?.dispose();
				this.instrument?.dispose();
				return;
			}
			let prepared = null,
				ticket;
			try {
				validateAswanCommand(data.method, data.args ?? []);
				if (data.method === 'loadAudition') {
					prepared = readAswanAuditionLoad(...data.args);
					ticket = ++this.auditionGeneration;
					this.pendingAuditionToken = prepared.options.token;
				} else if (data.method === 'stopAudition') {
					const token = data.args?.[0];
					if (token !== undefined && (typeof token !== 'string' || !token.length))
						throw new TypeError('Invalid audition token');
					if (token === undefined || token === this.pendingAuditionToken) {
						++this.auditionGeneration;
						this.pendingAuditionToken = null;
					}
				} else if (data.method === 'stop' || data.method === 'beginCode')
					this.invalidateAudition();
			} catch (error) {
				this.port.postMessage({ id: data.id, error: error.message, name: error.name });
				return;
			}
			void this.ready.then(async () => {
				if (this.dead) return;
				try {
					let value;
					if (data.method === 'loadAudition') {
						const audition = await this.ensureAudition();
						if (
							this.dead ||
							ticket !== this.auditionGeneration ||
							this.pendingAuditionToken !== prepared.options.token
						)
							throw aswanAuditionCancelled();
						audition.stop();
						audition.synth.initialize();
						audition.setPreset(prepared.preset, prepared.options.channel);
						audition.setPitch(this.instrument.pitch);
						for (let ch = 0; ch < 4; ch++)
							audition.setChannelEnabled(ch, !this.instrument.core.mutedChannels[ch]);
						this.auditionToken = prepared.options.token;
						this.pendingAuditionToken = null;
						this.auditionOptions = prepared.options;
						value = { token: this.auditionToken, state: this.readAudition() };
					} else if (data.method === 'invokeAudition') {
						const [token, method, args] = data.args;
						this.checkAudition(token);
						validateAswanAuditionCall(method, args);
						if (method === 'read') value = this.readAudition();
						else if (method === 'setPreset' || method === 'editPreset') {
							for (const preset of args)
								readAswanAuditionLoad(preset, this.auditionOptions);
							if (method === 'setPreset')
								this.audition.setPreset(args[0], this.auditionOptions.channel);
							else
								this.audition.editPreset(
									args[0],
									args[1],
									this.auditionOptions.channel,
								);
							value = this.readAudition();
						} else if (method === 'noteOn') {
							value = this.audition.noteOn(
								args[0],
								args[1],
								this.auditionOptions.channel,
							);
							const voice = this.audition.voices.get(args[0]);
							voice.midi +=
								12 *
								Math.log2(
									this.auditionOptions.frequencyHz /
										(440 *
											2 ** ((this.auditionOptions.referenceMidi - 69) / 12)),
								);
							this.audition._tune(voice);
						} else value = this.audition[method](...args);
					} else if (data.method === 'readAudition') {
						this.checkAudition(data.args[0]);
						value = this.readAudition();
					} else if (data.method === 'stopAudition') {
						const token = data.args?.[0];
						if (token !== undefined && token !== this.auditionToken) value = false;
						else {
							this.audition?.stop();
							this.auditionToken = null;
							this.auditionOptions = null;
							value = true;
						}
					} else {
						value = this.instrument[data.method](...(data.args ?? []));
						if (data.method === 'setPitch') this.audition?.setPitch(data.args[0]);
						if (data.method === 'setChannelEnabled')
							this.audition?.setChannelEnabled(...data.args);
					}
					this.port.postMessage({ id: data.id, value });
				} catch (error) {
					this.port.postMessage({ id: data.id, error: error.message, name: error.name });
				}
			});
		};
	}
	invalidateAudition() {
		++this.auditionGeneration;
		this.pendingAuditionToken = null;
		this.auditionToken = null;
		this.auditionOptions = null;
		this.audition?.stop();
	}
	checkAudition(token) {
		if (!this.audition || typeof token !== 'string' || token !== this.auditionToken)
			throw aswanAuditionCancelled();
	}
	readAudition() {
		const state = this.audition.read(),
			options = this.auditionOptions;
		return {
			...state,
			preset: state.channels[options.channel].authoredPreset,
			editorSource: state.channels[options.channel].preset.source,
			audition: { ...options },
		};
	}
	ensureAudition() {
		if (this.audition) return Promise.resolve(this.audition);
		if (!this.auditionLoading)
			this.auditionLoading = WonderSwanAudioEngine.create({
				moduleFactory: () => this.module,
				outputSampleRate: sampleRate,
			})
				.then((core) => {
					if (this.dead) {
						core.dispose();
						throw aswanAuditionCancelled();
					}
					return (this.audition = new AswanInstrument(core));
				})
				.finally(() => {
					this.auditionLoading = null;
				});
		return this.auditionLoading;
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
			if (this.auditionToken && this.audition?.voices.size) {
				if (left.length > this.auditionLeft.length) {
					const size = 2 ** Math.ceil(Math.log2(left.length));
					this.auditionLeft = new Float32Array(size);
					this.auditionRight = new Float32Array(size);
				}
				this.audition.process(this.auditionLeft, this.auditionRight, left.length);
				for (let i = 0; i < left.length; i++) {
					left[i] += this.auditionLeft[i];
					right[i] += this.auditionRight[i];
				}
			}
		}
		return true;
	}
}
registerProcessor('tetorica-aswan-synth', AswanProcessor);
